-- JB OS: conferência da geladeira com o Saipos (14/11/2026)
-- O que saiu da geladeira (contagem) contra o que o Saipos registrou como vendido, por dia.
-- Os itens vendidos chegam do relatório "Itens vendidos" do Saipos, lido no Chrome do Mac.
-- A gravação só passa com um bilhete de 15 minutos criado pelo Claude (sem chave secreta);
-- ninguém do app consegue escrever venda. Nada é apagado: leitura nova zera o que sumiu.

alter table public.jb_perda add column if not exists foto_path text;

create table if not exists public.jb_saipos_item (
  id       bigserial primary key,
  data     date not null,
  lista    text not null check (lista in ('item','opcao')),
  grupo    text not null default '',
  nome     text not null,
  qtd      numeric not null default 0,
  valor    numeric,
  lido_em  timestamptz not null default now(),
  unique (data, lista, grupo, nome)
);
alter table public.jb_saipos_item enable row level security;
drop policy if exists jb_saipos_item_le on public.jb_saipos_item;
create policy jb_saipos_item_le on public.jb_saipos_item for select to authenticated using (jb_e_gestor());

create table if not exists public.jb_saipos_leitura (
  data      date primary key,
  lido_em   timestamptz not null default now(),
  itens     numeric,
  valor     numeric,
  fonte     text not null default 'chrome'
);
alter table public.jb_saipos_leitura enable row level security;
drop policy if exists jb_saipos_leitura_le on public.jb_saipos_leitura;
create policy jb_saipos_leitura_le on public.jb_saipos_leitura for select to authenticated using (jb_e_gestor());

-- O que cada nome do Saipos é na geladeira.
--   lista item:  papel doce (1 doce, produto_id), combo (componentes {"gelado":2}), ignorar (bebida, colher)
--   lista opcao: papel doce (o sabor escolhido no combo, produto_id), ignorar
create table if not exists public.jb_saipos_mapa (
  lista        text not null check (lista in ('item','opcao')),
  nome         text not null,
  papel        text not null check (papel in ('doce','combo','ignorar')),
  produto_id   bigint references public.jb_produto(id),
  componentes  jsonb,
  categoria    text check (categoria in ('gelado','pote','nuvem','outro')),
  obs          text,
  criado_em    timestamptz not null default now(),
  primary key (lista, nome),
  check (papel <> 'doce' or (produto_id is not null and categoria is not null)),
  check (papel <> 'combo' or (lista = 'item' and componentes is not null))
);
alter table public.jb_saipos_mapa enable row level security;
drop policy if exists jb_saipos_mapa_gestor on public.jb_saipos_mapa;
create policy jb_saipos_mapa_gestor on public.jb_saipos_mapa for all to authenticated using (jb_e_gestor()) with check (jb_e_gestor());

-- bilhete de 15 minutos para gravar a leitura do Saipos
create table if not exists interno.jb_saipos_bilhete (
  bilhete   text primary key,
  expira    timestamptz not null default now() + interval '15 minutes',
  usado_em  timestamptz,
  criado_em timestamptz not null default now()
);
alter table interno.jb_saipos_bilhete enable row level security;
revoke all on interno.jb_saipos_bilhete from public, anon, authenticated;

create or replace function interno.jb_saipos_bilhete_novo() returns text
language plpgsql security definer set search_path = interno, public as $$
declare v text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into interno.jb_saipos_bilhete (bilhete) values (v);
  return v;
end $$;
revoke all on function interno.jb_saipos_bilhete_novo() from public, anon, authenticated;

