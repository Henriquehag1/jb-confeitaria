const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const textos = (a) => a.page.evaluate(() => [...document.querySelectorAll("#tarefasEq .tarefa-eq .tf-tx b")].map(b => b.textContent));

test("gestor dá uma tarefa que não é receita para a Yasmin; só ela vê e marca feito", async () => {
  const a = await abrir("uJes");
  assert.match(await a.texto("#btnProducao"), /Tarefas da equipe/);
  await a.page.click("#btnProducao"); await a.espera(700);
  assert.match(await a.texto("#prodLista"), /Produção[\s\S]*Outras tarefas/i);
  assert.ok((await a.page.locator("#prodLista .prod").count()) > 0, "as receitas do plano continuam lá");
  await a.page.fill("#tfTexto", "Dobrar os panos"); await a.page.click("#tfAdd"); await a.espera(500);
  assert.deepEqual(await textos(a), ["Dobrar os panos"]);
  const t = (await a.db("jb_tarefa_equipe"))[0];
  assert.deepEqual(t.quem, ["todos"]); assert.equal(t.data, hojeSP());
  await a.page.locator("#tarefasEq .para-quem").click(); await a.espera(200);
  await a.page.click("#quemTarefa" + t.id + " .quem-chip[data-q='equipe']"); await a.espera(400);
  assert.deepEqual((await a.db("jb_tarefa_equipe"))[0].quem, ["equipe"]);
  /* sugestão pronta com um toque */
  await a.page.locator("#tarefasEq .tf-sug button", { hasText: "Limpar a geladeira" }).click(); await a.espera(500);
  assert.deepEqual(await textos(a), ["Dobrar os panos", "Limpar a geladeira expositora"]);
  semErros(a); await a.fechar();

  const mk = db => { db.jb_tarefa_equipe = [
    { id: 1, data: hojeSP(), texto: "Dobrar os panos", quem: ["equipe"], feito: false },
    { id: 2, data: hojeSP(), texto: "Organizar o estoque", quem: ["producao"], feito: false }]; return db; };
  const y = await abrir("uYas", { db: mk });
  await y.page.click("#btnProducao"); await y.espera(700);
  assert.deepEqual(await textos(y), ["Dobrar os panos"], "a Yasmin vê só a dela");
  await y.page.click("#tarefasEq .tf-ck"); await y.espera(500);
  const feita = (await y.db("jb_tarefa_equipe")).find(x => x.id === 1);
  assert.equal(feita.feito, true); assert.equal(feita.feito_por, "Yasmin");
  assert.match(await y.texto("#tarefasEq"), /Feito às \d\d:\d\d por Yasmin/);
  assert.equal(await y.page.locator("#tarefasEq .para-quem").count(), 0, "equipe não escolhe destino");
  semErros(y); await y.fechar();

  const e = await abrir("uEli", { db: mk });
  await e.page.click("#btnProducao"); await e.espera(700);
  assert.deepEqual(await textos(e), ["Organizar o estoque"]);
  semErros(e); await e.fechar();
});

