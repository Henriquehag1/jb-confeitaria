const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const NOTA = {
  legivel: true, tipo_documento: "NFC-e", fornecedor: "ATACADAO S.A.", cnpj_emitente: "93.209.765/0590-06",
  destinatario_doc: null, data: "2026-11-17", numero: "9911", chave: null,
  valor_produtos: 96.00, desconto: 0, frete: 0, valor_pago: 96.00, pagamento_na_nota: "DINHEIRO",
  itens: [
    { codigo: "7890000000002", descricao: "OVOS BRANCOS C/30", qtd: 6, unidade: "UN", valor_unit: 16.00, valor_total: 96.00, insumo_id: 101, qtd_base: 180, destino: "insumo", certeza: 0.95 }
  ]
};
const ENVIADA = { id: 7, user_id: "uEli", criado_em: "2026-11-17T14:00:00Z", data: "2026-11-17", valor: 96, loja: "Atacadão", obs: "ovos",
                  fotos: ["reembolso/uEli/20261117-1-0.jpg"], status: "enviado" };

test("Eliana: botão na Home, foto do cupom, valor e a lista só dela", async () => {
  const a = await abrir("uEli", { agora: "2026-11-18T13:00:00Z", db: db => {
    db.jb_reembolso.push({ ...ENVIADA, id: 3, status: "pago", data: "2026-10-30", valor: 181.6, loja: "Atacadão" },
                         { ...ENVIADA, id: 4, user_id: "uYas", valor: 50 });
    return db; } });
  assert.equal(await a.visivel("btnReemb"), true);
  assert.equal(await a.texto("#btnReemb .t"), "Comprei para o ateliê");
  await a.page.click("#btnReemb"); await a.espera(400);
  assert.equal(await a.tela(), "scReemb");
  assert.equal(await a.titulo(), "Comprei para o ateliê");
  assert.match(await a.texto("#rbEnviar"), /Falta a foto do cupom e o valor/);
  const lista = await a.texto("#rbCorpo");
  assert.match(lista, /R\$ 181,60/, "vê a compra dela");
  assert.doesNotMatch(lista, /R\$ 50,00/, "não vê a de outra pessoa");

  await a.page.setInputFiles("#rbArquivo", { name: "cupom.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector(".cf-foto");
  const up = await a.log("upload");
  assert.equal(up[0][1], "contas");
  assert.match(up[0][2], /^reembolso\/uEli\/20261118-\d+-0\.jpg$/, "a foto vai para a pasta dela");
  await a.page.fill("#rbValor", "96,00");
  await a.page.fill("#rbLoja", "Atacadão");
  await a.page.fill("#rbObs", "ovos");
  assert.equal(await a.texto("#rbEnviar .t"), "Enviar para a Jessica");
  await a.page.click("#rbEnviar"); await a.espera(400);
  const r = (await a.db("jb_reembolso")).find(x => x.valor === 96);
  assert.ok(r, "gravou");
  assert.deepEqual([r.user_id, r.status, r.loja, r.obs, r.data], ["uEli", "enviado", "Atacadão", "ovos", "2026-11-18"]);
  assert.match(await a.texto("#rbCorpo"), /enviada[\s\S]*A Jessica vai conferir/);
  semErros(a); await a.fechar();
});

test("a equipe da noite e a freela não veem o botão; o gestor só vê quando tem compra para conferir", async () => {
  let a = await abrir("uYas");
  assert.equal(await a.visivel("btnReemb"), false);
  await a.fechar();
  a = await abrir("uJes");
  assert.equal(await a.visivel("btnReemb"), false, "nada para conferir");
  await a.fechar();
  a = await abrir("uJes", { db: db => { db.jb_reembolso.push({ ...ENVIADA }); return db; } });
  assert.equal(await a.visivel("btnReemb"), true);
  assert.equal(await a.texto("#btnReemb .t"), "Compra da equipe para conferir");
  assert.equal(await a.texto("#btnReemb .s"), "Eliana: R$ 96,00 · toque para conferir a nota");
  semErros(a); await a.fechar();
});

test("conferir: abre a nota com a foto dela, grava sem lançar no financeiro e vira reembolso dela", async () => {
  const a = await abrir("uJes", { agora: "2026-11-18T13:00:00Z", db: db => {
    db.jb_reembolso.push({ ...ENVIADA });
    db.__fn = { ler: { nota: NOTA, ia: { custo_usd: 0.01 } }, cartoes: { cartoes: ["Santander Unique Visa"] } };
    return db; } });
  await a.page.click("#btnReemb"); await a.espera(400);
  assert.equal(await a.titulo(), "Compras da equipe");
  await a.page.click('.rb-item[data-id="7"] button:text-is("Conferir a nota")');
  await a.page.waitForSelector("#cfGravar");
  const ler = (await a.log("fn")).find(f => f[2].acao === "ler");
  assert.deepEqual(ler[2].fotos, ["reembolso/uEli/20261117-1-0.jpg"]);
  assert.match(await a.texto(".cf-reemb"), /Compra que Eliana mandou: R\$ 96,00 em Atacadão/);
  assert.equal(await a.page.locator(".cf-quem button[aria-pressed=true]").textContent(), "Eliana, do bolso dela");
  assert.equal(await a.page.locator("#cfPag .chips:not(.cf-quem)").count(), 0, "sem escolher forma de pagamento: a JB devolve no Pix");
  await a.page.click("#cfGravar");
  await a.page.waitForSelector("#cfOutra");
  const g = (await a.log("rpc")).find(r => r[1] === "jb_compra_foto_gravar")[2].p;
  assert.deepEqual([g.forma, g.cartao, g.parcelas], ["pix", null, 1]);
  const conf = (await a.log("rpc")).find(r => r[1] === "jb_reembolso_conferir")[2];
  assert.deepEqual([conf.p_user, conf.p_reembolso], ["uEli", 7]);
  assert.equal((await a.log("fn")).filter(f => f[2].acao === "financeiro").length, 0, "o financeiro recebe no dia do Pix");
  const feito = await a.texto("#cfCorpo");
  assert.match(feito, /Entrou no pagamento de Eliana: R\$ 96,00, junto com as diárias \(acerto até .*10\/12\)/);
  assert.equal(await a.texto("#cfOutra .t"), "Voltar às compras da equipe");
  const r = (await a.db("jb_reembolso")).find(x => x.id === 7);
  assert.equal(r.status, "conferido");
  semErros(a); await a.fechar();
});

test("Jessica lança à mão a nota que a Eliana pagou: escolhe Quem pagou e vira reembolso", async () => {
  const a = await abrir("uJes", { agora: "2026-11-18T13:00:00Z", db: db => {
    db.__fn = { ler: { nota: NOTA, ia: { custo_usd: 0.01 } }, cartoes: { cartoes: [] } };
    return db; } });
  await a.page.click("#btnCompra");
  await a.page.setInputFiles("#cfArquivo", { name: "nota.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector("#cfLer");
  await a.page.click("#cfLer");
  await a.page.waitForSelector("#cfGravar");
  await a.page.click('.cf-quem button:text-is("Eliana, do bolso dela")');
  assert.match(await a.texto("#cfPag"), /A JB devolve para Eliana no próximo pagamento dela/);
  await a.page.click("#cfGravar");
  await a.page.waitForSelector("#cfOutra");
  const conf = (await a.log("rpc")).find(r => r[1] === "jb_reembolso_conferir")[2];
  assert.deepEqual([conf.p_user, conf.p_reembolso], ["uEli", null]);
  semErros(a); await a.fechar();
});

test("não aceitar: ela vê o motivo", async () => {
  const a = await abrir("uJes", { db: db => { db.jb_reembolso.push({ ...ENVIADA }); return db; } });
  await a.page.click("#btnReemb"); await a.espera(400);
  await a.page.click('.rb-item[data-id="7"] button:text-is("Não aceitar")');
  await a.page.fill(".rb-recusa input", "é compra de casa");
  await a.page.click('.rb-recusa button:text-is("Confirmar")'); await a.espera(300);
  const r = (await a.db("jb_reembolso")).find(x => x.id === 7);
  assert.deepEqual([r.status, r.motivo], ["recusado", "é compra de casa"]);
  semErros(a); await a.fechar();
});

test("Paguei a Eliana: marca dias e reembolso como pagos e manda lançar no Nosso Financeiro", async () => {
  const a = await abrir("uHen", { agora: "2026-11-18T15:00:00Z", db: db => {
    db.jb_pessoal_mes = [{ user_id: "uEli", nome: "Eliana", mes: "2026-11-01", dias_combinados: 0, dias_veio: 2, dias_pendentes: 0, custo: 280 }];
    db.jb_dia_trabalhado = ["2026-11-12", "2026-11-13"].map((d, i) => ({ id: 960 + i, user_id: "uEli", data: d, status: "confirmado", origem: "manual", pago_em: null }));
    db.jb_conta = (db.jb_conta || []).concat([{ id: 70, tipo: "equipe", descricao: "Eliana: reembolso de ATACADAO S.A. de 17/11", competencia: "2026-11-01",
      vencimento: "2026-12-10", valor: 96, compra_id: 1, equipe_user_id: "uEli", pago_em: null, valor_pago: null, pago_por: null, arquivada: false, abatimentos: [] }]);
    db.jb_reembolso.push({ ...ENVIADA, status: "conferido", conta_id: 70 });
    db.__fn = { pagamento: { status: "lancado", linhas: [{ tipo: "diarias", valor: 280, status: "lancado" }, { tipo: "compra", valor: 96, status: "lancado" }] } };
    return db; } });
  await a.page.click("#btnDias"); await a.espera(1200);
  const card = a.page.locator(`.pessoa:has(h3:text-is("Eliana"))`).first();
  assert.match(await card.innerText(), /A pagar agora: R\$ 376,00 \(12 e 13\/11 \+ reembolso de ATACADAO S\.A\. de 17\/11 R\$ 96,00\)/);
  await card.locator(".rb-pagar summary").click();
  assert.match(await card.locator(".rb-pagar summary").innerText(), /Paguei Eliana \(Pix de R\$ 376,00\)/);
  await card.locator(".rb-pg-form button").click(); await a.espera(1500);
  const pg = (await a.log("rpc")).find(r => r[1] === "jb_pagar_diarista")[2];
  assert.deepEqual([pg.p_user, pg.p_data, pg.p_valor], ["uEli", "2026-11-18", 376]);
  const fn = (await a.log("fn")).find(f => f[2].acao === "pagamento");
  assert.equal(fn[2].pagamento_id, 1);
  assert.match(await a.texto("#diasMsg"), /Pagamento de Eliana registrado: R\$ 376,00 em .*18\/11\. Já está no Nosso Financeiro/);
  const dias = (await a.db("jb_dia_trabalhado")).filter(d => d.user_id === "uEli");
  assert.ok(dias.every(d => d.pago_em), "os dias ficaram pagos");
  assert.ok((await a.db("jb_conta")).find(c => c.id === 70).pago_em, "o reembolso ficou pago");
  assert.equal((await a.db("jb_reembolso")).find(x => x.id === 7).status, "pago");
  assert.doesNotMatch(await a.page.locator(`.pessoa:has(h3:text-is("Eliana"))`).first().innerText(), /A pagar agora/);
  semErros(a); await a.fechar();
});
