-- JB OS: entrada no freezer (19/10/2026)
-- O freezer mora na última contagem em que a Jessica ou o Henrique contaram o freezer.
-- "Coloquei no freezer" soma nela; "Saiu do freezer" (Repor) desconta dela. Tudo fica num histórico.

create table if not exists public.jb_freezer_mov (
  id bigserial primary key,
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  produto_id bigint not null references public.jb_produto(id),
  qtd integer not null check (qtd <> 0 and qtd between -9999 and 9999),
  tipo text not null check (tipo in ('entrada','saida')),
  contagem_id bigint,
  registrado_por uuid default auth.uid(),
  nome text,
  criado_em timestamptz not null default now()
);
alter table public.jb_freezer_mov enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'jb_freezer_mov' and policyname = 'jb_freezer_mov_gestor_le') then
    create policy jb_freezer_mov_gestor_le on public.jb_freezer_mov for select to authenticated using (public.jb_e_gestor());
  end if;
end $p$;

create or replace function interno.jb_freezer_ref(p_data date) returns bigint
language sql stable set search_path to 'public','pg_temp' as $$
  select c.id from public.jb_contagem c
   where c.freezer_contado and c.data <= p_data
   order by c.data desc, (c.momento = 'fechamento') desc
   limit 1
$$;

create or replace function public.jb_freezer_entrada(p_itens jsonb) returns integer
language plpgsql volatile security definer set search_path to 'public','pg_temp' as $$
declare
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ref   bigint;
  v_nome  text;
  v_total integer;
  v_lista jsonb;
begin
  if not public.jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) > 200 then raise exception 'itens invalidos'; end if;
  select nome into v_nome from jb_usuario where user_id = auth.uid();
  v_ref := interno.jb_freezer_ref(v_hoje);
  if v_ref is null then
    select id into v_ref from jb_contagem where data = v_hoje and momento = 'abertura';
    if v_ref is null then raise exception 'conte o freezer primeiro'; end if;
    update jb_contagem set freezer_contado = true where id = v_ref;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('pid', y.pid, 'n', y.n)), '[]'::jsonb) into v_lista
    from (select x.pid, least(999, sum(x.n))::int as n
            from (select (e->>'produto_id')::bigint as pid, greatest(0, least(999, coalesce((e->>'qtd')::int, 0))) as n
                    from jsonb_array_elements(p_itens) e where (e->>'produto_id') is not null) x
           where x.n > 0 and exists (select 1 from jb_produto p where p.id = x.pid)
           group by x.pid) y;

  perform set_config('jb.mov_tipo', 'acerto', true);
  insert into jb_contagem_item (contagem_id, produto_id, qtd, freezer)
  select v_ref, t.pid, 0, t.n from jsonb_to_recordset(v_lista) as t(pid bigint, n integer)
  on conflict (contagem_id, produto_id) do update set freezer = least(9999, jb_contagem_item.freezer + excluded.freezer);
  perform set_config('jb.mov_tipo', '', true);

  insert into jb_freezer_mov (data, produto_id, qtd, tipo, contagem_id, registrado_por, nome)
  select v_hoje, t.pid, t.n, 'entrada', v_ref, auth.uid(), v_nome from jsonb_to_recordset(v_lista) as t(pid bigint, n integer);

  select coalesce(sum(freezer), 0) into v_total from jb_contagem_item where contagem_id = v_ref;
  return v_total;
end $$;

-- Repor: o que sai do freezer desconta da mesma contagem de referência e entra no histórico.
create or replace function public.jb_repor(p_data date, p_itens jsonb) returns integer
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_nome  text;
  v_papel text;
  v_ab    bigint;
  v_autor uuid;
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_total integer;
  v_ref   bigint;
begin
  select nome, papel into v_nome, v_papel from jb_usuario where user_id = auth.uid() and ativo;
  if v_nome is null then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'itens invalidos';
  end if;
  select id, registrado_por into v_ab, v_autor from jb_contagem where data = p_data and momento = 'abertura';
  if v_ab is null then
    raise exception 'turno ainda nao aberto';
  end if;
  -- Repor é dos donos. A equipe só repõe no turno que ela mesma abriu, no dia.
  if v_papel <> 'gestor' and (v_autor is distinct from auth.uid() or p_data <> v_hoje) then
    raise exception 'reposicao so dos donos' using errcode = '42501';
  end if;

  perform set_config('jb.mov_tipo', 'reposicao', true);
  insert into jb_contagem_item (contagem_id, produto_id, qtd)
  select v_ab, (e->>'produto_id')::int, least(999, (e->>'qtd')::int)
  from jsonb_array_elements(p_itens) e
  where (e->>'produto_id') is not null and coalesce((e->>'qtd')::int, 0) > 0
  on conflict (contagem_id, produto_id)
    do update set qtd = least(999, jb_contagem_item.qtd + excluded.qtd);
  perform set_config('jb.mov_tipo', '', true);

  if v_papel = 'gestor' then
    v_ref := coalesce(interno.jb_freezer_ref(p_data), v_ab);
    insert into jb_freezer_mov (data, produto_id, qtd, tipo, contagem_id, registrado_por, nome)
    select p_data, i.produto_id, -least(i.freezer, least(999, (e->>'qtd')::int)), 'saida', v_ref, auth.uid(), v_nome
      from jsonb_array_elements(p_itens) e
      join jb_contagem_item i on i.contagem_id = v_ref and i.produto_id = (e->>'produto_id')::int
     where coalesce((e->>'do_freezer')::boolean, false) and coalesce((e->>'qtd')::int, 0) > 0 and i.freezer > 0;
    update jb_contagem_item i set freezer = greatest(0, i.freezer - least(999, (e->>'qtd')::int))
      from jsonb_array_elements(p_itens) e
     where i.contagem_id = v_ref and (e->>'produto_id') is not null and i.produto_id = (e->>'produto_id')::int
       and coalesce((e->>'do_freezer')::boolean, false) and coalesce((e->>'qtd')::int, 0) > 0;
  end if;

  update jb_contagem set atualizado_em = now() where id = v_ab;
  select coalesce(sum(qtd), 0) into v_total from jb_contagem_item where contagem_id = v_ab;
  return v_total;
end $function$;
