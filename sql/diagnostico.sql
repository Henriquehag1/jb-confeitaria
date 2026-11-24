-- Diagnóstico de crescimento JB (24/11/2026): serviço pago da Jessica para outras
-- confeitarias de delivery. Fluxo: a cliente paga, o gestor cria o acesso (código DG...),
-- a cliente preenche jballassa.github.io/diagnostico-dados.html?c=CODIGO, a equipe analisa,
-- a Jessica entrega o plano e faz a chamada de 30 a 45 min.
--   aguardando_dados → dados_recebidos → em_analise → plano_entregue → concluido | cancelado
-- Nada é apagado. Só o gestor lê a tabela; a cliente só enxerga o próprio formulário pelo código.

create table if not exists public.jb_diagnostico (
  id            bigint generated always as identity primary key,
  codigo        text not null unique,
  criado_em     timestamptz not null default now(),
  parceria_id   bigint references public.jb_parceria(id),
  cliente       text not null,
  loja          text,
  contato       text,
  valor         numeric(10,2),
  pago_em       date,
  status        text not null default 'aguardando_dados'
                check (status in ('aguardando_dados','dados_recebidos','em_analise','plano_entregue','concluido','cancelado')),
  respostas     jsonb not null default '{}'::jsonb,
  salvo_em      timestamptz,
  enviado_em    timestamptz,
  salvamentos   integer not null default 0,
  plano_url     text,
  chamada_em    timestamptz,
  nota_interna  text,
  atualizado_em timestamptz
);

alter table public.jb_diagnostico enable row level security;
drop policy if exists jb_diagnostico_gestor on public.jb_diagnostico;
create policy jb_diagnostico_gestor on public.jb_diagnostico
  for all to authenticated using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_diagnostico from anon, public;
revoke delete, truncate on public.jb_diagnostico from authenticated;
grant select, insert, update on public.jb_diagnostico to authenticated;

-- Gestor: cria o acesso depois do pagamento. Devolve o código e o link.
create or replace function public.jb_diagnostico_criar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_cod  text;
  v_alf  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_parc bigint;
  i      int;
begin
  if not public.jb_e_gestor() then raise exception 'so_gestor'; end if;
  if length(btrim(coalesce(p->>'cliente',''))) < 2 then raise exception 'cliente'; end if;
  if nullif(p->>'parceria','') is not null then
    select id into v_parc from jb_parceria where codigo = upper(btrim(p->>'parceria'));
    if v_parc is null then raise exception 'parceria'; end if;
  end if;
  loop
    v_cod := 'DG';
    for i in 1..8 loop
      v_cod := v_cod || substr(v_alf, 1 + floor(random() * length(v_alf))::int, 1);
    end loop;
    exit when not exists (select 1 from jb_diagnostico where codigo = v_cod);
  end loop;
  insert into jb_diagnostico (codigo, parceria_id, cliente, loja, contato, valor, pago_em, nota_interna)
  values (v_cod, v_parc, left(btrim(p->>'cliente'), 80), left(nullif(btrim(coalesce(p->>'loja','')),''), 80),
          left(nullif(btrim(coalesce(p->>'contato','')),''), 120),
          nullif(p->>'valor','')::numeric, nullif(p->>'pago_em','')::date,
          nullif(btrim(coalesce(p->>'nota','')),''));
  return jsonb_build_object('codigo', v_cod,
    'link', 'https://jballassa.github.io/diagnostico-dados.html?c=' || v_cod);
end $fn$;
revoke all on function public.jb_diagnostico_criar(jsonb) from public, anon;
grant execute on function public.jb_diagnostico_criar(jsonb) to authenticated;

-- Cliente (anon): abre o formulário pelo código. Devolve o primeiro nome e o que já salvou.
create or replace function public.jb_diagnostico_abrir(c text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare r record;
begin
  select codigo, cliente, loja, status, respostas, enviado_em into r
    from jb_diagnostico where codigo = upper(btrim(coalesce(c,'')));
  if r.codigo is null or r.status = 'cancelado' then raise exception 'codigo'; end if;
  return jsonb_build_object(
    'nome', split_part(r.cliente, ' ', 1),
    'loja', r.loja,
    'aberto', r.status in ('aguardando_dados','dados_recebidos'),
    'enviado', r.enviado_em is not null,
    'respostas', case when r.status in ('aguardando_dados','dados_recebidos') then r.respostas else '{}'::jsonb end);
end $fn$;
revoke all on function public.jb_diagnostico_abrir(text) from public;
grant execute on function public.jb_diagnostico_abrir(text) to anon, authenticated;

-- Cliente (anon): salva o rascunho (final = false) ou envia (final = true).
-- Só enquanto a análise não começou; limite de tamanho e de salvamentos.
create or replace function public.jb_diagnostico_salvar(c text, p jsonb, final boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare r record;
begin
  select id, status, salvamentos into r from jb_diagnostico where codigo = upper(btrim(coalesce(c,'')));
  if r.id is null or r.status = 'cancelado' then raise exception 'codigo'; end if;
  if r.status not in ('aguardando_dados','dados_recebidos') then raise exception 'fechado'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'formato'; end if;
  if length(p::text) > 60000 then raise exception 'tamanho'; end if;
  if r.salvamentos >= 200 then raise exception 'limite'; end if;
  update jb_diagnostico set
    respostas   = p,
    salvo_em    = now(),
    salvamentos = salvamentos + 1,
    enviado_em  = case when final then now() else enviado_em end,
    status      = case when final then 'dados_recebidos' else status end,
    atualizado_em = now()
  where id = r.id;
  return jsonb_build_object('ok', true, 'enviado', final);
end $fn$;
revoke all on function public.jb_diagnostico_salvar(text, jsonb, boolean) from public;
grant execute on function public.jb_diagnostico_salvar(text, jsonb, boolean) to anon, authenticated;
