-- JB OS · conferir o que a freela vê e soltar o celular dela (22/10/2026)
-- interno.jb_freela_dia_de(nome): o dia de uma freela pelo nome (itens + receitas). Usado pelo celular dela
--   (jb_freela_producao, por token) e pela conferência dos donos (jb_freela_espiar, só gestor, só leitura).
-- jb_freela_soltar_celular(id): só gestor. O código volta a valer para o primeiro celular que digitar
--   (para quando alguém abriu o acesso no celular errado). O celular que estava com ele perde o acesso.

create or replace function interno.jb_freela_dia_de(p_nome text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fichas integer[];
  v_subs integer[];
begin
  select coalesce(array_agg(p.ref_id) filter (where p.tipo = 'ficha'), '{}'),
         coalesce(array_agg(p.ref_id) filter (where p.tipo = 'subreceita'), '{}')
    into v_fichas, v_subs
    from public.jb_producao_item p
   where p.data = v_hoje and public.jb_item_visivel(p.quem, p.para, p.para_freela, null, p_nome);

  select v_subs || coalesce(array_agg(distinct s.id), '{}') into v_subs
    from public.jb_ficha_item fi join public.jb_subreceita s on s.nome = fi.ingrediente and s.ativo
   where fi.ficha_id = any(v_fichas);

  return jsonb_build_object(
    'ok', true, 'nome', p_nome,
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
     where p.data = v_hoje and public.jb_item_visivel(p.quem, p.para, p.para_freela, null, p_nome)), '[]'::jsonb),
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

create or replace function public.jb_freela_producao(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare a public.jb_freela_acesso;
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then return jsonb_build_object('ok', false); end if;
  return interno.jb_freela_dia_de(a.nome);
end $function$;

create or replace function public.jb_freela_espiar(p_nome text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
begin
  if not public.jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  if char_length(v_nome) < 1 or char_length(v_nome) > 40 then raise exception 'nome invalido'; end if;
  return interno.jb_freela_dia_de(v_nome);
end $function$;

create or replace function public.jb_freela_soltar_celular(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  update public.jb_freela_acesso set token_hash = null, token_em = null, erros = 0
   where id = p_id and encerrado_em is null;
end $function$;

grant execute on function public.jb_freela_espiar(text) to authenticated;
grant execute on function public.jb_freela_soltar_celular(bigint) to authenticated;
