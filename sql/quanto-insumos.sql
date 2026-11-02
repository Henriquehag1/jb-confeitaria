-- JB OS · Quanto fazer: insumos para separar (02/11/2026)
-- Pedido do Henrique: depois dos doces e das massas e recheios, mostrar quanto de cada insumo separar.
-- Entrada: a lista do que vai ser feito, [{tipo:'ficha', ref_id, qtd (unidades)} | {tipo:'subreceita', ref_id, kg}].
--   Doce (ficha): entra só o que vai direto nele (cobertura, embalagem...). O que vai dentro de massa ou recheio
--   entra pela linha da massa ou do recheio, para não contar duas vezes.
--   Massa ou recheio (subreceita): abre a receita inteira, inclusive o que está dentro de outro preparo
--   (ex.: Recheio Kinder Bueno leva Creme de Chocolate Branco, que leva Brigadeiro Cremoso de Ninho).
-- Saída: insumos (na unidade do cadastro, com embalagem e lugar), preparos de dentro e ingredientes sem cadastro.
create or replace function public.jb_quanto_insumos(p_itens jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if not public.jb_e_gestor() then
    raise exception 'so gestor' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    return jsonb_build_object('insumos', '[]'::jsonb, 'preparos', '[]'::jsonb, 'sem_cadastro', '[]'::jsonb);
  end if;

  with recursive entrada as (
    select x.tipo, x.ref_id, coalesce(x.qtd, 0) as qtd, coalesce(x.kg, 0) as kg
      from jsonb_to_recordset(p_itens) as x(tipo text, ref_id integer, qtd numeric, kg numeric)
     where coalesce(x.qtd, 0) > 0 or coalesce(x.kg, 0) > 0
  ), sub_ativa as (
    select s.id, s.nome, s.rendimento_kg from public.jb_subreceita s where s.ativo
  ), arvore as (
    -- massas e recheios pedidos, e o que está dentro deles (até 5 níveis)
    select s.id, s.nome, s.rendimento_kg, e.kg, 0 as nivel, s.nome as origem
      from entrada e join sub_ativa s on s.id = e.ref_id
     where e.tipo = 'subreceita' and e.kg > 0
    union all
    select s2.id, s2.nome, s2.rendimento_kg,
           a.kg / nullif(a.rendimento_kg, 0) * si.qtd * public.jb_fator(si.unidade, 'kg', null::numeric),
           a.nivel + 1, a.origem
      from arvore a
      join public.jb_subreceita_item si on si.subreceita_id = a.id
      join sub_ativa s2 on lower(s2.nome) = lower(si.ingrediente)
     where a.nivel < 5 and coalesce(a.rendimento_kg, 0) > 0 and lower(si.unidade) in ('g', 'kg')
  ), linhas as (
    -- o que vai direto no doce
    select fi.ingrediente, fi.unidade,
           fi.qtd * e.qtd / greatest(coalesce(f.rendimento_un, 1), 1) as q, coalesce(pr.nome, f.nome) as origem
      from entrada e
      join public.jb_ficha f on f.id = e.ref_id
      left join public.jb_produto pr on pr.id = f.produto_id
      join public.jb_ficha_item fi on fi.ficha_id = f.id
     where e.tipo = 'ficha' and e.qtd > 0
       and not exists (select 1 from sub_ativa s where lower(s.nome) = lower(fi.ingrediente))
    union all
    -- o que vai em cada massa ou recheio (os preparos de dentro já abriram na árvore)
    select si.ingrediente, si.unidade, si.qtd * a.kg / a.rendimento_kg, a.origem
      from arvore a
      join public.jb_subreceita_item si on si.subreceita_id = a.id
     where coalesce(a.rendimento_kg, 0) > 0
       and not exists (select 1 from sub_ativa s where lower(s.nome) = lower(si.ingrediente))
  ), com_insumo as (
    select l.*, i.id as insumo_id, i.nome as insumo, i.unidade as un_insumo, i.categoria, i.local,
           i.emb_nome, i.emb_qtd, i.foto_url,
           l.q * public.jb_fator(l.unidade, i.unidade, i.equiv_g) as q_insumo
      from linhas l
      left join lateral (
        select * from public.jb_insumo ii where lower(ii.nome) = lower(l.ingrediente)
         order by ii.ativo desc, ii.id limit 1) i on true
  )
  select jsonb_build_object(
    'insumos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'insumo_id', c.insumo_id, 'nome', c.insumo, 'unidade', c.un_insumo, 'qtd', round(c.q, 4),
               'categoria', c.categoria, 'local', c.local, 'emb_nome', c.emb_nome, 'emb_qtd', c.emb_qtd,
               'foto_url', c.foto_url, 'para', c.para) order by c.categoria, c.local, c.insumo)
        from (select insumo_id, insumo, un_insumo, categoria, local, emb_nome, emb_qtd, foto_url,
                     sum(q_insumo) as q, string_agg(distinct origem, ', ') as para
                from com_insumo where insumo_id is not null
               group by insumo_id, insumo, un_insumo, categoria, local, emb_nome, emb_qtd, foto_url) c
       where c.q > 0), '[]'::jsonb),
    'preparos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', p.nome, 'kg', round(p.kg, 3), 'para', p.para) order by p.kg desc)
        from (select nome, sum(kg) as kg, string_agg(distinct origem, ', ') as para
                from arvore where nivel > 0 group by nome) p), '[]'::jsonb),
    'sem_cadastro', coalesce((
      select jsonb_agg(jsonb_build_object('nome', s.ingrediente, 'unidade', s.unidade, 'qtd', round(s.q, 3), 'para', s.para) order by s.ingrediente)
        from (select ingrediente, unidade, sum(q) as q, string_agg(distinct origem, ', ') as para
                from com_insumo where insumo_id is null group by ingrediente, unidade) s), '[]'::jsonb)
  ) into v;
  return v;
end
$function$;

revoke all on function public.jb_quanto_insumos(jsonb) from public, anon;
grant execute on function public.jb_quanto_insumos(jsonb) to authenticated;
