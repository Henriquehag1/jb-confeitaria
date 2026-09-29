const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const abrirEnc = async a => {
  await a.page.click("#btnEncomendas"); await a.espera(600);
  assert.equal(await a.tela(), "scEnc");
};
const cartao = (a, cod) => a.page.evaluate(c => {
  const e = [...document.querySelectorAll("#encLista .enc")].find(x => x.querySelector(".enc-meio small").textContent.trim() === c);
  return e ? { classe: e.className, sinal: e.querySelector(".enc-sinal").textContent, chip: e.querySelector(".enc-chip").textContent } : null;
}, cod);
const abrirCartao = (a, cod) => a.page.evaluate(c => {
  [...document.querySelectorAll("#encLista .enc")].find(x => x.querySelector(".enc-meio small").textContent.trim() === c)
    .querySelector(".enc-topo").click();
}, cod);
const botao = (a, rot) => a.page.evaluate(r => {
  [...document.querySelectorAll("#encLista .enc-acoes button")].find(b => b.textContent === r).click();
}, rot);

test("a Home do gestor mostra Encomendas de bolo, e a equipe não", async () => {
  let a = await abrir("uJes");
  assert.equal(await a.visivel("btnEncomendas"), true);
  semErros(a); await a.fechar();
  a = await abrir("uYas");
  assert.equal(await a.visivel("btnEncomendas"), false);
  await a.fechar();
});

test("com encomenda nova, o botão da Home avisa quantas estão esperando", async () => {
  const a = await abrir("uJes", { db: db => { db.jb_pendencias.push({ grupo:"encomenda", ordem:3, texto:"1 encomenda nova esperando confirmação", dica:"Do site: Ana", qtd:1 }); return db; } });
  assert.equal(await a.texto("#encSub"), "1 nova esperando você");
  semErros(a); await a.fechar();
});

test("as novas aparecem primeiro, a agenda por dia, e as entregues ficam recolhidas", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  const ordem = await a.page.evaluate(() =>
    [...document.querySelectorAll("#encLista > .grupotar, #encLista > .enc, #encLista > details")].map(e =>
      e.tagName === "DETAILS" ? "recolhidas" : e.classList.contains("grupotar") ? "# " + e.textContent : e.querySelector(".enc-meio small").textContent.trim()));
  assert.equal(ordem[0], "# Esperando você confirmar");
  assert.equal(ordem[1], "JB1001");
  assert.ok(ordem.indexOf("JB1002") > 1, JSON.stringify(ordem));
  assert.equal(ordem[ordem.length - 1], "recolhidas");
  const cab = await a.page.evaluate(() => [...document.querySelectorAll(".enc-cab b")].map(b => b.textContent));
  assert.deepEqual(cab, ["1", "1", "0"], "1 nova, 1 na agenda, nenhum sinal a receber");
  semErros(a); await a.fechar();
});

test("o cartão aberto mostra a conta, o recado e o WhatsApp do cliente já escrito", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await abrirCartao(a, "JB1001"); await a.espera(200);
  const d = await a.page.evaluate(() => {
    const e = document.querySelector("#encLista .enc.aberta");
    return {
      linhas: [...e.querySelectorAll(".enc-det .linhaval")].map(l => l.querySelector(".n").textContent + "=" + l.querySelector(".v").textContent),
      info: [...e.querySelectorAll(".enc-info dt")].map(x => x.textContent),
      wa: e.querySelector(".enc-wa").href
    };
  });
  assert.ok(d.linhas.includes("Chantininho=R$ 340,00"), JSON.stringify(d.linhas));
  assert.ok(d.linhas.includes("Total=R$ 712,00"));
  assert.ok(d.info.includes("Escrita") && d.info.includes("Cor") && d.info.includes("Como"));
  assert.match(d.wa, /^https:\/\/wa\.me\/5511988887777\?text=/);
  const txt = decodeURIComponent(d.wa.split("?text=")[1]);
  assert.match(txt, /^oi, Ana! aqui é a Jessica :\) recebi seu pedido JB1001/);
  assert.match(txt, /o sinal é de R\$ 356,00 no Pix/);
  semErros(a); await a.fechar();
});

