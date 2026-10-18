const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const AGORA = "2026-10-08T23:30:00Z";          // 20:30 de quinta em São Paulo
const HOJE  = "2026-10-08";
const TOKEN = "tok" + "x".repeat(40) + "1";
const janela = (extra = {}) => ({ id: 1, nome: "Ana", valido_de: "2026-10-08T20:00:00Z", valido_ate: "2026-10-09T09:00:00Z",
  codigo: "482913", erros: 0, token: null, token_em: null, criado_por: "uJes", criado_em: "2026-10-08T20:00:00Z", encerrado_em: null, encerrado_por: null, ...extra });
const comAbertura = db => {
  db.jb_contagem.push({ id: 5, data: HOJE, momento: "abertura", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: HOJE + "T19:00:00Z" });
  db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10 }, { contagem_id: 5, produto_id: 2, qtd: 20 }, { contagem_id: 5, produto_id: 3, qtd: 6 });
  return db;
};
const freelaLogada = (extra, montar) => ({ agora: AGORA, semSessao: true, storage: { jb_freela_token: TOKEN },
  db: db => { db.jb_freela_acesso = [janela({ token: TOKEN, token_em: "2026-10-08T21:00:00Z", ...extra })]; comAbertura(db); if(montar) montar(db); return db; } });

async function digitarCodigo(a, codigo){
  await a.page.locator("#pickWho button", { hasText: "Freela" }).click();
  await a.page.fill("#pin", codigo);
  await a.page.click("#btnEntrar"); await a.espera(500);
}

test("login: Freela pede código, não PIN", async () => {
  const a = await abrir(null, { semSessao: true, agora: AGORA });
  await a.page.locator("#pickWho button", { hasText: "Freela" }).click();
  assert.equal(await a.page.getAttribute("#pin", "placeholder"), "Código");
  assert.match(await a.texto("#loginTip"), /código de 6 números que a Jessica mandou/);
  semErros(a); await a.fechar();
});

test("código certo dentro da janela: entra, fica só com a contagem, sem conta de login", async () => {
  const a = await abrir(null, { semSessao: true, agora: AGORA, db: db => { db.jb_freela_acesso = [janela()]; return comAbertura(db); } });
  await digitarCodigo(a, "482913");
  assert.equal(await a.tela(), "scHome");
  assert.deepEqual(await a.log("login"), [], "nenhum login de conta");
  assert.equal(await a.texto("#whoName"), "Ana");
  assert.equal(await a.texto("#homeSub"), "Freela · até 06:00");
  assert.match(await a.texto("#homeTip"), /Seu acesso vale até amanhã às 06:00\./);
  assert.ok(await a.page.evaluate(() => localStorage.getItem("jb_freela_token")), "token guardado no celular");
  assert.equal(await a.visivel("btnFechamento"), true);
  for(const b of ["btnAbertura","btnHist","btnProducao","btnDias","btnPerda","btnPromo","btnCustos","btnResultado","btnContas","btnSaude","btnContador","btnEstoque","btnEncomendas","btnAfazeres"])
    assert.equal(await a.visivel(b), false, b + " escondido");
  assert.deepEqual(await a.page.evaluate(() => [$("cardCheguei").innerHTML, $("cardMeusDias").innerHTML]), ["", ""], "sem Cheguei e sem Meus dias");
  const rpcs = (await a.log("rpc")).map(r => r[1]);
  assert.ok(rpcs.every(n => n.startsWith("jb_freela_")), "só fala com as funções da freela: " + rpcs.join(","));
  assert.ok(!(await a.log("select")).length, "não lê nenhuma tabela direto");
  semErros(a); await a.fechar();
});

test("código errado, bloqueado, em uso ou sem janela: mensagens certas", async () => {
  const casos = [
    [[janela()], "111111", /Código errado/],
    [[janela({ erros: 4 })], "111111", /bloqueado/],
    [[janela({ token: "outro" + "y".repeat(40), token_em: "2026-10-08T21:00:00Z" })], "482913", /já foi usado em outro celular/],
    [[janela({ valido_ate: "2026-10-08T22:00:00Z" })], "482913", /não está liberado agora/],
    [[janela({ encerrado_em: "2026-10-08T21:00:00Z" })], "482913", /não está liberado agora/]
  ];
  for(const [linhas, cod, re] of casos){
    const a = await abrir(null, { semSessao: true, agora: AGORA, db: db => { db.jb_freela_acesso = linhas; return db; } });
    await digitarCodigo(a, cod);
    assert.equal(await a.tela(), "scLogin");
    assert.match(await a.texto("#loginErr"), re);
    assert.equal(await a.page.evaluate(() => localStorage.getItem("jb_freela_token")), null);
    semErros(a); await a.fechar();
  }
});

