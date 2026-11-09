const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

/* 14 dias fechados: o produto 1 vende 10 por dia (sobra 5), o 2 vende 3, o 3 vende 0 */
const historico = (db, hoje) => {
  let id = 100;
  for(let k = 14; k >= 1; k--){
    const d = diaMais(hoje, -k);
    const ab = id++, fe = id++;
    db.jb_contagem.push({ id: ab, data: d, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: d + "T12:00:00Z" });
    db.jb_contagem.push({ id: fe, data: d, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: d + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: ab, produto_id: 1, qtd: 15 }, { contagem_id: ab, produto_id: 2, qtd: 8 }, { contagem_id: ab, produto_id: 3, qtd: 4 });
    db.jb_contagem_item.push({ contagem_id: fe, produto_id: 1, qtd: 5 }, { contagem_id: fe, produto_id: 2, qtd: 5 }, { contagem_id: fe, produto_id: 3, qtd: 4 });
  }
  return db;
};

test("geladeira ideal: cálculo cobre 8 em 10 dias, peso do dia da semana e mínimo de 2", async () => {
  const a = await abrir("uJes");
  const r = await a.page.evaluate(() => {
    const dia = "2026-11-09"; // segunda
    const linhas = [];
    for(let k = 1; k <= 28; k++){
      const d = gdMaisDias(dia, -k);
      linhas.push({ data: d, produto_id: 1, vendeu: k % 5 === 0 ? 20 : 10, sobrou: 3, fechado: true, saiu_total: 10 });
      linhas.push({ data: d, produto_id: 2, vendeu: 0, sobrou: 2, fechado: true, saiu_total: 0 });
      linhas.push({ data: d, produto_id: 3, vendeu: 4, sobrou: 0, fechado: true, saiu_total: 4 });
    }
    linhas.push({ data: dia, produto_id: 1, vendeu: 99, sobrou: 0, fechado: false, saiu_total: 99 }); // hoje não entra
    const x = gdCalcular(linhas, dia);
    const v1 = linhas.filter(l => l.produto_id === 1 && l.data < dia).map(l => l.vendeu);
    return { f: x.__fator, esperado1: Math.ceil(gdPercentil(v1, 0.8) * x.__fator - 1e-9), i1: x[1].ideal, i2: x[2].ideal, i3: x[3].ideal, poucos: gdCalcular(linhas.slice(0, 9), dia)[1].ideal };
  });
  assert.ok(r.f >= 0.85 && r.f <= 1.3);
  assert.equal(r.i2, 2, "mínimo de 2");
  assert.equal(r.i1, r.esperado1, "8 em cada 10 dias, com o peso do dia da semana");
  assert.ok(r.i3 >= 5, "acabou todo dia: pede um pouco mais que os 4 vendidos");
  assert.equal(r.poucos, null, "menos de 7 dias: não crava");
  semErros(a); await a.fechar();
});

test("geladeira ideal: card na Home, chip na contagem e repor preenche o que falta", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    historico(db, hoje);
    db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T12:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 4 }, { contagem_id: 5, produto_id: 2, qtd: 9 }, { contagem_id: 5, produto_id: 3, qtd: 2 });
    return db;
  }});
  await a.espera(500);
  const card = await a.texto("#geladeiraCard");
  assert.match(card, /Geladeira ideal/);
  assert.match(card, /1 doce abaixo do ideal na abertura/);
  assert.match(card, /4 de 10/);

  await a.page.click("#btnGdRepor"); await a.espera(700);
  assert.equal(await a.tela(), "scCount");
  const valores = await a.page.evaluate(() => [...document.querySelectorAll("#countList .step input")].map(i => i.value));
  assert.deepEqual(valores, ["6", "", ""], "só o que falta para chegar em 10");
  assert.match(await a.texto("#countList"), /ideal 10/);
  assert.match(await a.texto("#countList"), /completo/);
  const tom = await a.page.evaluate(() => document.querySelector("#countList .item .ideal").dataset.tom);
  assert.equal(tom, "ok", "4 + 6 chega no ideal");
  semErros(a); await a.fechar();
});

test("geladeira ideal: equipe não vê o card", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => historico(db, hoje) });
  await a.espera(400);
  assert.equal(await a.page.evaluate(() => !!document.querySelector("#geladeiraCard")), false);
  semErros(a); await a.fechar();
});
