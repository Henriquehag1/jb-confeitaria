const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const AGORA = "2026-10-08T15:00:00Z";

const comDados = db => {
  db.__jb_kpi_destino = [{ mes: "2026-09-01", app: 0.4999, imposto: 0.0633, ingrediente: 0.2415, custo_fixo: 0.19, sobra: 0.004, bruto_estimado: 54072.21 }];
  db.jb_custo_fixo_calculado = [
    { origem: "item", nome: "Contas da casa", valor: 2998.17, ordem: 10, obs: null, item_id: 1 },
    { origem: "folha", nome: "Folha: Yasmin", valor: 3683.33, ordem: 900, obs: null, item_id: null },
    { origem: "pro_labore", nome: "Pró-labore da Jessica", valor: 2500, ordem: 950, obs: null, item_id: null }
  ];
  db.jb_parametro = [{ chave: "bolsa_fatia", valor: 0.5 }, { chave: "freela_noite", valor: 120 }];
  db.jb_dia_trabalhado = [
    { id: 1, user_id: "uEli", data: "2026-10-02", turno: "dia", status: "confirmado", origem: "gestor" },
    { id: 2, user_id: "uEli", data: "2026-10-03", turno: "dia", status: "sugerido", origem: "auto" },
    { id: 3, user_id: "uEli", data: "2026-09-25", turno: "dia", status: "confirmado", origem: "gestor" }
  ];
  db.jb_freela = [{ id: 1, nome: "Bela", data: "2026-10-05", valor: 120, cancelada: false, conta_id: null },
                  { id: 2, nome: "Ana", data: "2026-10-06", valor: 120, cancelada: true, conta_id: null }];
  db.jb_falta = [{ id: 1, user_id: "uYas", data: "2026-10-05", minutos: 390, desconta: true, valor_desconto: 137.55, cancelada: false }];
  return db;
};

test("conta da bolsa: metade da sobra antes da ajuda extra; Eliana e freela tiram, falta descontada devolve", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(() => {
    const g = bolsaItens([{ user_id: "e", inicio: "2026-01-01", fim: null, regime: "diaria", valor: 140 }, { user_id: "y", inicio: "2026-01-01", regime: "semanal", valor: 850 }],
      [{ user_id: "e", data: "2026-10-02", status: "confirmado" }, { user_id: "e", data: "2026-10-03", status: "sugerido" }, { user_id: "y", data: "2026-10-02", status: "confirmado" }],
      [{ valor: 120 }, { valor: 120, cancelada: true }], [{ desconta: true, valor_desconto: 137.55 }, { desconta: false, valor_desconto: 99 }], () => "Eliana");
    const B = bolsaCalcular({ total: 689.4, freela: 120 }, g);
    const zero = bolsaCalcular({ total: 100, freela: 120 }, { itens: [{ valor: 250 }], devolvido: 0 });
    return { itens: g.itens, dev: g.devolvido, disp: B.disponivel, noites: B.noites, neg: zero.disponivel, nNeg: zero.noites, pct: zero.usadoPct, seg: mesSeguinte("2026-12-01") };
  });
  assert.deepEqual(r.itens, [{ nome: "Eliana", valor: 140, detalhe: "1 dia × R$ 140,00" }, { nome: "Freelas", valor: 120, detalhe: "1 noite" }]);
  assert.equal(r.dev, 137.55);
  assert.equal(r.disp, 566.95);
  assert.equal(r.noites, 4);
  assert.equal(r.neg, -150); assert.equal(r.nNeg, 0); assert.equal(r.pct, 1);
  assert.equal(r.seg, "2027-01-01");
  await a.fechar();
});

test("bolsa na tela Quem veio no ateliê, no formulário de freela e na Home", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: comDados });
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.match(await a.texto("#diasSub"), /Bolsa extra: R\$ 566,95 · 4 noites de freela/);
  await a.page.click("#btnDias"); await a.espera(700);
  const b = await a.texto("#bolsaCard");
  assert.match(b, /Bolsa de ajuda extra · outubro/i);
  assert.match(b, /R\$ 566,95[\s\S]*disponível · 4 noites de freela de R\$ 120,00/);
  assert.match(b, /Bolsa do mês\s*R\$ 689,40/);
  assert.match(b, /− Eliana\s*R\$ 140,00/);
  assert.match(b, /− Freelas\s*R\$ 120,00/);
  assert.match(b, /\+ Faltas descontadas\s*R\$ 137,55/);
  assert.match(b, /1 diária de R\$ 120,00 pede\s*R\$ 614,44 de venda/);
  assert.match(b, /Fora da bolsa, sempre: alguém à noite todos os dias e o domingo/);
  await a.page.click("#bolsaCard .sd-ln:has-text('Bolsa do mês')"); await a.espera(150);
  assert.match(await a.texto("#diasCorpo .explica:not(.hide)"), /R\$ 1\.378,80 × 50% = R\$ 689,40/);

  // confirmar o dia sugerido da Eliana tira mais R$ 140 da bolsa
  await a.page.evaluate(() => alternarDia("uEli", "2026-10-03")); await a.espera(500);
  assert.match(await a.texto("#bolsaCard"), /R\$ 426,95[\s\S]*3 noites/);

  // registrar freela mostra a bolsa
  await a.page.click("#eqFreelaAbre"); await a.espera(300);
  assert.match(await a.texto("#eqFrBolsa"), /Na bolsa do mês: R\$ 426,95, dá para 3 noites de R\$ 120,00/);
  semErros(a); await a.fechar();
});
