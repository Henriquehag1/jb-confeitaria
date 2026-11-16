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

  await abrirCartao(a, "PC1002"); await a.espera(150);
  const mail = await a.page.getAttribute("#parcLista .enc-wa", "href");
  assert.match(mail, /^mailto:rh@agencianorte\.com\.br\?subject=/);
  assert.equal(await a.texto("#parcLista .enc-wa"), "Responder Carlos por e-mail");
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
