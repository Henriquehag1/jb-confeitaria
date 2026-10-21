const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* freelas que já foram liberadas: os nomes viram opção no seletor */
const comFreelas = db => {
  db.jb_freela_acesso = [
    { id: 7, nome: "Ana", valido_de: "2026-10-01T10:00:00Z", valido_ate: "2026-10-01T20:00:00Z", criado_em: "2026-10-01T10:00:00Z", encerrado_em: null },
    { id: 8, nome: "maria ", valido_de: "2026-10-02T10:00:00Z", valido_ate: "2026-10-02T20:00:00Z", criado_em: "2026-10-02T10:00:00Z", encerrado_em: null }
  ];
  return db;
};

test("gestor manda um item só para uma freela pelo nome e ele some para a Eliana", async () => {
  const a = await abrir("uJes", { db: comFreelas });
  await a.page.click("#btnProducao"); await a.espera(700);
  const opcoes = await a.page.evaluate(() => [...document.querySelector("#prodLista select.para").options].map(o => o.textContent));
  assert.ok(opcoes.includes("só as freelas do dia"));
  assert.ok(opcoes.includes("só Ana (freela)"));
  assert.ok(opcoes.includes("só maria (freela)"), "nome limpo de espaço: " + JSON.stringify(opcoes));
  assert.ok(opcoes.includes("Outra freela..."));
  // a massa de brownie (produção) vai só para a Ana
  await a.page.evaluate(() => {
    const s = [...document.querySelectorAll("#prodLista select.para")].find(x => x.value === "producao");
    s.value = "fr:Ana"; s.dispatchEvent(new Event("change"));
  });
  await a.espera(400);
  const massa = (await a.db("jb_producao_item")).find(p => p.id === 2);
  assert.equal(massa.para_freela, "Ana"); assert.equal(massa.para, "todos");
  assert.match(await a.texto("#prodMsg"), /agora aparece para Ana \(freela\)/);
  semErros(a); await a.fechar();

  const e = await abrir("uEli", { db: db => { comFreelas(db); db.jb_producao_item.find(p => p.id === 2).para_freela = "Ana"; return db; } });
  await e.page.click("#btnProducao"); await e.espera(600);
  const nomes = await e.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(x => x.childNodes[0].textContent.trim()));
  assert.ok(!nomes.some(n => /Massa Brownie/.test(n)), "a Eliana não vê o que é da freela: " + JSON.stringify(nomes));
  semErros(e); await e.fechar();
});

test("Outra freela...: digita o nome e grava", async () => {
  const a = await abrir("uJes", { db: comFreelas });
  await a.page.click("#btnProducao"); await a.espera(700);
  await a.page.evaluate(() => {
    const s = [...document.querySelectorAll("#prodLista select.para")].find(x => x.value === "todos");
    s.value = "fr:?"; s.dispatchEvent(new Event("change"));
  });
  await a.espera(150);
  await a.page.fill("input.nomefreela", "  Bia  ");
  await a.page.press("input.nomefreela", "Enter"); await a.espera(400);
  const it = (await a.db("jb_producao_item")).find(p => p.id === 1);
  assert.equal(it.para_freela, "Bia");
  assert.equal(await a.page.locator("input.nomefreela").count(), 0);
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
      { id: 2, data: HOJE, tipo: "subreceita", ref_id: 20, qtd: 5, feito: false, obs: "mais firme", para: "todos", para_freela: "ana" },
      { id: 3, data: HOJE, tipo: "ficha", ref_id: 11, qtd: 5, feito: false, obs: null, para: "todos", para_freela: "Bia" },
      { id: 4, data: HOJE, tipo: "subreceita", ref_id: 21, qtd: 1, feito: false, obs: null, para: "producao", para_freela: null }
    ];
    if(montar) montar(db);
    return db;
  } });

test("a freela vê O que fazer hoje só com o que é dela ou de todos, abre a receita e marca feito", async () => {
  const a = await abrir(null, freelaAna());
  assert.equal(await a.tela(), "scHome");
  assert.equal(await a.visivel("btnProducao"), true);
  assert.match(await a.texto("#btnProducao .t"), /O que fazer hoje/);
  await a.page.click("#btnProducao"); await a.espera(600);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(x => x.childNodes[0].textContent.trim()));
  assert.deepEqual(nomes.sort(), ["Brownie Brigadeiro", "Massa Brownie"], "vê o dela e o de todos: " + JSON.stringify(nomes));
  assert.equal(await a.page.locator("#prodLista select.para").count(), 0, "freela não escolhe destino");
  // abre a massa, que está em 2 massas de 2,5 kg
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Massa Brownie/.test(e.textContent)).click());
  await a.espera(500);
  assert.equal(await a.tela(), "scReceita");
  assert.match(await a.texto("#recCorpo .rendebox"), /2 massas/);
  assert.match(await a.texto("#recCorpo"), /Recado: mais firme/);
  assert.match(await a.texto("#recCorpo"), /Chocolate 50%/);
  await a.page.click("#btnRecFeito"); await a.espera(600);
  const r = (await a.log("rpc")).find(x => x[1] === "jb_freela_marcar");
  assert.equal(r[2].p_id, 2); assert.equal(r[2].p_feito, true); assert.equal(r[2].p_token, TOKEN);
  const salvo = (await a.db("jb_producao_item")).find(p => p.id === 2);
  assert.equal(salvo.feito, true); assert.equal(salvo.feito_por, "Ana (freela)");
  assert.equal(await a.tela(), "scProd");
  assert.match(await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod")].find(r => /Massa Brownie/.test(r.textContent)).textContent), /Feito às .* por Ana \(freela\)/);
  semErros(a); await a.fechar();
});

