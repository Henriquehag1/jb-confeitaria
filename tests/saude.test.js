const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const AGORA = "2026-10-08T15:00:00Z";

const DESTINO = [
  { mes: "2026-08-01", app: 0.4869, imposto: 0.0633, ingrediente: 0.2439, custo_fixo: 0.1934, sobra: 0.0125, bruto_estimado: 32280.24 },
  { mes: "2026-09-01", app: 0.4999, imposto: 0.0633, ingrediente: 0.2415, custo_fixo: 0.1914, sobra: 0.0039, bruto_estimado: 54072.21 },
  { mes: "2026-10-01", app: 0.334, imposto: 0.0633, ingrediente: 0.2279, custo_fixo: 0.1814, sobra: 0.1934, bruto_estimado: 231.19 }
];
const KPI = [
  { mes: "2026-09-01", entradas: 31145.08, saidas: 15580.19, pro_labore: 2500, unidades_dia: 71, equilibrio_dia: 65, contrib_un: 5.09, custo_fixo_mes: 9881.5 },
  { mes: "2026-10-01", entradas: 168.02, saidas: 8312.79, pro_labore: 2500, unidades_dia: 71, equilibrio_dia: 33, contrib_un: 10.21, custo_fixo_mes: 9881.5 }
];
const comDados = db => {
  db.__jb_kpi_destino = DESTINO;
  db.__jb_kpi_mes = KPI;
  db.jb_imposto_regra = [{ id: 1, modo: "auto", anexo: "I" }];
  db.jb_dia_trabalhado = [
    { id: 1, user_id: "uEli", data: "2026-09-03", turno: "dia", status: "confirmado", origem: "gestor" },
    { id: 2, user_id: "uEli", data: "2026-09-04", turno: "dia", status: "confirmado", origem: "gestor" },
    { id: 3, user_id: "uEli", data: "2026-09-10", turno: "dia", status: "sugerido", origem: "auto" }
  ];
  db.jb_freela = [{ id: 1, nome: "Bela", data: "2026-09-20", valor: 120, cancelada: false }];
  return db;
};

test("a conta da saúde: veredito, lucro, folga, contratar e conselhos saem dos números", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(([D, K]) => {
    const s = saudeCalcular({ destino: D, kpi: K, equipe: [{ nome: "Yasmin", mes: 3683.33 }, { nome: "Eliana", mes: 280 }],
                              imposto: { aliquota_usada: 0.0633, modo: "auto", anexo: "I", faixa: 3, rbt12: 437190.74, meses_com_dado: 9, pago_sobre_bruto: 0.0183 } });
    return { lucro: s.lucro, rot: s.veredito.rot, dono: s.donoLeva, folga: Math.round(s.folga * 1000) / 1000, eqPct: Math.round(s.equipePct * 1000) / 1000,
             falta: Math.round(s.faltaClt * 100) / 100, unExtra: s.unExtraDia, diarias: s.diariasCabem, dif: Math.round(s.imposto.diferencaMes),
             cons: s.recomendacoes.map(x => x.t),
             v: [saudeVeredito(0.12).rot, saudeVeredito(0.05).rot, saudeVeredito(0.01).rot, saudeVeredito(-0.02).rot] };
  }, [DESTINO[1], KPI[0]]);
  assert.equal(r.lucro, 210.88);
  assert.equal(r.rot, "No limite");
  assert.equal(r.dono, 2710.88);
  assert.equal(r.folga, 0.092);
  assert.equal(r.eqPct, 0.073);
  assert.equal(r.falta, 2707.34);
  assert.equal(r.unExtra, 18);
  assert.equal(r.diarias, 1);
  assert.equal(r.dif, 2433);
  assert.deepEqual(r.v, ["Saudável", "Atenção", "No limite", "No vermelho"]);
  assert.deepEqual(r.cons, ["A maior conta é o app: R$ 49,99 de cada R$ 100.", "Folga pequena sobre o ponto de equilíbrio.",
                            "Imposto pago abaixo da tabela.", "Contratar CLT de 40h ainda não cabe.", "Equipe do tamanho certo para a venda."]);
  await a.fechar();
});

