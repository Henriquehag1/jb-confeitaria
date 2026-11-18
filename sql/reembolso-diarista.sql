-- Compras que a diarista (Eliana) faz para o ateliê e o reembolso no pagamento dela (18/11/2026).
--   1. Ela tira foto do cupom e põe o valor no celular (jb_reembolso, status enviado).
--   2. A Jessica ou o Henrique confere pela Compra pela nota: preço, estoque e fichas, e
--      jb_reembolso_conferir cria a conta de reembolso ligada a ela (soma no "A pagar agora").
--   3. No pagamento, jb_pagar_diarista marca dias e reembolsos como pagos e registra o
--      pagamento; a Edge Function jb-nota (acao pagamento) lança no Nosso Financeiro:
--      diárias em Pessoas e cada compra na categoria dela, na data do Pix.
-- Nada é apagado: recusada fica no histórico.

create table if not exists public.jb_reembolso (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid(),
  criado_em     timestamptz not null default now(),
  data          date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  valor         numeric not null check (valor > 0 and valor <= 5000),
  loja          text check (loja is null or length(loja) <= 80),
  obs           text check (obs is null or length(obs) <= 300),
  fotos         text[] not null default '{}' check (cardinality(fotos) between 1 and 4),
  status        text not null default 'enviado' check (status in ('enviado','conferido','pago','recusado')),
  compra_id     bigint references public.jb_compra(id),
  conta_id      bigint references public.jb_conta(id),
  conferido_em  timestamptz,
  conferido_por uuid,
  motivo        text check (motivo is null or length(motivo) <= 200)
);
alter table public.jb_reembolso enable row level security;
drop policy if exists jb_reembolso_ve on public.jb_reembolso;
create policy jb_reembolso_ve on public.jb_reembolso for select to authenticated
  using (public.jb_e_gestor() or user_id = auth.uid());
drop policy if exists jb_reembolso_envia on public.jb_reembolso;
create policy jb_reembolso_envia on public.jb_reembolso for insert to authenticated
  with check (public.jb_e_membro() and user_id = auth.uid() and status = 'enviado'
              and compra_id is null and conta_id is null and conferido_em is null and motivo is null
              and data between ((now() at time zone 'America/Sao_Paulo')::date - 30) and ((now() at time zone 'America/Sao_Paulo')::date + 1)
              and not exists (select 1 from unnest(fotos) f where f not like 'reembolso/' || auth.uid()::text || '/%'));
drop policy if exists jb_reembolso_gestor on public.jb_reembolso;
create policy jb_reembolso_gestor on public.jb_reembolso for update to authenticated
  using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_reembolso from anon, public;
revoke delete, truncate on public.jb_reembolso from authenticated;
grant select, insert, update on public.jb_reembolso to authenticated;

-- a foto do cupom: cada pessoa só grava na pasta dela; quem lê é o gestor (política que já existe)
drop policy if exists "contas reembolso envia" on storage.objects;
create policy "contas reembolso envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'contas' and public.jb_e_membro() and name like 'reembolso/' || auth.uid()::text || '/%');

-- registro de cada pagamento da diarista (o que foi pago e como foi para o Nosso Financeiro)
create table if not exists public.jb_pagamento_diarista (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  data        date not null,
  valor       numeric not null check (valor > 0),
  diarias     numeric not null default 0,
  dias        date[] not null default '{}',
  contas      bigint[] not null default '{}',
  fin_status  text,
  fin_ref     text,
  fin_em      timestamptz,
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid()
);
alter table public.jb_pagamento_diarista enable row level security;
drop policy if exists jb_pagamento_diarista_gestor on public.jb_pagamento_diarista;
create policy jb_pagamento_diarista_gestor on public.jb_pagamento_diarista for all to authenticated
  using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_pagamento_diarista from anon, public;
revoke insert, delete, truncate on public.jb_pagamento_diarista from authenticated;
grant select, update on public.jb_pagamento_diarista to authenticated;

