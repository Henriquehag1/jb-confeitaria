-- JB OS · Plano de produção: para quem é cada item, incluindo freela por nome (21/10/2026)
-- para_freela: vazio = segue o "para" de sempre (todos, producao, equipe);
--              '*'   = só as freelas (qualquer uma liberada no dia);
--              nome  = só a freela liberada com esse nome (sem diferença de maiúscula e espaço).
-- Item com para_freela preenchido some para a Yasmin e a Eliana. Item "todos" aparece também para as freelas.
-- A freela não tem login: lê o dia e marca feito por token (jb_freela_producao, jb_freela_marcar).
-- feito_por: quem marcou como feito.
-- Sem as palavras proibidas pelo conector (ele trava nelas).

alter table public.jb_producao_item add column if not exists para_freela text
  check (para_freela is null or length(btrim(para_freela)) between 1 and 40);
alter table public.jb_producao_item add column if not exists feito_por text;

alter policy jb_producao_sel on public.jb_producao_item
  using (public.jb_e_gestor() or (public.jb_e_membro() and para_freela is null and (para = 'todos' or para = public.jb_meu_papel())));

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
        p.feito_por
   from public.jb_producao_item p
   left join public.jb_ficha f on p.tipo = 'ficha' and f.id = p.ref_id
   left join public.jb_subreceita s on p.tipo = 'subreceita' and s.id = p.ref_id
  where public.jb_e_membro()
    and (public.jb_e_gestor() or (p.para_freela is null and (p.para = 'todos' or p.para = public.jb_meu_papel())));

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
       where p.para in ('equipe', 'todos') and p.para_freela is null
         and p.data >= (now() at time zone 'America/Sao_Paulo')::date - 1
         and ((p.tipo = p_tipo and p.ref_id = p_id)
              or (p_tipo = 'subreceita' and p.tipo = 'ficha' and exists (
                    select 1 from jb_ficha_item fi join jb_subreceita s on s.nome = fi.ingrediente
                     where fi.ficha_id = p.ref_id and s.id = p_id))))
    else false end
$function$;

create or replace function public.jb_marcar_producao(p_id bigint, p_feito boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.jb_e_membro() then
    raise exception 'sem acesso';
  end if;
  update public.jb_producao_item
     set feito = p_feito, feito_em = case when p_feito then now() else null end,
         feito_por = case when p_feito then (select u.nome from public.jb_usuario u where u.user_id = auth.uid()) else null end
   where id = p_id;
end $function$;

-- o que a freela vê hoje
create or replace function interno.jb_freela_ve(p public.jb_producao_item, a public.jb_freela_acesso)
 returns boolean
 language sql
 immutable
as $function$
  select (p.para_freela is null and p.para = 'todos')
      or p.para_freela = '*'
      or lower(btrim(p.para_freela)) = lower(btrim(a.nome))
$function$;

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
        'para', p.para, 'para_freela', p.para_freela,
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

create or replace function public.jb_freela_marcar(p_token text, p_id bigint, p_feito boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  a public.jb_freela_acesso;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ok boolean := false;
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then raise exception 'sem acesso' using errcode = '42501'; end if;
  update public.jb_producao_item p
     set feito = p_feito, feito_em = case when p_feito then now() else null end,
         feito_por = case when p_feito then a.nome || ' (freela)' else null end
   where p.id = p_id and p.data = v_hoje and interno.jb_freela_ve(p, a)
  returning true into v_ok;
  if not coalesce(v_ok, false) then raise exception 'item fora do seu dia' using errcode = '42501'; end if;
  return true;
end $function$;

grant execute on function public.jb_freela_producao(text) to anon, authenticated;
grant execute on function public.jb_freela_marcar(text, bigint, boolean) to anon, authenticated;
