-- JB OS · retorno de quem recebeu a tarefa (30/10/2026)
-- Em cada receita do plano e em cada "outra tarefa", quem recebeu pode dizer "não deu" (com o motivo)
-- ou deixar um adendo (um bilhete curto). A Jessica lê na lista do dia.
-- Feito continua igual (quadradinho nas tarefas; "quanto fiz" nas receitas): custo, estoque e
-- Quanto fazer seguem lendo só feito e o registro, nada muda para eles.
-- Quando vira feito, o "não deu" sai sozinho (o bilhete fica).

alter table public.jb_producao_item
  add column if not exists nao_deu  boolean not null default false,
  add column if not exists nota     text check (nota is null or length(nota) <= 200),
  add column if not exists nota_por text,
  add column if not exists nota_em  timestamptz;
alter table public.jb_tarefa_equipe
  add column if not exists nao_deu  boolean not null default false,
  add column if not exists nota     text check (nota is null or length(nota) <= 200),
  add column if not exists nota_por text,
  add column if not exists nota_em  timestamptz;

create or replace function interno.jb_feito_tira_nao_deu()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.feito and not coalesce(old.feito, false) then new.nao_deu := false; end if;
  return new;
end $function$;
drop trigger if exists jb_producao_item_feito_nao_deu on public.jb_producao_item;
create trigger jb_producao_item_feito_nao_deu before update of feito on public.jb_producao_item
  for each row execute function interno.jb_feito_tira_nao_deu();
drop trigger if exists jb_tarefa_equipe_feito_nao_deu on public.jb_tarefa_equipe;
create trigger jb_tarefa_equipe_feito_nao_deu before update of feito on public.jb_tarefa_equipe
  for each row execute function interno.jb_feito_tira_nao_deu();

-- quem tem login (Eliana, Yasmin; o gestor também pode)
-- p_tipo: 'producao' (receita do plano) ou 'tarefa' (outra tarefa)
-- p_nao_deu true = não deu, e a nota é o motivo; false = só o adendo (nota vazia apaga)
create or replace function public.jb_tarefa_retorno(p_tipo text, p_id bigint, p_nao_deu boolean, p_nota text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nome text; v_papel text; v_ok boolean;
  v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 200);
  v_nao boolean := coalesce(p_nao_deu, false);
begin
  if not public.jb_e_membro() then raise exception 'sem acesso' using errcode = '42501'; end if;
  select u.nome, u.papel into v_nome, v_papel from public.jb_usuario u where u.user_id = auth.uid() and u.ativo limit 1;
  if p_tipo = 'tarefa' then
    update public.jb_tarefa_equipe t
       set nao_deu = v_nao and not t.feito, nota = v_nota,
           nota_por = case when v_nota is not null or v_nao then v_nome end,
           nota_em  = case when v_nota is not null or v_nao then now() end
     where t.id = p_id and (public.jb_e_gestor() or public.jb_item_visivel(t.quem, 'todos', null, v_papel, null))
    returning true into v_ok;
  elsif p_tipo = 'producao' then
    update public.jb_producao_item p
       set nao_deu = v_nao and not p.feito, nota = v_nota,
           nota_por = case when v_nota is not null or v_nao then v_nome end,
           nota_em  = case when v_nota is not null or v_nao then now() end
     where p.id = p_id and (public.jb_e_gestor() or public.jb_item_visivel(p.quem, p.para, p.para_freela, v_papel, null))
    returning true into v_ok;
  else
    raise exception 'tipo invalido';
  end if;
  if not coalesce(v_ok, false) then raise exception 'tarefa de outra pessoa' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.jb_tarefa_retorno(text, bigint, boolean, text) from public, anon;
grant execute on function public.jb_tarefa_retorno(text, bigint, boolean, text) to authenticated;