test("sinal recebido confirma a encomenda e ela vai para a agenda", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await abrirCartao(a, "JB1001"); await a.espera(150);
  await botao(a, "Sinal recebido, confirmar"); await a.espera(300);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_encomenda").pop();
  assert.equal(upd[2].status, "confirmada");
  assert.equal(upd[2].sinal_pago, true);
  const c = await cartao(a, "JB1001");
  assert.equal(c.chip, "confirmada");
  assert.match(c.sinal, /Sinal de R\$ 356,00 recebido\. Falta R\$ 356,00 na retirada/);
  const primeiro = await a.page.evaluate(() => document.querySelector("#encLista > .grupotar").textContent);
  assert.notEqual(primeiro, "Esperando você confirmar", "não sobrou nenhuma nova");
  semErros(a); await a.fechar();
});

test("pronto e entregue seguem em ordem, e cancelar pede confirmação", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await abrirCartao(a, "JB1002"); await a.espera(150);
  await botao(a, "Bolo pronto"); await a.espera(250);
  assert.equal((await cartao(a, "JB1002")).chip, "pronta");
  await botao(a, "Entregue"); await a.espera(250);
  assert.equal((await cartao(a, "JB1002")).chip, "entregue");
  // cancelar a nova
  await abrirCartao(a, "JB1001"); await a.espera(150);
  await botao(a, "Cancelar"); await a.espera(250);
  assert.ok(a.confirms.some(m => /Cancelar a encomenda JB1001 de Ana Paula/.test(m)));
  assert.equal((await cartao(a, "JB1001")).chip, "cancelada");
  semErros(a); await a.fechar();
});

test("a anotação interna salva ao sair do campo", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await abrirCartao(a, "JB1002"); await a.espera(150);
  const ta = a.page.locator("#encLista .enc.aberta .enc-nota textarea");
  await ta.fill("trazer vela 30"); await ta.dispatchEvent("blur"); await a.espera(250);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_encomenda").pop();
  assert.equal(upd[2].nota_interna, "trazer vela 30");
  semErros(a); await a.fechar();
});

test("na aba Cardápio e preços, mudar um preço grava e vale para o site", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await a.page.click("#abaEncCardapio"); await a.espera(300);
  assert.equal(await a.titulo(), "Cardápio de bolos");
  const inp = a.page.locator('.enc-precos input[aria-label="Naked Cake, tamanho M"]');
  assert.equal(await inp.inputValue(), "260,00");
  await inp.fill("275"); await inp.dispatchEvent("blur"); await a.espera(250);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_bolo_opcao").pop();
  assert.deepEqual(upd[2].preco_m, 275);
  assert.equal(await inp.inputValue(), "275,00");
  assert.match(await a.texto("#toast"), /Naked Cake M: R\$ 275,00\. Já vale no site/);
  semErros(a); await a.fechar();
});

test("desligar uma opção tira do site sem apagar", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await a.page.click("#abaEncCardapio"); await a.espera(300);
  await a.page.click('input[aria-label="Mostrar Kinder Bueno no site"]'); await a.espera(250);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_bolo_opcao").pop();
  assert.equal(upd[2].ativo, false);
  assert.equal((await a.log("delete")).filter(d => d[1] === "jb_bolo_opcao").length, 0);
  semErros(a); await a.fechar();
});

test("tamanho não tem campo de preço: o preço mora no modelo", async () => {
  const a = await abrir("uJes");
  await abrirEnc(a);
  await a.page.click("#abaEncCardapio"); await a.espera(300);
  const n = await a.page.evaluate(() => {
    const op = [...document.querySelectorAll(".enc-op")].find(o => o.querySelector("b").textContent.startsWith("PP"));
    return op.querySelectorAll(".enc-precos input").length;
  });
  assert.equal(n, 0);
  semErros(a); await a.fechar();
});
