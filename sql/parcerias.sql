-- Parcerias e collabs (16/11/2026): pedidos que marcas e perfis mandam pela página
-- jballassa.github.io/parcerias.html. O site chama jb_parceria_criar (anon, com
-- validação e limite); só o gestor lê e muda o status no JB OS.
--   nova → conversando → fechada | recusada
-- Nada é apagado: recusada fica no histórico.

create table if not exists public.jb_parceria (
  id            bigint generated always as identity primary key,
  codigo        text not null unique,
  criado_em     timestamptz not null default now(),
  com_quem      text not null check (com_quem in ('jb','jessica')),
  tipo          text not null check (tipo in ('collab','corporativo','evento','revenda','publi','presenca','aula','outro')),
  nome          text not null,
  marca         text,
  instagram     text,
  contato       text not null,
  quando        text,
  formato       text check (formato in ('pago','permuta','a_combinar')),
  ideia         text not null,
  status        text not null default 'nova' check (status in ('nova','conversando','fechada','recusada')),
  nota_interna  text,
  origem        text,
  atualizado_em timestamptz
);

alter table public.jb_parceria enable row level security;
drop policy if exists jb_parceria_gestor on public.jb_parceria;
create policy jb_parceria_gestor on public.jb_parceria
  for all to authenticated using (public.jb_e_gestor()) with check (public.jb_e_gestor());
revoke all on public.jb_parceria from anon, public;
revoke insert, delete, truncate on public.jb_parceria from authenticated;
grant select, update on public.jb_parceria to authenticated;

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
