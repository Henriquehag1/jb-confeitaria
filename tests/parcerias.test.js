const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const abrirParc = async a => {
  await a.page.click("#btnParcerias"); await a.espera(500);
  assert.equal(await a.tela(), "scParc");
};
const abrirCartao = (a, cod) => a.page.evaluate(c => {
  [...document.querySelectorAll("#parcLista .enc")].find(x => x.querySelector(".enc-meio small").textContent.trim() === c)
    .querySelector(".enc-topo").click();
}, cod);
const botao = (a, rot) => a.page.evaluate(r => {
  [...document.querySelectorAll("#parcLista .enc-acoes button")].find(b => b.textContent === r).click();
}, rot);

test("parcerias: só o gestor vê o botão, e ele avisa quando tem pedido novo", async () => {
  let a = await abrir("uJes");
  assert.equal(await a.visivel("btnParcerias"), true);
  assert.equal(await a.texto("#parcSub"), "1 pedido de parceria esperando resposta");
  assert.match(await a.page.getAttribute("#btnParcerias", "class"), /enc-nova/);
  semErros(a); await a.fechar();

  a = await abrir("uYas");
  assert.equal(await a.visivel("btnParcerias"), false);
  await a.fechar();

  a = await abrir("uJes", { db: db => { db.jb_parceria.forEach(p => { if(p.status === "nova") p.status = "conversando"; }); return db; } });
  assert.equal(await a.texto("#parcSub"), "Marcas e perfis que querem fazer algo com a JB");
  assert.doesNotMatch(await a.page.getAttribute("#btnParcerias", "class"), /enc-nova/);
  semErros(a); await a.fechar();
});

test("parcerias: novas primeiro, depois conversando, e recusadas recolhidas", async () => {
  const a = await abrir("uJes");
  await abrirParc(a);
  assert.equal(await a.titulo(), "Parcerias e collabs");
  const ordem = await a.page.evaluate(() =>
    [...document.querySelectorAll("#parcLista > .grupotar, #parcLista > .enc, #parcLista > details")].map(e =>
      e.tagName === "DETAILS" ? "recolhidas" : e.classList.contains("grupotar") ? "# " + e.textContent : e.querySelector(".enc-meio small").textContent.trim()));
  assert.deepEqual(ordem, ["# Esperando resposta", "PC1001", "# Conversando", "PC1002", "recolhidas"]);
  const cab = await a.page.evaluate(() => [...document.querySelectorAll("#parcLista .enc-cab b")].map(b => b.textContent));
  assert.deepEqual(cab, ["1", "1", "0"]);
  const linha = await a.texto("#parcLista .enc.nova .enc-meio > span");
  assert.equal(linha, "Com a Jessica · Publi ou conteúdo · Permuta");
  semErros(a); await a.fechar();
});

test("parcerias: o cartão aberto mostra a ideia e responde no WhatsApp ou no e-mail, no tom da Jessica", async () => {
  const a = await abrir("uJes");
  await abrirParc(a);
  await abrirCartao(a, "PC1001"); await a.espera(150);
  assert.equal(await a.texto("#parcLista .parc-ideia"), "Queremos uma receita de pote com a nossa granola, em reels.");
  const wa = await a.page.getAttribute("#parcLista .enc-wa", "href");
  assert.match(wa, /^https:\/\/wa\.me\/5511988887777\?text=/);
  assert.match(decodeURIComponent(wa), /oi, Marina! aqui é a Jessica, da JB :\) recebi a sua ideia de publi ou conteúdo \(PC1001\)/);
  const insta = await a.page.getAttribute("#parcLista .enc-info a", "href");
  assert.equal(insta, "https://www.instagram.com/granolaboa/");

  assert.match(await a.texto("#parcLista .pr-sem"), /Ainda sem nota/);
  assert.equal(await a.page.locator("#parcLista .pr-versoes").count(), 0, "sem análise, só a resposta padrão");

  await abrirCartao(a, "PC1002"); await a.espera(150);
  const mail = await a.page.getAttribute("#parcLista .enc-wa", "href");
  assert.match(mail, /^https:\/\/mail\.google\.com\/mail\/\?authuser=jbconfeitariaparcerias%40gmail\.com&view=cm&fs=1&to=rh%40agencianorte\.com\.br&su=/);
  assert.equal(await a.texto("#parcLista .enc-wa"), "Responder Carlos pelo e-mail da JB");
  assert.match(await a.page.getAttribute("#parcLista .pr-app", "href"), /^mailto:rh@agencianorte\.com\.br\?subject=/);
  semErros(a); await a.fechar();
});

