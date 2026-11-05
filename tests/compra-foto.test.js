const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/* Uma nota de mercado como a IA devolve: chocolate e ovos são insumos, a toalha não. */
const NOTA = {
  legivel: true, tipo_documento: "NFC-e", fornecedor: "ATACADAO S.A.", cnpj_emitente: "93.209.765/0590-06",
  destinatario_doc: null, data: "2026-11-02", numero: "451239", chave: null,
  valor_produtos: 190.47, desconto: 0.47, frete: 0, valor_pago: 190.00, pagamento_na_nota: "CARTAO DE CREDITO",
  itens: [
    { codigo: "7891000000001", descricao: "CHOC BLEND MELKEN 2,05KG", qtd: 2, unidade: "UN", valor_unit: 82.00, valor_total: 164.00, insumo_id: 100, qtd_base: 4.1, destino: "insumo", certeza: 0.95 },
    { codigo: "7890000000002", descricao: "OVOS BRANCOS C/30", qtd: 1, unidade: "UN", valor_unit: 16.00, valor_total: 16.00, insumo_id: 101, qtd_base: 30, destino: "insumo", certeza: 0.6 },
    { codigo: "7896104990321", descricao: "TOALHA PAPEL KLASS C/2", qtd: 3, unidade: "UN", valor_unit: 3.49, valor_total: 10.47, insumo_id: null, qtd_base: null, destino: "consumo", certeza: 0.9 }
  ]
};
const comFn = (extra) => db => {
  db.__fn = {
    ler: { nota: NOTA, ia: { modelo: "claude-haiku-4-5", entrada: 5773, saida: 1404, custo_usd: 0.0128 } },
    cartoes: { cartoes: ["Nubank Jessica", "Santander Unique Visa", "Unicred Visa Infinite"] },
    financeiro: { status: "lancado", parcelas: 2, valor: 190 },
    ...(extra || {})
  };
  return db;
};

test("as contas puras: número, soma, CNPJ, forma, aprendizado, custo e margem", async () => {
  const a = await abrir("uHen", { agora: "2026-11-05T15:00:00Z" });
  const r = await a.page.evaluate(N => {
    const ins = [{ id: 100, nome: "Chocolate 50%", unidade: "kg", custo_unit: 40, categoria: "ingrediente" },
                 { id: 101, nome: "Ovos", unidade: "un", custo_unit: 0.72, categoria: "ingrediente" },
                 { id: 200, nome: "Pote 500ml", unidade: "un", custo_unit: 0.80, categoria: "embalagem" }];
    /* compra antiga: o mesmo código de barras já foi para o insumo 100, rendendo 2,05 kg por unidade */
    const apr = cfAprendizado([{ id: 1, fornecedor: "Atacadão", cnpj: null }],
      [{ id: 1, compra_id: 1, codigo_forn: "7891000000001", descricao: "CHOC BLEND", qtd: 3, qtd_base: 6.15, insumo_id: 100, destino: "insumo" },
       { id: 2, compra_id: 1, codigo_forn: null, descricao: "Toalha papel Klass c/2", qtd: 1, qtd_base: null, insumo_id: null, destino: "consumo" }]);
    const nota = JSON.parse(JSON.stringify(N));
    nota.itens[0].qtd_base = 4;            // a IA errou a conta; o histórico corrige
    nota.itens[0].insumo_id = 200;         // e ligou ao insumo errado
    const linhas = cfMontarLinhas(nota, ins, apr);
    return {
      num: [cfNum("1.245"), cfNum("1,245"), cfNum("1.250,50"), cfNum(""), cfNum("abc")],
      forn: [cfChaveForn("ATACADAO S.A.", null), cfChaveForn("Atacadão", null), cfChaveForn("x", "93.209.765/0590-06")],
      soma: cfConfereSoma(linhas, { desconto: 0.47, frete: 0, valor_pago: 190 }),
      somaRuim: cfConfereSoma(linhas, { desconto: 0, frete: 0, valor_pago: 200 }).fecha,
      dest: [cfDestinatario("47.010.705/0001-53").tipo, cfDestinatario("12.345.678/0001-90").tipo, cfDestinatario("123.456.789-01").tipo, cfDestinatario(null).tipo],
      forma: [cfFormaDaNota("CARTAO DE CREDITO"), cfFormaDaNota("Pix"), cfFormaDaNota("Débito"), cfFormaDaNota("depósito"), cfFormaDaNota("")],
      l0: [linhas[0].insumo_id, linhas[0].qtd_base, linhas[0].origem],
      l2: [linhas[2].insumo_id, linhas[2].destino],
      custo: cfCusto(linhas[0], ins[0]),
      cat: cfCategoria(linhas, ins),
      marg: cfMargens([{ de: 0.25, para: 0.18 }, { de: 0.05, para: -0.01 }, { de: 0.10, para: 0.08 }], 0.2)
    };
  }, NOTA);
  assert.deepEqual(r.num, [1.245, 1.245, 1250.5, null, null], "no campo de quantidade o ponto é decimal");
  assert.equal(r.forn[0], r.forn[1], "ATACADAO S.A. e Atacadão são o mesmo fornecedor");
  assert.equal(r.forn[2], "93209765", "com CNPJ, vale a raiz");
  assert.deepEqual([r.soma.soma, r.soma.esperado, r.soma.fecha], [190.47, 190, true]);
  assert.equal(r.somaRuim, false);
  assert.deepEqual(r.dest, ["ok", "err", "warn", "warn"]);
  assert.deepEqual(r.forma, ["cartao", "pix", "debito", "boleto", null]);
  assert.deepEqual(r.l0, [100, 4.1, "antes"], "o código de barras já comprado ganha da IA, com a mesma conversão (2 x 2,05 kg)");
  assert.deepEqual(r.l2, [null, "consumo"]);
  assert.equal(r.custo.novo, 40);
  assert.equal(r.custo.grande, false);
  assert.equal(r.cat, 48);
  assert.deepEqual([r.marg.cruzou.length, r.marg.prejuizo.length, r.marg.piorou.length], [1, 1, 1]);
  semErros(a);
  await a.fechar();
});

