-- JB OS · acerto de dados em Quem veio no ateliê (25/10/2026), com o ok do Henrique. Já aplicado; fica de registro.
-- Edclecia e Sabrina são a mesma pessoa (vale Sabrina); Marcus/Markus é o Markus Porthos.
update jb_freela set nome = 'Sabrina' where nome = 'Edclecia Silva';
update jb_freela set nome = 'Markus Porthos' where nome in ('Marcus','Markus');
update jb_freela_acesso set nome = 'Sabrina' where nome = 'Edclecia Silva';
update jb_freela_pessoa set nome = 'Sabrina' where nome = 'Edclecia Silva';
update jb_producao_item set para_freela = 'Sabrina' where para_freela = 'Edclecia Silva';
update jb_producao_item set quem = array_replace(quem, 'fr:Edclecia Silva', 'fr:Sabrina') where 'fr:Edclecia Silva' = any(quem);
update jb_conta set descricao = replace(descricao, 'Freela Edclecia Silva', 'Freela Sabrina') where descricao like 'Freela Edclecia Silva%';
update jb_conta set descricao = regexp_replace(descricao, '^Freela (Marcus|Markus)(?! Porthos)', 'Freela Markus Porthos')
 where descricao ~ '^Freela (Marcus|Markus)' and descricao !~ '^Freela Markus Porthos';
-- Sabrina 22/10: das 15h às 20h, R$ 90 (a conta 37 já estava assim)
update jb_freela set valor = 90, saida = '20:00' where id = 15;
-- Bella 17/10: diária repetida (vale a 14, ligada à falta da Yasmin)
update jb_conta set valor_pago = null, pago_em = null, pago_por = null, arquivada = true where id = 35;
update jb_freela set cancelada = true, cancelada_em = now() where id = 13;
-- Sabrina 24/10: diária que faltava (Pix de R$ 220 em 24/10 = 22/10 R$ 90 + 24/10 R$ 130): conta 41 e freela 19, pagas em 24/10.
