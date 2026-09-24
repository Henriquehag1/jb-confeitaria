const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const linhas = a => a.page.evaluate(() =>
  [...document.querySelectorAll("#estLista .item")].map(r => ({
    nome: r.querySelector(".nome").childNodes[0].textContent.trim(),
    base: (r.querySelector(".base") || {}).textContent || "",
    valor: r.querySelector(".step input").value
  })));

/* clica n vezes no + da linha daquele insumo */
const mais = (a, nome, n) => a.page.evaluate(([nm, vezes]) => {
  const linha = [...document.querySelectorAll("#estLista .item")]
    .find(r => r.querySelector(".nome").childNodes[0].textContent.trim() === nm);
  const b = [...linha.querySelectorAll(".step button")].pop();
  for(let i = 0; i < vezes; i++) b.click();
}, [nome, n]);

const compras = a => a.page.evaluate(() =>
  [...document.querySelectorAll("#estLista .promo-ln")].map(r => ({
    nome: r.querySelector(".nm").textContent,
    sub: r.querySelector(".sub").textContent,
    vl: r.querySelector(".vl").textContent,
    classe: r.className
  })));

test("o botão de estoque só aparece para o gestor", async () => {
  const j = await abrir("uJes");
  assert.equal(await j.visivel("btnEstoque"), true, "a Jessica vê");
  semErros(j); await j.fechar();

  const y = await abrir("uYas");
  assert.equal(await y.visivel("btnEstoque"), false, "a Yasmin não vê");
  semErros(y); await y.fechar();
});

test("a contagem lista só os insumos marcados, agrupados por prateleira", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);
  assert.equal(await a.tela(), "scEstoque");
  assert.equal(await a.titulo(), "Estoque");

  const ls = await linhas(a);
  const nomes = ls.map(l => l.nome);
  assert.deepEqual(nomes.sort(), ["Chocolate 50%", "Ovos"], "o Açúcar está fora da contagem: " + JSON.stringify(nomes));

  const grupos = await a.page.evaluate(() =>
    [...document.querySelectorAll("#estLista .grupotar")].map(g => g.textContent));
  assert.deepEqual(grupos, ["Prateleira de secos"]);

  assert.match(await a.texto("#estCab .g"), /^0 de 2$/);
  assert.equal(await a.visivel("estFoot"), false, "sem contagem aberta, não dá para fechar");
  semErros(a); await a.fechar();
});

test("quem tem embalagem conta em embalagem e o app converte para a unidade", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);

  await mais(a, "Chocolate 50%", 3);   // 0,5 · 1,0 · 1,5
  await a.espera(900);

  const l = (await linhas(a)).find(x => x.nome === "Chocolate 50%");
  assert.equal(l.valor, "1,5", "o passo da embalagem é de meio pacote");
  assert.match(l.base, /pacote 2,05kg/);
  assert.match(l.base, /dá 3,075 kg/, "1,5 pacote de 2,05kg dá 3,075kg: " + l.base);

  const itens = await a.db("jb_estoque_item");
  assert.equal(itens.length, 1, "gravou uma linha só, com o debounce");
  assert.equal(Number(itens[0].qtd_emb), 1.5);
  assert.equal(Number(itens[0].qtd_base), 3.075);

  const cont = await a.db("jb_estoque_contagem");
  assert.equal(cont.length, 1, "a contagem abriu sozinha no primeiro número");
  assert.equal(cont[0].data, hojeSP());
  assert.equal(cont[0].fechada, false);
  assert.equal(cont[0].nome_responsavel, "Jessica");

  assert.match(await a.texto("#estCab .g"), /^1 de 2$/);
  assert.equal(await a.visivel("estFoot"), true, "agora dá para fechar");
  semErros(a); await a.fechar();
});

test("quem não tem embalagem conta na própria unidade, de um em um", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);

  await mais(a, "Ovos", 2);
  await a.espera(900);

  const l = (await linhas(a)).find(x => x.nome === "Ovos");
  assert.equal(l.valor, "2");
  assert.match(l.base, /em un/);
  const it = (await a.db("jb_estoque_item")).find(i => i.insumo_id === 101);
  assert.equal(Number(it.qtd_base), 2, "sem embalagem, a conta é direta");
  semErros(a); await a.fechar();
});

test("sem contagem fechada, a lista de compra usa o consumo estimado e diz isso", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);
  await a.page.click("#abaEstComprar"); await a.espera(400);
  assert.equal(await a.titulo(), "O que comprar");

  const cs = await compras(a);
  const choco = cs.find(c => c.nome === "Chocolate 50%");
  assert.ok(choco, "o chocolate aparece: " + JSON.stringify(cs));
  assert.match(choco.sub, /tem 0 kg/);
  assert.match(choco.sub, /gasta 3 por semana/);
  assert.match(choco.sub, /consumo estimado/);
  // cobertura de 2 semanas = 6kg, em pacotes de 2,05kg dá 3 pacotes
  assert.equal(choco.vl, "3×");

  assert.match(await a.texto("#estCab p"), /Ainda não há contagem fechada/);
  semErros(a); await a.fechar();
});

