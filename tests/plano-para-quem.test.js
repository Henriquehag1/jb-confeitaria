const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* freelas que já foram liberadas: sem lista da casa, os nomes delas viram opção */
const comFreelas = db => {
  db.jb_freela_acesso = [
    { id: 7, nome: "Ana", valido_de: "2026-10-01T10:00:00Z", valido_ate: "2026-10-01T20:00:00Z", criado_em: "2026-10-01T10:00:00Z", encerrado_em: null },
    { id: 8, nome: "maria ", valido_de: "2026-10-02T10:00:00Z", valido_ate: "2026-10-02T20:00:00Z", criado_em: "2026-10-02T10:00:00Z", encerrado_em: null }
  ];
  return db;
};
const casa = db => { comFreelas(db);
  db.jb_freela_pessoa = [{ id: 1, nome: "Markus Porthos", ativo: true }, { id: 2, nome: "Edclecia Silva", ativo: true },
                         { id: 3, nome: "Isabella Freitas", ativo: true }, { id: 4, nome: "Antiga", ativo: false }];
  return db; };
const chips = (a, id) => a.page.evaluate(i => [...document.querySelectorAll("#" + i + " .quem-chip")].map(c => c.textContent), id);

test("gestor manda um item só para uma freela e ele some para a Eliana", async () => {
  const a = await abrir("uJes", { db: comFreelas });
  await a.page.click("#btnProducao"); await a.espera(700);
  await a.page.locator("#prodLista .para-quem", { hasText: "Eliana" }).click(); await a.espera(200);
  assert.deepEqual(await chips(a, "quemItem2"), ["Todos", "Eliana", "Yasmin", "Freelas do dia", "Ana", "maria", "+ Pessoa nova"]);
  await a.page.click("#quemItem2 .quem-chip[data-q='fr:Ana']"); await a.espera(300);
  await a.page.click("#quemItem2 .quem-chip[data-q='producao']"); await a.espera(300);
  const massa = (await a.db("jb_producao_item")).find(p => p.id === 2);
  assert.deepEqual(massa.quem, ["fr:Ana"]);
  assert.equal(massa.para_freela, "Ana"); assert.equal(massa.para, "todos");
  assert.match(await a.texto("#prodMsg"), /agora aparece para Ana/);
  semErros(a); await a.fechar();

  const e = await abrir("uEli", { db: db => { comFreelas(db); Object.assign(db.jb_producao_item.find(p => p.id === 2), { quem: ["fr:Ana"], para: "todos", para_freela: "Ana" }); return db; } });
  await e.page.click("#btnProducao"); await e.espera(600);
  const nomes = await e.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(x => x.childNodes[0].textContent.trim()));
  assert.ok(!nomes.some(n => /Massa Brownie/.test(n)), "a Eliana não vê o que é da freela: " + JSON.stringify(nomes));
  semErros(e); await e.fechar();
});

test("com a lista de freelas da casa, as opções são ela; pessoa nova entra na lista", async () => {
  const a = await abrir("uJes", { db: casa });
  await a.page.click("#btnProducao"); await a.espera(700);
  await a.page.locator("#prodLista .para-quem", { hasText: "todo mundo" }).click(); await a.espera(200);
  assert.deepEqual(await chips(a, "quemItem1"), ["Todos", "Eliana", "Yasmin", "Freelas do dia", "Edclecia Silva", "Isabella Freitas", "Markus Porthos", "+ Pessoa nova"]);
  await a.page.click("#quemItem1 .quem-chip.nova"); await a.espera(150);
  await a.page.fill("#quemItem1 input.nomefreela", "  Bia   Souza ");
  await a.page.press("#quemItem1 input.nomefreela", "Enter"); await a.espera(400);
  const ins = (await a.log("insert")).find(x => x[1] === "jb_freela_pessoa");
  assert.deepEqual(ins[2], [{ nome: "Bia Souza" }]);
  assert.deepEqual((await a.db("jb_producao_item")).find(p => p.id === 1).quem, ["fr:Bia Souza"]);
  semErros(a); await a.fechar();
});

