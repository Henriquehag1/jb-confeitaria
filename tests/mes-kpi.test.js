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

const DETALHE = { versao: 2, grupos: [
  { nome: "Contas fixas", total: 3616.11, itens: [
    { data: "2026-10-01", desc: "Aluguel atelie Pinheiros (metade)", valor: 1916.11, forma: "conta", cartao: null, parcela: null, previsto: false },
    { data: "2026-10-15", desc: "Funcionaria do atelie Yasmin", valor: 1700, forma: "conta", cartao: null, parcela: null, previsto: true } ] },
  { nome: "Insumos e materia-prima", total: 1568.67, itens: [
    { data: "2026-10-07", desc: "Loja santo Antônio 1/6", valor: 683.76, forma: "cartao", cartao: "Santander Unique Visa", parcela: "1/6", previsto: false },
    { data: "2026-10-13", desc: "Loja santo Antônio 2/6", valor: 884.91, forma: "cartao", cartao: "Santander Unique Visa", parcela: "2/6", previsto: false } ] }
] };

test("Caixa do mês: só o dinheiro de verdade; o diagnóstico fica na Saúde do negócio", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnResultado"); await a.espera(700);
  assert.equal(await a.tela(), "scMes");
  assert.equal(await a.titulo(), "Caixa do mês");
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .kpi").length), 0, "sem os cartões repetidos");
  assert.equal(await barras(a, "Para onde vai cada R$ 100"), null, "para onde vai cada R$ 100 mora na Saúde");
  assert.equal(await barras(a, "Unidades por dia"), null, "o gráfico de doces por dia mora na Saúde");
  assert.match(await a.texto("#mesCorpo"), /estão na Saúde do negócio/);
  semErros(a); await a.fechar();
});

test("o que saiu: cada grupo do Nosso Financeiro abre os lançamentos, com parcela, cartão e previsto", async () => {
  const a = await abrir("uJes", { db: db => { db.jb_mes[0].detalhe = DETALHE; return db; } });
  await a.page.click("#btnResultado"); await a.espera(700);
  const g = await a.page.evaluate(() => [...document.querySelectorAll("#cxGrupos .cx-grupo")].map(b => b.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(g, ["Contas fixas 2 lançamentos, 1 previsto R$ 3.616,11", "Insumos e materia-prima 2 lançamentos R$ 1.568,67"]);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#cxGrupos .cx-itens:not(.hide)").length), 0, "nasce fechado");
  await a.page.click('#cxGrupos [data-grupo="Insumos e materia-prima"]'); await a.espera(150);
  const itens = await a.page.evaluate(() => [...document.querySelectorAll("#cxGrupos .cx-itens:not(.hide) .cx-item")].map(x => x.innerText.replace(/\s+/g, " ").trim()));
  assert.deepEqual(itens, ["07/10 Loja santo Antônio 1/6 parcela 1/6 · cartão Santander Unique Visa R$ 683,76",
                           "13/10 Loja santo Antônio 2/6 parcela 2/6 · cartão Santander Unique Visa R$ 884,91"]);
  await a.page.click('#cxGrupos [data-grupo="Contas fixas"]'); await a.espera(150);
  assert.match(await a.page.evaluate(() => document.querySelector("#cxGrupos .cx-item.prev").innerText), /previsto, ainda não pago/);
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

test("Yasmin não enxerga o caixa do mês", async () => {
  const a = await abrir("uYas", { db: db => { db.jb_mes[0].detalhe = DETALHE; return db; } });
  assert.equal(await a.visivel("btnResultado"), false);
  await a.page.evaluate(async () => { await abrirMes(); }).catch(() => {});
  await a.espera(600);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#mesCorpo .graf, #cxGrupos").length), 0);
  await a.fechar();
});