test("com duas contagens fechadas, o consumo passa a vir da contagem", async () => {
  const a = await abrir("uJes", { db: db => {
    db.jb_estoque_contagem = [
      { id: 1, data: "2026-09-08", fechada: true },
      { id: 2, data: "2026-09-15", fechada: true }
    ];
    db.jb_estoque_item = [
      { id: 1, contagem_id: 1, insumo_id: 100, qtd_emb: 5, qtd_base: 10.25 },
      { id: 2, contagem_id: 2, insumo_id: 100, qtd_emb: 2, qtd_base: 4.10 }
    ];
    return db;
  }});
  await a.page.click("#btnEstoque"); await a.espera(600);
  await a.page.click("#abaEstComprar"); await a.espera(400);

  const choco = (await compras(a)).find(c => c.nome === "Chocolate 50%");
  // 10,25 − 4,10 = 6,15 kg em 7 dias
  assert.match(choco.sub, /tem 4,1 kg/);
  assert.match(choco.sub, /gasta 6,15 por semana/);
  assert.ok(!/estimado/.test(choco.sub), "não é mais estimativa: " + choco.sub);
  // faltam 2×6,15 − 4,10 = 8,2 kg, em pacotes de 2,05 dá 4
  assert.equal(choco.vl, "4×");
  assert.match(choco.classe, /fora/, "dura menos de uma semana, entra no vermelho");
  semErros(a); await a.fechar();
});

test("a compra lançada depois da contagem entra no saldo", async () => {
  const a = await abrir("uJes", { db: db => {
    db.jb_estoque_contagem = [{ id: 1, data: "2026-09-15", fechada: true }];
    db.jb_estoque_item = [{ id: 1, contagem_id: 1, insumo_id: 100, qtd_emb: 1, qtd_base: 2.05 }];
    db.jb_compra = [{ id: 900, data: "2026-09-17", fornecedor: "Distribuidora" }];
    db.jb_compra_item = [{ id: 900, compra_id: 900, insumo_id: 100, qtd_base: 6.15, unidade_base: "kg" }];
    return db;
  }});
  await a.page.click("#btnEstoque"); await a.espera(600);
  await a.page.click("#abaEstComprar"); await a.espera(400);

  const choco = (await compras(a)).find(c => c.nome === "Chocolate 50%");
  assert.match(choco.sub, /tem 8,2 kg/, "2,05 contado mais 6,15 comprado depois: " + choco.sub);
  assert.equal(choco.vl, "2,73 sem", "8,2 kg com consumo de 3 por semana dura 2,73 semanas");
  semErros(a); await a.fechar();
});

test("fechar a contagem avisa dos itens em branco e só fecha com a confirmação", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);
  await mais(a, "Chocolate 50%", 1); await a.espera(900);

  await a.page.click("#btnEstFechar"); await a.espera(900);
  assert.ok(a.confirms.some(m => /Faltam 1 item sem contar/.test(m)), "pergunta antes: " + JSON.stringify(a.confirms));
  const cont = await a.db("jb_estoque_contagem");
  assert.equal(cont[0].fechada, true);
  assert.ok(cont[0].fechada_em, "marca a hora do fechamento");
  // e cai na aba de compra, que é o passo seguinte
  assert.equal(await a.titulo(), "O que comprar");
  semErros(a); await a.fechar();
});

test("a lista para o WhatsApp sai separada por fornecedor", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);
  const txt = await a.page.evaluate(() => textoDaLista(EST.linhas));
  assert.match(txt, /DISTRIBUIDORA/);
  assert.match(txt, /- Chocolate 50%: 3 pacote 2,05kg/);
  assert.match(txt, /GRANJA/);
  assert.match(txt, /- Ovos: 200 un/, "sem embalagem cadastrada, sai na unidade: " + txt);
  semErros(a); await a.fechar();
});

test("a foto do insumo aparece na contagem e na lista de compra", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnEstoque"); await a.espera(600);

  const fotos = await a.page.evaluate(() =>
    [...document.querySelectorAll("#estLista .item")].map(r => {
      const im = r.querySelector("img.foto");
      return { nome: r.querySelector(".nome").childNodes[0].textContent.trim(), src: im ? im.getAttribute("src") : null };
    }));
  const choco = fotos.find(f => f.nome === "Chocolate 50%");
  assert.equal(choco.src, "img/insumos/chocolate-blend-melken.jpg", "o caminho relativo passa inteiro");
  assert.equal(fotos.find(f => f.nome === "Ovos").src, null, "sem foto cadastrada, a linha fica sem imagem");

  await a.page.click("#abaEstComprar"); await a.espera(400);
  const naCompra = await a.page.evaluate(() => {
    const ln = [...document.querySelectorAll("#estLista .promo-ln")]
      .find(r => r.querySelector(".nm").textContent === "Chocolate 50%");
    const im = ln.querySelector("img.foto");
    return { src: im ? im.getAttribute("src") : null, ordem: ln.firstElementChild.tagName };
  });
  assert.equal(naCompra.src, "img/insumos/chocolate-blend-melken.jpg");
  assert.equal(naCompra.ordem, "IMG", "a foto vem antes do texto");
  semErros(a); await a.fechar();
});