-- p = {"dias": {"2026-11-13": {"t": 94, "v": 3710.42, "i": [[nome,qtd,valor],...], "o": [[grupo,nome,qtd,valor],...]}}}
create or replace function public.jb_saipos_gravar(p_bilhete text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, interno as $$
declare
  b interno.jb_saipos_bilhete; k text; d date; dia jsonb; x jsonb; n int := 0; soma numeric;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into b from interno.jb_saipos_bilhete where bilhete = p_bilhete for update;
  if not found or b.usado_em is not null or b.expira < now() then raise exception 'bilhete'; end if;
  if jsonb_typeof(p->'dias') <> 'object' then raise exception 'formato'; end if;
  if (select count(*) from jsonb_object_keys(p->'dias')) > 45 then raise exception 'dias demais'; end if;
  for k in select jsonb_object_keys(p->'dias') loop
    d := k::date;
    if d >= hoje or d < hoje - 60 then raise exception 'data fora: %', k; end if;
    dia := p->'dias'->k;
    if jsonb_array_length(coalesce(dia->'i','[]')) > 300 or jsonb_array_length(coalesce(dia->'o','[]')) > 300 then raise exception 'linhas demais'; end if;
    -- confere: a soma das linhas tem que fechar com o total do relatório
    select coalesce(sum((e->>1)::numeric), 0) into soma from jsonb_array_elements(coalesce(dia->'i','[]')) e;
    if dia ? 't' and soma <> (dia->>'t')::numeric then raise exception 'soma não fecha em %: % contra %', k, soma, dia->>'t'; end if;
    -- o que não veio nesta leitura vai a zero (nada é apagado)
    update public.jb_saipos_item set qtd = 0, valor = 0, lido_em = now() where data = d;
    for x in select * from jsonb_array_elements(coalesce(dia->'i','[]')) loop
      insert into public.jb_saipos_item (data, lista, grupo, nome, qtd, valor)
      values (d, 'item', '', left(x->>0, 200), (x->>1)::numeric, (x->>2)::numeric)
      on conflict (data, lista, grupo, nome) do update set qtd = public.jb_saipos_item.qtd + excluded.qtd, valor = coalesce(public.jb_saipos_item.valor,0) + coalesce(excluded.valor,0), lido_em = now();
    end loop;
    for x in select * from jsonb_array_elements(coalesce(dia->'o','[]')) loop
      insert into public.jb_saipos_item (data, lista, grupo, nome, qtd, valor)
      values (d, 'opcao', left(coalesce(x->>0,''), 200), left(x->>1, 200), (x->>2)::numeric, (x->>3)::numeric)
      on conflict (data, lista, grupo, nome) do update set qtd = public.jb_saipos_item.qtd + excluded.qtd, valor = coalesce(public.jb_saipos_item.valor,0) + coalesce(excluded.valor,0), lido_em = now();
    end loop;
    insert into public.jb_saipos_leitura (data, lido_em, itens, valor, fonte)
    values (d, now(), (dia->>'t')::numeric, (dia->>'v')::numeric, coalesce(p->>'fonte','chrome'))
    on conflict (data) do update set lido_em = now(), itens = excluded.itens, valor = excluded.valor, fonte = excluded.fonte;
    n := n + 1;
  end loop;
  update interno.jb_saipos_bilhete set usado_em = now() where bilhete = p_bilhete;
  return jsonb_build_object('ok', true, 'dias', n);
end $$;
revoke all on function public.jb_saipos_gravar(text, jsonb) from public;
grant execute on function public.jb_saipos_gravar(text, jsonb) to anon, authenticated;

-- A conferência de um período: por dia, por categoria e por doce.
--   saiu       = vendeu da contagem (jb_saidas) + acertos de contagem do dia (acerto não explica saída)
--   vendido    = itens do Saipos (doce direto) + sabores escolhidos nos combos
--   sem_sabor  = doces de combo cujo sabor o Saipos não mostrou (só fecha na categoria)
--   diferenca  = saiu - vendido (positivo: saiu da geladeira sem venda no Saipos)
create or replace function public.jb_conferencia_geladeira(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date; v_out jsonb := '[]'; v_prod jsonb; v_cat jsonb; v_nm jsonb; v_lido record; v_fech boolean; v_perdas jsonb;
begin
  if not (jb_e_gestor() or session_user in ('postgres','supabase_admin')) then raise exception 'só gestor'; end if;
  if p_ate < p_de or p_ate - p_de > 62 then raise exception 'período'; end if;
  for d in select generate_series(p_de, p_ate, interval '1 day')::date loop
    select * into v_lido from jb_saipos_leitura where data = d;
    select bool_and(fechado) into v_fech from jb_saidas where data = d;

    with cat_prod as (
      select p.id, p.nome,
             coalesce((select m.categoria from jb_saipos_mapa m where m.papel = 'doce' and m.produto_id = p.id order by (m.lista = 'item') desc limit 1),
                      case when p.nome ~* 'gelado' then 'gelado' when p.nome ~* 'pote' then 'pote' when p.nome ~* 'nuvem' then 'nuvem' else 'outro' end) as cat
      from jb_produto p
    ),
    s  as (select produto_id, sum(vendeu) q from jb_saidas where data = d group by 1),
    ac as (select produto_id, sum(qtd) q from jb_perda where data = d and motivo = 'contagem' and not apos_fechamento and not anulada group by 1),
    pe as (select produto_id, sum(qtd) q from jb_perda where data = d and motivo <> 'contagem' and not apos_fechamento and not anulada group by 1),
    vi as (select produto_id, sum(q) q from (
             select m.produto_id, i.qtd q from jb_saipos_item i join jb_saipos_mapa m on m.lista = 'item' and m.nome = i.nome and m.papel = 'doce'
              where i.data = d and i.lista = 'item'
             union all
             -- combo de doces fixos (ex.: 2 Brownies = 1 Ninho e Nutella + 1 Brigadeiro): {"produto:2":1,"produto:1":1}
             select substr(e.key, 9)::bigint, i.qtd * (e.value)::numeric
               from jb_saipos_item i join jb_saipos_mapa m on m.lista = 'item' and m.nome = i.nome and m.papel = 'combo'
               cross join lateral jsonb_each_text(m.componentes) e
              where i.data = d and i.lista = 'item' and e.key like 'produto:%') x group by 1),
    vo as (select m.produto_id, sum(i.qtd) q from jb_saipos_item i join jb_saipos_mapa m on m.lista = 'opcao' and m.nome = i.nome and m.papel = 'doce'
           where i.data = d and i.lista = 'opcao' group by 1),
    linhas as (
      select c.id, c.nome, c.cat,
             coalesce(s.q,0) + coalesce(ac.q,0) as saiu, coalesce(ac.q,0) as acerto, coalesce(pe.q,0) as perda,
             coalesce(vi.q,0) as direto, coalesce(vo.q,0) as sabor, coalesce(vi.q,0) + coalesce(vo.q,0) as vendido
      from cat_prod c
      left join s on s.produto_id = c.id left join ac on ac.produto_id = c.id left join pe on pe.produto_id = c.id
      left join vi on vi.produto_id = c.id left join vo on vo.produto_id = c.id
      where coalesce(s.q,0) <> 0 or ac.q is not null or pe.q is not null or vi.q is not null or vo.q is not null
    ),
    combo as (
      select e.key as cat, sum(i.qtd * (e.value)::numeric) q
      from jb_saipos_item i join jb_saipos_mapa m on m.lista = 'item' and m.nome = i.nome and m.papel = 'combo'
      cross join lateral jsonb_each_text(m.componentes) e
      where i.data = d and i.lista = 'item' and e.key not like 'produto:%' group by 1
    ),
    sab as (select cat, sum(sabor) q from linhas group by 1),
    cats as (
      select c.cat,
             coalesce((select sum(saiu) from linhas l where l.cat = c.cat),0) saiu,
             coalesce((select sum(vendido) from linhas l where l.cat = c.cat),0) vendido_doce,
             greatest(coalesce((select q from combo where combo.cat = c.cat),0) - coalesce((select q from sab where sab.cat = c.cat),0), 0) sem_sabor,
             coalesce((select q from combo where combo.cat = c.cat),0) - coalesce((select q from sab where sab.cat = c.cat),0) as combo_menos_sabor
      from (values ('gelado'),('pote'),('nuvem'),('outro')) c(cat)
    )
    select
      (select coalesce(jsonb_agg(jsonb_build_object('produto_id', id, 'nome', nome, 'cat', cat, 'saiu', saiu, 'acerto', acerto, 'perda', perda,
              'direto', direto, 'sabor', sabor, 'vendido', vendido, 'diferenca', saiu - vendido) order by cat, nome), '[]') from linhas),
      (select coalesce(jsonb_agg(jsonb_build_object('cat', cat, 'saiu', saiu, 'vendido', vendido_doce + sem_sabor, 'sem_sabor', sem_sabor,
              'sabor_sobrando', greatest(-combo_menos_sabor, 0), 'diferenca', saiu - vendido_doce - sem_sabor)
              order by array_position(array['gelado','pote','nuvem','outro'], cat)), '[]') from cats where saiu <> 0 or vendido_doce <> 0 or sem_sabor <> 0)
      into v_prod, v_cat;

    select coalesce(jsonb_agg(jsonb_build_object('lista', i.lista, 'grupo', i.grupo, 'nome', i.nome, 'qtd', i.qtd) order by i.qtd desc), '[]') into v_nm
    from jb_saipos_item i left join jb_saipos_mapa m on m.lista = i.lista and m.nome = i.nome
    where i.data = d and i.qtd > 0 and m.nome is null;

    select coalesce(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'qtd', qtd, 'motivo', motivo, 'obs', obs, 'foto', foto_path is not null, 'quem', nome_responsavel) order by criado_em), '[]')
      into v_perdas from jb_perda where data = d and not anulada and not apos_fechamento;

    v_out := v_out || jsonb_build_object(
      'data', d, 'lido', v_lido.data is not null, 'lido_em', v_lido.lido_em, 'fechado', coalesce(v_fech, false),
      'saipos_itens', v_lido.itens, 'saipos_valor', v_lido.valor,
      'categorias', v_cat, 'produtos', v_prod, 'nao_mapeados', v_nm, 'perdas', v_perdas,
      'saiu', (select coalesce(sum((c->>'saiu')::numeric),0) from jsonb_array_elements(v_cat) c),
      'vendido', (select coalesce(sum((c->>'vendido')::numeric),0) from jsonb_array_elements(v_cat) c),
      'diferenca', (select coalesce(sum((c->>'diferenca')::numeric),0) from jsonb_array_elements(v_cat) c));
  end loop;
  return v_out;
end $$;
revoke all on function public.jb_conferencia_geladeira(date, date) from public, anon;
grant execute on function public.jb_conferencia_geladeira(date, date) to authenticated;
