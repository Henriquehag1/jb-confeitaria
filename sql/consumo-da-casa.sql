-- Consumo da casa (15/11/2026): motivo próprio de perda para o que os sócios, a equipe
-- ou a família levam para comer, separado da cortesia para cliente.
-- Aplicado pelo conector em 15/11/2026 (bloco DO). Quem levou é obrigatório.
alter table public.jb_perda drop constraint jb_perda_motivo_check;
alter table public.jb_perda add constraint jb_perda_motivo_check
  check (motivo = any (array['venceu','danificado','fora_padrao','cortesia','erro','contagem','consumo']));
alter table public.jb_perda add constraint jb_perda_consumo_quem
  check (motivo <> 'consumo' or length(btrim(coalesce(obs,''))) > 0);
-- jb_saidas desconta todas as perdas não anuladas, então o consumo já entra como saída
-- explicada na conferência Geladeira x Saipos.
