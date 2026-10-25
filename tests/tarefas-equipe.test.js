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
