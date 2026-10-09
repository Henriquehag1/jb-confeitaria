const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const CANAIS = [
  { id: 1, nome: "Próprio", ordem: 1, taxa: 0, promo: 0, ativo: true, taxa_efetiva: null, vale_fatia: 0 },
  { id: 2, nome: "iFood", ordem: 2, taxa: 0.30, promo: 0.15, ativo: true, taxa_efetiva: 0.334, vale_fatia: 0 },
  { id: 3, nome: "99Food", ordem: 3, taxa: 0.27, promo: 0.47, ativo: true, taxa_efetiva: 0.528, vale_fatia: 0.0455 },
  { id: 4, nome: "Keeta", ordem: 4, taxa: 0.22, promo: 0.30, ativo: true, taxa_efetiva: 0.515, vale_fatia: 0.0443 },
  { id: 5, nome: "Vale-refeição", ordem: 50, taxa: 0, promo: 0, ativo: false, taxa_efetiva: null, vale_fatia: 0 }
];
const OUT = "2026-10-01";
const comDados = db => {
  db.jb_canal = CANAIS;
  db.jb_faturamento = [
    { mes: OUT, canal_id: 1, valor: 637.63 }, { mes: OUT, canal_id: 2, valor: 3288.76 },
    { mes: OUT, canal_id: 3, valor: 11952.47 }, { mes: OUT, canal_id: 4, valor: 13631.55 },
    { mes: OUT, canal_id: 5, valor: 1634.67 },
    { mes: "2026-09-01", canal_id: 2, valor: 999 }
  ];
  db.jb_conta = [
    { id: 4, tipo: "imposto", descricao: "DAS do Simples, setembro/2026", competencia: "2026-09-01", vencimento: "2026-10-20", valor: 1240, pago_em: "2026-10-20", valor_pago: 1240, arquivada: false },
    { id: 5, tipo: "imposto", descricao: "Parcelamento do Simples, parcela de outubro (2 de 26)", competencia: OUT, vencimento: "2026-10-30", valor: null, pago_em: "2026-10-28", valor_pago: 303.4, arquivada: false },
    { id: 6, tipo: "imposto", descricao: "Multa por atraso da declaração de julho/2026", competencia: "2026-07-01", vencimento: "2026-11-03", valor: 25, pago_em: null, valor_pago: null, arquivada: false },
    { id: 2, tipo: "fixa", descricao: "Contabilidade", competencia: OUT, vencimento: "2026-10-10", valor: 200, pago_em: "2026-10-10", valor_pago: 200, arquivada: false }
  ];
  db.jb_parametro = [{ chave: "contador_dia", valor: 5 }, { chave: "taxa_pluxee", valor: 0.1516 },
                     { chave: "contador_email", valor: 0, texto: "contador@exemplo.com.br" }];
  db.jb_contador_mes = [{ mes: "2026-09-01", vendas: {}, enviado_em: "2026-10-02T15:00:00Z" }];
  return db;
};

test("a conta do contador: prazo no dia útil, venda estimada pelo repasse, relatório substitui", async () => {
  const a = await abrir("uHen", { agora: "2026-11-03T15:00:00Z" });
  const r = await a.page.evaluate(C => {
    const p = contadorPacote({ mes: "2026-10-01", canais: C,
      fat: [{ canal_id: 1, valor: 637.63 }, { canal_id: 2, valor: 3288.76 }, { canal_id: 3, valor: 11952.47 }, { canal_id: 5, valor: 1634.67 }],
      impostos: [{ descricao: "DAS", valor: 1240, valor_pago: 1240, pago_em: "2026-10-20" }, { descricao: "fora", valor: 1, pago_em: "2026-11-01" }],
      param: { taxa_pluxee: 0.1516 }, registro: { vendas: { 3: 26000 } } });
    return { prazos: [contadorPrazo("2026-10-01", 5), contadorPrazo("2026-11-01", 5), contadorPrazo("2026-01-01", 5)],
             fatia99: Math.round(contadorFatiaConta(C[2], 0.1516) * 10000) / 10000,
             vendas: p.vendas.map(v => [v.nome, v.valor, v.origem]), totalV: p.totalVendas, totalR: p.totalRecebido,
             rec: p.recebidos.map(v => v.rot), imp: p.impostos.length, est: p.estimados, msg: p.mensagem };
  }, CANAIS);
  assert.deepEqual(r.prazos, ["2026-11-05", "2026-12-07", "2026-02-05"], "5/12/2026 é sábado: passa para segunda");
  assert.equal(r.fatia99, 0.4334, "99Food: 47,2% fica com a loja, menos o vale que chega pela Pluxee");
  assert.deepEqual(r.vendas, [["Próprio", 637.63, "conta"], ["iFood", 4938.08, "estimado"], ["99Food", 26000, "relatorio"], ["Keeta", 0, "estimado"]]);
  assert.equal(r.totalV, 31575.71);
  assert.equal(r.totalR, 17513.53);
  assert.deepEqual(r.rec, ["Venda direta (Pix, cartão e encomendas)", "iFood", "99Food", "Vale-refeição (Pluxee)"]);
  assert.equal(r.imp, 1, "só o que foi pago dentro do mês");
  assert.equal(r.est, 1);
  assert.match(r.msg, /dados da JB Confeitaria de outubro\/2026 para o PGDAS-D e o DAS/);
  assert.match(r.msg, /• iFood: R\$ 4\.938,08 \(estimado\)/);
  assert.match(r.msg, /• 99Food: R\$ 26\.000,00\n/);
  assert.doesNotMatch(r.msg, /Keeta/, "canal sem venda fica fora da mensagem");
  assert.match(r.msg, /O vale-refeição \(Pluxee\) é forma de pagamento de pedidos do 99Food: já está dentro dessas vendas/);
  assert.doesNotMatch(r.msg, /—|–/, "sem travessão");
  await a.fechar();
});