/* ---------- a freela no celular dela ---------- */
const AGORA = "2026-10-08T17:30:00Z";          // 14:30 em São Paulo
const HOJE  = "2026-10-08";
const TOKEN = "tok" + "x".repeat(40) + "1";
const freelaAna = montar => ({ agora: AGORA, semSessao: true, storage: { jb_freela_token: TOKEN },
  db: db => {
    db.jb_freela_acesso = [{ id: 1, nome: "Ana", valido_de: "2026-10-08T11:00:00Z", valido_ate: "2026-10-09T09:00:00Z", codigo: "482913", erros: 0,
      token: TOKEN, token_em: "2026-10-08T11:05:00Z", criado_por: "uJes", criado_em: "2026-10-08T11:00:00Z", encerrado_em: null, encerrado_por: null }];
    db.jb_producao_item = [
      { id: 1, data: HOJE, tipo: "ficha", ref_id: 10, qtd: 48, feito: false, obs: null, para: "todos", para_freela: null },
      { id: 2, data: HOJE, tipo: "subreceita", ref_id: 20, qtd: 5, feito: false, obs: "mais firme", para: "todos", quem: ["fr:ana", "fr:Bia"] },
      { id: 3, data: HOJE, tipo: "ficha", ref_id: 11, qtd: 5, feito: false, obs: null, para: "todos", quem: ["fr:Bia"] },
      { id: 4, data: HOJE, tipo: "subreceita", ref_id: 21, qtd: 1, feito: false, obs: null, para: "producao", para_freela: null }
    ];
    if(montar) montar(db);
    return db;
  } });

test("a freela vê só o que é dela ou de todos, abre a receita e registra quanto fez", async () => {
  const a = await abrir(null, freelaAna());
  assert.equal(await a.tela(), "scHome");
  assert.equal(await a.visivel("btnProducao"), true);
  await a.page.click("#btnProducao"); await a.espera(600);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(x => x.childNodes[0].textContent.trim()));
  assert.deepEqual(nomes.sort(), ["Brownie Brigadeiro", "Massa Brownie"], "vê o dela e o de todos: " + JSON.stringify(nomes));
  assert.match(await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)).textContent), /junto com Bia/);
  assert.equal(await a.page.locator("#prodLista .para-quem").count(), 0, "freela não escolhe destino");
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Massa Brownie/.test(e.textContent)).click());
  await a.espera(500);
  assert.equal(await a.tela(), "scReceita");
  assert.match(await a.texto("#recCorpo .rendebox"), /2 massas/);
  assert.match(await a.texto("#recCorpo"), /Recado: mais firme/);
  assert.match(await a.texto("#recProgresso"), /Pedido: 2 massas · junto com Bia/);
  assert.equal(await a.page.inputValue("#recFez"), "2", "sugere o pedido");
  assert.match(await a.texto("#btnRecFeito"), /Registrar o que fiz/);
  // fez só 1,5 massa
  await a.page.fill("#recFez", "1,5");
  await a.page.click("#btnRecFeito"); await a.espera(600);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_freela_registrar");
  assert.equal(r[2].p_id, 2); assert.equal(r[2].p_qtd, 3.75, "1,5 massa de 2,5 kg"); assert.equal(r[2].p_token, TOKEN);
  let it = (await a.db("jb_producao_item")).find(p => p.id === 2);
  assert.equal(it.feito, false, "a Bia ainda não registrou");
  assert.equal(await a.tela(), "scProd");
  assert.match(await a.texto("#prodMsg"), /registrei 1,5 massas\. Ainda faltam meia massa/);
  assert.match(await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)).textContent), /Até agora: 1,5 massas de 2 massas · Ana 1,5 massas/);
  // corrigir: abrir de novo mostra o número dela
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Massa Brownie/.test(e.textContent)).click());
  await a.espera(500);
  assert.equal(await a.page.inputValue("#recFez"), "1,5");
  assert.match(await a.texto("#btnRecFeito"), /Corrigir o que fiz/);
  semErros(a); await a.fechar();
});

test("quando todas as pessoas do item registram, ele fecha mesmo com menos; fez a mais aparece", async () => {
  const a = await abrir(null, freelaAna(db => {
    db.jb_producao_registro = [{ id: 1, item_id: 2, nome: "Bia", qtd: 2.5, criado_em: "2026-10-08T16:00:00Z", atualizado_em: "2026-10-08T16:00:00Z" }];
  }));
  await a.page.click("#btnProducao"); await a.espera(600);
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Massa Brownie/.test(e.textContent)).click());
  await a.espera(500);
  assert.equal(await a.page.inputValue("#recFez"), "1", "sugere o que falta: 1 massa");
  await a.page.fill("#recFez", "0,5");
  await a.page.click("#btnRecFeito"); await a.espera(600);
  const it = (await a.db("jb_producao_item")).find(p => p.id === 2);
  assert.equal(it.feito, true, "Ana e Bia registraram");
  assert.match(await a.texto("#prodMsg"), /Item fechado com meia massa a menos que o pedido/);
  assert.match(await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)).textContent), /Feito: 1,5 massas de 2 massas \(meia massa a menos\) · Bia 1 massa, Ana meia massa/);
  // doce de todos: fez a mais fecha e mostra
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Brownie Brigadeiro/.test(e.textContent)).click());
  await a.espera(500);
  await a.page.fill("#recFez", "52");
  await a.page.click("#btnRecFeito"); await a.espera(600);
  assert.match(await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Brownie Brigadeiro/.test(r.textContent)).textContent), /Feito: 52 un de 48 un \(4 un a mais\) · Ana 52 un/);
  semErros(a); await a.fechar();
});