-- a freela, pelo código dela; só o que é dela e é de hoje
create or replace function public.jb_freela_retorno(p_token text, p_tipo text, p_id bigint, p_nao_deu boolean, p_nota text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  a public.jb_freela_acesso; v_ok boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nota text := left(nullif(btrim(coalesce(p_nota, '')), ''), 200);
  v_nao boolean := coalesce(p_nao_deu, false);
begin
  a := interno.jb_freela_por_token(p_token);
  if a.id is null then raise exception 'acesso encerrado' using errcode = '42501'; end if;
  if p_tipo = 'tarefa' then
    update public.jb_tarefa_equipe t
       set nao_deu = v_nao and not t.feito, nota = v_nota,
           nota_por = case when v_nota is not null or v_nao then a.nome end,
           nota_em  = case when v_nota is not null or v_nao then now() end
     where t.id = p_id and t.data = v_hoje and public.jb_item_visivel(t.quem, 'todos', null, null, a.nome)
    returning true into v_ok;
  elsif p_tipo = 'producao' then
    update public.jb_producao_item p
       set nao_deu = v_nao and not p.feito, nota = v_nota,
           nota_por = case when v_nota is not null or v_nao then a.nome end,
           nota_em  = case when v_nota is not null or v_nao then now() end
     where p.id = p_id and p.data = v_hoje and interno.jb_freela_ve(p, a)
    returning true into v_ok;
  else
    raise exception 'tipo invalido';
  end if;
  if not coalesce(v_ok, false) then raise exception 'tarefa de outra pessoa' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.jb_freela_retorno(text, text, bigint, boolean, text) from public;
grant execute on function public.jb_freela_retorno(text, text, bigint, boolean, text) to anon, authenticated;

-- a lista do dia de quem tem login passa a trazer o retorno (colunas novas no fim)
create or replace view public.jb_producao_dia as
 SELECT p.id, p.data, p.tipo, p.ref_id, p.qtd, p.feito, p.feito_em, p.obs,
        CASE WHEN p.tipo = 'ficha'::text THEN f.nome ELSE s.nome END AS nome,
        CASE WHEN p.tipo = 'ficha'::text THEN f.rendimento_un ELSE s.rendimento_kg END AS rendimento,
        CASE WHEN p.tipo = 'ficha'::text THEN 'un'::text ELSE 'kg'::text END AS unidade,
        COALESCE(CASE WHEN p.tipo = 'ficha'::text THEN f.preparo_conferido ELSE s.preparo_conferido END, false) AS preparo_conferido,
        CASE WHEN p.tipo = 'ficha'::text THEN f.modo_preparo ELSE s.modo_preparo END AS modo_preparo,
        CASE WHEN p.tipo = 'ficha'::text THEN f.foto_url ELSE NULL::text END AS foto_url,
        p.para,
        CASE WHEN p.tipo = 'subreceita'::text THEN s.unidade_producao ELSE NULL::text END AS unidade_producao,
        p.para_freela, p.feito_por, p.quem,
        ( SELECT sum(r.qtd) AS sum FROM jb_producao_registro r WHERE r.item_id = p.id) AS feito_qtd,
        ( SELECT jsonb_agg(jsonb_build_object('nome', r.nome, 'qtd', r.qtd, 'em', r.atualizado_em) ORDER BY r.atualizado_em) AS jsonb_agg
            FROM jb_producao_registro r WHERE r.item_id = p.id) AS feitos,
        p.nao_deu, p.nota, p.nota_por, p.nota_em
   FROM jb_producao_item p
     LEFT JOIN jb_ficha f ON p.tipo = 'ficha'::text AND f.id = p.ref_id
     LEFT JOIN jb_subreceita s ON p.tipo = 'subreceita'::text AND s.id = p.ref_id
  WHERE jb_e_membro() AND (jb_e_gestor() OR jb_item_visivel(p.quem, p.para, p.para_freela, jb_meu_papel(), NULL::text));

-- o dia da freela (e a conferência) também
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
        'nao_deu', p.nao_deu, 'nota', p.nota, 'nota_por', p.nota_por, 'nota_em', p.nota_em,
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
        'feito', t.feito, 'feito_em', t.feito_em, 'feito_por', t.feito_por,
        'nao_deu', t.nao_deu, 'nota', t.nota, 'nota_por', t.nota_por, 'nota_em', t.nota_em) order by t.id)
      from public.jb_tarefa_equipe t
     where t.data = v_hoje and public.jb_item_visivel(t.quem, 'todos', null, null, p_nome)), '[]'::jsonb)
  );
end $function$;

