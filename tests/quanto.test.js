const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* A conta vem pronta do banco (jb_quanto_fazer). Aqui o teste controla o resultado. */
const conta = db => {
  db.jb_quanto_param = [{ id: 1, dias: 7, margem_pct: 15 }];
  db.jb_quanto_meta = [];
  db.__quanto = {
    hoje: hojeSP(), dias: 7, margem_pct: 15, dias_base: 25, total_fazer: 108,
    itens: [
      { produto_id: 1, nome: "Brownie Brigadeiro", ordem: 1, ficha_id: 10, rend: 1, fonte: "vendas", venda_dia: 10.56, dias_hist: 25, vendeu_hist: 264, zerou: 0,
        meta_semana: null, validade_dias: null, cobertura: 7, extra: 0, alvo: 86, expositora: 15, freezer: 0, falta: 71, fazer: 71 },
      { produto_id: 2, nome: "Bolo Gelado Supreme", ordem: 2, ficha_id: null, rend: 36, fonte: "vendas", venda_dia: 9.08, dias_hist: 25, vendeu_hist: 227, zerou: 0,
        meta_semana: null, validade_dias: null, cobertura: 7, extra: 0, alvo: 74, expositora: 27, freezer: 49, falta: 0, fazer: 0 },
      { produto_id: 3, nome: "Pudim", ordem: 3, ficha_id: 11, rend: 1, fonte: "sem", venda_dia: 0, dias_hist: 0, vendeu_hist: 0, zerou: 0,
        meta_semana: null, validade_dias: null, cobertura: 7, extra: 0, alvo: 0, expositora: 0, freezer: 0, falta: 0, fazer: 0 },
      { produto_id: 4, nome: "Coxinha", ordem: 4, ficha_id: 11, rend: 1, fonte: "meta", venda_dia: 5.71, dias_hist: 2, vendeu_hist: 9, zerou: 0,
        meta_semana: 40, validade_dias: null, cobertura: 7, extra: 0, alvo: 46, expositora: 9, freezer: 0, falta: 37, fazer: 37 }
    ],
    bases: [
      { subreceita_id: 20, nome: "Massa Brownie", unidade_producao: "massa", rendimento_kg: 2.5, kg: 5.68, lotes: 2.27, lotes_fazer: 2.5, para: "Brownie Brigadeiro" },
      { subreceita_id: 21, nome: "Creme de Ninho", unidade_producao: "panela", rendimento_kg: 1, kg: 0.4, lotes: 0.4, lotes_fazer: 0.5, para: "Brownie Brigadeiro" }
    ]
  };
  return db;
};

test("Jessica vê Quanto fazer na Home com o resumo da conta e abre a tela", async () => {
  const a = await abrir("uJes", { db: conta });
  assert.equal(await a.visivel("btnQuanto"), true);
  assert.match(await a.texto("#qfSub"), /Faltam 108 doces para os próximos 7 dias/);
  await a.page.click("#btnQuanto"); await a.espera(400);
  assert.equal(await a.tela(), "scQuanto");
  assert.equal(await a.titulo(), "Quanto fazer");
  assert.match(await a.texto("#qfTotal"), /108 doces/);
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#qfCorpo .qf-item")].map(r => [r.querySelector(".n").firstChild.textContent, r.querySelector(".qt").textContent]));
  assert.deepEqual(linhas[0], ["Brownie Brigadeiro", "71"], "o que mais precisa vem primeiro");
  assert.deepEqual(linhas[1], ["Coxinha", "37"]);
  assert.ok(linhas.some(l => l[0] === "Bolo Gelado Supreme" && l[1] === "ok"), "geladeira e freezer cobrem: ok");
  const det = await a.page.evaluate(() => [...document.querySelectorAll("#qfCorpo .qf-item small")].map(s => s.textContent));
  assert.match(det[0], /vende 10,6 por dia · tem 15 na geladeira · precisa de 86 para 7 dias/);
  assert.match(det[1], /doce novo: usando sua meta de 40 por semana \(2 dias de venda até agora\)/);
  assert.ok(det.some(d => /tem 27 na geladeira e 49 no freezer/.test(d) && /sem ficha técnica/.test(d)));
  assert.ok(det.some(d => /sem venda registrada: toque e digite a meta da semana/.test(d)));
  const bases = await a.page.evaluate(() => [...document.querySelectorAll("#qfCorpo .qf-base .qt")].map(e => e.textContent));
  assert.deepEqual(bases, ["2,5 massas", "meia panela"]);
  semErros(a); await a.fechar();
});

test("Yasmin e Eliana não veem Quanto fazer e o app nem pede a conta", async () => {
  for(const uid of ["uYas", "uEli"]){
    const a = await abrir(uid, { db: conta });
    assert.equal(await a.visivel("btnQuanto"), false, uid);
    assert.equal((await a.log("rpc")).filter(r => r[1] === "jb_quanto_fazer").length, 0, uid);
    semErros(a); await a.fechar();
  }
});

