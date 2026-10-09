const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const AGORA = "2026-10-20T15:00:00Z";

test("conferência pura: Pix casa com dias seguidos, valor diferente, sem registro, duplicado, esquecido, diária e quinzena", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(() => {
    const contas = {
      1: { id: 1, valor: 130, vencimento: "2026-10-01", pago_em: null, nf_ref: null },
      2: { id: 2, valor: 130, vencimento: "2026-10-02", pago_em: null, nf_ref: null },
      3: { id: 3, valor: 130, vencimento: "2026-10-08", pago_em: null, nf_ref: null },
      4: { id: 4, valor: 130, vencimento: "2026-10-09", pago_em: null, nf_ref: null },
      5: { id: 5, valor: 120, vencimento: "2026-10-05", pago_em: null, nf_ref: null },
      6: { id: 6, valor: 130, vencimento: "2026-10-06", pago_em: null, nf_ref: null }
    };
    const freelas = [
      { nome: "Marcus", data: "2026-10-01", valor: 130, conta_id: 1 }, { nome: "Marcus", data: "2026-10-02", valor: 130, conta_id: 2 },
      { nome: "Marcus", data: "2026-10-08", valor: 130, conta_id: 3 }, { nome: "Marcus", data: "2026-10-09", valor: 130, conta_id: 4 },
      { nome: "Bela", data: "2026-10-05", valor: 120, conta_id: 5 }, { nome: "Ana", data: "2026-10-06", valor: 130, conta_id: 6 }
    ];
    const pagamentos = [
      { ref: "evento a", data: "2026-10-02", desc: "Markus 2 dias", valor: 260 },
      { ref: "evento b", data: "2026-10-09", desc: "Markus", valor: 280 },
      { ref: "evento c", data: "2026-10-12", desc: "Tamile, diaria", valor: 250 },
      { ref: "evento d", data: "2026-10-05", desc: "Bela noite", valor: 120 },
      { ref: "evento e", data: "2026-10-06", desc: "Bela", valor: 120 },
      { ref: "evento f", data: "2026-10-07", desc: "Eliana acerto de setembro", valor: 280 },
      { ref: "evento g", data: "2026-10-15", desc: "Eliana", valor: 280 },
      { ref: "pagamento_conta 49", data: "2026-10-15", desc: "Funcionaria do atelie Yasmin, a cada 14 dias", valor: 1700 },
      { ref: "evento h", data: "2026-10-16", desc: "Yasmin vale", valor: 100 },
      { ref: "evento z", data: "2026-09-28", desc: "Marcus setembro", valor: 130 }
    ];
    const r = conferirEquipe({ mes: "2026-10-01", hoje: "2026-10-20", pagamentos, nomes: ["Marcus", "Bela", "Ana", "Eliana", "Yasmin"], freelas, contas,
      diarias: [{ nome: "Eliana", valor: 140, dias: ["2026-10-02", "2026-10-03"] }],
      semanais: [{ nome: "Yasmin", contas: [{ id: 9, valor: 1700, vencimento: "2026-10-15", pago_em: "2026-10-15", nf_ref: "pagamento_conta 49", descricao: "Yasmin, 2 semanas" }] }] });
    return { marcar: r.marcar, dif: r.valorDif.map(v => [v.pag.ref, v.contas.map(c => c.id), v.soma]),
             sem: r.semRegistro.map(p => [p.ref, p.motivo || null]), dup: r.duplicados.map(([x, y]) => [x.ref, y.ref]),
             esq: r.esquecidos.map(e => e.conta.id), dia: r.diarias.map(d => [d.nome, d.devido, d.pago, d.dif]),
             sem2: r.semanais.map(s => [s.conta.id, s.pag ? s.pag.ref : null]), avisos: r.avisos, norm: confNorm("Markus Yasmin Phillipe") };
  });
  assert.equal(r.norm, "marcus iasmin filipe");
  assert.deepEqual(r.marcar, [{ id: 1, pago_em: "2026-10-02", valor_pago: 130, nf_ref: "evento a" }, { id: 2, pago_em: "2026-10-02", valor_pago: 130, nf_ref: "evento a" },
                              { id: 5, pago_em: "2026-10-05", valor_pago: 120, nf_ref: "evento d" }]);
  assert.deepEqual(r.dif, [["evento b", [3, 4], 260]], "R$ 280 para 2 dias de R$ 130: hora extra a confirmar");
  assert.deepEqual(r.sem, [["evento h", "quinzena"], ["evento c", null], ["evento e", null]]);
  assert.deepEqual(r.dup, [["evento d", "evento e"]]);
  assert.deepEqual(r.esq, [6], "a Ana do dia 06 passou de 7 dias sem Pix");
  assert.deepEqual(r.dia, [["Eliana", 280, 280, 0]], "o acerto de 07/10 é do mês anterior");
  assert.deepEqual(r.sem2, [[9, "pagamento_conta 49"]]);
  assert.equal(r.avisos, 6);
  await a.fechar();
});

test("Quem veio no ateliê: marca sozinho o que casou e mostra o que não casou", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: db => {
    db.jb_mes = [{ mes: "2026-10-01", saidas: 1000, saidas_manual: false, obs: "", detalhe: { grupos: [{ nome: "Pessoas", total: 510, itens: [
      { data: "2026-10-02", desc: "Markus 2 dias", valor: 260, ref: "evento a", previsto: false },
      { data: "2026-10-12", desc: "Tamile, diaria", valor: 250, ref: "evento c", previsto: false } ] }] } }];
    db.jb_conta.push({ id: 71, tipo: "equipe", descricao: "Freela Marcus, 01/10", competencia: "2026-10-01", vencimento: "2026-10-01", valor: 130, pago_em: null, arquivada: false },
                     { id: 72, tipo: "equipe", descricao: "Freela Marcus, 02/10", competencia: "2026-10-01", vencimento: "2026-10-02", valor: 130, pago_em: null, arquivada: false });
    db.jb_freela = [{ id: 1, nome: "Marcus", data: "2026-10-01", valor: 130, conta_id: 71, cancelada: false }, { id: 2, nome: "Marcus", data: "2026-10-02", valor: 130, conta_id: 72, cancelada: false }];
    return db; } });
  a.texto = sel => a.page.locator(sel).first().innerText();
  await a.page.click("#btnDias"); await a.espera(1200);
  const contas = (await a.db("jb_conta")).filter(c => c.id === 71 || c.id === 72);
  assert.deepEqual(contas.map(c => [c.pago_em, c.nf_ref, c.pago_por]), [["2026-10-02", "evento a", "financeiro"], ["2026-10-02", "evento a", "financeiro"]]);
  const t = await a.texto("#confCard");
  assert.match(t, /Conferência com o Nosso Financeiro/i);
  assert.match(t, /Pago sem registro no JB OS[\s\S]*Pix de R\$ 250,00 em 12\/10 \("Tamile, diaria"\)/);
  assert.match(t, /1 Pix de freela conferido[\s\S]*Marcus R\$ 260,00 em 02\/10/);
  await a.page.locator("#confCard button", { hasText: "Registrar como freela" }).click(); await a.espera(300);
  assert.equal(await a.page.inputValue("#eqFrNome"), "Tamile");
  assert.equal(await a.page.inputValue("#eqFrValor"), "250,00");
  assert.equal(await a.page.inputValue("#eqFrDia"), "2026-10-12");
  semErros(a); await a.fechar();
});
