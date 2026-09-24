const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);

const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

test("gestor: Home com pendências vindas do banco, versão e subtítulo", async () => {
  const a = await abrir("uJes");
  assert.equal(await a.tela(), "scHome");
  assert.equal(await a.texto("#homeSub"), "Ateliê");
  assert.match(await a.texto("#homeVersao"), /versão \d{4}-\d{2}-\d{2}/);
  // o cartao nasce fechado, com o titulo e o numero
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .corpo").classList.contains("hide")), true);
  assert.match(await a.texto("#cardPend .cab"), /ver/);
  await a.page.click("#cardPend .cab"); await a.espera(200);
  const pend = await a.page.evaluate(() => [...document.querySelectorAll("#cardPend .p .t")].map(e => e.textContent));
  assert.equal(pend.length, 3);
  assert.match(pend[0], /taxa efetiva do iFood/);
  assert.match(await a.texto("#cardPend .k"), /Pendências · 3/);
  // tocar na pendência de contagem abre o histórico
  await a.page.click("#cardPend .p.contagem");
  await a.espera(400);
  assert.equal(await a.tela(), "scHist");
  semErros(a); await a.fechar();
});

test("pendências: ok guarda por uma semana, e a linha volta quando a situação muda", async () => {
  const a = await abrir("uJes");
  await a.page.click("#cardPend .cab"); await a.espera(200);
  await a.page.click("#cardPend .p.taxa .ok"); await a.espera(600);

  const gravado = (await a.db("jb_pendencia_ok"))[0];
  assert.equal(gravado.chave, "taxa:10");
  assert.match(gravado.texto_quando, /taxa efetiva do iFood/);
  assert.equal(gravado.ate, diaMais(hojeSP(), 7));

  let pend = await a.page.evaluate(() => [...document.querySelectorAll("#cardPend .p .t")].map(e => e.textContent));
  assert.equal(pend.length, 2, "a linha guardada sai da lista");
  assert.match(await a.texto("#cardPend .k"), /Pendências · 2/);
  assert.match(await a.texto("#cardPend"), /1 guardada por uma semana/);

  // dá para ver e trazer de volta
  await a.page.evaluate(() => [...document.querySelectorAll("#cardPend .mais")].find(b => /guardada/.test(b.textContent)).click());
  await a.espera(300);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#cardPend .p.guardada").length), 1);
  await a.page.click("#cardPend .p.guardada .ok"); await a.espera(600);
  assert.equal((await a.db("jb_pendencia_ok")).length, 0);
  assert.match(await a.texto("#cardPend .k"), /Pendências · 3/);

  // guarda de novo e muda a situação: a pendência volta sozinha
  await a.page.click("#cardPend .p.taxa .ok"); await a.espera(600);
  assert.match(await a.texto("#cardPend .k"), /Pendências · 2/);
  await a.page.evaluate(() => { window.__DB.jb_pendencias[0].texto = "Taxa do iFood medida há 90 dias"; });
  await a.page.evaluate(async () => { await carregarHome(); }); await a.espera(500);
  await a.page.evaluate(() => { const c = document.querySelector("#cardPend .corpo"); if(c.classList.contains("hide")) document.querySelector("#cardPend .cab").click(); });
  await a.espera(200);
  assert.match(await a.texto("#cardPend .k"), /Pendências · 3/, "texto novo, pendência de volta");
  semErros(a); await a.fechar();
});

test("pendências: o cartão fecha e continua fechado na próxima Home", async () => {
  const a = await abrir("uJes");
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .corpo").classList.contains("hide")), true, "nasce fechado");
  await a.page.click("#cardPend .cab"); await a.espera(200);
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .corpo").classList.contains("hide")), false, "abre no toque");
  assert.match(await a.texto("#cardPend .cab"), /fechar/);
  await a.page.click("#cardPend .cab"); await a.espera(200);
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .corpo").classList.contains("hide")), true, "fecha de novo");
  assert.equal(await a.page.evaluate(() => localStorage.getItem("jb_pend_fechado")), "1");
  await a.page.evaluate(async () => { await carregarHome(); }); await a.espera(400);
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .corpo").classList.contains("hide")), true, "lembra que estava fechado");
  assert.equal(await a.page.evaluate(() => document.querySelector("#cardPend .cab").getAttribute("aria-expanded")), "false");
  semErros(a); await a.fechar();
});

test("gestor tem o registro de perda na Home; equipe não", async () => {
  const a = await abrir("uJes");
  assert.equal(await a.visivel("btnPerda"), true, "a Jessica registra perda direto da Home");
  await a.page.click("#btnPerda"); await a.espera(400);
  assert.equal(await a.tela(), "scPerda");
  assert.match(await a.texto("#peData"), /de setembro/);
  assert.ok(!/depois de fechar/.test(await a.texto("#peData")), "perda do dia, não da sobra da noite");
  await a.page.click("#btnPeVoltar"); await a.espera(300);
  assert.equal(await a.tela(), "scHome");
  semErros(a); await a.fechar();
});

test("equipe: sem pendências, sem cartão de abertura, subtítulo de contagem", async () => {
  const a = await abrir("uYas");
  assert.equal(await a.texto("#homeSub"), "Contagem de turno");
  assert.equal(await a.page.evaluate(() => document.getElementById("cardPend").children.length), 0);
  assert.equal(await a.visivel("btnAbertura"), false, "a abertura de turno não aparece para a equipe");
  assert.equal(await a.visivel("btnPerda"), false, "registro de perda é dos donos");
  assert.equal(await a.page.evaluate(() => document.getElementById("btnFechamento").disabled), true, "sem abertura, fechamento travado");
  assert.match(await a.texto("#btnFechamento .s"), /Só depois que o turno for aberto/);
  semErros(a); await a.fechar();
});

