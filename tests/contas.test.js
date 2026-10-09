const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const mais = (n) => { const d = new Date(hojeSP() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const br = iso => iso.split("-").reverse().join("/");

const COMPROVANTE_SET = (data) => `Comprovante de pagamento - Simples Nacional
Agente arrecadador 077 - Banco Inter S/A
Código de barras 85800000012-7 40000328262-2 93072026275-4 97864060631-1
Data do pagamento ${br(data)}
Número do documento 07202627597864060
Valor total R$ 1.240,00
Pagamento efetuado via Aplicativo do Inter em ${br(data)} às 16:59.`;

const COMPROVANTE_OUTRO = (data) => `Comprovante de pagamento - Simples Nacional
Código de barras 85890000007-7 67590328262-3 81072026281-8 74489663821-5
Data do pagamento ${br(data)}
Valor total R$ 767,59`;

async function abrirContas(uid, opts){
  const a = await abrir(uid || "uHen", opts);
  await a.page.evaluate(() => { window.open = () => ({ close(){}, set location(v){ window.__ABRIU = v; } }); });
  await a.page.click("#btnContas"); await a.espera(500);
  return a;
}
async function anexar(a, sel, texto, nome){
  await a.page.evaluate(t => { window.__pdfTexto = async () => t; }, texto);
  await a.page.setInputFiles(sel, { name: nome || "arquivo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 teste") });
  await a.espera(400);
}
const cartao = (a, txt) => a.page.evaluate(t => {
  const c = [...document.querySelectorAll("#contasLista .enc.conta")].find(x => x.querySelector(".enc-meio b").textContent.includes(t));
  return c ? c.dataset.id : null;
}, txt);
const clicarNo = (a, id, rotulo) => a.page.evaluate(([i, r]) => {
  const c = document.querySelector('#contasLista .enc.conta[data-id="' + i + '"]');
  [...c.querySelectorAll(".enc-acoes button")].find(b => b.textContent === r).click();
}, [id, rotulo]);

test("só o gestor vê as contas; a home diz o que está atrasado ou vence logo", async () => {
  const a = await abrir("uHen");
  assert.ok(await a.visivel("btnContas"));
  assert.equal(await a.texto("#contasSub"), "1 atrasada, 1 vence em até 3 dias");
  semErros(a); await a.fechar();
  for(const uid of ["uEli", "uYas"]){
    const e = await abrir(uid);
    assert.equal(await e.visivel("btnContas"), false, uid + " não vê contas");
    semErros(e); await e.fechar();
  }
});

test("a lista separa atrasadas, próximos 7 dias, mais para frente e pagas; arquivada não aparece", async () => {
  const a = await abrirContas();
  assert.equal(await a.tela(), "scContas");
  assert.equal(await a.titulo(), "Contas a pagar");
  const est = await a.page.evaluate(() => {
    const secoes = {}; let atual = null;
    [...document.querySelectorAll("#contasLista > *")].forEach(el => {
      if(el.matches("h3.conta-sec")){ atual = el.textContent; secoes[atual] = []; }
      else if(el.matches(".enc.conta") && atual) secoes[atual].push(el.querySelector(".enc-meio b").textContent);
    });
    return { secoes, cab: [...document.querySelectorAll(".enc-cab b")].map(b => b.textContent),
             quando: document.querySelector("#contasLista .enc.conta.est-atrasada .conta-quando").textContent,
             chip: document.querySelector("#contasLista .enc.conta.est-atrasada .enc-chip").textContent,
             abas: [...document.querySelectorAll(".conta-abas button")].map(b => b.textContent + ":" + b.getAttribute("aria-selected")) };
  });
  assert.deepEqual(est.secoes, {
    "Atrasadas": ["DAS do Simples, setembro/2026"],
    "Nos próximos 7 dias": ["Contabilidade"],
    "Mais para frente": ["Multa por atraso da declaração"]
  });
  assert.deepEqual(est.abas, ["A pagar3:true", "Pagas1:false", "Todas4:false"]);
  assert.equal(est.chip, "ATRASADA");

  // aba Pagas: verde, com o que foi pago
  await a.page.click('.conta-abas button[data-aba="pagas"]'); await a.espera(200);
  const pg = await a.page.evaluate(() => [...document.querySelectorAll("#contasLista .enc.conta")].map(c => [c.className, c.querySelector(".enc-meio b").textContent, c.querySelector(".enc-chip").textContent]));
  assert.deepEqual(pg.map(x => x[1]), ["Aluguel do ateliê (metade)"]);
  assert.match(pg[0][0], /est-paga/); assert.equal(pg[0][2], "✓ PAGA");
  assert.match(await a.texto(".conta-resumo-pagas"), /1 conta paga nos últimos 90 dias, R\$ 1\.916,11/);

  // aba Todas: tudo por data de vencimento
  await a.page.click('.conta-abas button[data-aba="todas"]'); await a.espera(200);
  const venc = await a.page.evaluate(() => [...document.querySelectorAll("#contasLista .enc.conta[data-id]")].map(c => c.querySelector(".enc-meio b").textContent));
  assert.deepEqual(venc, ["Aluguel do ateliê (metade)", "DAS do Simples, setembro/2026", "Contabilidade", "Multa por atraso da declaração"]);
  assert.deepEqual(est.cab, ["1", "R$ 200,00", "R$ 1.465,00"]);
  assert.match(est.quando, /^venceu há 2 dias/);
  assert.ok(!(await a.page.evaluate(() => document.body.textContent.includes("Boleto antigo arquivado"))));
  semErros(a); await a.fechar();
});

test("comprovante lido sozinho: código igual, valor e data preenchidos, conta vira paga", async () => {
  const a = await abrirContas();
  const id = await cartao(a, "DAS do Simples, setembro");
  await clicarNo(a, id, "Paguei");
  await anexar(a, "#contaComprovante", COMPROVANTE_SET(mais(-1)), "PAGAMENTO_inter.pdf");
  const leitura = await a.texto("#contaLeitura");
  assert.match(leitura, /pago em .*R\$ 1\.240,00.*código igual ao do boleto ✓/);
  assert.equal(await a.page.inputValue("#contaPagoEm"), mais(-1));
  assert.equal(await a.page.inputValue("#contaValorPago"), "1240,00");
  await a.page.click("#contaConfirmaPago"); await a.espera(400);
  const r = (await a.db("jb_conta")).find(c => c.id === 1);
  assert.equal(r.pago_em, mais(-1));
  assert.equal(r.valor_pago, 1240);
  assert.equal(r.pago_por, "comprovante");
  assert.match(r.comprovante_path, /^1\/comprovante-\d+\.pdf$/);
  const up = await a.log("upload");
  assert.equal(up[0][1], "contas", "vai para o balde privado");
  assert.match(await a.texto("#contasMsg"), /DAS do Simples, setembro\/2026: paga em/);
  semErros(a); await a.fechar();
});

test("comprovante de outro boleto acende o alerta e não marca sem confirmação", async () => {
  const a = await abrirContas("uHen", { confirmar: false });
  const id = await cartao(a, "DAS do Simples, setembro");
  await clicarNo(a, id, "Paguei");
  await anexar(a, "#contaComprovante", COMPROVANTE_OUTRO(mais(0)));
  assert.match(await a.texto("#contaLeitura"), /o código é de OUTRO boleto/);
  assert.ok(await a.page.evaluate(() => document.getElementById("contaLeitura").classList.contains("alerta")));
  await a.page.click("#contaConfirmaPago"); await a.espera(300);
  assert.equal(a.confirms.length, 1);
  assert.equal((await a.db("jb_conta")).find(c => c.id === 1).pago_em, null);
  semErros(a); await a.fechar();
});

test("paguei sem comprovante: data e valor à mão; data no futuro não passa", async () => {
  const a = await abrirContas();
  const id = await cartao(a, "Contabilidade");
  await clicarNo(a, id, "Paguei");
  await a.page.evaluate(d => { const i = document.getElementById("contaPagoEm"); i.removeAttribute("max"); i.value = d; i.dispatchEvent(new Event("change")); }, mais(3));
  await a.page.click("#contaConfirmaPago"); await a.espera(300);
  assert.match(await a.texto("#contasMsg"), /não pode ser no futuro/);
  await a.page.evaluate(d => { const i = document.getElementById("contaPagoEm"); i.value = d; i.dispatchEvent(new Event("change")); }, mais(0));
  await a.page.fill("#contaValorPago", "200,00");
  await a.page.click("#contaConfirmaPago"); await a.espera(300);
  const r = (await a.db("jb_conta")).find(c => c.id === 2);
  assert.deepEqual([r.pago_em, r.valor_pago, r.pago_por], [mais(0), 200, "manual"]);
  semErros(a); await a.fechar();
});

test("conta nova: o boleto em PDF preenche código, valor, vencimento, documento e mês", async () => {
  const a = await abrirContas();
  await a.page.click("#contaNovaBt"); await a.espera(200);
  const DAS = `Documento de Arrecadação do Simples Nacional
CNPJ 47.010.705/0001-53 Período de Apuração outubro/2026 Data de Vencimento 20/11/2026
Número do Documento 07.20.26281.7448164-6 Pagar este documento até 20/11/2026 Valor Total do Documento 567,60
85810000005 6 67600328262 5 81072026281 8 74481646770 2`;
  await anexar(a, "#contaBoleto", DAS, "das-outubro.pdf");
  assert.ok(await a.visivel("contaBoletoLido"));
  const v = await a.page.evaluate(() => ({
    tipo: contaTipo.value, desc: contaDescricao.value, venc: contaVencimento.value, valor: contaValor.value,
    comp: contaCompetencia.value, doc: contaDocumento.value, cod: contaCodigo.value }));
  assert.deepEqual(v, { tipo: "imposto", desc: "DAS do Simples, outubro/2026", venc: "2026-11-20", valor: "567,60",
    comp: "2026-10", doc: "07.20.26281.7448164-6", cod: "858100000056676003282625810720262818744816467702" });
  await a.page.click("#contaSalvar"); await a.espera(400);
  const nova = (await a.db("jb_conta")).find(c => c.descricao === "DAS do Simples, outubro/2026");
  assert.ok(nova, "inseriu");
  assert.equal(nova.valor, 567.6);
  assert.equal(nova.competencia, "2026-10-01");
  assert.match(nova.boleto_path, new RegExp("^" + nova.id + "/boleto-\\d+\\.pdf$"));
  semErros(a); await a.fechar();
});

test("código de barras com número trocado não é salvo", async () => {
  const a = await abrirContas();
  await a.page.click("#contaNovaBt"); await a.espera(200);
  await a.page.fill("#contaDescricao", "Boleto do atacado");
  await a.page.fill("#contaVencimento", mais(5));
  await a.page.fill("#contaValor", "150,00");
  await a.page.fill("#contaCodigo", "85810000005 6 67600328262 5 81072026281 8 74481646770 3");
  await a.page.click("#contaSalvar"); await a.espera(300);
  assert.match(await a.texto("#contasMsg"), /não confere/);
  assert.ok(!(await a.db("jb_conta")).some(c => c.descricao === "Boleto do atacado"));
  semErros(a); await a.fechar();
});

test("ver boleto abre link assinado de 5 minutos; tirar da lista arquiva", async () => {
  const a = await abrirContas();
  const id = await cartao(a, "DAS do Simples, setembro");
  await a.page.click('#contasLista .enc.conta[data-id="' + id + '"] .conta-arq'); await a.espera(300);
  const s = await a.log("signed");
  assert.deepEqual(s[0].slice(1), ["contas", "1/boleto-1.pdf", 300]);
  assert.match(await a.page.evaluate(() => window.__ABRIU), /object\/sign\/contas\/1\/boleto-1\.pdf/);
  assert.equal(await a.texto('#contasLista .enc.conta[data-id="' + id + '"] .conta-arq'), "📄 Abrir boleto");
  const idM = await cartao(a, "Multa por atraso");
  await clicarNo(a, idM, "Editar"); await a.espera(200);
  await a.page.click("#contaArquivar"); await a.espera(300);
  assert.equal((await a.db("jb_conta")).find(c => c.id === 4).arquivada, true);
  assert.equal(await cartao(a, "Multa por atraso"), null);
  semErros(a); await a.fechar();
});

test("leitura de código: arrecadação e boleto bancário, com dígitos conferidos", async () => {
  const a = await abrir("uHen");
  const r = await a.page.evaluate(() => {
    const das = "85810000005 6 67600328262 5 81072026281 8 74481646770 2";
    // boleto bancário montado a partir de um código de 44 com DV certo
    const sem = "0019" + "1000" + "0000012345" + "0000002" + "123456789012" + "3456" + "21";   // banco, fator, valor, campo livre (25)
    const dv = contaMod11Boleto(sem);
    const c44 = sem.slice(0, 4) + dv + sem.slice(4);
    const campo = (s) => s + contaMod10(s);
    const linha = campo(c44.slice(0, 4) + c44.slice(19, 24)) + campo(c44.slice(24, 34)) + campo(c44.slice(34, 44)) + c44[4] + c44.slice(5, 19);
    return {
      das: contaDoCodigo(das),
      dasErrado: contaCodigo44(das.replace(/2$/, "3")),
      bol: contaDoCodigo(linha),
      bolVolta: contaCodigo44(linha) === c44
    };
  });
  assert.deepEqual(r.das, { valor: 567.6, vencimento: null, arrecadacao: true });
  assert.equal(r.dasErrado, null);
  assert.deepEqual(r.bol, { valor: 123.45, vencimento: "2025-02-22", arrecadacao: false });
  assert.equal(r.bolVolta, true);
  semErros(a); await a.fechar();
});

test("cartões: a parte da confeitaria em cada fatura, com cada compra ao tocar", async () => {
  const fat = [
    { cartao: "Santander Unique Visa", vencimento: mais(20), compras: 1568.67, divida: 0, pago: false, ativo: true,
      itens: [{ data: mais(-10), desc: "Loja santo Antônio 2/6", valor: 683.78, parcela: "2/6" }, { data: mais(-5), desc: "Embalagem bolo", valor: 884.89, parcela: null }] },
    { cartao: "XP (divida antiga JB)", vencimento: mais(3), compras: 612.71, divida: 3156.28, pago: false, ativo: true,
      itens: [{ data: mais(-20), desc: "Atacadão 3/3", valor: 478.91, parcela: "3/3" }, { data: mais(-15), desc: "Mercado livre 4/6", valor: 133.8, parcela: "4/6" }] },
    { cartao: "XP (divida antiga JB)", vencimento: mais(-4), compras: 0, divida: 4378.83, pago: true, ativo: true, itens: [] },
    { cartao: "Bradesco Visa", vencimento: mais(25), compras: 226.66, divida: 0, pago: false, ativo: false, itens: [] }
  ];
  const a = await abrirContas("uHen", { db: db => { db.jb_cartao_fatura = fat; return db; } });
  const linhas = () => a.page.evaluate(() => [...document.querySelectorAll("#contaCartoes .conta-fatura")].map(c => c.querySelector(".conta-fat-topo").innerText.replace(/\s+/g, " ").trim()));
  const l = await linhas();
  assert.equal(l.length, 2, "a paga vai para Pagas e a inativa não aparece: " + JSON.stringify(l));
  assert.match(l[0], /Fatura XP \(divida antiga JB\) 2 compras R\$ 612,71 · dívida antiga R\$ 3\.156,28 R\$ 3\.768,99 CARTÃO/);
  assert.match(l[1], /Fatura Santander Unique Visa 2 compras R\$ 1\.568,67 R\$ 1\.568,67 CARTÃO/);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#contaCartoes .conta-fat-itens:not(.hide)").length), 0, "nasce fechado");
  await a.page.click("#contaCartoes .conta-fatura:nth-of-type(1) .conta-fat-topo"); await a.espera(150);
  const itens = await a.page.evaluate(() => [...document.querySelectorAll("#contaCartoes .conta-fat-itens:not(.hide) .cx-item")].map(x => x.innerText.replace(/\s+/g, " ").trim()));
  assert.equal(itens.length, 4);
  assert.match(itens[0], /Atacadão 3\/3 parcela 3\/3 R\$ 478,91/);
  assert.match(itens[2], /Dívida antiga no cartão parcela do mês do parcelamento antigo R\$ 3\.156,28/);
  assert.match(itens[3], /Parte da confeitaria nesta fatura R\$ 3\.768,99/);
  await a.page.click('#contasLista .conta-abas [data-aba="pagas"]'); await a.espera(200);
  assert.deepEqual((await linhas()).map(x => /✓ PAGA/.test(x)), [true]);
  semErros(a); await a.fechar();
});

test("foto do comprovante: mostra a foto, explica o próximo passo e guarda ao confirmar", async () => {
  const a = await abrirContas("uJes");
  const id = await cartao(a, "Contabilidade");
  await clicarNo(a, id, "Paguei");
  await a.page.evaluate(() => { delete window.__pdfTexto; });
  await a.page.setInputFiles("#contaComprovante", { name: "IMG_0412.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]) });
  await a.espera(400);
  assert.ok(await a.page.$("#contaFotoPrevia"), "a foto aparece no painel");
  assert.match(await a.texto("#contaLeitura"), /Foto anexada\. .*Confirmar pagamento/);
  await a.page.click("#contaConfirmaPago"); await a.espera(400);
  const r = (await a.db("jb_conta")).find(c => String(c.id) === id);
  assert.equal(r.pago_por, "comprovante");
  assert.match(r.comprovante_path, new RegExp("^" + id + "/comprovante-\\d+\\.jpg$"));
  semErros(a); await a.fechar();
});

test("conta já paga sem comprovante: anexa depois, sem mexer na data nem no valor", async () => {
  const a = await abrirContas("uJes");
  const pagas = (await a.db("jb_conta")).filter(c => c.pago_em && !c.comprovante_path && !c.arquivada);
  assert.ok(pagas.length, "o stub tem conta paga sem comprovante");
  const c0 = pagas[0];
  await a.page.click('.conta-abas [data-aba="pagas"]'); await a.espera(200);
  assert.ok(await a.page.$("#contaAnexar" + c0.id), "botão de anexar na conta paga");
  await a.page.setInputFiles("#contaAnexar" + c0.id, { name: "comprovante.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  await a.espera(500);
  const r = (await a.db("jb_conta")).find(c => c.id === c0.id);
  assert.match(r.comprovante_path, new RegExp("^" + c0.id + "/comprovante-\\d+\\.jpg$"));
  assert.equal(r.pago_em, c0.pago_em); assert.equal(r.pago_por, c0.pago_por); assert.equal(r.valor_pago, c0.valor_pago);
  assert.match(await a.texto("#contasMsg"), /comprovante guardado/);
  assert.equal(await a.page.$("#contaAnexar" + c0.id), null, "depois de guardar o botão some");
  semErros(a); await a.fechar();
});