test("tela do contador: status, números, mensagem, relatório do app e marcar como enviado", async () => {
  const a = await abrir("uHen", { agora: "2026-11-03T15:00:00Z", db: comDados });
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.equal(await a.visivel("btnContador"), true);
  assert.match(await a.texto("#contadorSub"), /Mandar até 05\/11 · dados de outubro/);
  await a.page.click("#btnContador"); await a.espera(600);
  assert.equal(await a.tela(), "scContador");
  assert.equal(await a.titulo(), "Dados para o contador");
  assert.match(await a.texto("#ctStatus"), /Mandar até qui\.?, 05\/11/);
  const v = await a.texto("#ctVendas");
  assert.match(v, /Venda direta \(Pix, cartão e encomendas\)[\s\S]*o que caiu na conta[\s\S]*R\$ 637,63/);
  assert.match(v, /iFood[\s\S]*estimado pelo repasse[\s\S]*R\$ 4\.938,08/);
  assert.match(v, /Total de vendas[\s\S]*R\$ 63\.621,52/);
  const rc = await a.texto("#ctRecebido");
  assert.match(rc, /Vale-refeição \(Pluxee\)[\s\S]*R\$ 1\.634,67/);
  assert.match(rc, /Total recebido[\s\S]*R\$ 31\.145,08/);
  const ip = await a.texto("#ctImpostos");
  assert.match(ip, /DAS do Simples, setembro\/2026[\s\S]*R\$ 1\.240,00/);
  assert.match(ip, /Parcelamento do Simples[\s\S]*R\$ 303,40/);
  assert.doesNotMatch(ip, /Multa|Contabilidade/);
  const msg = await a.texto("#ctTexto");
  assert.match(msg, /Total de vendas: R\$ 63\.621,52/);
  assert.match(msg, /• DAS do Simples, setembro\/2026: R\$ 1\.240,00 em 20\/10/);
  assert.match(msg, /Obrigada!$/);
  assert.match(await a.page.getAttribute("#ctWhats", "href"), /^https:\/\/wa\.me\/\?text=Ol%C3%A1/);

  // e-mail: abre o app de e-mail com o contador no Para, assunto e texto sem os asteriscos do WhatsApp
  const mail = await a.page.getAttribute("#ctEmail", "href");
  assert.match(mail, /^mailto:contador@exemplo\.com\.br\?subject=/);
  const q = new URLSearchParams(mail.split("?")[1]);
  assert.equal(q.get("subject"), "JB Confeitaria, dados de outubro/2026 para o PGDAS-D");
  assert.match(q.get("body"), /^Olá! Tudo bem\?/);
  assert.match(q.get("body"), /\nVendas de outubro \(valor/);
  assert.ok(!q.get("body").includes("*"), "sem asteriscos no e-mail");
  assert.match(await a.texto("#ctPara"), /contador@exemplo\.com\.br/);

  // copiar
  await a.page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async t => { window.__COPIA = t; } } }));
  await a.page.click("#ctCopiar"); await a.espera(150);
  assert.match(await a.page.evaluate(() => window.__COPIA), /Vendas de outubro/);

  // número do relatório do iFood substitui a estimativa
  await a.page.click('#ctVendas [data-canal="2"]'); await a.espera(150);
  await a.page.fill("#ctRel2", "5.012,40");
  await a.page.locator('#ctVendas .explica:not(.hide) button', { hasText: "Usar este" }).click(); await a.espera(500);
  assert.deepEqual((await a.db("jb_contador_mes")).find(r => r.mes === OUT).vendas, { 2: 5012.4 });
  assert.match(await a.texto("#ctVendas"), /iFood[\s\S]*do relatório do app[\s\S]*R\$ 5\.012,40/);
  assert.match(await a.texto("#ctTexto"), /• iFood: R\$ 5\.012,40\n/);

  // marcar como enviado
  await a.page.click("#ctEnviado"); await a.espera(500);
  assert.ok((await a.db("jb_contador_mes")).find(r => r.mes === OUT).enviado_em);
  assert.match(await a.texto("#ctStatus"), /Enviado em 03\/11 ✓/);
  await a.page.click("#navVoltar"); await a.espera(500);
  assert.match(await a.texto("#contadorSub"), /Outubro enviado ✓ · próximo até 07\/12/);
  semErros(a); await a.fechar();
});

test("contador atrasado aparece em destaque na Home", async () => {
  const a = await abrir("uHen", { agora: "2026-11-10T15:00:00Z", db: comDados });
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.match(await a.texto("#contadorSub"), /Atrasado: dados de outubro \(era até 05\/11\)/);
  assert.match(await a.page.getAttribute("#btnContador", "class"), /^(?!.*ghost)/);
  semErros(a); await a.fechar();
});

test("só gestor vê os dados do contador", async () => {
  for(const uid of ["uYas", "uEli"]){
    const a = await abrir(uid, { agora: "2026-11-03T15:00:00Z", db: comDados });
    assert.equal(await a.visivel("btnContador"), false, uid);
    const n = await a.page.evaluate(async () => (await sb.from("jb_contador_mes").select("*")).data.length);
    assert.equal(n, 0);
    semErros(a); await a.fechar();
  }
});