-- conferir: a compra (já gravada pela Compra pela nota) vira reembolso da pessoa
create or replace function public.jb_reembolso_conferir(p_compra bigint, p_user uuid, p_reembolso bigint default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_c jb_compra; v_nome text; v_conta bigint; v_venc date; v_valor numeric;
begin
  if not jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  select * into v_c from jb_compra where id = p_compra;
  if not found then raise exception 'compra'; end if;
  if not exists (select 1 from jb_acordo a where a.user_id = p_user and a.regime = 'diaria'
                  and a.inicio <= v_c.data and (a.fim is null or a.fim >= v_c.data)) then
    raise exception 'nao e diarista';
  end if;
  select nome into v_nome from jb_usuario where user_id = p_user;
  select id into v_conta from jb_conta where compra_id = p_compra and tipo = 'equipe' and equipe_user_id = p_user limit 1;
  v_valor := round(coalesce(v_c.valor_pago, v_c.valor_total), 2);
  v_venc := (date_trunc('month', v_c.data) + interval '1 month')::date + 9;
  if v_conta is null then
    insert into jb_conta (tipo, descricao, competencia, vencimento, valor, compra_id, obs, arquivada, equipe_user_id, abatimentos)
    values ('equipe',
            left(coalesce(v_nome, 'Diarista') || ': reembolso de ' || coalesce(nullif(btrim(v_c.fornecedor), ''), 'compra') || ' de ' || to_char(v_c.data, 'DD/MM'), 140),
            date_trunc('month', v_c.data)::date, v_venc, v_valor, p_compra,
            left('Compra paga por ' || coalesce(v_nome, 'ela') || ' e devolvida no pagamento dela. O Nosso Financeiro recebe esta compra no dia do Pix.', 400),
            false, p_user, '[]'::jsonb)
    returning id into v_conta;
  end if;
  update jb_compra set fin_status = 'no_pagamento', fin_ref = null, fin_em = now(), forma = 'pix', cartao = null, parcelas = 1
   where id = p_compra and coalesce(fin_status, '') not in ('lancado', 'ja_existia', 'ja_lancado');
  if p_reembolso is not null then
    update jb_reembolso set status = 'conferido', compra_id = p_compra, conta_id = v_conta,
           conferido_em = now(), conferido_por = auth.uid()
     where id = p_reembolso and user_id = p_user and status = 'enviado';
  end if;
  return jsonb_build_object('conta_id', v_conta, 'valor', v_valor, 'vencimento', v_venc, 'nome', v_nome);
end $fn$;

create or replace function public.jb_reembolso_recusar(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
begin
  if not jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  update jb_reembolso set status = 'recusado', motivo = left(nullif(btrim(coalesce(p_motivo, '')), ''), 200),
         conferido_em = now(), conferido_por = auth.uid()
   where id = p_id and status = 'enviado';
end $fn$;

-- pagar: dias em aberto até a data + reembolsos em aberto; o valor tem que bater com o total
create or replace function public.jb_pagar_diarista(p_user uuid, p_data date, p_valor numeric)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $fn$
declare v_diaria numeric; v_dias date[]; v_ids bigint[]; v_contas bigint[]; v_soma_c numeric; v_total numeric; v_id bigint;
begin
  if not jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  if p_data is null or p_data > (now() at time zone 'America/Sao_Paulo')::date + 1 or p_data < (now() at time zone 'America/Sao_Paulo')::date - 60 then
    raise exception 'data';
  end if;
  select valor into v_diaria from jb_acordo where user_id = p_user and regime = 'diaria'
     and inicio <= p_data and (fim is null or fim >= p_data) order by inicio desc limit 1;
  if v_diaria is null then raise exception 'nao e diarista'; end if;
  select coalesce(array_agg(data order by data), '{}'), coalesce(array_agg(id order by data), '{}') into v_dias, v_ids
    from jb_dia_trabalhado where user_id = p_user and status = 'confirmado' and pago_em is null and data <= p_data;
  select coalesce(array_agg(id order by id), '{}'), coalesce(sum(valor), 0) into v_contas, v_soma_c
    from jb_conta where equipe_user_id = p_user and tipo = 'equipe' and pago_em is null and not arquivada and valor > 0;
  v_total := round(cardinality(v_ids) * v_diaria + v_soma_c, 2);
  if v_total <= 0 then raise exception 'nada a pagar'; end if;
  if abs(v_total - round(p_valor, 2)) > 0.02 then raise exception 'valor: o total em aberto é %', v_total; end if;
  insert into jb_pagamento_diarista (user_id, data, valor, diarias, dias, contas, fin_status)
  values (p_user, p_data, v_total, round(cardinality(v_ids) * v_diaria, 2), v_dias, v_contas, 'pendente')
  returning id into v_id;
  update jb_dia_trabalhado set pago_em = ((p_data + time '12:00') at time zone 'America/Sao_Paulo'), pago_por = auth.uid()
   where id = any(v_ids);
  update jb_conta set pago_em = p_data, valor_pago = valor, pago_por = 'manual', nf_ref = 'jbos pagamento ' || v_id
   where id = any(v_contas);
  update jb_reembolso set status = 'pago' where conta_id = any(v_contas) and status = 'conferido';
  return jsonb_build_object('pagamento_id', v_id, 'total', v_total, 'diarias', round(cardinality(v_ids) * v_diaria, 2),
                            'dias', to_jsonb(v_dias), 'contas', to_jsonb(v_contas));
end $fn$;

revoke all on function public.jb_reembolso_conferir(bigint, uuid, bigint) from public, anon;
revoke all on function public.jb_reembolso_recusar(bigint, text) from public, anon;
revoke all on function public.jb_pagar_diarista(uuid, date, numeric) from public, anon;
grant execute on function public.jb_reembolso_conferir(bigint, uuid, bigint) to authenticated;
grant execute on function public.jb_reembolso_recusar(bigint, text) to authenticated;
grant execute on function public.jb_pagar_diarista(uuid, date, numeric) to authenticated;
