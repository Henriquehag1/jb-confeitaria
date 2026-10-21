-- JB OS · várias freelas liberadas ao mesmo tempo (21/10/2026)
-- Antes: liberar uma freela encerrava o acesso de qualquer outra.
-- Agora: cada pessoa tem o seu código. Liberar de novo a mesma pessoa troca só o código dela.
-- Entrar: o código é procurado entre os acessos abertos e ainda sem celular. Código errado conta
-- erro em todos os acessos abertos sem celular (5 erros bloqueiam, como antes) e o limite geral
-- de 30 tentativas em 10 minutos continua.

create or replace function public.jb_freela_liberar(p_nome text, p_ate timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_id bigint; v_nome text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'); v_cod text;
begin
  if not public.jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  if char_length(v_nome) < 1 or char_length(v_nome) > 40 then raise exception 'nome invalido'; end if;
  if p_ate is null or p_ate <= now() + interval '15 minutes' or p_ate > now() + interval '4 days' then
    raise exception 'validade invalida';
  end if;
  update public.jb_freela_acesso set encerrado_em = now(), encerrado_por = auth.uid()
   where encerrado_em is null and lower(btrim(nome)) = lower(v_nome);
  v_cod := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.jb_freela_acesso (nome, valido_de, valido_ate, codigo_hash, criado_por)
  values (v_nome, now(), p_ate, 'pendente', auth.uid()) returning id into v_id;
  update public.jb_freela_acesso set codigo_hash = encode(extensions.digest(v_id::text || ':' || v_cod, 'sha256'), 'hex') where id = v_id;
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $function$;

create or replace function public.jb_freela_encerrar_um(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.jb_e_gestor() then raise exception 'so gestor' using errcode = '42501'; end if;
  update public.jb_freela_acesso set encerrado_em = now(), encerrado_por = auth.uid() where id = p_id and encerrado_em is null;
end $function$;

create or replace function public.jb_freela_entrar(p_codigo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare a public.jb_freela_acesso; v_tok text; v_cod text := regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
        v_abertos integer; v_livres integer;
begin
  if (select count(*) from interno.jb_freela_tentativa where em > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('ok', false, 'motivo', 'espere');
  end if;
  select count(*), count(*) filter (where x.token_hash is null and x.erros < 5)
    into v_abertos, v_livres
    from public.jb_freela_acesso x
   where x.encerrado_em is null and now() >= x.valido_de and now() < x.valido_ate;
  if v_abertos = 0 then
    insert into interno.jb_freela_tentativa default values;
    return jsonb_build_object('ok', false, 'motivo', 'fechado');
  end if;
  if length(v_cod) = 6 then
    select * into a from public.jb_freela_acesso x
     where x.encerrado_em is null and now() >= x.valido_de and now() < x.valido_ate
       and x.codigo_hash = encode(extensions.digest(x.id::text || ':' || v_cod, 'sha256'), 'hex')
     order by x.id desc limit 1;
  end if;
  if a.id is not null then
    if a.erros >= 5 then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
    if a.token_hash is not null then return jsonb_build_object('ok', false, 'motivo', 'em_uso'); end if;
    v_tok := encode(extensions.gen_random_bytes(24), 'hex');
    update public.jb_freela_acesso set token_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex'), token_em = now() where id = a.id;
    return jsonb_build_object('ok', true, 'token', v_tok, 'nome', a.nome, 'valido_ate', a.valido_ate);
  end if;
  -- código errado: conta erro em todos os acessos abertos que ainda esperam um celular
  insert into interno.jb_freela_tentativa default values;
  if v_livres = 0 then
    return jsonb_build_object('ok', false, 'motivo',
      case when exists (select 1 from public.jb_freela_acesso x
                         where x.encerrado_em is null and now() >= x.valido_de and now() < x.valido_ate
                           and x.token_hash is null) then 'bloqueado' else 'fechado' end);
  end if;
  update public.jb_freela_acesso x set erros = erros + 1
   where x.encerrado_em is null and now() >= x.valido_de and now() < x.valido_ate and x.token_hash is null and x.erros < 5;
  return jsonb_build_object('ok', false, 'motivo',
    case when exists (select 1 from public.jb_freela_acesso x
                       where x.encerrado_em is null and now() >= x.valido_de and now() < x.valido_ate
                         and x.token_hash is null and x.erros < 5) then 'codigo' else 'bloqueado' end);
end $function$;

grant execute on function public.jb_freela_encerrar_um(bigint) to authenticated;