test("trocar os dias e a folga refaz a conta e guarda para os dois donos", async () => {
  const a = await abrir("uJes", { db: conta });
  await a.page.click("#btnQuanto"); await a.espera(400);
  await a.page.locator("#qfDias button", { hasText: /^4 dias$/ }).click(); await a.espera(300);
  let rpcs = (await a.log("rpc")).filter(r => r[1] === "jb_quanto_fazer");
  assert.deepEqual(rpcs[rpcs.length - 1][2], { p_dias: 4, p_margem_pct: 15 });
  assert.equal((await a.db("jb_quanto_param"))[0].dias, 4);
  assert.equal(await a.page.locator("#qfDias button[aria-pressed='true']").textContent(), "4 dias");
  await a.page.locator("#qfFolga button", { hasText: "25%" }).click(); await a.espera(300);
  rpcs = (await a.log("rpc")).filter(r => r[1] === "jb_quanto_fazer");
  assert.deepEqual(rpcs[rpcs.length - 1][2], { p_dias: 4, p_margem_pct: 25 });
  assert.equal((await a.db("jb_quanto_param"))[0].margem_pct, 25);
  semErros(a); await a.fechar();
});

test("tocar num doce abre meta e validade; salvar grava e refaz a conta", async () => {
  const a = await abrir("uJes", { db: conta });
  await a.page.click("#btnQuanto"); await a.espera(400);
  await a.page.click("#qfCorpo .qf-item[data-pid='3']"); await a.espera(200);
  await a.page.fill("#qfMeta", "60");
  await a.page.fill("#qfValidade", "4");
  const antes = (await a.log("rpc")).filter(r => r[1] === "jb_quanto_fazer").length;
  await a.page.click("#qfSalvarMeta"); await a.espera(400);
  const up = (await a.log("upsert")).find(u => u[1] === "jb_quanto_meta");
  assert.equal(up[2].produto_id, 3); assert.equal(up[2].meta_semana, 60); assert.equal(up[2].validade_dias, 4);
  assert.deepEqual(up[3], { onConflict: "produto_id" });
  assert.ok((await a.log("rpc")).filter(r => r[1] === "jb_quanto_fazer").length > antes, "refez a conta");
  assert.match(await a.texto("#qfMsg"), /Pudim: guardado/);
  assert.equal(await a.page.locator("#qfMeta").count(), 0, "editor fecha depois de salvar");
  semErros(a); await a.fechar();
});

test("validade zero ou meta absurda não grava", async () => {
  const a = await abrir("uJes", { db: conta });
  await a.page.click("#btnQuanto"); await a.espera(400);
  await a.page.click("#qfCorpo .qf-item[data-pid='3']"); await a.espera(200);
  await a.page.fill("#qfValidade", "0");
  await a.page.click("#qfSalvarMeta"); await a.espera(300);
  assert.equal((await a.log("upsert")).filter(u => u[1] === "jb_quanto_meta").length, 0);
  assert.match(await a.texto("#qfMsg"), /Confira os números/);
  semErros(a); await a.fechar();
});

test("mandar para o plano: massas e recheios num dia em kg, montagem em outro em unidades, sem duplicar", async () => {
  const hoje = hojeSP();
  const quinta = diaMais(hoje, 2), sexta = diaMais(hoje, 3);
  const a = await abrir("uJes", { db: db => {
    conta(db);
    // a massa de brownie já estava no plano da quinta
    db.jb_producao_item.push({ id: 900, data: quinta, tipo: "subreceita", ref_id: 20, qtd: 2.5, feito: false, para: "producao" });
    return db;
  } });
  await a.page.click("#btnQuanto"); await a.espera(400);
  await a.page.locator("#qfDiaBases button").nth(2).click(); await a.espera(150);
  await a.page.locator("#qfDiaMonta button").nth(3).click(); await a.espera(150);
  await a.page.click("#qfMandar"); await a.espera(600);
  assert.equal(a.confirms.length, 1, "pergunta antes de trocar o que já estava");
  assert.match(a.confirms[0], /1 receita já estava no plano/);
  const itens = await a.db("jb_producao_item");
  const massa = itens.filter(i => i.data === quinta && i.tipo === "subreceita" && i.ref_id === 20);
  assert.equal(massa.length, 1, "não duplica a massa");
  assert.equal(massa[0].qtd, 6.25, "2,5 massas de 2,5 kg");
  const creme = itens.find(i => i.data === quinta && i.tipo === "subreceita" && i.ref_id === 21);
  assert.equal(creme.qtd, 0.5); assert.equal(creme.para, "producao");
  const brownie = itens.find(i => i.data === sexta && i.tipo === "ficha" && i.ref_id === 10);
  assert.equal(brownie.qtd, 71); assert.equal(brownie.para, "todos");
  assert.ok(!itens.some(i => i.tipo === "ficha" && i.ref_id === null), "doce sem ficha fica de fora");
  assert.match(await a.texto("#qfMsg"), /No plano: 2 massas e recheios .* e 2 doces para montar/);
  semErros(a); await a.fechar();
});

test("conta recusada pelo banco mostra recado em vez de tela vazia", async () => {
  const a = await abrir("uJes", { db: conta, falha: { "rpc:jb_quanto_fazer": true } });
  assert.match(await a.texto("#qfSub"), /A conta da semana/);
  await a.page.click("#btnQuanto"); await a.espera(400);
  assert.match(await a.texto("#qfMsg"), /Não consegui fazer a conta agora/);
  semErros(a); await a.fechar();
});