test("equipe: abertura da Jessica escondida, fechamento liberado, lembrete depois das 22h", async () => {
  const hoje = hojeSP("2026-09-08T01:30:00Z");   // 22:30 em SP de 07/09
  const a = await abrir("uYas", {
    agora: "2026-09-08T01:30:00Z",
    db: db => { db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T18:00:00Z" });
                db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10 }); return db; }
  });
  assert.equal(await a.visivel("btnAbertura"), false);
  assert.equal(await a.page.evaluate(() => document.getElementById("btnFechamento").disabled), false);
  assert.match(await a.texto("#homeMsg"), /Hora de fechar o turno/);
  semErros(a); await a.fechar();
});

test("equipe de madrugada sem ter fechado: continua no turno de ontem e consegue fechar", async () => {
  const agora = "2026-09-09T03:10:00Z";           // 00:10 em SP de 09/09
  const ontem = "2026-09-08";
  const a = await abrir("uYas", {
    agora,
    db: db => { db.jb_contagem.push({ id: 5, data: ontem, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: ontem + "T18:00:00Z" });
                db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10 }); return db; }
  });
  assert.equal(await a.page.evaluate(() => TURNO_DIA), ontem, "o app segue no dia de ontem");
  assert.equal(await a.page.evaluate(() => document.getElementById("btnFechamento").disabled), false);
  assert.match(await a.texto("#homeMsg"), /turno de ontem ainda não foi fechado/);
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.tela(), "scCount");
  assert.match(await a.texto("#countData"), /8 de setembro/);
  semErros(a); await a.fechar();
});

test("erro de rede na jb_usuario não derruba a sessão", async () => {
  const a = await abrir("uYas", { falha: { jb_usuario: true } });
  assert.equal(await a.tela(), "scLogin");
  assert.match(await a.texto("#loginErr"), /Sem conexão/);
  assert.deepEqual(await a.log("signOut"), [], "não fez signOut por erro de rede");
  semErros(a); await a.fechar();
});

test("usuário desativado é deslogado com a mensagem certa", async () => {
  const a = await abrir("uYas", { db: db => { db.jb_usuario.find(u => u.user_id === "uYas").ativo = false; return db; } });
  assert.equal(await a.tela(), "scLogin");
  assert.match(await a.texto("#loginErr"), /encerrado/);
  assert.equal((await a.log("signOut")).length, 1);
  semErros(a); await a.fechar();
});

test("erro de rede na contagem do dia: Home avisa em vez de mostrar botões que gravariam errado", async () => {
  const a = await abrir("uJes", { falha: { jb_contagem: true } });
  assert.equal(await a.tela(), "scHome");
  assert.match(await a.texto("#homeMsg"), /Não consegui falar com o servidor/);
  assert.equal(await a.visivel("btnFechamento"), false);
  semErros(a); await a.fechar();
});

test("voltar do celular não empilha histórico a cada volta", async () => {
  const a = await abrir("uJes");
  const antes = await a.page.evaluate(() => history.length);
  for(let i = 0; i < 3; i++){
    await a.page.click("#btnHist"); await a.espera(300);
    await a.page.goBack(); await a.espera(400);
  }
  assert.equal(await a.tela(), "scHome");
  const depois = await a.page.evaluate(() => history.length);
  assert.ok(depois - antes <= 1, "histórico cresceu " + (depois - antes) + " em 3 ciclos");
  semErros(a); await a.fechar();
});

test("PIN é campo de senha e o botão sair é texto", async () => {
  const a = await abrir("uYas", { semSessao: true });
  assert.equal(await a.tela(), "scLogin");
  assert.equal(await a.page.getAttribute("#pin", "type"), "password");
  assert.match(await a.texto("#loginVersao"), /versão/);
  semErros(a); await a.fechar();
});

test("promoção do dia: semáforo por canal e por desconto, só para os donos", async () => {
  const a = await abrir("uJes");
  assert.equal(await a.visivel("btnPromo"), true);
  await a.page.click("#btnPromo"); await a.espera(600);
  assert.equal(await a.tela(), "scPromo");

  // nasce no 99Food, a 25%
  assert.match(await a.texto("#promoMsg"), /A −25%, 1 produto dá prejuízo no 99Food/);
  const cabs = await a.page.evaluate(() => [...document.querySelectorAll("#promoLista .promo-cab")].map(e => e.textContent));
  assert.deepEqual(cabs, ["Pode ficar · 1", "No limite, ganha menos de R$ 1 · 1", "Tirar da lista · 1"]);
  assert.match(await a.texto("#promoLista .promo-ln.ok .nm"), /Bolo Gelado Supreme/);
  assert.match(await a.texto("#promoLista .promo-ln.ok .sub"), /aguenta até 33%/);
  assert.match(await a.texto("#promoLista .promo-ln.fora .nm"), /Potinho/);

  // a 30% o cookie cai para o vermelho
  await a.page.evaluate(() => [...document.querySelectorAll("#promoDescs button")].find(b => b.textContent === "30%").click());
  await a.espera(250);
  assert.match(await a.texto("#promoMsg"), /2 produtos dão prejuízo/);

  // trocar de canal muda a lista
  await a.page.evaluate(() => [...document.querySelectorAll("#promoCanais button")].find(b => b.textContent === "iFood").click());
  await a.espera(250);
  assert.match(await a.texto("#promoMsg"), /todos os produtos ainda se pagam no iFood/);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#promoLista .promo-ln").length), 1);
  semErros(a); await a.fechar();
});

test("equipe não vê a promoção do dia", async () => {
  const a = await abrir("uYas");
  assert.equal(await a.visivel("btnPromo"), false);
  semErros(a); await a.fechar();
});