/* a freela no celular dela */
const AGORA = "2026-10-08T17:30:00Z";
const HOJE = "2026-10-08";
const TOKEN = "tok" + "x".repeat(40) + "1";
test("a freela vê a tarefa dela junto com as receitas e marca feito pelo código", async () => {
  const a = await abrir(null, { agora: AGORA, semSessao: true, storage: { jb_freela_token: TOKEN }, db: db => {
    db.jb_freela_acesso = [{ id: 1, nome: "Ana", valido_de: "2026-10-08T11:00:00Z", valido_ate: "2026-10-09T09:00:00Z", codigo: "482913", erros: 0,
      token: TOKEN, token_em: "2026-10-08T11:05:00Z", criado_por: "uJes", criado_em: "2026-10-08T11:00:00Z", encerrado_em: null, encerrado_por: null }];
    db.jb_producao_item = [{ id: 1, data: HOJE, tipo: "ficha", ref_id: 10, qtd: 48, feito: false, obs: null, para: "todos", para_freela: null }];
    db.jb_tarefa_equipe = [{ id: 7, data: HOJE, texto: "Limpar o freezer", quem: ["fr:Ana"], feito: false },
                           { id: 8, data: HOJE, texto: "Lavar a louça", quem: ["fr:Bia"], feito: false },
                           { id: 9, data: HOJE, texto: "Tirar o lixo", quem: ["freelas"], feito: false }];
    return db; } });
  await a.page.click("#btnProducao"); await a.espera(700);
  assert.ok((await a.page.locator("#prodLista .prod").count()) === 1, "a receita continua");
  assert.deepEqual(await textos(a), ["Limpar o freezer", "Tirar o lixo"]);
  await a.page.click("#tarefasEq .tarefa-eq[data-tarefa='7'] .tf-ck"); await a.espera(600);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_freela_tarefa");
  assert.equal(r[2].p_token, TOKEN); assert.equal(r[2].p_id, 7); assert.equal(r[2].p_feito, true);
  assert.equal((await a.db("jb_tarefa_equipe")).find(x => x.id === 7).feito_por, "Ana");
  assert.match(await a.texto("#tarefasEq"), /Feito às \d\d:\d\d por Ana/);
  semErros(a); await a.fechar();
});

/* 30/10: quem recebeu diz "não deu" (com o motivo) ou deixa um adendo, na receita e na tarefa */
test("a Eliana marca feito pela lista, diz que não deu e deixa adendo; a Jessica lê na lista", async () => {
  const mk = db => {
    const f = db.jb_ficha[0];
    db.jb_producao_item = [
      { id: 31, data: hojeSP(), tipo: "ficha", ref_id: f.id, qtd: 24, feito: false, obs: null, para: "producao", para_freela: null, quem: ["producao"] },
      { id: 32, data: hojeSP(), tipo: "ficha", ref_id: f.id, qtd: 12, feito: false, obs: null, para: "producao", para_freela: null, quem: ["producao"] }];
    db.jb_tarefa_equipe = [{ id: 5, data: hojeSP(), texto: "Assar crocante", quem: ["producao"], feito: false }];
    return db; };
  const e = await abrir("uEli", { db: mk });
  await e.page.click("#btnProducao"); await e.espera(700);
  assert.equal(await e.page.locator("#prodLista .prod .prod-fiz").count(), 2, "cada receita tem Marcar feito");
  assert.equal(await e.page.locator("#tarefasEq .tf-ck").count(), 1, "a tarefa tem o quadradinho");

  /* não deu, com o motivo, na receita 31 */
  await e.page.locator("[data-ret='producao31'] .ret-b.nao").click(); await e.espera(200);
  await e.page.locator("[data-ret='producao31'] .ret-ok").click(); await e.espera(300);
  assert.match(await e.texto("#prodMsg"), /motivo/i, "pede o motivo");
  await e.page.fill("[data-ret='producao31'] textarea", "faltou leite condensado");
  await e.page.locator("[data-ret='producao31'] .ret-ok").click(); await e.espera(600);
  let it = (await e.db("jb_producao_item")).find(x => x.id === 31);
  assert.equal(it.nao_deu, true); assert.equal(it.nota, "faltou leite condensado"); assert.equal(it.nota_por, "Eliana");
  assert.match(await e.texto("[data-ret='producao31']"), /Não deu: faltou leite condensado \(Eliana, \d\d:\d\d\)/);
  assert.equal(it.feito, false, "não deu não mexe no feito");

  /* adendo na tarefa */
  await e.page.locator("[data-ret='tarefa5'] .ret-b.nota").click(); await e.espera(200);
  await e.page.fill("[data-ret='tarefa5'] textarea", "assei 2 assadeiras, a terceira fica para amanhã");
  await e.page.locator("[data-ret='tarefa5'] .ret-ok").click(); await e.espera(600);
  const t = (await e.db("jb_tarefa_equipe"))[0];
  assert.equal(t.nao_deu, false); assert.equal(t.nota, "assei 2 assadeiras, a terceira fica para amanhã");
  assert.match(await e.texto("[data-ret='tarefa5']"), /Adendo: assei 2 assadeiras/);

  /* desfazer o não deu */
  await e.page.locator("[data-ret='producao31'] .ret-b.tirar-ret").click(); await e.espera(600);
  it = (await e.db("jb_producao_item")).find(x => x.id === 31);
  assert.equal(it.nao_deu, false); assert.equal(it.nota, null);

  /* Marcar feito abre a receita no "Quanto você fez?" */
  await e.page.locator("#prodLista .prod .prod-fiz").first().click(); await e.espera(800);
  assert.ok(await e.page.locator("#recFez").isVisible(), "abre direto no quanto fez");
  assert.equal(await e.page.evaluate(() => document.activeElement && document.activeElement.id), "recFez");
  semErros(e); await e.fechar();

  /* a Jessica vê o bilhete na lista e não tem os botões */
  const j = await abrir("uJes", { db: db => { mk(db);
    db.jb_producao_item[1].nao_deu = true; db.jb_producao_item[1].nota = "acabou o gás"; db.jb_producao_item[1].nota_por = "Eliana"; db.jb_producao_item[1].nota_em = new Date().toISOString();
    db.jb_tarefa_equipe[0].nota = "feito pela metade"; db.jb_tarefa_equipe[0].nota_por = "Eliana";
    return db; } });
  await j.page.click("#btnProducao"); await j.espera(700);
  assert.match(await j.texto("#prodLista"), /Não deu: acabou o gás \(Eliana, \d\d:\d\d\)/);
  assert.match(await j.texto("#tarefasEq"), /Adendo: feito pela metade \(Eliana\)/);
  assert.equal(await j.page.locator(".ret-bts, .prod-fiz").count(), 0, "gestor só lê");
  semErros(j); await j.fechar();
});