test("celular com token guardado abre direto; quando a janela fecha, volta para o login", async () => {
  let a = await abrir(null, freelaLogada());
  assert.equal(await a.tela(), "scHome");
  semErros(a); await a.fechar();

  a = await abrir(null, freelaLogada({ encerrado_em: "2026-10-08T22:00:00Z" }));
  assert.equal(await a.tela(), "scLogin");
  assert.equal(await a.page.evaluate(() => localStorage.getItem("jb_freela_token")), null, "token apagado");
  semErros(a); await a.fechar();
});

test("acesso encerrado enquanto ela usa: na próxima volta à Home, sai com aviso", async () => {
  const a = await abrir(null, freelaLogada());
  await a.page.evaluate(() => { __DB.jb_freela_acesso[0].encerrado_em = new Date().toISOString(); });
  await a.page.click("#homeRecarregar"); await a.espera(500);
  assert.equal(await a.tela(), "scLogin");
  assert.match(await a.texto("#loginErr"), /Seu acesso de freela terminou/);
  semErros(a); await a.fechar();
});

test("freela fecha a geladeira e anota o que saiu depois: tudo fica com o nome dela", async () => {
  const a = await abrir(null, freelaLogada());
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.tela(), "scCount");
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("2"); await inputs.nth(1).fill("5"); await inputs.nth(2).fill("6");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.equal(await a.tela(), "scFeito");
  const fe = (await a.db("jb_contagem")).find(c => c.momento === "fechamento");
  assert.equal(fe.nome_responsavel, "Ana (freela)");
  assert.equal(fe.freela_id, 1);
  assert.deepEqual((await a.db("jb_contagem_item")).filter(i => i.contagem_id === fe.id).map(i => i.qtd), [2, 5, 6]);
  assert.ok(!/R\$/.test(await a.texto("#scFeito")), "nada de dinheiro");

  await a.page.click("#btnAdendo"); await a.espera(300);
  assert.equal(await a.tela(), "scAdendo");
  await a.page.fill("#adTexto", "Saiu um brownie no balcão");
  await a.espera(100);
  await a.page.click("#btnAdSalvar"); await a.espera(500);
  const ad = await a.db("jb_adendo");
  assert.equal(ad.length, 1);
  assert.equal(ad[0].nome_responsavel, "Ana (freela)");
  semErros(a); await a.fechar();
});

test("o turno que a Yasmin já fechou a freela vê, mas não consegue gravar por cima", async () => {
  const a = await abrir(null, freelaLogada({}, db => {
    db.jb_contagem.push({ id: 6, data: HOJE, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: HOJE + "T23:00:00Z" });
  }));
  assert.match(await a.texto("#btnFechamento .s"), /Registrado por Yasmin/);
  const r = await a.page.evaluate(() => SB_REAL.rpc("jb_freela_salvar", { p_token: localStorage.getItem("jb_freela_token"), p_data: hojeSP(), p_momento: "fechamento", p_itens: [] }));
  assert.ok(r.error, "o banco recusa");
  semErros(a); await a.fechar();
});

test("sair apaga o token deste celular", async () => {
  const a = await abrir(null, freelaLogada());
  await a.page.click("#btnSair"); await a.espera(300);
  assert.match(a.confirms[0], /código novo/);
  assert.equal(await a.tela(), "scLogin");
  assert.equal(await a.page.evaluate(() => localStorage.getItem("jb_freela_token")), null);
  semErros(a); await a.fechar();
});

