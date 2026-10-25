-- JB OS · tarefas para a equipe que não são receita (dobrar pano, limpar a geladeira) (25/10/2026)
-- Ficam junto do plano de produção, na tela "Tarefas da equipe", com o mesmo "para quem" do plano
-- (quem: 'todos', 'producao', 'equipe', 'freelas', 'fr:Nome'). Tabela própria: o plano de produção,
-- o Quanto fazer, o custo e o estoque continuam lendo só jb_producao_item, sem mudança.
-- Sem as palavras que travam o conector.

create table if not exists public.jb_tarefa_equipe (
  id          bigint generated always as identity primary key,
  data        date not null,
  texto       text not null check (length(btrim(texto)) between 1 and 160),
  quem        text[] not null default '{todos}' check (cardinality(quem) between 1 and 12),
  feito       boolean not null default false,
  feito_em    timestamptz,
  feito_por   text,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists jb_tarefa_equipe_data on public.jb_tarefa_equipe (data);
alter table public.jb_tarefa_equipe enable row level security;
create policy jb_tarefa_equipe_gestor on public.jb_tarefa_equipe for all
  using (public.jb_e_gestor()) with check (public.jb_e_gestor());
create policy jb_tarefa_equipe_ver on public.jb_tarefa_equipe for select
  using (public.jb_e_membro() and public.jb_item_visivel(quem, 'todos', null, public.jb_meu_papel(), null));
grant select, insert, update on public.jb_tarefa_equipe to authenticated;

-- quem recebeu a tarefa marca como feita (ou desfaz)
create or replace function public.jb_tarefa_marcar(p_id bigint, p_feito boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare t public.jb_tarefa_equipe; v_nome text;
begin
  select * into t from public.jb_tarefa_equipe where id = p_id;
  if t.id is null then raise exception 'tarefa nao encontrada'; end if;
  if not (public.jb_e_gestor() or (public.jb_e_membro() and public.jb_item_visivel(t.quem, 'todos', null, public.jb_meu_papel(), null))) then
    raise exception 'tarefa de outra pessoa' using errcode = '42501';
  end if;
  select nome into v_nome from public.jb_usuario where user_id = auth.uid();
  update public.jb_tarefa_equipe
     set feito = coalesce(p_feito, true),
         feito_em = case when coalesce(p_feito, true) then now() end,
         feito_por = case when coalesce(p_feito, true) then v_nome end
   where id = p_id;
  return jsonb_build_object('ok', true, 'feito', coalesce(p_feito, true));
end $function$;
grant execute on function public.jb_tarefa_marcar(bigint, boolean) to authenticated;

-- a freela marca pelo código dela; só as tarefas de hoje que são dela
create or replace function public.jb_freela_tarefa(p_token text, p_id bigint, p_feito boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare a public.jb_freela_acesso; t public.jb_tarefa_equipe;
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then raise exception 'acesso encerrado' using errcode = '42501'; end if;
  select * into t from public.jb_tarefa_equipe where id = p_id;
  if t.id is null or t.data <> (now() at time zone 'America/Sao_Paulo')::date
     or not public.jb_item_visivel(t.quem, 'todos', null, null, a.nome) then
    raise exception 'tarefa de outra pessoa' using errcode = '42501';
  end if;
  update public.jb_tarefa_equipe
     set feito = coalesce(p_feito, true),
         feito_em = case when coalesce(p_feito, true) then now() end,
         feito_por = case when coalesce(p_feito, true) then a.nome end
   where id = p_id;
  return jsonb_build_object('ok', true, 'feito', coalesce(p_feito, true));
end $function$;
grant execute on function public.jb_freela_tarefa(text, bigint, boolean) to anon, authenticated;

-- o dia da freela passa a trazer as tarefas dela
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
      from public.jb_subreceita_item i where i.subreceita_id = any(v_subs)), '[]'::jsonb),
    'tarefas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'texto', t.texto, 'quem', t.quem,
        'feito', t.feito, 'feito_em', t.feito_em, 'feito_por', t.feito_por) order by t.id)
      from public.jb_tarefa_equipe t
     where t.data = v_hoje and public.jb_item_visivel(t.quem, 'todos', null, null, p_nome)), '[]'::jsonb)
  );
end $function$;