test("a freela diz que não deu pelo código dela; só no que é dela", async () => {
  const a = await abrir(null, { agora: AGORA, semSessao: true, storage: { jb_freela_token: TOKEN }, db: db => {
    db.jb_freela_acesso = [{ id: 1, nome: "Ana", valido_de: "2026-10-08T11:00:00Z", valido_ate: "2026-10-09T09:00:00Z", codigo: "482913", erros: 0,
      token: TOKEN, token_em: "2026-10-08T11:05:00Z", criado_por: "uJes", criado_em: "2026-10-08T11:00:00Z", encerrado_em: null, encerrado_por: null }];
    db.jb_producao_item = [{ id: 1, data: HOJE, tipo: "ficha", ref_id: 10, qtd: 48, feito: false, obs: null, para: "todos", para_freela: null }];
    db.jb_tarefa_equipe = [{ id: 7, data: HOJE, texto: "Limpar o freezer", quem: ["fr:Ana"], feito: false }];
    return db; } });
  await a.page.click("#btnProducao"); await a.espera(700);
  await a.page.locator("[data-ret='tarefa7'] .ret-b.nao").click(); await a.espera(200);
  await a.page.fill("[data-ret='tarefa7'] textarea", "freezer cheio, não deu para tirar tudo");
  await a.page.locator("[data-ret='tarefa7'] .ret-ok").click(); await a.espera(700);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_freela_retorno");
  assert.equal(r[2].p_token, TOKEN); assert.equal(r[2].p_tipo, "tarefa"); assert.equal(r[2].p_id, 7); assert.equal(r[2].p_nao_deu, true);
  const t = (await a.db("jb_tarefa_equipe"))[0];
  assert.equal(t.nao_deu, true); assert.equal(t.nota_por, "Ana");
  assert.match(await a.texto("[data-ret='tarefa7']"), /Não deu: freezer cheio/);
  /* depois fez: o quadradinho tira o não deu e o bilhete fica */
  await a.page.click("#tarefasEq .tarefa-eq[data-tarefa='7'] .tf-ck"); await a.espera(600);
  const t2 = (await a.db("jb_tarefa_equipe"))[0];
  assert.equal(t2.feito, true); assert.equal(t2.nao_deu, false); assert.equal(t2.nota, "freezer cheio, não deu para tirar tudo");
  assert.match(await a.texto("[data-ret='tarefa7']"), /Adendo: freezer cheio/);
  semErros(a); await a.fechar();
});
