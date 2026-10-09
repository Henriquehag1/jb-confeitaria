const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const abrirMesNaTela = async (a) => {
  await a.page.click("#btnResultado"); await a.espera(900);
  assert.equal(await a.tela(), "scMes");
};

const aberta = a => a.page.evaluate(() => {
  const e = document.querySelector("#mesCorpo .explica:not(.hide)");
  if(!e) return null;
  return {
    titulo: e.querySelector("strong").textContent,
    linhas: [...e.querySelectorAll("p:not(.conta)")].map(p => p.textContent),
    conta: (e.querySelector("p.conta") || {}).textContent || null
  };
});

test("todo número da tela tem um ponto de interrogação, e nenhuma explicação nasce aberta", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  const n = await a.page.evaluate(() => ({
    botoes: document.querySelectorAll("#mesCorpo button.porque").length,
    abertas: document.querySelectorAll("#mesCorpo .explica:not(.hide)").length,
    todas: document.querySelectorAll("#mesCorpo .explica").length
  }));
  assert.equal(n.botoes, n.todas, "um botão para cada explicação");
  assert.ok(n.botoes >= 8, "placar, barras, canais, total e saídas: " + n.botoes);
  assert.equal(n.abertas, 0, "a tela abre limpa");
  semErros(a); await a.fechar();
});

test("só fica uma explicação aberta por vez, e tocar de novo fecha", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await a.page.evaluate(() => document.querySelector("#mesCorpo .placar button.porque").click()); await a.espera(150);
  const canal = () => a.page.evaluate(() => [...document.querySelectorAll("#mesCorpo .linhaval")]
      .find(x => x.querySelector(".n").childNodes[0].textContent.trim() === "99Food").querySelector("button.porque").click());
  await canal(); await a.espera(150);
  let e = await aberta(a);
  assert.equal(e.titulo, "99Food");
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .explica:not(.hide)").length), 1);
  await canal(); await a.espera(150);
  assert.equal(await aberta(a), null, "tocar de novo fecha");
  semErros(a); await a.fechar();
});

test("clicar no corpo da barra também abre, mas a linha de digitar não perde o campo", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await a.page.evaluate(() => { [...document.querySelectorAll("#mesCorpo .barra")][0].click(); });
  await a.espera(200);
  assert.ok(await aberta(a), "tocar na barra inteira abre");
  await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .linhaval input.q")[1].focus());
  const foco = await a.page.evaluate(() => document.activeElement.className);
  assert.match(foco, /\bq\b/, "o campo de digitar segue funcionando: " + foco);
  semErros(a); await a.fechar();
});

test("a linha de um canal explica que o valor é repasse, não o que o cliente pagou", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await a.page.evaluate(() => {
    const l = [...document.querySelectorAll("#mesCorpo .linhaval")]
      .find(x => x.querySelector(".n").childNodes[0].textContent.trim() === "99Food");
    l.querySelector("button.porque").click();
  });
  await a.espera(200);
  const e = await aberta(a);
  assert.equal(e.titulo, "99Food");
  assert.match(e.linhas[0], /repasse/);
  assert.match(e.linhas.join(" "), /Nosso Financeiro/);
  assert.match(e.conta, /o cliente pagou por volta de R\$/, "conta: " + e.conta);
  semErros(a); await a.fechar();
});

test("o placar explica a subtração com os dois números do mês", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await a.page.evaluate(() => document.querySelector("#mesCorpo .placar button.porque").click());
  await a.espera(200);
  const e = await aberta(a);
  assert.match(e.titulo, /^(Sobrou|Faltou) no mês$/);
  assert.match(e.conta, /que entrou − R\$ [\d.,]+ que saiu = /, "conta: " + e.conta);
  semErros(a); await a.fechar();
});

test("tudo que saiu explica a soma pelos grupos do Nosso Financeiro", async () => {
  const a = await abrir("uJes", { db: db => { db.jb_mes[0].detalhe = { grupos: [{ nome: "Contas fixas", total: 1000, itens: [] }, { nome: "Mercado", total: 250.5, itens: [] }] }; return db; } });
  await abrirMesNaTela(a);
  await a.page.evaluate(() => [...document.querySelectorAll("#mesCorpo .linhaval")]
    .find(x => x.querySelector(".n").childNodes[0].textContent.trim() === "Tudo que saiu").querySelector("button.porque").click());
  await a.espera(200);
  const e = await aberta(a);
  assert.equal(e.titulo, "Tudo que saiu");
  assert.equal(e.conta, "Contas fixas 1.000,00 + Mercado 250,50 = R$ 1.250,50");
  semErros(a); await a.fechar();
});