test("a freela abre a receita do doce de todos com a massa dentro", async () => {
  const a = await abrir(null, freelaAna());
  await a.page.click("#btnProducao"); await a.espera(600);
  await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Brownie Brigadeiro/.test(e.textContent)).click());
  await a.espera(500);
  assert.equal(await a.tela(), "scReceita");
  assert.match(await a.texto("#recCorpo"), /Massa Brownie/);
  semErros(a); await a.fechar();
});

/* ---------- Quanto fazer: para quem vai cada coisa ---------- */
const conta = db => {
  comFreelas(db);
  db.jb_quanto_param = [{ id: 1, dias: 7, margem_pct: 15 }];
  db.__quanto = { hoje: hojeSP(), dias: 7, margem_pct: 15, dias_base: 25, total_fazer: 71,
    itens: [{ produto_id: 1, nome: "Brownie Brigadeiro", ordem: 1, ficha_id: 10, rend: 1, fonte: "vendas", venda_dia: 10.5, dias_hist: 25, zerou: 0,
              cobertura: 7, extra: 0, alvo: 86, expositora: 15, freezer: 0, falta: 71, fazer: 71 }],
    bases: [{ subreceita_id: 20, nome: "Massa Brownie", unidade_producao: "massa", rendimento_kg: 2.5, kg: 5.68, lotes: 2.27, lotes_fazer: 2.5, para: "Brownie Brigadeiro" },
            { subreceita_id: 21, nome: "Creme de Ninho", unidade_producao: "panela", rendimento_kg: 1, kg: 0.4, lotes: 0.4, lotes_fazer: 0.5, para: "Brownie Brigadeiro" }] };
  db.jb_producao_item = [];
  return db;
};

test("Quanto fazer: massas para as freelas do dia, doces para a Ana e um recheio trocado para a Yasmin", async () => {
  const a = await abrir("uJes", { db: conta });
  await a.page.click("#btnQuanto"); await a.espera(500);
  await a.page.selectOption("#qfDestBases", "fr:*");
  await a.page.selectOption("#qfDestDoces", "fr:Ana");
  await a.page.click("#qfVerItens"); await a.espera(200);
  await a.page.selectOption("#qfDestItens .qf-dest-item[data-chave='subreceita:21'] select", "equipe");
  await a.page.click("#qfMandar"); await a.espera(700);
  const it = await a.db("jb_producao_item");
  const massa = it.find(p => p.tipo === "subreceita" && p.ref_id === 20);
  const creme = it.find(p => p.tipo === "subreceita" && p.ref_id === 21);
  const doce  = it.find(p => p.tipo === "ficha" && p.ref_id === 10);
  assert.deepEqual([massa.para, massa.para_freela], ["todos", "*"]);
  assert.deepEqual([creme.para, creme.para_freela], ["equipe", null]);
  assert.deepEqual([doce.para, doce.para_freela, doce.qtd], ["todos", "Ana", 71]);
  const msg = await a.texto("#qfMsg");
  assert.match(msg, /as freelas do dia/); assert.match(msg, /Yasmin/); assert.match(msg, /Ana \(freela\)/);
  assert.match(await a.texto("#qfMsg"), /O que fazer hoje/);
  semErros(a); await a.fechar();
});

test("com a lista de freelas da casa, o seletor mostra só ela; Outra freela entra na lista", async () => {
  const a = await abrir("uJes", { db: db => { comFreelas(db);
    db.jb_freela_pessoa = [{ id: 1, nome: "Markus Porthos", ativo: true }, { id: 2, nome: "Edclecia Silva", ativo: true },
                           { id: 3, nome: "Isabella Freitas", ativo: true }, { id: 4, nome: "Antiga", ativo: false }];
    return db; } });
  await a.page.click("#btnProducao"); await a.espera(700);
  const opcoes = await a.page.evaluate(() => [...document.querySelector("#prodLista select.para").querySelectorAll("optgroup option")].map(o => o.textContent));
  assert.deepEqual(opcoes, ["só as freelas do dia", "só Edclecia Silva (freela)", "só Isabella Freitas (freela)", "só Markus Porthos (freela)", "Outra freela..."]);
  await a.page.evaluate(() => {
    const s = [...document.querySelectorAll("#prodLista select.para")].find(x => x.value === "todos");
    s.value = "fr:?"; s.dispatchEvent(new Event("change"));
  });
  await a.espera(150);
  await a.page.fill("input.nomefreela", "Bia Souza");
  await a.page.press("input.nomefreela", "Enter"); await a.espera(400);
  const ins = (await a.log("insert")).find(x => x[1] === "jb_freela_pessoa");
  assert.deepEqual(ins[2], [{ nome: "Bia Souza" }]);
  assert.equal((await a.db("jb_producao_item")).find(p => p.id === 1).para_freela, "Bia Souza");
  semErros(a); await a.fechar();
});
