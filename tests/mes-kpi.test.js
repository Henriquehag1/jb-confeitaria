const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* Monta n dias de turno fechado antes de hoje. `tortos` são dias em que a contagem
   de fechamento é maior que a de abertura: o "vendeu" fica negativo, como acontece
   de verdade quando alguém repõe a geladeira e esquece de marcar. */
function comDias(db, n, opcoes = {}){
  const tortos = opcoes.tortos || [];
  const abertos = opcoes.abertos || [];
  let id = 500;
  for(let i = n; i >= 1; i--){
    const d = diaMais(hojeSP(), -i);
    const torto = tortos.includes(i);
    const aberto = abertos.includes(i);
    db.jb_contagem.push({ id: ++id, data: d, momento: "abertura", registrado_por: "uJes",
                          nome_responsavel: "Jessica", criado_em: d + "T10:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: id, produto_id: 1, qtd: 40 },
                             { contagem_id: id, produto_id: 2, qtd: 30 });
    if(aberto) continue;
    db.jb_contagem.push({ id: ++id, data: d, momento: "fechamento", registrado_por: "uYas",
                          nome_responsavel: "Yasmin", criado_em: d + "T23:00:00Z" });
    /* sobrou mais do que tinha = contagem torta */
    db.jb_contagem_item.push({ contagem_id: id, produto_id: 1, qtd: torto ? 90 : 12 },
                             { contagem_id: id, produto_id: 2, qtd: torto ? 70 : 9 });
  }
  return db;
}

const barras = (a, titulo) => a.page.evaluate(t => {
  const g = [...document.querySelectorAll("#mesCorpo .graf")]
              .find(x => x.querySelector("h3").childNodes[0].textContent.trim() === t);
  if(!g) return null;
  return [...g.querySelectorAll(".barra")].map(b => ({
    nome: b.querySelector(".cab span").childNodes[0].textContent.trim(),
    valor: b.querySelector(".cab b").textContent,
    largura: b.querySelector(".preenche").style.width,
    destaque: b.classList.contains("destaque"),
    ruim: b.classList.contains("ruim")
  }));
}, titulo);

test("os KPIs do mês se calculam sozinhos: quatro cartões, nenhum campo para digitar", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnResultado"); await a.espera(700);
  assert.equal(await a.tela(), "scMes");

  const cards = await a.page.evaluate(() => [...document.querySelectorAll("#mesCorpo .kpi")].map(c => ({
    rot: c.querySelector(".rot").textContent,
    num: c.querySelector(".num").textContent,
    tom: c.querySelector(".num").className.replace("num","").trim()
  })));
  assert.equal(cards.length, 4, JSON.stringify(cards));
  assert.deepEqual(cards.map(c => c.rot),
    ["Vendendo por dia","Precisa vender por dia","Cada doce deixa","Sobra de cada R$ 100"]);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .kpi input").length), 0,
    "cartão de KPI não tem campo: ele se calcula");
  semErros(a); await a.fechar();
});

test("para onde vai cada R$ 100: as cinco fatias fecham em cem reais", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnResultado"); await a.espera(700);
  const bs = await barras(a, "Para onde vai cada R$ 100");
  assert.equal(bs.length, 5, JSON.stringify(bs));
  assert.deepEqual(bs.slice(0,4).map(b => b.nome),
    ["App e promoção","Imposto","Ingrediente e embalagem","Conta fixa"]);
  const num = t => Number(t.replace("R$","").replace("−","-").replace(/\./g,"").replace(",",".").trim());
  const soma = bs.reduce((s,b) => s + num(b.valor), 0);
  assert.ok(Math.abs(soma - 100) < 0.5, "as fatias somam " + soma);
  assert.equal(bs[4].destaque, true, "a última barra é a que importa");
  semErros(a); await a.fechar();
});

