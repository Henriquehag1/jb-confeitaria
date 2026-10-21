-- JB OS · plano: uma ou mais pessoas por item e quanto cada uma fez (21/10/2026)
-- quem: lista de destinos do item: 'todos', 'producao', 'equipe', 'freelas' (as freelas do dia) e 'fr:Nome'.
--       Preenchida, ela manda; vazia, vale o para/para_freela de antes.
-- jb_producao_registro: cada pessoa diz quanto fez daquele item (na mesma unidade do item: un ou kg).
--       Registrar de novo corrige o número dela. O item fica feito quando a soma chega no pedido
--       ou quando todas as pessoas nomeadas já registraram (fez menos também fecha).
-- Sem as palavras que travam o conector.

alter table public.jb_producao_item add column if not exists quem text[]
  check (quem is null or cardinality(quem) between 1 and 12);

create table if not exists public.jb_producao_registro (
  id             bigint generated always as identity primary key,
  item_id        bigint not null,
  nome           text not null check (length(btrim(nome)) between 1 and 60),
  qtd            numeric not null check (qtd >= 0 and qtd <= 100000),
  registrado_por uuid,
  freela_id      bigint,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists jb_producao_registro_un on public.jb_producao_registro (item_id, lower(btrim(nome)));
alter table public.jb_producao_registro enable row level security;
create policy jb_producao_registro_sel on public.jb_producao_registro for select
  using (public.jb_e_gestor() or (public.jb_e_membro() and exists (select 1 from public.jb_producao_dia d where d.id = item_id)));
grant select on public.jb_producao_registro to authenticated;

create or replace function public.jb_item_visivel(p_quem text[], p_para text, p_para_freela text, p_papel text, p_freela text)
 returns boolean
 language sql
 immutable
as $function$
  select case
    when p_quem is not null then
      'todos' = any(p_quem)
      or (p_papel is not null and p_papel = any(p_quem))
      or (p_freela is not null and ('freelas' = any(p_quem)
            or exists (select 1 from unnest(p_quem) q where lower(btrim(q)) = 'fr:' || lower(btrim(p_freela)))))
    when p_freela is not null then
      (p_para_freela is null and p_para = 'todos') or p_para_freela = '*' or lower(btrim(p_para_freela)) = lower(btrim(p_freela))
    else
      p_para_freela is null and (p_para = 'todos' or p_para = p_papel)
  end
$function$;

alter policy jb_producao_sel on public.jb_producao_item
  using (public.jb_e_gestor() or (public.jb_e_membro() and public.jb_item_visivel(quem, para, para_freela, public.jb_meu_papel(), null)));

create or replace view public.jb_producao_dia as
 select p.id, p.data, p.tipo, p.ref_id, p.qtd, p.feito, p.feito_em, p.obs,
        case when p.tipo = 'ficha' then f.nome else s.nome end as nome,
        case when p.tipo = 'ficha' then f.rendimento_un else s.rendimento_kg end as rendimento,
        case when p.tipo = 'ficha' then 'un'::text else 'kg'::text end as unidade,
        coalesce(case when p.tipo = 'ficha' then f.preparo_conferido else s.preparo_conferido end, false) as preparo_conferido,
        case when p.tipo = 'ficha' then f.modo_preparo else s.modo_preparo end as modo_preparo,
        case when p.tipo = 'ficha' then f.foto_url else null::text end as foto_url,
        p.para,
        case when p.tipo = 'subreceita' then s.unidade_producao else null::text end as unidade_producao,
        p.para_freela,
        p.feito_por,
        p.quem,
        (select sum(r.qtd) from public.jb_producao_registro r where r.item_id = p.id) as feito_qtd,
        (select jsonb_agg(jsonb_build_object('nome', r.nome, 'qtd', r.qtd, 'em', r.atualizado_em) order by r.atualizado_em)
           from public.jb_producao_registro r where r.item_id = p.id) as feitos
   from public.jb_producao_item p
   left join public.jb_ficha f on p.tipo = 'ficha' and f.id = p.ref_id
   left join public.jb_subreceita s on p.tipo = 'subreceita' and s.id = p.ref_id
  where public.jb_e_membro()
    and (public.jb_e_gestor() or public.jb_item_visivel(p.quem, p.para, p.para_freela, public.jb_meu_papel(), null));

create or replace function public.jb_pode_ver_receita(p_tipo text, p_id bigint)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select case jb_meu_papel()
    when 'gestor' then true
    when 'producao' then true
    when 'equipe' then exists (
      select 1 from jb_producao_item p
       where public.jb_item_visivel(p.quem, p.para, p.para_freela, 'equipe', null)
         and p.data >= (now() at time zone 'America/Sao_Paulo')::date - 1
         and ((p.tipo = p_tipo and p.ref_id = p_id)
              or (p_tipo = 'subreceita' and p.tipo = 'ficha' and exists (
                    select 1 from jb_ficha_item fi join jb_subreceita s on s.nome = fi.ingrediente
                     where fi.ficha_id = p.ref_id and s.id = p_id))))
    else false end
$function$;

create or replace function interno.jb_freela_ve(p public.jb_producao_item, a public.jb_freela_acesso)
 returns boolean
 language sql
 immutable
as $function$
  select public.jb_item_visivel(p.quem, p.para, p.para_freela, null, a.nome)
$function$;

-- registra (ou corrige) quanto uma pessoa fez e fecha o item quando for o caso
create or replace function interno.jb_registrar_feito(p_item bigint, p_nome text, p_qtd numeric, p_uid uuid, p_freela bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  it public.jb_producao_item;
  v_total numeric;
  v_esperados text[];
  v_faltam integer;
  v_feito boolean;
  v_nomes text;
begin
  select * into it from public.jb_producao_item where id = p_item;
  if it.id is null then raise exception 'item nao encontrado'; end if;
  if p_qtd is null or p_qtd < 0 or p_qtd > 100000 then raise exception 'quantidade invalida'; end if;

  insert into public.jb_producao_registro (item_id, nome, qtd, registrado_por, freela_id)
  values (p_item, btrim(p_nome), p_qtd, p_uid, p_freela)
  on conflict (item_id, lower(btrim(nome))) do update
     set qtd = excluded.qtd, atualizado_em = now(), registrado_por = excluded.registrado_por, freela_id = excluded.freela_id;

  select coalesce(sum(qtd), 0), string_agg(nome, ', ' order by atualizado_em)
    into v_total, v_nomes from public.jb_producao_registro where item_id = p_item;

  -- quem foi nomeado no item (sem "todos" nem "freelas"): todos registraram?
  if it.quem is not null and not ('todos' = any(it.quem) or 'freelas' = any(it.quem)) then
    select array_agg(n) into v_esperados from (
      select lower(btrim(substr(q, 4))) n from unnest(it.quem) q where q like 'fr:%'
      union
      select lower(btrim(u.nome)) from public.jb_usuario u where u.ativo and u.papel in ('producao', 'equipe') and u.papel = any(it.quem)
    ) x;
    select count(*) into v_faltam from unnest(coalesce(v_esperados, '{}')) e
     where not exists (select 1 from public.jb_producao_registro r where r.item_id = p_item and lower(btrim(r.nome)) = e);
  end if;

  v_feito := v_total >= it.qtd or (v_esperados is not null and cardinality(v_esperados) > 0 and v_faltam = 0);
  update public.jb_producao_item
     set feito = v_feito, feito_em = case when v_feito then coalesce(feito_em, now()) else null end, feito_por = v_nomes
   where id = p_item;
  return jsonb_build_object('feito', v_feito, 'total', v_total, 'pedido', it.qtd);
end $function$;

create or replace function public.jb_producao_registrar(p_id bigint, p_qtd numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  it public.jb_producao_item;
  v_nome text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.jb_e_membro() then raise exception 'sem acesso' using errcode = '42501'; end if;
  select * into it from public.jb_producao_item where id = p_id;
  if it.id is null then raise exception 'item nao encontrado'; end if;
  if not public.jb_e_gestor() then
    if not public.jb_item_visivel(it.quem, it.para, it.para_freela, public.jb_meu_papel(), null)
       or it.data not in (v_hoje, v_hoje - 1) then
      raise exception 'item fora do seu dia' using errcode = '42501';
    end if;
  end if;
  select u.nome into v_nome from public.jb_usuario u where u.user_id = auth.uid();
  return interno.jb_registrar_feito(p_id, coalesce(v_nome, 'Equipe'), p_qtd, auth.uid(), null);
end $function$;

create or replace function public.jb_freela_registrar(p_token text, p_id bigint, p_qtd numeric)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  a public.jb_freela_acesso;
  it public.jb_producao_item;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  select * into it from public.jb_producao_item where id = p_id;
  if it.id is null or it.data <> v_hoje or not interno.jb_freela_ve(it, a) then
    raise exception 'item fora do seu dia' using errcode = '42501';
  end if;
  return interno.jb_registrar_feito(p_id, a.nome, p_qtd, null, a.id);
end $function$;

-- o dia da freela agora traz quem e o que já foi feito
create or replace function public.jb_freela_producao(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  a public.jb_freela_acesso;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fichas integer[];
  v_subs integer[];
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false); end if;

  select coalesce(array_agg(p.ref_id) filter (where p.tipo = 'ficha'), '{}'),
         coalesce(array_agg(p.ref_id) filter (where p.tipo = 'subreceita'), '{}')
    into v_fichas, v_subs
    from public.jb_producao_item p
   where p.data = v_hoje and interno.jb_freela_ve(p, a);

  -- as massas e recheios que entram nos doces dela também abrem
  select v_subs || coalesce(array_agg(distinct s.id), '{}') into v_subs
    from public.jb_ficha_item fi join public.jb_subreceita s on s.nome = fi.ingrediente and s.ativo
   where fi.ficha_id = any(v_fichas);

  return jsonb_build_object(
    'ok', true,
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'data', p.data, 'tipo', p.tipo, 'ref_id', p.ref_id, 'qtd', p.qtd, 'feito', p.feito, 'feito_em', p.feito_em,
        'feito_por', p.feito_por, 'obs', p.obs,
        'nome', case when p.tipo = 'ficha' then f.nome else s.nome end,
        'rendimento', case when p.tipo = 'ficha' then f.rendimento_un else s.rendimento_kg end,
        'unidade', case when p.tipo = 'ficha' then 'un' else 'kg' end,
        'preparo_conferido', coalesce(case when p.tipo = 'ficha' then f.preparo_conferido else s.preparo_conferido end, false),
        'modo_preparo', case when p.tipo = 'ficha' then f.modo_preparo else s.modo_preparo end,
        'foto_url', case when p.tipo = 'ficha' then f.foto_url end,
        'para', p.para, 'para_freela', p.para_freela, 'quem', p.quem,
        'feito_qtd', (select sum(r.qtd) from public.jb_producao_registro r where r.item_id = p.id),
        'feitos', (select jsonb_agg(jsonb_build_object('nome', r.nome, 'qtd', r.qtd, 'em', r.atualizado_em) order by r.atualizado_em)
                     from public.jb_producao_registro r where r.item_id = p.id),
        'unidade_producao', case when p.tipo = 'subreceita' then s.unidade_producao end))
      from public.jb_producao_item p
      left join public.jb_ficha f on p.tipo = 'ficha' and f.id = p.ref_id
      left join public.jb_subreceita s on p.tipo = 'subreceita' and s.id = p.ref_id
     where p.data = v_hoje and interno.jb_freela_ve(p, a)), '[]'::jsonb),
    'fichas', coalesce((select jsonb_agg(jsonb_build_object('ficha_id', f.id, 'nome', f.nome, 'rendimento_un', f.rendimento_un,
        'tempo_mo_min', f.tempo_mo_min, 'modo_preparo', f.modo_preparo, 'preparo_conferido', f.preparo_conferido,
        'rascunho', f.rascunho, 'foto_url', f.foto_url))
      from public.jb_ficha f where f.ativo and f.id = any(v_fichas)), '[]'::jsonb),
    'ficha_itens', coalesce((select jsonb_agg(jsonb_build_object('ficha_id', i.ficha_id, 'ordem', i.ordem, 'ingrediente', i.ingrediente,
        'unidade', i.unidade, 'qtd', i.qtd,
        'e_subreceita', exists (select 1 from public.jb_subreceita s where s.nome = i.ingrediente and s.ativo),
        'subreceita_id', (select s.id from public.jb_subreceita s where s.nome = i.ingrediente and s.ativo limit 1)))
      from public.jb_ficha_item i where i.ficha_id = any(v_fichas)), '[]'::jsonb),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('subreceita_id', s.id, 'nome', s.nome, 'rendimento_kg', s.rendimento_kg,
        'modo_preparo', s.modo_preparo, 'preparo_conferido', s.preparo_conferido, 'unidade_producao', s.unidade_producao))
      from public.jb_subreceita s where s.ativo and s.id = any(v_subs)), '[]'::jsonb),
    'sub_itens', coalesce((select jsonb_agg(jsonb_build_object('subreceita_id', i.subreceita_id, 'ordem', i.ordem, 'ingrediente', i.ingrediente,
        'unidade', i.unidade, 'qtd', i.qtd))
      from public.jb_subreceita_item i where i.subreceita_id = any(v_subs)), '[]'::jsonb)
  );
end $function$;

grant execute on function public.jb_producao_registrar(bigint, numeric) to authenticated;
grant execute on function public.jb_freela_registrar(text, bigint, numeric) to anon, authenticated;
