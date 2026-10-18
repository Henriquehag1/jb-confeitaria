const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const AGORA = "2026-10-08T23:30:00Z";          // 20:30 de quinta em São Paulo
const HOJE  = "2026-10-08";
const janela = (extra = {}) => ({ id: 1, nome: "Ana", valido_de: "2026-10-08T20:00:00Z", valido_ate: "2026-10-09T09:00:00Z",
  sessao: null, sessao_em: null, criado_por: "uJes", criado_em: "2026-10-08T20:00:00Z", encerrado_em: null, encerrado_por: null, ...extra });
const comAbertura = db => {
  db.jb_contagem.push({ id: 5, data: HOJE, momento: "abertura", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: HOJE + "T19:00:00Z" });
  db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10 }, { contagem_id: 5, produto_id: 2, qtd: 20 }, { contagem_id: 5, produto_id: 3, qtd: 6 });
  return db;
};

test("login tem o botão Freela", async () => {
  const a = await abrir("uFre", { semSessao: true, agora: AGORA });
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#pickWho button")].map(b => b.textContent));
  assert.ok(nomes.includes("Freela"));
  semErros(a); await a.fechar();
});

test("freela sem acesso liberado é deslogada com a mensagem certa", async () => {
  const a = await abrir("uFre", { agora: AGORA });
  assert.equal(await a.tela(), "scLogin");
  assert.match(await a.texto("#loginErr"), /não está liberado agora/);
  assert.equal((await a.log("signOut")).length, 1);
  semErros(a); await a.fechar();
});

test("acesso vencido ou encerrado também não entra", async () => {
  for(const j of [janela({ valido_ate: "2026-10-08T22:00:00Z" }), janela({ encerrado_em: "2026-10-08T21:00:00Z" })]){
    const a = await abrir("uFre", { agora: AGORA, db: db => { db.jb_freela_acesso = [j]; return db; } });
    assert.equal(await a.tela(), "scLogin");
    assert.equal((await a.log("signOut")).length, 1);
    semErros(a); await a.fechar();
  }
});

test("outro celular já pegou o acesso: este não entra", async () => {
  const a = await abrir("uFre", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela({ sessao: "sessB", sessao_em: "2026-10-08T21:00:00Z" })]; return db; } });
  assert.equal(await a.tela(), "scLogin");
  assert.match(await a.texto("#loginErr"), /em uso em outro celular/);
  semErros(a); await a.fechar();
});

test("freela liberada: Home só com a contagem, sem histórico, plano, dias ou dinheiro", async () => {
  const a = await abrir("uFre", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela()]; return comAbertura(db); } });
  assert.equal(await a.tela(), "scHome");
  assert.equal(await a.texto("#whoName"), "Ana");
  assert.equal(await a.texto("#homeSub"), "Freela · até 06:00");
  assert.match(await a.texto("#homeTip"), /Seu acesso vale até amanhã às 06:00\./);
  assert.equal((await a.db("jb_freela_acesso"))[0].sessao, "sessA", "este celular ficou com o acesso");
  assert.equal(await a.visivel("btnFechamento"), true);
  for(const b of ["btnHist","btnProducao","btnDias","btnPerda","btnPromo","btnCustos","btnResultado","btnContas","btnSaude","btnContador","btnEstoque","btnEncomendas","btnAfazeres"])
    assert.equal(await a.visivel(b), false, b + " escondido");
  assert.deepEqual(await a.page.evaluate(() => [$("cardCheguei").innerHTML, $("cardMeusDias").innerHTML]), ["", ""], "sem Cheguei e sem Meus dias");
  assert.deepEqual((await a.log("rpc")).filter(r => r[1] === "jb_marcar_presenca"), [], "freela não bate ponto");
  semErros(a); await a.fechar();
});

test("freela fecha a geladeira: a contagem fica com o nome dela", async () => {
  const a = await abrir("uFre", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela()]; return comAbertura(db); } });
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.tela(), "scCount");
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("2"); await inputs.nth(1).fill("5"); await inputs.nth(2).fill("6");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.equal(await a.tela(), "scFeito");
  const fe = (await a.db("jb_contagem")).find(c => c.momento === "fechamento");
  assert.equal(fe.nome_responsavel, "Ana (freela)");
  assert.ok(!/itens saíram|R\$/.test(await a.texto("#scFeito")), "nada de números de venda ou dinheiro");
  semErros(a); await a.fechar();
});

test("gestor libera o acesso, copia a mensagem e depois encerra", async () => {
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
  assert.match(msg, /vale até amanhã às 20:30/);
  assert.ok(!/ [–—-] /.test(msg), "sem travessão ou hífen como separador");
  assert.ok(!/\d{6}/.test(msg), "o app não sabe nem escreve o PIN");

  await a.page.locator("#frAcesso button", { hasText: "Pronto" }).click(); await a.espera(200);
  assert.match(await a.texto("#frAcStatus"), /Ana pode entrar até amanhã às 20:30\. Ainda ninguém entrou\./);

  await a.page.locator("#frAcesso .ch-ed").click(); await a.espera(150);
  await a.page.locator("#frAcesso .ch-ed").click(); await a.espera(500);
  assert.ok((await a.db("jb_freela_acesso"))[0].encerrado_em, "encerrado");
  assert.match(await a.texto("#frAcStatus"), /Ninguém liberado agora/);
  semErros(a); await a.fechar();
});

test("liberar de novo troca a pessoa e solta o celular antigo", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela({ sessao: "sessB", sessao_em: "2026-10-08T21:10:00Z" })]; return db; } });
  await a.page.click("#btnDias"); await a.espera(500);
  assert.match(await a.texto("#frAcStatus"), /Ana pode entrar até amanhã às 06:00\. Já entrou num celular às 18:10\./);
  await a.page.click("#frAcAbre"); await a.espera(150);
  assert.equal(await a.page.inputValue("#frAcNome"), "Ana");
  await a.page.fill("#frAcNome", "Carla");
  await a.page.click("#frAcSalvar"); await a.espera(500);
  const rows = await a.db("jb_freela_acesso");
  assert.equal(rows.length, 2);
  assert.ok(rows[0].encerrado_em, "a liberação antiga terminou");
  assert.equal(rows[1].nome, "Carla"); assert.equal(rows[1].sessao, null);
  semErros(a); await a.fechar();
});

test("Yasmin não vê o acesso de freela", async () => {
  const a = await abrir("uYas", { agora: AGORA, db: db => { db.jb_freela_acesso = [janela()]; return db; } });
  assert.equal(await a.visivel("btnDias"), false);
  const r = await a.page.evaluate(async () => [
    (await sb.from("jb_freela_acesso").select("*")).data.length,
    !!(await sb.rpc("jb_freela_liberar", { p_nome: "X", p_ate: new Date(Date.now() + 3600e3).toISOString() })).error
  ]);
  assert.deepEqual(r, [0, true]);
  semErros(a); await a.fechar();
});
