/* Abre o app numa página do Playwright com o banco falso.
   Falha o teste em qualquer erro de página ou de console. */
const { chromium } = require("playwright");
const path = require("path");
const { baseDB, stubSource } = require("./stub");

const URL = "file://" + path.resolve(__dirname, "..", "index.html");
let browser = null;

async function navegador(){
  if(!browser) browser = await chromium.launch();
  return browser;
}

/* opts: { db: (db) => db, agora: "2026-09-08T03:10:00Z", falha: { tabela: true }, semSessao: true } */
async function abrir(uid, opts = {}){
  const b = await navegador();
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", e => erros.push("PAGEERROR: " + e.message));
  page.on("console", m => { if(m.type() === "error") erros.push("CONSOLE: " + m.text()); });
  const confirms = [];
  page.on("dialog", d => { confirms.push(d.message()); (opts.confirmar === false ? d.dismiss() : d.accept()); });

  let db = baseDB(opts.agora);
  if(opts.db) db = opts.db(db) || db;
  const src = stubSource(opts.semSessao ? null : uid, db, opts.agora)
    + (opts.falha ? "\nwindow.__FALHA=" + JSON.stringify(opts.falha) + ";" : "");

  await page.route("**/cdn.jsdelivr.net/**", r => r.fulfill({ contentType: "application/javascript", body: src }));
  await page.route("**/fonts.googleapis.com/**", r => r.fulfill({ contentType: "text/css", body: "" }));
  /* O storage de mentira devolve links em stub.local. Sem uma rota aqui a
     miniatura quebraria por rede, não por bug. */
  await page.route("**/stub.local/**", r => r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.route("**/static.ifood-static.com.br/**", r => r.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") }));
  await page.goto(URL);
  // espera o app sair da tela em branco: ou entrou numa tela, ou mostrou o login
  await page.waitForFunction(() => {
    try { return TELA !== "scLogin" || !document.getElementById("scLogin").classList.contains("hide"); }
    catch(e){ return false; }
  }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);

  return {
    page, erros, confirms,
    tela: () => page.evaluate(() => TELA),
    titulo: () => page.evaluate(() => document.getElementById("navTitulo").textContent),
    texto: (sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || "", sel),
    visivel: (id) => page.evaluate(i => { const e = document.getElementById(i); return !!e && !e.classList.contains("hide") && e.offsetParent !== null; }, id),
    log: (tipo) => page.evaluate(t => window.__LOG.filter(l => !t || l[0] === t), tipo || null),
    db: (t) => page.evaluate(t => window.__DB[t], t),
    espera: (ms) => page.waitForTimeout(ms),
    fechar: async () => { await ctx.close(); }
  };
}

async function encerrar(){ if(browser){ await browser.close(); browser = null; } }

module.exports = { abrir, encerrar };