test("Eliana registra o que fez no item dela e da freela; o gestor vê quem fez quanto", async () => {
  const e = await abrir("uEli", { db: db => { Object.assign(db.jb_producao_item.find(p => p.id === 2), { quem: ["producao", "fr:Ana"] }); return db; } });
  await e.page.click("#btnProducao"); await e.espera(600);
  await e.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(x => /Massa Brownie/.test(x.textContent)).click());
  await e.espera(500);
  await e.page.fill("#recFez", "1");
  await e.page.click("#btnRecFeito"); await e.espera(600);
  const r = (await e.log("rpc")).find(x => x[1] === "jb_producao_registrar");
  assert.equal(r[2].p_qtd, 2.5);
  const reg = await e.db("jb_producao_registro");
  assert.deepEqual(reg.map(x => [x.nome, x.qtd]), [["Eliana", 2.5]]);
  semErros(e); await e.fechar();

  const j = await abrir("uJes", { db: db => {
    Object.assign(db.jb_producao_item.find(p => p.id === 2), { quem: ["producao", "fr:Ana"] });
    db.jb_producao_registro = [{ id: 1, item_id: 2, nome: "Eliana", qtd: 2.5, atualizado_em: "2026-10-08T16:00:00Z" }];
    return db; } });
  await j.page.click("#btnProducao"); await j.espera(700);
  const linha = await j.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)));
  assert.ok(linha);
  assert.match(await j.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)).querySelector(".n small").textContent), /Até agora: 1 massa de 1,2 massas · Eliana 1 massa/);
  assert.match(await j.page.evaluate(() => [...document.querySelectorAll("#prodLista .para-quem")].map(b => b.textContent).join("|")), /Para: Eliana e Ana/);
  semErros(j); await j.fechar();
});

/* ---------- home e liberação ---------- */
test("Home do gestor tem Liberar freela: abre o formulário com as freelas da casa e Nova pessoa", async () => {
  const a = await abrir("uJes", { db: casa });
  assert.equal(await a.visivel("btnFreelaHoje"), true);
  assert.match(await a.texto("#frHojeSub"), /Escolha quem vem hoje/);
  await a.page.click("#btnFreelaHoje"); await a.espera(800);
  assert.equal(await a.tela(), "scDias");
  assert.equal(await a.visivel("frAcForm"), true);
  const ops = await a.page.evaluate(() => [...document.querySelectorAll("#frAcNomeSel option")].map(o => o.textContent));
  assert.deepEqual(ops, ["Escolha a freela", "Edclecia Silva", "Isabella Freitas", "Markus Porthos", "Nova pessoa..."]);
  await a.page.selectOption("#frAcNomeSel", "Markus Porthos"); await a.espera(150);
  await a.page.click("#frAcSalvar"); await a.espera(600);
  let rows = await a.db("jb_freela_acesso");
  assert.equal(rows[rows.length - 1].nome, "Markus Porthos");
  await a.page.locator("#frAcesso button", { hasText: "Pronto" }).click(); await a.espera(200);
  // segunda freela, pessoa nova
  await a.page.click("#frAcAbre"); await a.espera(150);
  await a.page.selectOption("#frAcNomeSel", "__nova"); await a.espera(150);
  await a.page.fill("#frAcNome", "Carla Dias");
  await a.page.click("#frAcSalvar"); await a.espera(600);
  rows = await a.db("jb_freela_acesso");
  assert.deepEqual(rows.filter(r => !r.encerrado_em).map(r => r.nome).filter(n => n !== "Ana" && n !== "maria ").sort(), ["Carla Dias", "Markus Porthos"]);
  assert.ok((await a.log("insert")).some(x => x[1] === "jb_freela_pessoa" && x[2][0].nome === "Carla Dias"), "pessoa nova entra na lista");
  semErros(a); await a.fechar();
});

test("Yasmin e Eliana não veem Liberar freela", async () => {
  for(const uid of ["uYas", "uEli"]){
    const a = await abrir(uid);
    assert.equal(await a.visivel("btnFreelaHoje"), false, uid);
    semErros(a); await a.fechar();
  }
});

