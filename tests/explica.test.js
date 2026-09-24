const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const abrirMesNaTela = async (a) => {
  await a.page.click("#btnResultado"); await a.espera(900);
  assert.equal(await a.tela(), "scMes");
};

/* abre a explicação de um cartão de KPI pelo rótulo */
const porqueDoCartao = (a, rot) => a.page.evaluate(r => {
  const k = [...document.querySelectorAll("#mesCorpo .kpi")]
    .find(c => c.querySelector(".rot").textContent === r);
  k.querySelector("button.porque").click();
}, rot);

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
  assert.ok(n.botoes >= 12, "tem explicação nos cartões, nas barras e nas linhas: " + n.botoes);
  assert.equal(n.abertas, 0, "a tela abre limpa");
  semErros(a); await a.fechar();
});

test("tocar no ponto de interrogação abre o que é, de onde vem e a conta", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await porqueDoCartao(a, "Precisa vender por dia");
  await a.espera(200);
  const e = await aberta(a);
  assert.equal(e.titulo, "Precisa vender por dia");
  assert.match(e.linhas[0], /ponto de equilíbrio/);
  assert.match(e.linhas[1], /conta fixa do mês dividida/);
  assert.match(e.conta, /^R\$ [\d.,]+ ÷ R\$ [\d.,]+ ÷ 30 dias = \d+ por dia$/, "conta: " + e.conta);
  assert.equal(await a.page.evaluate(() =>
    [...document.querySelectorAll("#mesCorpo button.porque")]
      .filter(b => b.getAttribute("aria-expanded") === "true").length), 1);
  semErros(a); await a.fechar();
});

test("a conta que aparece bate com os números que estão na tela", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await porqueDoCartao(a, "Precisa vender por dia");
  await a.espera(200);
  const e = await aberta(a);
  const num = t => Number(String(t).replace(/\./g,"").replace(",","."));
  const [, fixo, doce, eq] = e.conta.match(/^R\$ ([\d.,]+) ÷ R\$ ([\d.,]+) ÷ 30 dias = (\d+)/);
  const naTela = await a.page.evaluate(() => ({
    eq: document.querySelector("#mesCorpo .kpi .num").parentElement.parentElement
        && [...document.querySelectorAll("#mesCorpo .kpi")]
             .find(c => c.querySelector(".rot").textContent === "Precisa vender por dia")
             .querySelector(".num").textContent,
    doce: ([...document.querySelectorAll("#mesCorpo .kpi")]
             .find(c => c.querySelector(".rot").textContent === "Cada doce deixa") || {})
             .querySelector ? [...document.querySelectorAll("#mesCorpo .kpi")]
             .find(c => c.querySelector(".rot").textContent === "Cada doce deixa")
             .querySelector(".num").textContent : null
  }));
  assert.equal(eq + " un", naTela.eq, "o ponto de equilíbrio da conta é o do cartão");
  assert.equal("R$ " + doce, naTela.doce, "o que cada doce deixa é o mesmo dos dois lados");
  assert.equal(Math.ceil(num(fixo) / num(doce) / 30), Number(eq), "e a divisão fecha");
  semErros(a); await a.fechar();
});

test("só fica uma explicação aberta por vez, e tocar de novo fecha", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await porqueDoCartao(a, "Precisa vender por dia"); await a.espera(150);
  await porqueDoCartao(a, "Cada doce deixa"); await a.espera(150);
  let e = await aberta(a);
  assert.equal(e.titulo, "Cada doce deixa");
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .explica:not(.hide)").length), 1);
  await porqueDoCartao(a, "Cada doce deixa"); await a.espera(150);
  assert.equal(await aberta(a), null, "tocar de novo fecha");
  assert.equal(await a.page.evaluate(() =>
    [...document.querySelectorAll("#mesCorpo button.porque")]
      .filter(b => b.getAttribute("aria-expanded") === "true").length), 0);
  semErros(a); await a.fechar();
});

test("as barras do para onde vai cada R$ 100 explicam cada pedaço", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  await a.page.evaluate(() => {
    const b = [...document.querySelectorAll("#mesCorpo .barra")]
      .find(x => x.querySelector(".cab span").childNodes[0].textContent.trim() === "Conta fixa");
    b.querySelector("button.porque").click();
  });
  await a.espera(200);
  const e = await aberta(a);
  assert.equal(e.titulo, "Conta fixa");
  assert.match(e.linhas[0], /pró-labore/);
  assert.match(e.conta, /÷ [\d.]+ unidades = R\$ [\d,]+ por doce/, "conta: " + e.conta);
  semErros(a); await a.fechar();
});

test("clicar no corpo do cartão também abre, mas a linha de digitar não perde o campo", async () => {
  const a = await abrir("uJes");
  await abrirMesNaTela(a);
  // corpo do cartão abre
  await a.page.evaluate(() => {
    [...document.querySelectorAll("#mesCorpo .barra")][0].click();
  });
  await a.espera(200);
  assert.ok(await aberta(a), "tocar na barra inteira abre");

  // o campo de dinheiro continua clicável e recebe foco
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