test("só gestor vê o botão da compra pela nota", async () => {
  const e = await abrir("uYas");
  assert.equal(await e.visivel("btnCompra"), false);
  await e.fechar();
  const g = await abrir("uJes");
  assert.equal(await g.visivel("btnCompra"), true);
  semErros(g);
  await g.fechar();
});

test("foto, leitura, conferência e gravação: preço, financeiro e aviso de nota fora do CNPJ", async () => {
  const a = await abrir("uJes", { agora: "2026-11-05T15:00:00Z", db: comFn() });
  await a.page.click("#btnCompra");
  assert.equal(await a.tela(), "scCompra");
  assert.equal(await a.titulo(), "Compra pela nota");
  await a.page.setInputFiles("#cfArquivo", { name: "nota.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector("#cfLer");
  const up = await a.log("upload");
  assert.equal(up.length, 1);
  assert.equal(up[0][1], "contas", "a foto vai para o balde privado");
  assert.match(up[0][2], /^notas\/20261105-\d+-0\.jpg$/);

  await a.page.click("#cfLer");
  await a.page.waitForSelector("#cfGravar");
  const fn = await a.log("fn");
  assert.deepEqual(fn.map(f => f[2].acao).sort(), ["cartoes", "ler"]);
  assert.deepEqual(fn.find(f => f[2].acao === "ler")[2].fotos, [up[0][2]]);

  const avisos = await a.texto("#cfAvisos");
  assert.match(avisos, /sem o CNPJ da JB/);
  assert.match(avisos, /fecha com o total da nota: R\$ 190,00/);
  assert.match(avisos, /1 linha foi lida com pouca certeza/);
  assert.equal(await a.page.locator(".cf-lin.duvida").count(), 1);
  /* o cartão: a nota diz crédito; o cartão sugerido vem da lista do financeiro */
  assert.equal(await a.page.$eval("#cfCartao", s => s.value), "Santander Unique Visa");
  assert.equal(await a.page.$eval("#cfGravar", b => b.disabled), false);

  /* ovos: 16/30 = 0,5333 contra 0,72 no sistema (-25,9%): não atualiza sem ela marcar */
  const ovos = a.page.locator('.cf-lin[data-k="1"]');
  assert.match(await ovos.textContent(), /Mudou mais de 15%/);
  assert.equal(await ovos.locator(".cf-check input").isChecked(), false);
  await a.page.selectOption("#cfParcelas", "2");

  await a.page.click("#cfGravar");
  await a.page.waitForSelector("#cfOutra");
  const rpc = (await a.log("rpc")).find(r => r[1] === "jb_compra_foto_gravar")[2].p;
  assert.equal(rpc.fornecedor, "ATACADAO S.A.");
  assert.equal(rpc.valor_pago, 190);
  assert.equal(rpc.forma, "cartao");
  assert.equal(rpc.cartao, "Santander Unique Visa");
  assert.equal(rpc.parcelas, 2);
  assert.equal(rpc.fin_categoria, 48);
  assert.deepEqual(rpc.fotos, [up[0][2]]);
  assert.deepEqual(rpc.itens.map(i => [i.insumo_id, i.unidade_base, i.aplicar, i.destino]),
    [[100, "kg", true, "insumo"], [101, "un", false, "insumo"], [null, null, false, "consumo"]]);
  assert.equal(rpc.ia.custo_usd, 0.0128);

  const fin = (await a.log("fn")).find(f => f[2].acao === "financeiro");
  assert.ok(fin, "lançou no Nosso Financeiro");
  const feito = await a.texto("#cfCorpo");
  assert.match(feito, /Compra gravada: ATACADAO S\.A\., 3 linhas, R\$ 190,00/);
  assert.match(feito, /Nenhum preço mudou/, "o chocolate saiu pelo mesmo preço do sistema");
  assert.match(feito, /Lançado: R\$ 190,00 em 2x no Santander Unique Visa, aguardando a fatura/);
  assert.equal((await a.db("jb_insumo")).find(i => i.id === 101).custo_unit, 0.72, "ovos não mudaram");
  semErros(a);
  await a.fechar();
});

test("soma que não fecha trava o botão até conferir; preço grande atualiza quando ela marca", async () => {
  const nota = JSON.parse(JSON.stringify(NOTA));
  nota.valor_pago = 200; nota.destinatario_doc = "47010705000153";
  const a = await abrir("uJes", { db: comFn({ ler: { nota, ia: null } }) });
  await a.page.click("#btnCompra");
  await a.page.setInputFiles("#cfArquivo", { name: "nota.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector("#cfLer");
  await a.page.click("#cfLer");
  await a.page.waitForSelector("#cfGravar");
  assert.match(await a.texto("#cfAvisos"), /Nota no CNPJ da JB/);
  assert.match(await a.texto("#cfAvisos"), /dá R\$ 190,00, e a nota diz R\$ 200,00/);
  assert.equal(await a.page.$eval("#cfGravar", b => b.disabled), true);
  assert.match(await a.texto("#cfGravar"), /conferir a soma/);
  await a.page.check("#cfConferi");
  assert.equal(await a.page.$eval("#cfGravar", b => b.disabled), false);

  await a.page.locator('.cf-lin[data-k="1"] .cf-check input').check();
  await a.page.click("#cfGravar");
  await a.page.waitForSelector("#cfOutra");
  const p = (await a.log("rpc")).find(r => r[1] === "jb_compra_foto_gravar")[2].p;
  assert.deepEqual([p.itens[1].aplicar, p.itens[1].confirmou_variacao], [true, true]);
  assert.match(await a.texto("#cfCorpo"), /Ovos: R\$ 0,72 → R\$ 0,53 por un \(-25,9%\)/);
  semErros(a);
  await a.fechar();
});

test("nota repetida não grava de novo; financeiro que já tinha o gasto só avisa; erro deixa tentar de novo", async () => {
  const a = await abrir("uJes", { db: db => {
    comFn({ financeiro: [{ erro: "Nosso Financeiro: fora do ar" },
                         { status: "ja_existia", evento: { descricao: "Atacadão 1/2", data: "2026-11-02", valor: 95 } }] })(db);
    db.jb_compra = [{ id: 7, data: "2026-11-02", fornecedor: "ATACADAO S.A.", valor_pago: 190, forma: "pix" }];
    return db;
  } });
  await a.page.click("#btnCompra");
  await a.page.setInputFiles("#cfArquivo", { name: "nota.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector("#cfLer");
  await a.page.click("#cfLer");
  await a.page.waitForSelector("#cfGravar");
  await a.page.click("#cfGravar");
  await a.page.waitForSelector("#cfForcar");
  assert.match(await a.texto("#cfMsg"), /já foi lançada \(compra 7\)/);
  assert.equal((await a.db("jb_compra")).length, 1);

  await a.page.click("#cfForcar");
  await a.page.waitForSelector("#cfOutra");
  assert.match(await a.texto("#cfCorpo"), /Não consegui lançar no Nosso Financeiro: Nosso Financeiro: fora do ar/);
  await a.page.click("#cfFinDeNovo");
  await a.page.waitForSelector("#cfFinForcar");
  assert.match(await a.texto("#cfCorpo"), /Já estava no Nosso Financeiro: Atacadão 1\/2 .*R\$ 95,00\. Não lancei de novo/);
  semErros(a);
  await a.fechar();
});

test("leitura que falha volta para a foto com o recado do servidor", async () => {
  const a = await abrir("uJes", { db: comFn(), falha: { "fn:ler": "O limite de gasto da IA deste mês acabou." } });
  await a.page.click("#btnCompra");
  await a.page.setInputFiles("#cfArquivo", { name: "nota.png", mimeType: "image/png", buffer: PNG });
  await a.page.waitForSelector("#cfLer");
  await a.page.click("#cfLer");
  await a.page.waitForSelector("#cfLer");
  assert.match(await a.texto("#cfMsg"), /limite de gasto da IA deste mês acabou/);
  assert.equal((await a.log("rpc")).filter(r => r[1] === "jb_compra_foto_gravar").length, 0, "nada gravado");
  semErros(a);
  await a.fechar();
});