/* ---------- conferência: o dono vê como a freela vê ---------- */
const comPlanoMarkus = db => { casa(db);
  db.jb_producao_item = [
    { id: 1, data: db.jb_producao_item[0].data, tipo: "ficha", ref_id: 10, qtd: 48, feito: false, obs: "capricha", para: "todos", quem: ["fr:Markus Porthos"] },
    { id: 2, data: db.jb_producao_item[0].data, tipo: "subreceita", ref_id: 20, qtd: 3, feito: false, obs: null, para: "producao", quem: ["producao"] }
  ];
  db.jb_freela_acesso.push({ id: 20, nome: "Markus Porthos", valido_de: new Date(Date.now() - 3600e3).toISOString(), valido_ate: new Date(Date.now() + 5 * 3600e3).toISOString(),
    codigo: "111222", erros: 0, token: "tok" + "m".repeat(40), token_em: new Date(Date.now() - 600e3).toISOString(), criado_em: new Date().toISOString(), encerrado_em: null });
  return db; };

test("Jessica confere o app como o Markus vê, sem salvar nada, e volta para o dela", async () => {
  const a = await abrir("uJes", { db: comPlanoMarkus });
  await a.page.click("#btnDias"); await a.espera(600);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#frAcConf .quem-chip")].map(b => b.textContent));
  assert.deepEqual(nomes, ["Edclecia Silva", "Isabella Freitas", "Markus Porthos"]);
  await a.page.click("#frAcConf .quem-chip[data-nome='Markus Porthos']"); await a.espera(800);
  assert.equal(await a.tela(), "scHome");
  const barra = () => a.page.evaluate(() => !document.getElementById("espiaoBar").classList.contains("hide"));
  assert.equal(await barra(), true, "a faixa de conferência aparece (fixa no rodapé)");
  assert.match(await a.texto("#espiaoTx"), /vendo o app como Markus Porthos\. Nada é salvo/);
  assert.equal(await a.texto("#whoName"), "Markus Porthos");
  assert.equal(await a.visivel("btnCustos"), false, "nada do gestor aparece");
  await a.page.click("#btnProducao"); await a.espera(600);
  const itens = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(x => x.childNodes[0].textContent.trim()));
  assert.deepEqual(itens, ["Brownie Brigadeiro"], "só o que é dele");
  await a.page.evaluate(() => document.querySelector("#prodLista .prod .n").click()); await a.espera(500);
  assert.match(await a.texto("#recCorpo"), /Recado: capricha/);
  await a.page.click("#btnRecFeito"); await a.espera(400);
  assert.equal((await a.log("rpc")).filter(x => x[1] === "jb_producao_registrar" || x[1] === "jb_freela_registrar").length, 0, "não grava nada");
  assert.equal((await a.db("jb_producao_registro") || []).length, 0);
  // sair volta para a Jessica
  await a.page.click("#espiaoSair"); await a.espera(700);
  assert.equal(await barra(), false);
  assert.equal(await a.texto("#whoName"), "Jessica");
  assert.equal(await a.visivel("btnCustos"), true);
  semErros(a); await a.fechar();
});

test("soltar o celular: o mesmo código volta a valer para a freela", async () => {
  const a = await abrir("uJes", { db: comPlanoMarkus });
  await a.page.click("#btnDias"); await a.espera(600);
  const linha = "#frAcLista .fr-ac-linha[data-id='20']";
  await a.page.click(linha + " .fr-ac-solta"); await a.espera(150);
  await a.page.click(linha + " .fr-ac-solta"); await a.espera(500);
  const ac = (await a.db("jb_freela_acesso")).find(x => x.id === 20);
  assert.equal(ac.token, null); assert.equal(ac.encerrado_em, null, "continua liberado");
  semErros(a); await a.fechar();
  // e o código entra no celular dela
  const f = await abrir(null, { semSessao: true, db: db => { comPlanoMarkus(db); const x = db.jb_freela_acesso.find(y => y.id === 20); x.token = null; x.token_em = null; return db; } });
  await f.page.locator("#pickWho button", { hasText: "Freela" }).click();
  await f.page.fill("#pin", "111222");
  await f.page.click("#btnEntrar"); await f.espera(600);
  assert.equal(await f.texto("#whoName"), "Markus Porthos");
  semErros(f); await f.fechar();
});

test("Yasmin não consegue conferir como freela", async () => {
  const a = await abrir("uYas", { db: comPlanoMarkus });
  const r = await a.page.evaluate(async () => (await sb.rpc("jb_freela_espiar", { p_nome: "Markus Porthos" })).error);
  assert.equal(r.code, "42501");
  semErros(a); await a.fechar();
});
