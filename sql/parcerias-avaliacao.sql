-- Parcerias: nota da régua e resposta pronta (25/11/2026).
-- A análise automática (tarefa agendada do Claude) grava em avaliacao a nota de 0 a 12,
-- o veredito, a nota de cada ponto com o motivo e as três mensagens (curta, média, emocional).
-- O JB OS mostra isso no cartão do pedido e abre a resposta no e-mail de parcerias da JB
-- (ou no WhatsApp, quando o contato é telefone). respondido_em marca quando a Jessica
-- abriu a resposta pelo botão. Nada é apagado.
--
-- avaliacao = {
--   "nota": 0..12, "veredito": "sim" | "condicoes" | "nao_agora" | "nao",
--   "corte": null | "motivo do corte automático",
--   "resumo": "uma frase",
--   "criterios": { "dinheiro": {"n":0..2,"porque":"..."}, "alcance": {...}, "venda": {...},
--                  "marca": {...}, "trabalho": {...}, "custo": {...} },
--   "assunto": "assunto do e-mail",
--   "mensagens": { "curta": "...", "media": "...", "emocional": "..." },
--   "recomendada": "curta" | "media" | "emocional",
--   "avaliado_em": "2026-11-25T12:00:00Z"
-- }

alter table public.jb_parceria add column if not exists avaliacao jsonb;
alter table public.jb_parceria add column if not exists respondido_em timestamptz;
alter table public.jb_parceria add column if not exists resposta_canal text;
alter table public.jb_parceria add column if not exists resposta_versao text;

alter table public.jb_parceria drop constraint if exists jb_parceria_avaliacao_ok;
alter table public.jb_parceria add constraint jb_parceria_avaliacao_ok check (
  avaliacao is null or (
    jsonb_typeof(avaliacao) = 'object'
    and (avaliacao->>'nota') ~ '^([0-9]|1[0-2])$'
    and avaliacao->>'veredito' in ('sim','condicoes','nao_agora','nao')
  )
);
alter table public.jb_parceria drop constraint if exists jb_parceria_resposta_canal_ok;
alter table public.jb_parceria add constraint jb_parceria_resposta_canal_ok
  check (resposta_canal is null or resposta_canal in ('email','whatsapp','app_email'));
