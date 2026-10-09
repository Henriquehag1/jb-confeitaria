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
const FIXOS = [
  { origem: "item", nome: "Aluguel do ateliê (metade)", valor: 1916.11, ordem: 10, obs: "A outra metade é do consultório", item_id: 1 },
  { origem: "item", nome: "Luz do ateliê (metade)", valor: 241.06, ordem: 20, obs: null, item_id: 2 },
  { origem: "item", nome: "Água do ateliê (metade)", valor: 81.98, ordem: 30, obs: null, item_id: 3 },
  { origem: "item", nome: "Internet do ateliê (metade)", valor: 49.5, ordem: 40, obs: null, item_id: 4 },
  { origem: "item", nome: "Contabilidade", valor: 200, ordem: 50, obs: "Só da confeitaria", item_id: 5 },
  { origem: "item", nome: "Saipos", valor: 175, ordem: 60, obs: "Só da confeitaria", item_id: 6 },
  { origem: "item", nome: "Parcelamento do Simples Nacional", valor: 302.85, ordem: 80, obs: "Acordo de 23/09/2026, 26 parcelas. Outra frase.", item_id: 9 },
  { origem: "item", nome: "Anuidade Pluxee", valor: 31.67, ordem: 95, obs: null, item_id: 8 },
  { origem: "folha", nome: "Folha: Yasmin", valor: 3683.33, ordem: 900, obs: "Acordo semanal de R$ 850.00 desde 01/09/2026", item_id: null },
  { origem: "pro_labore", nome: "Pró-labore da Jessica", valor: 2500, ordem: 950, obs: "Não sai da conta", item_id: null }
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
  db.jb_custo_fixo_calculado = FIXOS;
  db.jb_parametro = [{ chave: "fatia_noite", valor: 0.46, fonte: "Venda da noite em setembro", medido_em: "2026-09-30" },
                     { chave: "freela_noite", valor: 120, fonte: "Freela de 08/10", medido_em: "2026-10-08" },
                     { chave: "noites_mes", valor: 30, fonte: "", medido_em: "2026-10-09" }];
  return db;
};

test("a conta da saúde: veredito, lucro, folga, contratar e conselhos saem dos números", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(([D, K]) => {
    const s = saudeCalcular({ destino: D, kpi: K, equipe: [{ nome: "Yasmin", mes: 3683.33 }, { nome: "Eliana", mes: 280 }],
                              imposto: { aliquota_usada: 0.0633, modo: "auto", anexo: "I", faixa: 3, rbt12: 437190.74, meses_com_dado: 9, pago_sobre_bruto: 0.0183 } });
    return { lucro: s.lucro, rot: s.veredito.rot, dono: s.donoLeva, folga: Math.round(s.folga * 1000) / 1000, eqPct: Math.round(s.equipePct * 1000) / 1000,
             falta: Math.round(s.faltaClt * 100) / 100, unExtra: s.unExtraDia, diarias: s.diariasCabem, dif: Math.round(s.imposto.diferencaMes),
             bolsa: s.bolsa.total,
             cons: s.recomendacoes.map(x => x.t),
             v: [saudeVeredito(0.12).rot, saudeVeredito(0.05).rot, saudeVeredito(0.01).rot, saudeVeredito(-0.02).rot] };
  }, [DESTINO[1], KPI[0]]);
  assert.equal(r.lucro, 678.8, "R$ 10.560,30 que sobram da venda − R$ 9.881,50 de contas fixas");
  assert.equal(r.rot, "No limite");
  assert.equal(r.dono, 3178.8);
  assert.equal(r.folga, 0.092);
  assert.equal(r.eqPct, 0.073);
  assert.equal(r.falta, 2239.42);
  assert.equal(r.unExtra, 15);
  assert.equal(r.diarias, 2, "bolsa = metade de R$ 678,80; sem parâmetro, diária de R$ 140");
  assert.equal(r.bolsa, 339.4);
  assert.equal(r.dif, 2433);
  assert.deepEqual(r.v, ["Saudável", "Atenção", "No limite", "No vermelho"]);
  assert.deepEqual(r.cons, ["A maior conta é o app: R$ 49,99 de cada R$ 100.", "Folga pequena sobre o ponto de equilíbrio.",
                            "Imposto pago abaixo da tabela.", "Contratar mais alguém registrado ainda não cabe.", "Equipe do tamanho certo."]);
  await a.fechar();
});

