-- JB OS · histórico de preços dos insumos (02/11/2026)
-- Pedido do Henrique: ter no app, rápido e claro, a evolução (alta ou queda) do preço de cada insumo.
-- Duas fontes, juntas na view jb_insumo_historico:
--   1. compra: cada item de compra ligado a um insumo (jb_compra_item.custo_base), já existia.
--   2. cadastro: toda mudança de custo_unit em jb_insumo passa a ficar gravada em jb_insumo_preco
--      (pelo campo de preço, pelo formulário ou pelo "usar esse preço"), com o valor anterior.
-- Só gestor lê e grava, igual ao resto de custos.

-- 0. correções de 01/11 pedidas pelo Henrique, antes de ligar o histórico:
--    o ovo continua sendo o Mantiqueira (0,72); os ovos caipiras orgânicos da compra do Atacadão
--    eram do uso pessoal (sai do estoque e do custo, fica registrado como pessoal na compra).
update public.jb_insumo set custo_unit = 0.72 where id = 40;
alter table public.jb_compra_item drop constraint jb_compra_item_destino_check,
  add constraint jb_compra_item_destino_check check (destino = any (array['insumo','consumo','revenda','pessoal']));
update public.jb_compra_item
   set destino = 'pessoal', insumo_id = null,
       obs = 'Era do uso pessoal (corrigido em 01/11): fora da confeitaria, do estoque e do custo'
 where compra_id = 3 and ordem = 5;
update public.jb_compra
   set valor_total = 1271.54, valor_pago = 1271.54,
       obs = 'Lançada pelo Claude a partir do descritivo do Henrique em 01/11. Valores por item já com os descontos da nota. A nota inteira foi 2.971,04: confeitaria 1.271,54 e uso pessoal 1.700,50 (os ovos caipiras orgânicos, 51,80, eram do pessoal; o item 5 fica registrado como pessoal e não entra no total), e 1,00 de desconto sem item, que ficou fora. Falta a unidade do Atacadão, o CNPJ e a forma de pagamento.'
 where id = 3;

-- 1. tabela das mudanças de preço do cadastro
create table if not exists public.jb_insumo_preco (
  id         bigint generated always as identity primary key,
  insumo_id  integer not null references public.jb_insumo(id) on delete cascade,
  data       date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  custo      numeric not null,
  anterior   numeric,
  unidade    text,
  obs        text,
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index if not exists jb_insumo_preco_insumo on public.jb_insumo_preco (insumo_id, data);
alter table public.jb_insumo_preco enable row level security;
create policy jb_insumo_preco_gestor on public.jb_insumo_preco for all
  using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_insumo_preco from anon;
grant select, insert on public.jb_insumo_preco to authenticated;

-- 2. gatilho: grava cada preço novo do cadastro
create or replace function interno.jb_insumo_preco_registra()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.custo_unit is null then return new; end if;
  if tg_op = 'UPDATE' and new.custo_unit is not distinct from old.custo_unit then return new; end if;
  insert into public.jb_insumo_preco (insumo_id, custo, anterior, unidade)
  values (new.id, new.custo_unit, case when tg_op = 'UPDATE' then old.custo_unit end, new.unidade);
  return new;
end $function$;
create trigger jb_insumo_preco_registra after insert or update of custo_unit on public.jb_insumo
  for each row execute function interno.jb_insumo_preco_registra();

-- 3. ponto de partida: o cadastro antes de 01/11 (backup.jb_insumo_20261101) e as cinco mudanças de 01/11
insert into public.jb_insumo_preco (insumo_id, data, custo, anterior, unidade, obs, criado_em)
select b.id, '2026-11-01', b.custo_unit, null, b.unidade, 'Preço que estava no cadastro antes de 01/11', '2026-11-01 12:00:00-03'
  from backup.jb_insumo_20261101 b join public.jb_insumo i on i.id = b.id
 where b.custo_unit is not null;
insert into public.jb_insumo_preco (insumo_id, data, custo, anterior, unidade, obs, criado_em)
select i.id, '2026-11-01', i.custo_unit, b.custo_unit, i.unidade, 'Atualizado pela compra do Atacadão de 01/11', '2026-11-01 22:00:00-03'
  from public.jb_insumo i join backup.jb_insumo_20261101 b on b.id = i.id
 where i.id in (19, 23, 25, 32, 44) and i.custo_unit is distinct from b.custo_unit;

-- 4. a linha do tempo de cada insumo: compras e cadastro juntos
create or replace view public.jb_insumo_historico with (security_invoker = true) as
  select ci.insumo_id, c.data, ci.custo_base as custo, ci.unidade_base as unidade,
         'compra'::text as origem, c.fornecedor, ci.descricao as obs, null::numeric as anterior,
         c.criado_em as em, ci.id as ref
    from public.jb_compra_item ci join public.jb_compra c on c.id = ci.compra_id
   where ci.insumo_id is not null and ci.custo_base is not null
     and coalesce(ci.destino, 'insumo') <> 'pessoal'
  union all
  select p.insumo_id, p.data, p.custo, p.unidade, 'cadastro', null, p.obs, p.anterior, p.criado_em, p.id
    from public.jb_insumo_preco p;
grant select on public.jb_insumo_historico to authenticated;
