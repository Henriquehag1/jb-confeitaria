const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* abertura de hoje da Jessica: Supreme (2) com 32 na expositora e 74 no freezer */
const comAbertura = (db, hoje) => {
  db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T14:00:00Z", freezer_contado: true });
  db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10, freezer: 0 },
                           { contagem_id: 5, produto_id: 2, qtd: 32, freezer: 74 },
                           { contagem_id: 5, produto_id: 3, qtd: 6, freezer: 0 });
  return db;
};

test("Yasmin fecha só a expositora: nada de freezer na tela nem no que vai para o banco", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.page.locator("#countList input[data-local='freezer']").count(), 0);
  const inputs = a.page.locator("#countList .step input");
  assert.equal(await inputs.count(), 3);
  await inputs.nth(0).fill("2"); await inputs.nth(1).fill("5"); await inputs.nth(2).fill("1");
  await a.espera(100);
  await a.page.click("#btnSalvar"); await a.espera(500);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_salvar_contagem");
  assert.deepEqual(r[2].p_itens, [{ produto_id: 1, qtd: 2 }, { produto_id: 2, qtd: 5 }, { produto_id: 3, qtd: 1 }]);
  semErros(a); await a.fechar();
});

test("Jessica vê expositora e freezer em todos os doces; freezer em branco fica como estava", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.page.locator("#countList input[data-local='freezer']").count(), 3, "freezer em todos os itens");
  const sup = a.page.locator("#countList .item[data-pid='2']");
  assert.equal(await sup.locator("input[data-local='freezer']").getAttribute("placeholder"), "74", "mostra o freezer da abertura");
  await a.page.locator("#countList .item[data-pid='1'] input[data-local='expositora']").fill("3");
  await sup.locator("input[data-local='expositora']").fill("9");
  await a.page.locator("#countList .item[data-pid='3'] input[data-local='expositora']").fill("2");
  await a.page.locator("#countList .item[data-pid='3'] input[data-local='freezer']").fill("12");
  await a.espera(100);
  await a.page.click("#btnSalvar"); await a.espera(500);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_salvar_contagem");
  assert.deepEqual(r[2].p_itens, [{ produto_id: 1, qtd: 3, freezer: 0 }, { produto_id: 2, qtd: 9, freezer: 74 }, { produto_id: 3, qtd: 2, freezer: 12 }]);
  semErros(a); await a.fechar();
});

test("corrigir a abertura: expositora e freezer separados", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnAbertura"); await a.espera(300);
  await a.page.click("#btnModoContar"); await a.espera(300);
  const sup = a.page.locator("#countList .item[data-pid='2']");
  assert.equal(await sup.locator("input[data-local='expositora']").inputValue(), "32");
  assert.equal(await sup.locator("input[data-local='freezer']").getAttribute("placeholder"), "74");
  semErros(a); await a.fechar();
});

test("repor do freezer: soma na expositora e desconta do freezer", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnAbertura"); await a.espera(300);
  assert.match(await a.texto("#countList .item[data-pid='2'] .fz"), /no freezer: 74/);
  await a.page.check("#reporDoFreezer");
  await a.page.locator("#countList .item[data-pid='2'] .step input").fill("10");
  await a.espera(100);
  await a.page.click("#btnSalvar"); await a.espera(500);
  const it = (await a.db("jb_contagem_item")).find(i => i.contagem_id === 5 && i.produto_id === 2);
  assert.deepEqual([it.qtd, it.freezer], [42, 64]);
  semErros(a); await a.fechar();
});

test("Home da Jessica mostra o freezer; a da Yasmin não", async () => {
  const hoje = hojeSP();
  let a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  assert.match(await a.texto("#freezerCard"), /No freezer · 74/);
  assert.match(await a.texto("#fzLista"), /Bolo gelado\s*74\s*74\s*Supreme/i, "item por item, agrupado");
  assert.match(await a.texto("#freezerCard"), /Contado na abertura de hoje/);
  semErros(a); await a.fechar();
  a = await abrir("uYas", { db: db => comAbertura(db, hoje) });
  assert.equal(await a.page.locator("#freezerCard").count(), 0);
  semErros(a); await a.fechar();
});

test("abertura do dia seguinte começa do freezer de ontem", async () => {
  const hoje = hojeSP(), ontem = diaMais(hoje, -1);
  const a = await abrir("uJes", { db: db => comAbertura(db, ontem) });
  await a.page.click("#btnAbertura"); await a.espera(400);
  assert.equal(await a.page.locator("#countList .item[data-pid='2'] input[data-local='freezer']").getAttribute("placeholder"), "74");
  semErros(a); await a.fechar();
});

test("Coloquei no freezer: soma no freezer sem mexer na expositora e fica no histórico", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  assert.match(await a.texto("#freezerCard"), /Coloquei no freezer/);
  await a.page.click("#btnFreezerEntrou"); await a.espera(400);
  assert.match(await a.texto("#fzList .item[data-pid='2'] .fz"), /no freezer: 74/);
  assert.equal(await a.page.locator("#btnFzSalvar").isDisabled(), true, "sem nada digitado não salva");
  await a.page.locator("#fzList .item[data-pid='2'] .step input").fill("20");
  await a.page.locator("#fzList .item[data-pid='3'] .step input").fill("5");
  await a.espera(100);
  assert.match(await a.texto("#fzProg"), /25 unidades/);
  await a.page.click("#btnFzSalvar"); await a.espera(600);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_freezer_entrada");
  assert.deepEqual(r[2].p_itens, [{ produto_id: 2, qtd: 20 }, { produto_id: 3, qtd: 5 }]);
  const it = await a.db("jb_contagem_item");
  const sup = it.find(i => i.contagem_id === 5 && i.produto_id === 2);
  assert.deepEqual([sup.qtd, sup.freezer], [32, 94], "expositora igual, freezer somado");
  assert.equal(it.find(i => i.contagem_id === 5 && i.produto_id === 3).freezer, 5);
  assert.match(await a.texto("#homeMsg"), /25 unidades entraram no freezer/);
  assert.match(await a.texto("#freezerCard"), /No freezer · 99/);
  const mov = await a.db("jb_freezer_mov");
  assert.equal(mov.length, 2);
  semErros(a); await a.fechar();
});

test("depois de colocar, a tela mostra as últimas entradas; repor do freezer entra como saída", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnAbertura"); await a.espera(300);
  await a.page.check("#reporDoFreezer");
  await a.page.locator("#countList .item[data-pid='2'] .step input").fill("6");
  await a.espera(100);
  await a.page.click("#btnSalvar"); await a.espera(500);
  await a.page.click("#btnFreezerEntrou"); await a.espera(400);
  assert.match(await a.texto("#fzList .item[data-pid='2'] .fz"), /no freezer: 68/);
  assert.match(await a.texto("#fzJa"), /Saiu para a expositora/);
  assert.match(await a.texto("#fzJa"), /-6/);
  semErros(a); await a.fechar();
});

test("Yasmin não tem Coloquei no freezer nem consegue gravar", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comAbertura(db, hoje) });
  assert.equal(await a.page.locator("#btnFreezerEntrou").count(), 0);
  const r = await a.page.evaluate(async () => { const x = await sb.rpc("jb_freezer_entrada", { p_itens: [{ produto_id: 2, qtd: 1 }] }); return x.error && x.error.code; });
  assert.equal(r, "42501");
  semErros(a); await a.fechar();
});
