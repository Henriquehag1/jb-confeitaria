create schema if not exists backup;
create table if not exists backup.jb_perda_20261108 as select * from public.jb_perda where id between 77 and 86;

alter table public.jb_perda add column if not exists anulada boolean not null default false;
alter table public.jb_perda add column if not exists anulada_motivo text;

alter table public.jb_perda drop constraint jb_perda_motivo_check;
alter table public.jb_perda add constraint jb_perda_motivo_check
  check (motivo = any (array['venceu','danificado','fora_padrao','cortesia','erro','contagem']));

create or replace view public.jb_saidas with (security_invoker=on) as
 WITH ad AS (
         SELECT jb_adendo.data, jb_adendo.produto_id, sum(jb_adendo.qtd) AS qtd
           FROM jb_adendo
          WHERE (jb_adendo.produto_id IS NOT NULL)
          GROUP BY jb_adendo.data, jb_adendo.produto_id
        ), pe AS (
         SELECT jb_perda.data, jb_perda.produto_id, sum(jb_perda.qtd) AS qtd
           FROM jb_perda
          WHERE (NOT jb_perda.apos_fechamento) AND (NOT jb_perda.anulada)
          GROUP BY jb_perda.data, jb_perda.produto_id
        ), pd AS (
         SELECT jb_perda.data, jb_perda.produto_id, sum(jb_perda.qtd) AS qtd
           FROM jb_perda
          WHERE jb_perda.apos_fechamento AND (NOT jb_perda.anulada)
          GROUP BY jb_perda.data, jb_perda.produto_id
        )
 SELECT a.data,
    p.id AS produto_id,
    p.nome AS produto,
    p.ordem,
    ia.qtd AS deixou,
        CASE WHEN (f.id IS NULL) THEN 0 ELSE itf.qtd END AS sobrou,
        CASE WHEN (f.id IS NULL) THEN ia.qtd ELSE (ia.qtd - itf.qtd) END AS saiu,
    COALESCE(ad.qtd, (0)::bigint) AS depois,
    (CASE WHEN (f.id IS NULL) THEN ia.qtd ELSE (ia.qtd - itf.qtd) END + COALESCE(ad.qtd, (0)::bigint)) AS saiu_total,
    (f.id IS NOT NULL) AS fechado,
        CASE WHEN ((fo.id IS NULL) OR (ito.qtd IS NULL)) THEN NULL::bigint
            ELSE GREATEST(((ito.qtd - COALESCE(ado.qtd, (0)::bigint)) - COALESCE(pdo.qtd, (0)::bigint)), (0)::bigint) END AS de_ontem,
        CASE WHEN ((fo.id IS NULL) OR (ito.qtd IS NULL)) THEN NULL::bigint
            ELSE (ia.qtd - GREATEST(((ito.qtd - COALESCE(ado.qtd, (0)::bigint)) - COALESCE(pdo.qtd, (0)::bigint)), (0)::bigint)) END AS entrou,
    COALESCE(pe.qtd, (0)::bigint) AS perdeu,
    ((CASE WHEN (f.id IS NULL) THEN ia.qtd ELSE (ia.qtd - itf.qtd) END + COALESCE(ad.qtd, (0)::bigint)) - COALESCE(pe.qtd, (0)::bigint)) AS vendeu,
    COALESCE(pd.qtd, (0)::bigint) AS perdeu_depois,
        CASE WHEN (f.id IS NULL) THEN NULL::bigint
            ELSE GREATEST(((itf.qtd - COALESCE(ad.qtd, (0)::bigint)) - COALESCE(pd.qtd, (0)::bigint)), (0)::bigint) END AS ficou
   FROM (((((((((((jb_contagem a
     JOIN jb_contagem_item ia ON ((ia.contagem_id = a.id)))
     JOIN jb_produto p ON ((p.id = ia.produto_id)))
     LEFT JOIN jb_contagem f ON (((f.data = a.data) AND (f.momento = 'fechamento'::text))))
     LEFT JOIN jb_contagem_item itf ON (((itf.contagem_id = f.id) AND (itf.produto_id = p.id))))
     LEFT JOIN ad ON (((ad.data = a.data) AND (ad.produto_id = p.id))))
     LEFT JOIN pe ON (((pe.data = a.data) AND (pe.produto_id = p.id))))
     LEFT JOIN pd ON (((pd.data = a.data) AND (pd.produto_id = p.id))))
     LEFT JOIN jb_contagem fo ON (((fo.data = (a.data - 1)) AND (fo.momento = 'fechamento'::text))))
     LEFT JOIN jb_contagem_item ito ON (((ito.contagem_id = fo.id) AND (ito.produto_id = p.id))))
     LEFT JOIN ad ado ON (((ado.data = (a.data - 1)) AND (ado.produto_id = p.id))))
     LEFT JOIN pd pdo ON (((pdo.data = (a.data - 1)) AND (pdo.produto_id = p.id))))
  WHERE (a.momento = 'abertura'::text);

create or replace view public.jb_perda_resumo with (security_invoker=on) as
 SELECT motivo,
    (count(*))::integer AS lancamentos,
    (sum(qtd))::integer AS unidades,
    min(data) AS de,
    max(data) AS ate
   FROM jb_perda p
  WHERE (data >= (((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date - 60)) AND (NOT anulada)
  GROUP BY motivo;

create or replace function public.jb_perda_sem_repetir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from jb_perda x
     where x.data = new.data and x.produto_id = new.produto_id and x.qtd = new.qtd
       and x.motivo = new.motivo and x.apos_fechamento = new.apos_fechamento
       and x.registrado_por is not distinct from new.registrado_por
       and not x.anulada
       and x.criado_em > now() - interval '60 seconds'
  ) then
    return null;
  end if;
  return new;
end $$;
revoke all on function public.jb_perda_sem_repetir() from public, anon, authenticated;

drop trigger if exists jb_perda_sem_repetir on public.jb_perda;
create trigger jb_perda_sem_repetir before insert on public.jb_perda
  for each row execute function public.jb_perda_sem_repetir();

update public.jb_perda set motivo = 'fora_padrao', obs = null where id = 83 and produto_id = 26 and qtd = 5;
update public.jb_perda set anulada = true, anulada_motivo = 'Gravado 2 vezes no mesmo envio; anulado em 08/11 a pedido do Henrique' where id in (84, 85);