test("tela Saúde do negócio: usa o último mês fechado, não o mês pela metade", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: comDados });
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.match(await a.texto("#saudeSub"), /No limite · Setembro: sobraram R\$ 978,80 depois de tudo/);
  assert.match(await a.page.getAttribute("#saudePonto", "class"), /tom-ambar/);
  await a.page.click("#btnSaude"); await a.espera(700);
  assert.equal(await a.tela(), "scSaude");
  assert.equal(await a.titulo(), "Saúde do negócio");
  assert.match(await a.texto("#sdVeredito"), /No limite/i);
  assert.match(await a.texto("#sdVeredito"), /Setembro de 2026/);
  assert.match(await a.texto("#sdLucro"), /R\$ 978,80/);
  // a conta inteira, linha por linha, fecha no lucro
  const ct = await a.texto("#sdConta");
  assert.match(ct, /De onde sai o lucro de setembro/i);
  assert.match(ct, /Os clientes pagaram\s*R\$ 54\.072,21[\s\S]*− App e promoção\s*R\$ 27\.030,70[\s\S]*− Imposto \(Simples\)\s*R\$ 3\.422,77[\s\S]*− Ingrediente e embalagem\s*R\$ 13\.058,44[\s\S]*= Sobrou da venda\s*R\$ 10\.560,30/);
  assert.match(ct, /− Yasmin \(equipe\)\s*R\$ 3\.683,33[\s\S]*− Pró-labore da Jessica\s*R\$ 2\.500,00[\s\S]*− Aluguel do ateliê \(metade\)\s*R\$ 1\.916,11/);
  assert.doesNotMatch(ct, /Produção da Eliana/, "a Eliana saiu das contas fixas: vem da bolsa");
  assert.match(ct, /− Anuidade Pluxee\s*R\$ 31,67[\s\S]*− Eliana \(ajuda extra\)\s*R\$ 280,00[\s\S]*− Freelas \(ajuda extra\)\s*R\$ 120,00[\s\S]*= Lucro do mês\s*R\$ 978,80/);
  assert.match(ct, /Não é o extrato do banco/);
  assert.match(await a.texto("#sdVeredito"), /O dono leva/);
  assert.match(await a.texto("#sdTendencia"), /ago[\s\S]*set/i);
  assert.doesNotMatch(await a.texto("#sdTendencia"), /out/i, "outubro pela metade fica fora");
  assert.match(await a.texto("#sdDestino"), /App e promoção\s*R\$ 49,99/);
  assert.match(await a.texto("#sdFolga"), /Vendendo por dia[\s\S]*71 doces[\s\S]*65 doces[\s\S]*9%/);
  assert.match(await a.texto("#sdImposto"), /6,3% · automática/);
  assert.match(await a.texto("#sdImposto"), /1,8% da venda/);
  const eq = await a.texto("#sdEquipe");
  assert.match(eq, /Yasmin[\s\S]*R\$ 3\.683,33/);
  assert.match(eq, /2 dias × R\$ 140,00/, "só os dias confirmados contam");
  assert.match(eq, /Freelas[\s\S]*R\$ 120,00/);
  assert.match(eq, /Equipe no mês[\s\S]*R\$ 4\.083,33 · 7,6%/);
  assert.match(await a.texto("#sdContratar"), /\+13 doces\/dia/);
  assert.match(await a.texto("#sdNoite"), /Bolsa de ajuda extra de outubro[\s\S]*R\$ 689,40 · 5 noites/);
  assert.match(await a.texto("#sdNoite"), /Para pagar 1 diária de R\$ 120,00\s*R\$ 614,44 de venda · 24 doces/);
  assert.match(await a.texto("#sdNoite"), /Para mais 1 noite de freela[\s\S]*\+1 doce por dia/);
  await a.page.click("#sdNoite .sd-ln:has-text('Para mais 1 noite')"); await a.espera(150);
  assert.match(await a.texto("#saudeCorpo .explica:not(.hide)"), /Faltam R\$ 30,60 na bolsa = R\$ 61,20 de sobra ÷ R\$ 152,70 = 1 doce por dia/);
  await a.page.click("#sdNoite .sd-ln:has-text('Para mais 1 noite')"); await a.espera(100);
  assert.match(await a.texto("#sdConselhos"), /A maior conta é o app/);
  assert.match(await a.texto("#sdCaixa"), /Sobrou no caixa[\s\S]*R\$ 15\.564,89/);

  // turno da noite
  const noite = await a.texto("#sdNoite");
  assert.match(noite, /R\$ 166,24[\s\S]*Cada noite deixa/);
  assert.match(noite, /R\$ 121,43[\s\S]*Custo da noite hoje/);
  assert.match(noite, /R\$ 44,81[\s\S]*Sobra por noite/);
  assert.match(noite, /pague até[\s\S]*R\$ 116,00 por noite/);
  assert.match(noite, /R\$ 120,00 deixa[\s\S]*R\$ 46,24 por noite/);

  // Yasmin: decisão e cenários
  const y = await a.texto("#sdYasmin");
  assert.match(y, /Manter e renegociar a folga/);
  assert.match(await a.texto('#sdYasmin [data-cen="manter"]'), /R\$ 3\.683[\s\S]*hoje/);
  assert.match(await a.texto('#sdYasmin [data-cen="renegociar"]'), /Renegociar ✓[\s\S]*R\$ 3\.470[\s\S]*economiza R\$ 214/);
  assert.match(await a.texto('#sdYasmin [data-cen="freelas"]'), /R\$ 3\.600/);
  assert.match(y, /Hora dela hoje[\s\S]*R\$ 21,16/);

  // tocar num número abre de onde ele sai
  await a.page.click("#sdLucro"); await a.espera(150);
  assert.match(await a.texto("#saudeCorpo .explica:not(.hide)"), /R\$ 10\.560,30 que sobraram da venda − R\$ 9\.181,50 de contas fixas − R\$ 400,00 de ajuda extra = R\$ 978,80/);
  await a.page.click('#sdYasmin [data-cen="renegociar"]'); await a.espera(150);
  assert.match(await a.texto("#saudeCorpo .explica:not(.hide)"), /6 noites, folga no domingo, mesma hora \(R\$ 21,16\)/);
  assert.equal(await a.page.locator("#saudeCorpo .explica:not(.hide)").count(), 1, "uma explicação aberta por vez");
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