test("gestor libera, a mensagem já leva o código, e depois encerra", async () => {
  const a = await abrir("uJes", { agora: AGORA, db: db => {
    db.jb_freela = [{ id: 1, nome: "Bia", data: "2026-10-02", valor: 120, cancelada: false, conta_id: null }];
    return db;
  }});
  await a.page.click("#btnDias"); await a.espera(500);
  assert.match(await a.texto("#frAcStatus"), /Ninguém liberado agora/);

  await a.page.click("#frAcAbre"); await a.espera(150);
  assert.deepEqual(await a.page.evaluate(() => [...document.querySelectorAll("#frAcNomes option")].map(o => o.value)), ["Bia"], "sugere quem já foi freela");
  assert.match(await a.page.locator("#frAcAte option").first().innerText(), /Até amanhã às 06:00/);
  await a.page.click("#frAcSalvar"); await a.espera(200);
  assert.match(await a.texto("#frAcErr"), /Escreva o nome/);

  await a.page.fill("#frAcNome", "  Ana  ");
  await a.page.selectOption("#frAcAte", "24h");
  await a.page.click("#frAcSalvar"); await a.espera(500);
  const rows = await a.db("jb_freela_acesso");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nome, "Ana");
  assert.equal(Date.parse(rows[0].valido_ate), Date.parse(AGORA) + 86400000);

  const msg = await a.page.inputValue("#frAcTexto");
  assert.match(msg, /^Oi, Ana!/);
  assert.match(msg, /https:\/\/henriquehag1\.github\.io\/jb-confeitaria\//);
  assert.match(msg, /Toque em Freela/);
  assert.ok(msg.includes("Digite o código " + rows[0].codigo), "o código vai na mensagem");
  assert.match(msg, /vale até amanhã às 20:30/);
  assert.ok(!/ [–—-] /.test(msg), "sem travessão ou hífen como separador");
  assert.match(await a.texto("#frAcesso .fr-ac-ok"), /O código só aparece agora/);

  await a.page.locator("#frAcesso button", { hasText: "Pronto" }).click(); await a.espera(200);
  assert.match(await a.texto("#frAcStatus"), /Ana pode entrar até amanhã às 20:30\. Ainda ninguém entrou\./);
  assert.ok(!(await a.texto("#frAcesso")).includes(rows[0].codigo), "depois de Pronto o código some da tela");

  await a.page.locator("#frAcesso .ch-ed").click(); await a.espera(150);
  await a.page.locator("#frAcesso .ch-ed").click(); await a.espera(500);
  assert.ok((await a.db("jb_freela_acesso"))[0].encerrado_em, "encerrado");
  assert.match(await a.texto("#frAcStatus"), /Ninguém liberado agora/);
  semErros(a); await a.fechar();
});

test("gestor vê quando ela entrou e quando o código foi bloqueado; liberar de novo troca a pessoa", async () => {
  let a = await abrir("uHen", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela({ token: TOKEN, token_em: "2026-10-08T21:10:00Z" })]; return db; } });
  await a.page.click("#btnDias"); await a.espera(500);
  assert.match(await a.texto("#frAcStatus"), /Ana pode entrar até amanhã às 06:00\. Já entrou num celular às 18:10\./);
  await a.page.click("#frAcAbre"); await a.espera(150);
  assert.equal(await a.page.inputValue("#frAcNome"), "Ana");
  await a.page.fill("#frAcNome", "Carla");
  await a.page.click("#frAcSalvar"); await a.espera(500);
  const rows = await a.db("jb_freela_acesso");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].encerrado_em, "a liberação antiga terminou");
  assert.equal(rows[1].nome, "Carla"); assert.equal(rows[1].token, null);
  semErros(a); await a.fechar();

  a = await abrir("uHen", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela({ erros: 5 })]; return db; } });
  await a.page.click("#btnDias"); await a.espera(500);
  assert.match(await a.texto("#frAcStatus"), /bloqueado depois de 5 tentativas/);
  semErros(a); await a.fechar();
});

test("Yasmin não vê nem libera acesso de freela", async () => {
  const a = await abrir("uYas", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela()]; return db; } });
  assert.equal(await a.visivel("btnDias"), false);
  const r = await a.page.evaluate(async () => [
    (await sb.from("jb_freela_acesso").select("*")).data.length,
    !!(await sb.rpc("jb_freela_liberar", { p_nome: "X", p_ate: new Date(Date.now() + 3600e3).toISOString() })).error
  ]);
  assert.deepEqual(r, [0, true]);
  semErros(a); await a.fechar();
});