test("tela Saúde do negócio: usa o último mês fechado, não o mês pela metade", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: comDados });
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.match(await a.texto("#saudeSub"), /No limite · Setembro: sobraram R\$ 210,88 depois de tudo/);
  assert.match(await a.page.getAttribute("#saudePonto", "class"), /tom-ambar/);
  await a.page.click("#btnSaude"); await a.espera(700);
  assert.equal(await a.tela(), "scSaude");
  assert.equal(await a.titulo(), "Saúde do negócio");
  assert.match(await a.texto("#sdVeredito"), /No limite/i);
  assert.match(await a.texto("#sdVeredito"), /Setembro de 2026/);
  assert.match(await a.texto("#sdLucro"), /R\$ 210,88/);
  assert.match(await a.texto("#sdVeredito"), /O dono leva/);
  assert.match(await a.texto("#sdTendencia"), /ago[\s\S]*set/i);
  assert.doesNotMatch(await a.texto("#sdTendencia"), /out/i, "outubro pela metade fica fora");
  assert.match(await a.texto("#sdDestino"), /App e promoção\s*R\$ 49,99/);
  assert.match(await a.texto("#sdFolga"), /Vendendo por dia\s*71 doces[\s\S]*65 doces[\s\S]*9%/);
  assert.match(await a.texto("#sdImposto"), /6,3% · automática/);
  assert.match(await a.texto("#sdImposto"), /Anexo I, faixa 3/);
  assert.match(await a.texto("#sdImposto"), /1,8% da venda/);
  const eq = await a.texto("#sdEquipe");
  assert.match(eq, /Yasmin[\s\S]*R\$ 3\.683,33 no mês/);
  assert.match(eq, /2 dias × R\$ 140,00/, "só os dias confirmados contam");
  assert.match(eq, /Freelas[\s\S]*R\$ 120,00/);
  assert.match(eq, /Equipe no mês\s*R\$ 4\.083,33 · 7,6% da venda/);
  assert.match(await a.texto("#sdContratar"), /faltam R\$ 2\.707,34 por mês: vender mais 18 doces por dia/);
  assert.match(await a.texto("#sdConselhos"), /A maior conta é o app/);
  assert.match(await a.texto("#sdCaixa"), /Sobrou no caixa\s*R\$ 15\.564,89/);
  semErros(a); await a.fechar();
});

test("só gestor vê a Saúde do negócio", async () => {
  for(const uid of ["uYas", "uEli"]){
    const a = await abrir(uid, { agora: AGORA, db: comDados });
    assert.equal(await a.visivel("btnSaude"), false, uid);
    const n = await a.page.evaluate(async () => [(await sb.from("jb_kpi_destino").select("*")).data.length, (await sb.from("jb_imposto_estimado").select("*")).data.length]);
    assert.deepEqual(n, [0, 0]);
    semErros(a); await a.fechar();
  }
});

test("Custos e preços usa o imposto automático e troca o anexo num toque", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: db => { db.jb_imposto_regra = [{ id: 1, modo: "auto", anexo: "I" }]; return db; } });
  a.texto = sel => a.page.locator(sel).first().innerText();
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(600);
  assert.equal(await a.page.evaluate(() => CFG.imposto_pct), 0.0633);
  await a.page.locator("button", { hasText: "custos da casa e meta de margem" }).first().click(); await a.espera(300);
  const t = await a.texto("#impBloco");
  assert.match(t, /Imposto sobre a venda: 6,3% · automático/);
  assert.match(t, /Anexo I, faixa 3/);
  assert.match(t, /DAS pago foi 1,8% da venda/);
  assert.equal(await a.page.locator('label', { hasText: "Imposto sobre a venda (%)" }).count(), 0, "o campo de imposto fixo some no automático");
  await a.page.click("#impAnexoII"); await a.espera(400);
  assert.equal((await a.db("jb_imposto_regra"))[0].anexo, "II");
  assert.equal(await a.page.evaluate(() => CFG.imposto_pct), 0.0682);
  await a.page.click("#impModo"); await a.espera(400);
  assert.equal((await a.db("jb_imposto_regra"))[0].modo, "fixo");
  assert.equal(await a.page.evaluate(() => CFG.imposto_pct), 0.05);
  assert.equal(await a.page.locator('label', { hasText: "Imposto sobre a venda (%)" }).count(), 1, "no fixo o campo volta");
  semErros(a); await a.fechar();
});
