-- JB OS · Quanto fazer (21/10/2026)
-- Sugestão de produção por doce, só para os donos (Jessica e Henrique).
-- Conta: venda média por dia (últimos 28 dias fechados) x dias a cobrir x (1 + margem + extra se acabou na geladeira)
--        menos o que já tem na expositora e no freezer. Produto com assadeira (rendimento > 1) arredonda para assadeira inteira.
-- Doce novo (menos de 7 dias de venda) usa a meta da semana que a Jessica digitar; depois de 7 dias, passa a usar a venda sozinho.

create table if not exists public.jb_quanto_meta (
  produto_id     integer primary key references public.jb_produto(id),
  meta_semana    integer check (meta_semana between 0 and 9999),
  validade_dias  integer check (validade_dias between 1 and 60),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.jb_quanto_meta enable row level security;
create policy jb_quanto_meta_sel on public.jb_quanto_meta for select using (public.jb_e_gestor());
create policy jb_quanto_meta_ins on public.jb_quanto_meta for insert with check (public.jb_e_gestor());
create policy jb_quanto_meta_upd on public.jb_quanto_meta for update using (public.jb_e_gestor()) with check (public.jb_e_gestor());
create policy jb_quanto_meta_del on public.jb_quanto_meta for delete using (public.jb_e_gestor());
revoke all on public.jb_quanto_meta from anon;
grant select, insert, update, delete on public.jb_quanto_meta to authenticated;

create table if not exists public.jb_quanto_param (
  id            integer primary key default 1 check (id = 1),
  dias          integer not null default 7  check (dias between 1 and 21),
  margem_pct    integer not null default 15 check (margem_pct between 0 and 100),
  atualizado_em timestamptz not null default now()
);
alter table public.jb_quanto_param enable row level security;
create policy jb_quanto_param_sel on public.jb_quanto_param for select using (public.jb_e_gestor());
create policy jb_quanto_param_upd on public.jb_quanto_param for update using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_quanto_param from anon;
grant select, update on public.jb_quanto_param to authenticated;
insert into public.jb_quanto_param (id, dias, margem_pct) values (1, 7, 15) on conflict (id) do nothing;

create or replace function public.jb_quanto_fazer(p_dias integer default null, p_margem_pct integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias   integer;
  v_margem numeric;
  v_ref    bigint;
  v_ndias  integer;
  v_itens  jsonb;
  v_bases  jsonb;
begin
  if not public.jb_e_gestor() then
    raise exception 'so gestor' using errcode = '42501';
  end if;
  select dias, margem_pct into v_dias, v_margem from public.jb_quanto_param where id = 1;
  v_dias   := coalesce(p_dias, v_dias, 7);
  v_margem := coalesce(p_margem_pct, v_margem, 15) / 100.0;
  if v_dias < 1 or v_dias > 21 then raise exception 'dias entre 1 e 21'; end if;
  if v_margem < 0 or v_margem > 1 then raise exception 'margem entre 0 e 100'; end if;
  v_ref := interno.jb_freezer_ref(v_hoje);

  select count(*) into v_ndias from (
    select s.data from public.jb_saidas s
     where s.data >= v_hoje - 28 and s.data < v_hoje
     group by s.data having bool_and(s.fechado) and sum(s.saiu_total) >= 0) x;

  with dias_ok as (
    select s.data from public.jb_saidas s
     where s.data >= v_hoje - 28 and s.data < v_hoje
     group by s.data having bool_and(s.fechado) and sum(s.saiu_total) >= 0
  ), hist as (
    select s.produto_id, count(*)::int as dias, sum(greatest(s.vendeu, 0))::int as vendeu,
           (count(*) filter (where s.sobrou = 0))::int as zerou
      from public.jb_saidas s join dias_ok d using (data) group by s.produto_id
  ), ult as (
    select distinct on (s.produto_id) s.produto_id, s.data,
           (case when s.fechado then s.ficou else s.deixou end)::int as expositora
      from public.jb_saidas s where s.data <= v_hoje and s.data >= v_hoje - 3
     order by s.produto_id, s.data desc
  ), fz as (
    select ci.produto_id, coalesce(ci.freezer, 0)::int as freezer
      from public.jb_contagem_item ci where ci.contagem_id = v_ref
  ), fic as (
    select distinct on (f.produto_id) f.produto_id, f.id as ficha_id, f.rendimento_un
      from public.jb_ficha f where f.ativo and f.produto_id is not null and not coalesce(f.rascunho, false)
     order by f.produto_id, f.id
  ), base as (
    select p.id as produto_id, p.nome, p.ordem, p.foto_url, fic.ficha_id, greatest(coalesce(fic.rendimento_un, 1), 1) as rend,
           coalesce(h.dias, 0) as dias_hist, coalesce(h.vendeu, 0) as vendeu_hist, coalesce(h.zerou, 0) as zerou,
           m.meta_semana, m.validade_dias,
           coalesce(u.expositora, 0) as expositora, u.data as expositora_data, coalesce(f.freezer, 0) as freezer
      from public.jb_produto p
      left join hist h on h.produto_id = p.id
      left join public.jb_quanto_meta m on m.produto_id = p.id
      left join ult u on u.produto_id = p.id
      left join fz f on f.produto_id = p.id
      left join fic on fic.produto_id = p.id
     where p.ativo
  ), calc as (
    select b.*,
           case when b.dias_hist >= 7 then 'vendas'
                when b.meta_semana is not null then 'meta'
                when b.dias_hist > 0 then 'pouco'
                else 'sem' end as fonte,
           case when b.dias_hist >= 7 then b.vendeu_hist::numeric / b.dias_hist
                when b.meta_semana is not null then b.meta_semana / 7.0
                when b.dias_hist > 0 then b.vendeu_hist::numeric / b.dias_hist
                else 0 end as venda_dia,
           least(v_dias, coalesce(b.validade_dias, v_dias)) as cobertura,
           case when b.dias_hist >= 7 then least(0.25, 0.25 * b.zerou::numeric / b.dias_hist) else 0 end as extra
      from base b
  ), alvo as (
    select c.*, ceil(c.venda_dia * c.cobertura * (1 + v_margem + c.extra))::int as alvo from calc c
  ), fim as (
    select a.produto_id, a.nome, a.ordem, a.foto_url, a.ficha_id, a.rend, a.dias_hist, a.vendeu_hist, a.zerou,
           a.meta_semana, a.validade_dias, a.fonte, round(a.venda_dia, 2) as venda_dia, a.cobertura,
           round(a.extra, 3) as extra, a.alvo, a.expositora, a.expositora_data, a.freezer,
           greatest(0, a.alvo - a.expositora - a.freezer) as falta,
           case when a.alvo - a.expositora - a.freezer <= 0 then 0
                when a.rend > 1 then (ceil((a.alvo - a.expositora - a.freezer) / a.rend) * a.rend)::int
                else a.alvo - a.expositora - a.freezer end as fazer
      from alvo a
  )
  select coalesce(jsonb_agg(to_jsonb(q) order by q.ordem, q.nome), '[]'::jsonb) into v_itens from fim q;

  with q as (
    select * from jsonb_to_recordset(v_itens) as x(produto_id integer, nome text, ficha_id integer, rend numeric, fazer integer)
  ), uso as (
    select s.id as subreceita_id, s.nome, s.unidade_producao, s.rendimento_kg,
           sum(q.fazer / q.rend * fi.qtd / (case when lower(fi.unidade) = 'kg' then 1 else 1000 end)) as kg,
           string_agg(distinct q.nome, ', ') as para
      from q
      join public.jb_ficha_item fi on fi.ficha_id = q.ficha_id
      join public.jb_subreceita s on lower(s.nome) = lower(fi.ingrediente) and s.ativo
     where q.fazer > 0 and lower(fi.unidade) in ('g', 'kg')
     group by s.id, s.nome, s.unidade_producao, s.rendimento_kg
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'subreceita_id', u.subreceita_id, 'nome', u.nome, 'unidade_producao', coalesce(u.unidade_producao, 'receita'),
           'rendimento_kg', u.rendimento_kg, 'kg', round(u.kg, 3),
           'lotes', round(u.kg / nullif(u.rendimento_kg, 0), 2),
           'lotes_fazer', ceil(u.kg / nullif(u.rendimento_kg, 0) * 2) / 2.0,
           'para', u.para) order by u.unidade_producao, u.kg desc), '[]'::jsonb)
    into v_bases from uso u;

  return jsonb_build_object(
    'hoje', v_hoje, 'dias', v_dias, 'margem_pct', round(v_margem * 100), 'dias_base', v_ndias,
    'freezer_ref', v_ref, 'itens', v_itens, 'bases', v_bases,
    'total_fazer', (select coalesce(sum((e->>'fazer')::int), 0) from jsonb_array_elements(v_itens) e));
end
$fn$;
revoke all on function public.jb_quanto_fazer(integer, integer) from public, anon;
grant execute on function public.jb_quanto_fazer(integer, integer) to authenticated;
