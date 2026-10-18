const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* Bolo Gelado Supreme (id 2) congela; Brownie (1) e Pudim (3) não. */
const comFreezer = (db, hoje, abertura = true) => {
  db.jb_produto.find(p => p.id === 2).congela = true;
  if(abertura){
    db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T14:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10, qtd_freezer: 0 },
                             { contagem_id: 5, produto_id: 2, qtd: 106, qtd_freezer: 74 },
                             { contagem_id: 5, produto_id: 3, qtd: 6, qtd_freezer: 0 });
  }
  return db;
};

test("item que congela tem expositora e freezer; o banco recebe o total e a parte do freezer", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comFreezer(db, hoje) });
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.page.locator("#countList .item.dois").count(), 1, "só o Supreme tem dois números");
  const linha = a.page.locator('#countList .item[data-pid="2"]');
  assert.match(await linha.innerText(), /Expositora[\s\S]*Freezer/i);

  await a.page.locator("#countList .item[data-pid='1'] .step input").fill("2");
  await a.page.locator("#countList .item[data-pid='3'] .step input").fill("1");
  await linha.locator("input[data-local='expositora']").fill("20");
  await a.espera(100);
  assert.equal(await a.page.evaluate(() => document.querySelector("#countList .item[data-pid='2']").classList.contains("filled")), false, "sem o freezer o item não conta como feito");
  await linha.locator("input[data-local='freezer']").fill("74");
  await a.espera(100);
  assert.match(await linha.innerText(), /total 94/);
  await a.page.click("#btnSalvar"); await a.espera(500);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_salvar_contagem");
  assert.deepEqual(r[2].p_itens, [{ produto_id: 1, qtd: 2 }, { produto_id: 2, qtd: 94, qtd_freezer: 74 }, { produto_id: 3, qtd: 1 }]);
  semErros(a); await a.fechar();
});

test("freezer esquecido em branco no fechamento: o app pergunta antes de contar zero", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comFreezer(db, hoje), confirmar: false });
  await a.page.click("#btnFechamento"); await a.espera(300);
  for(const pid of [1, 3]) await a.page.locator(`#countList .item[data-pid='${pid}'] .step input`).fill("1");
  await a.page.locator("#countList .item[data-pid='2'] input[data-local='expositora']").fill("20");
  await a.page.click("#btnSalvar"); await a.espera(300);
  assert.match(a.confirms[0], /Bolo Gelado Supreme \(freezer\)/);
  assert.equal((await a.log("rpc")).filter(x => x[1] === "jb_salvar_contagem").length, 0, "não salvou");
  semErros(a); await a.fechar();
});

test("corrigir a abertura traz expositora e freezer separados", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comFreezer(db, hoje) });
  await a.page.click("#btnAbertura"); await a.espera(300);
  await a.page.click("#btnModoContar"); await a.espera(300);
  const linha = a.page.locator("#countList .item[data-pid='2']");
  assert.equal(await linha.locator("input[data-local='expositora']").inputValue(), "32");
  assert.equal(await linha.locator("input[data-local='freezer']").inputValue(), "74");
  assert.match(await linha.innerText(), /total 106/);
  semErros(a); await a.fechar();
});

test("Home da Jessica mostra o que está no freezer; a da Yasmin não", async () => {
  const hoje = hojeSP();
  let a = await abrir("uJes", { db: db => comFreezer(db, hoje) });
  assert.match(await a.texto("#freezerCard"), /No freezer · 74/);
  assert.match(await a.texto("#freezerCard"), /74 Bolo Gelado Supreme/);
  semErros(a); await a.fechar();
  a = await abrir("uYas", { db: db => comFreezer(db, hoje) });
  assert.equal(await a.page.locator("#freezerCard").count(), 0);
  semErros(a); await a.fechar();
});

test("na lista, a Jessica liga e desliga o freezer de um item", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comFreezer(db, hoje, false) });
  await a.page.click("#btnAbertura"); await a.espera(300);
  await a.page.click("#btnEditarLista"); await a.espera(300);
  await a.page.locator("button[data-congela='3']").click(); await a.espera(400);
  assert.equal((await a.db("jb_produto")).find(p => p.id === 3).congela, true);
  semErros(a); await a.fechar();
});
