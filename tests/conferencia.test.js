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
  assert.deepEqual(r.sem, [["evento h", "quinzena"], ["evento c", null]], "o Pix repetido da Bela aparece só como duplicado");
  assert.deepEqual(r.dup, [["evento d", "evento e"]]);
  assert.deepEqual(r.esq, [6], "a Ana do dia 06 passou de 7 dias sem Pix");
  assert.deepEqual(r.dia, [["Eliana", 280, 280, 0]], "o acerto de 07/10 é do mês anterior");
  assert.deepEqual(r.sem2, [[9, "pagamento_conta 49"]]);
  assert.equal(r.avisos, 5);
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

test("conferência com os casos reais de outubro: nomes escritos diferente, dias pagos à mão, quinzena com arredondamento e do mês anterior", async () => {
  const a = await abrir("uHen", { agora: "2026-10-25T15:00:00Z" });
  const r = await a.page.evaluate(() => {
    const k = (id, valor, venc, pago, extra) => Object.assign({ id, valor, vencimento: venc, pago_em: pago, pago_por: pago ? "manual" : null, valor_pago: pago ? valor : null, nf_ref: null }, extra || {});
    const contas = {
      30: k(30, 130, "2026-10-16", "2026-10-18"), 32: k(32, 130, "2026-10-17", "2026-10-18"),
      33: k(33, 130, "2026-10-16", "2026-10-18"), 34: k(34, 130, "2026-10-17", "2026-10-18"),
      36: k(36, 120, "2026-10-17", "2026-10-17"), 19: k(19, 120, "2026-10-08", "2026-10-08", { nf_ref: "evento bela" }),
      37: k(37, 90, "2026-10-22", "2026-10-24"), 41: k(41, 130, "2026-10-24", "2026-10-24"),
      38: k(38, 130, "2026-10-23", "2026-10-24"), 40: k(40, 130, "2026-10-24", "2026-10-24"),
      50: k(50, 130, "2026-10-09", "2026-10-10", { pago_por: "financeiro", nf_ref: "evento antigo" })
    };
    const freelas = [
      { nome: "Markus Porthos", data: "2026-10-16", conta_id: 30 }, { nome: "Markus Porthos", data: "2026-10-17", conta_id: 32 },
      { nome: "Sabrina", data: "2026-10-16", conta_id: 33 }, { nome: "Sabrina", data: "2026-10-17", conta_id: 34 },
      { nome: "Bela", data: "2026-10-08", conta_id: 19 }, { nome: "Bella", data: "2026-10-17", conta_id: 36 },
      { nome: "Sabrina", data: "2026-10-22", conta_id: 37 }, { nome: "Sabrina", data: "2026-10-24", conta_id: 41 },
      { nome: "Markus Porthos", data: "2026-10-23", conta_id: 38 }, { nome: "Markus Porthos", data: "2026-10-24", conta_id: 40 },
      { nome: "Markus Porthos", data: "2026-10-09", conta_id: 50 }
    ];
    const pagamentos = [
      { ref: "evento bela", data: "2026-10-08", desc: "Bela, freela da noite", valor: 120 },
      { ref: "evento m1", data: "2026-10-17", desc: "Markus", valor: 260 },
      { ref: "evento s1", data: "2026-10-17", desc: "Sabrina freela", valor: 260 },
      { ref: "evento b1", data: "2026-10-17", desc: "Bella", valor: 120 },
      { ref: "evento m2", data: "2026-10-24", desc: "Markus freela", valor: 260 },
      { ref: "evento s2", data: "2026-10-24", desc: "Sabrina freela", valor: 220 },
      { ref: "pagamento_conta 49", data: "2026-10-05", desc: "Funcionaria do atelie Yasmin, a cada 14 dias", valor: 1700 },
      { ref: "pagamento_conta 58", data: "2026-10-16", desc: "Funcionaria do atelie Yasmin, a cada 14 dias", valor: 1563 },
      { ref: "pagamento_conta 50", data: "2026-10-07", desc: "Funcionaria do atelie Eliana, acerto das semanas extras do mes fechado", valor: 280 }
    ];
    const r = conferirEquipe({ mes: "2026-10-01", hoje: "2026-10-25", pagamentos, nomes: ["Markus Porthos", "Sabrina", "Bella", "Bela", "Eliana", "Yasmin"], freelas, contas,
      diarias: [{ nome: "Eliana", valor: 140, dias: ["2026-10-01", "2026-10-02", "2026-10-06"], pagos: [{ data: "2026-10-01", pago_em: "2026-10-06" }, { data: "2026-10-02", pago_em: "2026-10-06" }] }],
      semanais: [{ nome: "Yasmin", contas: [
        { id: 8, valor: 1700, valor_pago: 1700, vencimento: "2026-10-03", pago_em: "2026-10-05", pago_por: "financeiro", nf_ref: "conta_fixa 55, 2026-10", descricao: "Funcionária do ateliê, quinzena do dia 3" },
        { id: 17, valor: 1700, valor_pago: 1562.45, vencimento: "2026-10-15", pago_em: "2026-10-15", pago_por: "manual", nf_ref: null, descricao: "Yasmin, 2 semanas (01/10 a 14/10)" },
        { id: 18, valor: 1700, valor_pago: null, vencimento: "2026-10-29", pago_em: null, nf_ref: null, descricao: "Yasmin, 2 semanas (15/10 a 28/10)" }] }] });
    return { avisos: r.avisos, sem: r.semRegistro.map(p => p.ref), dup: r.duplicados.length, dif: r.valorDif.length,
             marcar: r.marcar.map(m => [m.id, m.nf_ref, !!m.so_ref]).sort((x, y) => x[0] - y[0]),
             sem2: r.semanais.map(s => [s.conta.id, s.pag ? s.pag.ref : null]),
             eli: r.diarias.map(d => [d.pago, d.dif, d.anteriores.length]) };
  });
  assert.equal(r.avisos, 0, "nenhum alarme falso");
  assert.deepEqual(r.sem, []);
  assert.equal(r.dup, 0, "Markus em dois fins de semana não é duplicado");
  assert.equal(r.dif, 0);
  assert.deepEqual(r.marcar, [[17, "pagamento_conta 58", true], [30, "evento m1", true], [32, "evento m1", true], [33, "evento s1", true], [34, "evento s1", true],
                              [36, "evento b1", true], [37, "evento s2", true], [38, "evento m2", true], [40, "evento m2", true], [41, "evento s2", true]]);
  assert.deepEqual(r.sem2, [[8, "pagamento_conta 49"], [17, "pagamento_conta 58"], [18, null]]);
  assert.deepEqual(r.eli, [[280, -140, 0]], "o Pix de 07/10 pagou os dias 01 e 02/10 marcados como pagos em 06/10");
  await a.fechar();
});

test("conferência: Pix repetido sem dia registrado vira um aviso de duplicado só", async () => {
  const a = await abrir("uHen", { agora: "2026-10-25T15:00:00Z" });
  const r = await a.page.evaluate(() => {
    const contas = { 1: { id: 1, valor: 130, vencimento: "2026-10-16", pago_em: null, nf_ref: null } };
    const r = conferirEquipe({ mes: "2026-10-01", hoje: "2026-10-18", nomes: ["Markus Porthos"], contas,
      freelas: [{ nome: "Markus Porthos", data: "2026-10-16", conta_id: 1 }],
      pagamentos: [{ ref: "a", data: "2026-10-16", desc: "Marcus", valor: 130 }, { ref: "b", data: "2026-10-17", desc: "Markus", valor: 130 }] });
    return { dup: r.duplicados.map(([x, y]) => [x.ref, y.ref]), sem: r.semRegistro.map(p => p.ref), avisos: r.avisos, marcar: r.marcar.map(m => m.id) };
  });
  assert.deepEqual(r.marcar, [1]);
  assert.deepEqual(r.dup, [["a", "b"]]);
  assert.deepEqual(r.sem, []);
  assert.equal(r.avisos, 1);
  await a.fechar();
});