test("quando não sobra nada, a barra vira Falta e fica em vermelho", async () => {
  const a = await abrir("uJes");   // no banco de teste o 99Food come 74%: a sobra é negativa
  await a.page.click("#btnResultado"); await a.espera(700);
  const bs = await barras(a, "Para onde vai cada R$ 100");
  assert.equal(bs[4].nome, "Falta", JSON.stringify(bs[4]));
  assert.equal(bs[4].ruim, true);
  assert.match(bs[4].valor, /^R\$ -/);
  semErros(a); await a.fechar();
});

test("de onde vem o dinheiro: a barra mostra o que o cliente pagou, não só o repasse", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnResultado"); await a.espera(700);
  const bs = await barras(a, "De onde vem o dinheiro");
  assert.deepEqual(bs.map(b => b.nome), ["99Food","iFood"], "o maior primeiro");
  assert.deepEqual(bs.map(b => b.valor), ["R$ 3.011,12","R$ 317,02"]);
  const notas = await a.page.evaluate(() => {
    const g = [...document.querySelectorAll("#mesCorpo .graf")]
                .find(x => x.querySelector("h3").childNodes[0].textContent.trim() === "De onde vem o dinheiro");
    return [...g.querySelectorAll(".barra .cab small")].map(e => e.textContent);
  });
  // 3011,12 / (1 - 0,74) = 11.581,23
  assert.match(notas[0], /O cliente pagou R\$ 11\.581,23 e o app ficou com 74%/);
  semErros(a); await a.fechar();
});

test("unidades por dia: uma coluna por dia, e o dia de contagem torta fica marcado", async () => {
  const a = await abrir("uJes", { db: db => comDias(db, 8, { tortos: [3], abertos: [1] }) });
  await a.page.click("#btnResultado"); await a.espera(900);
  const cols = await a.page.evaluate(() =>
    [...document.querySelectorAll("#mesCorpo .colunas .col")].map(c => ({
      fora: c.classList.contains("fora"),
      titulo: c.querySelector("title").textContent
    })));
  assert.equal(cols.length, 8, JSON.stringify(cols.map(c => c.titulo)));
  const marcados = cols.filter(c => c.fora);
  assert.equal(marcados.length, 2, "o dia torto e o turno ainda aberto");
  assert.ok(marcados.some(c => /contagem torta/.test(c.titulo)), JSON.stringify(marcados));
  assert.ok(marcados.some(c => /turno ainda aberto/.test(c.titulo)), JSON.stringify(marcados));
  const rod = await a.page.evaluate(() => {
    const g = [...document.querySelectorAll("#mesCorpo .graf")]
                .find(x => x.querySelector("h3").childNodes[0].textContent.trim() === "Unidades por dia");
    return (g.querySelector(".rodape") || {}).textContent || "";
  });
  assert.match(rod, /2 dias estão claros/);
  semErros(a); await a.fechar();
});

test("a linha do que precisa vender aparece no gráfico, com o número escrito", async () => {
  const a = await abrir("uJes", { db: db => comDias(db, 8) });
  await a.page.click("#btnResultado"); await a.espera(900);
  const meta = await a.page.evaluate(() => {
    const t = document.querySelector("#mesCorpo .colunas text.metaTx");
    return t ? t.textContent : null;
  });
  assert.match(meta || "", /^\d+ para pagar as contas$/, "meta: " + meta);
  semErros(a); await a.fechar();
});

test("a tela se recarrega sozinha quando o celular volta para ela", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnResultado"); await a.espera(700);
  await a.page.evaluate(() => {
    window.__kpis = 0;
    const orig = window.carregarKPIs;
    window.carregarKPIs = async () => { window.__kpis++; return orig(); };
  });
  await a.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await a.espera(900);
  assert.equal(await a.page.evaluate(() => window.__kpis), 1, "voltar o foco recarrega os números");
  assert.ok(await a.page.evaluate(() => !!MES_KPI && !!MES_KPI.atual), "e eles continuam na tela");
  semErros(a); await a.fechar();
});

test("Yasmin não enxerga os KPIs do mês", async () => {
  const a = await abrir("uYas");
  await a.page.evaluate(async () => { await abrirMes(); }).catch(() => {});
  await a.espera(600);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .kpi").length), 0);
  await a.fechar();
});