test("parcerias: a régua mostra a nota, cada ponto, a legenda, e a resposta recomendada abre no e-mail da JB", async () => {
  const a = await abrir("uJes");
  await abrirParc(a);
  await abrirCartao(a, "PC1002"); await a.espera(150);
  assert.equal(await a.texto("#parcLista .pr-nota"), "10/12");
  assert.equal(await a.texto("#parcLista .parc-regua .enc-chip"), "sim");
  assert.equal(await a.texto("#parcLista .pr-resumo"), "Pedido pago e grande, com data fora do pico.");
  const pontos = await a.page.evaluate(() => [...document.querySelectorAll("#parcLista .pr-crit li")].map(li =>
    li.querySelector(".pr-nome").textContent + " " + li.querySelector("em").textContent + " " + li.querySelectorAll(".pr-pts i.on").length));
  assert.deepEqual(pontos, ["Dinheiro para a JB 2/2 2", "Alcance para a JB 1/2 1", "Venda que pode gerar 2/2 2",
    "Combina com a marca 2/2 2", "Trabalho da Jessica 1/2 1", "Custo e risco 2/2 2"]);
  const legenda = await a.page.evaluate(() => [...document.querySelectorAll("#parcLista .pr-legenda li b")].map(b => b.textContent));
  assert.deepEqual(legenda, ["9 a 12: sim", "6 a 8: sim com condições", "4 a 5: não agora", "0 a 3: não"]);

  const versoes = await a.page.evaluate(() => [...document.querySelectorAll("#parcLista .pr-versoes button")].map(b => b.textContent + (b.getAttribute("aria-pressed") === "true" ? " (escolhida)" : "")));
  assert.deepEqual(versoes, ["Curta", "Média ★ (escolhida)", "Emocional"]);
  assert.equal(await a.page.inputValue("#parcLista .pr-texto"), "oi, Carlos, tudo bem? os kits ficam lindos..");
  let href = decodeURIComponent(await a.page.getAttribute("#parcLista .enc-wa", "href"));
  assert.match(href, /su=Kits de fim de ano da JB&body=oi, Carlos, tudo bem\? os kits ficam lindos\.\.$/);

  await a.page.evaluate(() => [...document.querySelectorAll("#parcLista .pr-versoes button")].find(b => b.textContent === "Curta").click());
  assert.equal(await a.page.inputValue("#parcLista .pr-texto"), "oi, Carlos! topamos sim :)");
  await a.page.fill("#parcLista .pr-texto", "oi, Carlos! topamos sim, me manda as datas :)");
  href = decodeURIComponent(await a.page.getAttribute("#parcLista .enc-wa", "href"));
  assert.match(href, /body=oi, Carlos! topamos sim, me manda as datas :\)$/);

  await a.page.evaluate(() => { const l = document.querySelector("#parcLista .enc-wa"); l.addEventListener("click", e => e.preventDefault()); l.click(); });
  await a.espera(250);
  const db = await a.db("jb_parceria");
  const p2 = db.find(p => p.codigo === "PC1002");
  assert.equal(p2.resposta_canal, "email");
  assert.equal(p2.resposta_versao, "curta");
  assert.ok(p2.respondido_em);
  assert.equal(p2.status, "conversando", "abrir a resposta não muda o status sozinho");
  semErros(a); await a.fechar();
});

test("parcerias: muda o status sem apagar nada, e a fechada lembra de registrar a permuta", async () => {
  const a = await abrir("uJes");
  await abrirParc(a);
  await abrirCartao(a, "PC1001"); await a.espera(150);
  await botao(a, "Respondi, conversando"); await a.espera(250);
  let db = await a.db("jb_parceria");
  assert.equal(db.find(p => p.codigo === "PC1001").status, "conversando");

  await abrirCartao(a, "PC1001"); await a.espera(150);
  await abrirCartao(a, "PC1001"); await a.espera(150);
  await botao(a, "Fechou"); await a.espera(250);
  db = await a.db("jb_parceria");
  assert.equal(db.find(p => p.codigo === "PC1001").status, "fechada");
  assert.equal(db.length, 3, "nada some");
  assert.deepEqual(await a.log("delete"), []);

  await a.page.evaluate(() => document.querySelector("#parcLista details").open = true);
  assert.match(await a.texto("#parcLista .parc-dica"), /Perda › Cortesia ou degustação.*permuta @granolaboa/);

  await a.page.fill("#parcLista .enc-nota textarea", "20 potes por 1 reels e 3 stories");
  await a.page.evaluate(() => document.querySelector("#parcLista .enc-nota textarea").blur()); await a.espera(200);
  db = await a.db("jb_parceria");
  assert.equal(db.find(p => p.codigo === "PC1001").nota_interna, "20 potes por 1 reels e 3 stories");
  semErros(a); await a.fechar();
});
