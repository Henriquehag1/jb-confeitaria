-- Parcerias: o formulário do site passa a aceitar só e-mail (25/11/2026).
-- A Jessica prefere responder toda proposta por e-mail (jbconfeitariaparcerias@gmail.com),
-- então jb_parceria_criar recusa telefone com 'contato'. Os pedidos antigos continuam como
-- estão (nada é apagado nem alterado). Mesmo texto da função em sql/parcerias.sql.

create or replace function public.jb_parceria_criar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_quem    text := coalesce(p->>'com_quem','');
  v_tipo    text := coalesce(p->>'tipo','');
  v_nome    text := btrim(coalesce(p->>'nome',''));
  v_marca   text := left(nullif(btrim(coalesce(p->>'marca','')),''), 80);
  v_insta   text := nullif(btrim(coalesce(p->>'instagram','')),'');
  v_cont    text := btrim(coalesce(p->>'contato',''));
  v_quando  text := left(nullif(btrim(coalesce(p->>'quando','')),''), 60);
  v_form    text := nullif(p->>'formato','');
  v_ideia   text := btrim(coalesce(p->>'ideia',''));
  v_cod     text;
  v_agora   timestamptz := now();
begin
  -- campo escondido do formulário: robô preenche, gente não vê. Finge que deu certo.
  if length(btrim(coalesce(p->>'hp',''))) > 0 then
    return jsonb_build_object('codigo', 'PC' || lpad((floor(random() * 10000))::int::text, 4, '0'));
  end if;

  if v_quem not in ('jb','jessica') then raise exception 'com_quem'; end if;
  if not ((v_quem = 'jb' and v_tipo in ('collab','corporativo','evento','revenda','outro'))
       or (v_quem = 'jessica' and v_tipo in ('publi','presenca','aula','outro'))) then
    raise exception 'tipo';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 80 then raise exception 'nome'; end if;

  -- contato: só e-mail (desde 25/11/2026 a resposta de parceria é sempre por e-mail)
  if v_cont ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' and length(v_cont) <= 120 then
    v_cont := lower(v_cont);
  else
    raise exception 'contato';
  end if;

  if v_insta is not null then
    v_insta := regexp_replace(v_insta, '^(https?://)?(www\.)?instagram\.com/', '', 'i');
    v_insta := regexp_replace(v_insta, '[/?].*$', '');
    v_insta := ltrim(v_insta, '@');
    if v_insta !~ '^[A-Za-z0-9._]{1,30}$' then raise exception 'instagram'; end if;
    v_insta := lower(v_insta);
  end if;

  if v_form is not null and v_form not in ('pago','permuta','a_combinar') then raise exception 'formato'; end if;
  if length(v_ideia) < 10 then raise exception 'ideia'; end if;
  v_ideia := left(v_ideia, 1200);

  if (select count(*) from jb_parceria where contato = v_cont and criado_em > v_agora - interval '1 day') >= 3 then
    raise exception 'limite';
  end if;
  if (select count(*) from jb_parceria where criado_em > v_agora - interval '10 minutes') >= 15 then
    raise exception 'limite';
  end if;

  loop
    v_cod := 'PC' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from jb_parceria where codigo = v_cod);
  end loop;

  insert into jb_parceria (codigo, com_quem, tipo, nome, marca, instagram, contato, quando, formato, ideia, origem)
  values (v_cod, v_quem, v_tipo, v_nome, v_marca, v_insta, v_cont, v_quando, v_form, v_ideia,
          left(nullif(p->>'origem',''), 40));

  return jsonb_build_object('codigo', v_cod);
end $fn$;

revoke all on function public.jb_parceria_criar(jsonb) from public;
grant execute on function public.jb_parceria_criar(jsonb) to anon, authenticated;
