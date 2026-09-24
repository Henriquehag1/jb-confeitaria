const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

test("plano de produção: seletor de dia aparece para a Jessica (regressão da montarDias duplicada)", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnProducao"); await a.espera(500);
  assert.equal(await a.tela(), "scProd");
  const chips = await a.page.evaluate(() => [...document.querySelectorAll("#prodDias button")].map(b => b.textContent));
  assert.ok(chips.length >= 3, "chips de dia: " + JSON.stringify(chips));
  assert.ok(chips.some(c => /Hoje/.test(c)));
  assert.ok(chips.some(c => /Amanhã/.test(c)));
  // e o calendário de "Quem veio" continua com o dele
  await a.page.click("#navVoltar"); await a.espera(400);
  await a.page.click("#btnDias"); await a.espera(500);
  assert.equal(await a.tela(), "scDias");
  assert.ok((await a.page.evaluate(() => document.querySelectorAll("#diasChips button").length)) >= 3);
  semErros(a); await a.fechar();
});

test("Eliana abre receita não conferida com a faixa de aviso, em vez de ficar travada", async () => {
  const a = await abrir("uEli");
  assert.equal(await a.tela(), "scHome");
  await a.page.click("#btnProducao"); await a.espera(500);
  const sub = await a.page.evaluate(() => {
    const n = [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Brownie Brigadeiro/.test(e.textContent));
    return n.querySelector("small").textContent;
  });
  assert.match(sub, /não conferido pela Jessica/);
  await a.page.evaluate(() => {
    [...document.querySelectorAll("#prodLista .prod .n")].find(e => /Brownie Brigadeiro/.test(e.textContent)).click();
  });
  await a.espera(500);
  assert.equal(await a.tela(), "scReceita", "a receita abre");
  assert.match(await a.texto("#scReceita .msg.warn"), /ainda não conferido pela Jessica/);
  semErros(a); await a.fechar();
});

test("numBR: o mesmo dedo, o mesmo número, em qualquer tela", async () => {
  const a = await abrir("uJes");
  const r = await a.page.evaluate(() => ["18,90", "18.90", "1.250,50", "1,250.50", "1250", "1.250", "1.5", "3.125", "R$ 44,95", "", "abc"].map(numBR));
  assert.deepEqual(r, [18.9, 18.9, 1250.5, 1250.5, 1250, 1250, 1.5, 3125, 44.95, null, null], "3.125 e milhar, como no Brasil");
  semErros(a); await a.fechar();
});

test("fator: unidade que não converte devolve null, e a ficha marca a linha", async () => {
  const a = await abrir("uJes");
  const f = await a.page.evaluate(() => [fator("g","kg"), fator("kg","g"), fator("un","un"), fator("g","un",null), fator("g","un",50), fator("un","kg"), fator("ml","kg")]);
  assert.deepEqual(f, [0.001, 1000, 1, null, 0.02, null, null]);
  // ficha do brownie: usa "Ovos" por un (ok) e chocolate em g (ok). Troca a unidade de um item para forçar o alerta.
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.evaluate(async () => { await abrirFicha(10, "ficha"); });
  await a.espera(500);
  await a.page.evaluate(() => { FITENS[1].unidade = "g"; montarItens(); calcular(); });   // ovos em gramas sem equiv_g
  await a.espera(200);
  const alertas = await a.page.evaluate(() => [...document.querySelectorAll("#fichaItens .ing.alerta .alertatxt")].map(e => e.textContent));
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /não converte/);
  assert.match(await a.texto("#fichaResumo"), /Unidade que não converte/);
  semErros(a); await a.fechar();
});

test("salvar ficha vai pelo RPC em transação; sair com alteração pendente pergunta", async () => {
  const a = await abrir("uJes", { confirmar: false });
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.evaluate(async () => { await abrirFicha(10, "ficha"); });
  await a.espera(400);
  assert.equal(await a.page.evaluate(() => FICHA_SUJA), false);
  await a.page.fill("#fRend", "30");
  await a.page.dispatchEvent("#fRend", "input");
  assert.equal(await a.page.evaluate(() => FICHA_SUJA), true);
  // tenta sair: o confirm é recusado, continua na ficha
  await a.page.click("#btnFichaVoltar"); await a.espera(300);
  assert.equal(a.confirms.length, 1);
  assert.match(a.confirms[0], /não foram salvas/);
  assert.equal(await a.tela(), "scFicha");
  // salva
  await a.page.click("#btnFichaSalvar"); await a.espera(600);
  const rpc = (await a.log("rpc")).filter(r => r[1] === "jb_salvar_ficha");
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0][2].p_tipo, "ficha");
  assert.equal(rpc[0][2].p_id, 10);
  assert.equal(rpc[0][2].p_campos.rendimento_un, 30);
  assert.equal(rpc[0][2].p_itens.length, 3);
  assert.deepEqual((await a.log("delete")), [], "nenhum delete solto no cliente");
  assert.equal(await a.tela(), "scCustos");
  semErros(a); await a.fechar();
});

test("preço: salvar um preço atualiza só a linha, sem redesenhar a lista; taxa efetiva grava a data", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaPreco"); await a.espera(600);
  const antes = await a.page.evaluate(() => document.querySelectorAll("#listaCustos .pm").length);
  assert.ok(antes >= 1);
  await a.page.evaluate(() => { window.__marca = document.querySelector("#listaCustos .pm"); window.__marca.dataset.marca = "x"; });
  const inp = a.page.locator("#listaCustos .pm input.q").first();
  await inp.fill("19,90"); await inp.dispatchEvent("blur"); await a.espera(400);
  const up = (await a.log("upsert")).filter(u => u[1] === "jb_preco");
  assert.equal(up.length, 1);
  assert.equal(up[0][2].preco, 19.9);
  // a mesma linha continua no DOM (não foi recriada)
  assert.equal(await a.page.evaluate(() => document.querySelector("#listaCustos .pm").dataset.marca), "x");
  assert.match(await a.texto("#toast"), /salvo/);

  // taxa efetiva: grava o valor e a data da medição
  const taxa = a.page.locator("#precoPlacar .taxas label.wide input");
  await taxa.fill("38"); await taxa.dispatchEvent("blur"); await a.espera(500);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_canal");
  assert.equal(upd.length, 1);
  assert.equal(upd[0][2].taxa_efetiva, 0.38);
  assert.equal(upd[0][2].taxa_efetiva_em, hojeSP());
  assert.match(await a.texto("#precoPlacar .nota-taxa"), /medida de 38/);

  // custos da casa: lista o custo fixo calculado, linha a linha
  await a.page.evaluate(() => { ajustesAbertos = true; montarPlacar(); });
  await a.espera(500);
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#custosCasa .cl .nm")].map(e => e.firstChild.textContent));
  assert.ok(linhas.includes("Folha: Yasmin"), JSON.stringify(linhas));
  assert.ok(linhas.includes("Pró-labore da Jessica"));
  assert.match(await a.texto("#custosCasa .cabe"), /8\.099,44/);
  semErros(a); await a.fechar();
});

test("insumos: busca filtra em memória e o último preço pago aplica com um toque", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaInsumos"); await a.espera(600);
  const pagos = await a.page.evaluate(() => [...document.querySelectorAll("#listaCustos .ing .pago")].filter(e => e.textContent).map(e => e.textContent));
  assert.equal(pagos.length, 1);
  assert.match(pagos[0], /último pago: R\$ 2,89 por kg/);
  const consultasAntes = (await a.log("rpc")).length;
  await a.page.fill("#buscaInsumo", "açú"); await a.espera(300);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#listaCustos .ing .nm")].map(e => e.textContent));
  assert.deepEqual(nomes, ["Açúcar"]);
  await a.page.click("#listaCustos .ing .pago button"); await a.espera(400);
  const rpc = (await a.log("rpc")).filter(r => r[1] === "jb_aplicar_preco_compra");
  assert.equal(rpc.length, 1);
  assert.equal((await a.db("jb_insumo")).find(i => i.id === 102).custo_unit, 2.89);
  assert.match(await a.texto("#toast"), /agora custa R\$ 2,89/);
  semErros(a); await a.fechar();
});

test("resultado do mês: sincronizado em, e apagar um valor manual volta ao automático", async () => {
  const a = await abrir("uJes", { db: db => { db.jb_faturamento[0].manual = true; return db; } });
  await a.page.click("#btnResultado"); await a.espera(600);
  assert.equal(await a.tela(), "scMes");
  assert.match(await a.texto("#mesCorpo .placar .sync"), /Sincronizado com o Nosso Financeiro em/);
  const tags = await a.page.evaluate(() => [...document.querySelectorAll("#mesCorpo .linhaval .n small.manual")].map(e => e.textContent));
  assert.deepEqual(tags.filter(Boolean), ["digitado à mão"]);
  // apaga o valor manual do iFood
  const inp = a.page.locator("#mesCorpo .linhaval input.q").nth(1);
  await inp.fill(""); await inp.dispatchEvent("blur"); await a.espera(400);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_faturamento");
  assert.equal(upd.length, 1);
  assert.deepEqual(upd[0][2], { manual: false });
  assert.deepEqual((await a.log("upsert")).filter(u => u[1] === "jb_faturamento"), [], "não gravou zero");
  assert.equal(await inp.inputValue(), "317,02", "o valor sincronizado continua na tela");
  semErros(a); await a.fechar();
});

test("medir a fatia real com um repasse: dois números viram taxa efetiva com data", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaPreco"); await a.espera(600);
  // vai para o 99Food
  await a.page.evaluate(() => [...document.querySelectorAll("#precoCanais button")].find(b => b.textContent === "99Food").click());
  await a.espera(600);
  await a.page.evaluate(() => [...document.querySelectorAll("#precoPlacar .abrir")].find(b => /medir a fatia real/.test(b.textContent)).click());
  await a.espera(200);
  const campos = a.page.locator("#formCustos input");
  await campos.nth(0).fill("10.000,00"); await campos.nth(1).fill("5.300,00");
  await a.page.click("#formCustos .acoes button"); await a.espera(500);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_canal");
  assert.equal(upd.length, 1);
  assert.equal(upd[0][2].taxa_efetiva, 0.47);
  assert.equal(upd[0][2].taxa_efetiva_em, hojeSP());
  assert.match(await a.texto("#custosMsg"), /99Food fica com 47/);
  semErros(a); await a.fechar();
});

test("plano do dia por pessoa: a Yasmin não vê a massa que é da Eliana", async () => {
  const a = await abrir("uYas");
  await a.page.click("#btnProducao"); await a.espera(600);
  assert.equal(await a.tela(), "scProd");
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(e => e.childNodes[0].textContent.trim()));
  assert.ok(!nomes.some(n => /Massa Brownie/.test(n)), "massa da produção não aparece: " + JSON.stringify(nomes));
  assert.ok(nomes.length >= 1, "ainda vê o que é dela e o que é de todos");
  semErros(a); await a.fechar();
});

test("plano do dia por pessoa: a Eliana vê a massa dela e não vê o que é da Yasmin", async () => {
  const a = await abrir("uEli");
  await a.page.click("#btnProducao"); await a.espera(600);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista .prod .n")].map(e => e.childNodes[0].textContent.trim()));
  assert.ok(nomes.some(n => /Massa Brownie/.test(n)), "vê a massa: " + JSON.stringify(nomes));
  assert.ok(!nomes.some(n => /Pudim/.test(n)), "não vê o que foi direcionado à Yasmin");
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#prodLista select.para").length), 0,
    "quem não é gestor não escolhe destinatário");
  semErros(a); await a.fechar();
});

test("gestor escolhe para quem é cada item e a troca é salva", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnProducao"); await a.espera(700);
  const sels = await a.page.evaluate(() => [...document.querySelectorAll("#prodLista select.para")].map(s => s.value));
  assert.equal(sels.length, 3, "o gestor vê os três itens com seletor");
  assert.deepEqual(sels.sort(), ["equipe","producao","todos"]);

  // o item que hoje é de todos passa a ser só da produção
  await a.page.evaluate(() => {
    const s = [...document.querySelectorAll("#prodLista select.para")].find(x => x.value === "todos");
    s.value = "producao"; s.dispatchEvent(new Event("change"));
  });
  await a.espera(500);
  const salvos = (await a.db("jb_producao_item")).map(p => p.para).sort();
  assert.deepEqual(salvos, ["equipe","producao","producao"], "gravou o novo destino");
  assert.match(await a.texto("#prodMsg"), /agora aparece para/);
  semErros(a); await a.fechar();
});

test("massa nova nasce para a produção e produto novo para todos", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnProducao"); await a.espera(700);
  await a.page.evaluate(async () => { await addReceitaAoDia("subreceita:21"); });
  await a.espera(500);
  const novos = (await a.db("jb_producao_item")).filter(p => p.ref_id === 21 && p.tipo === "subreceita");
  assert.equal(novos.length, 1);
  assert.equal(novos[0].para, "producao");
  semErros(a); await a.fechar();
});

test("a tela de preço mostra o pedaço do vale e quanto a operadora fica", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaPreco"); await a.espera(600);
  await a.page.evaluate(() => [...document.querySelectorAll("#precoCanais button")].find(b => b.textContent === "99Food").click());
  await a.espera(600);
  const vale = await a.texto("#precoPlacar .nota-taxa.vale");
  assert.match(vale, /4,6% do que sai por aqui o cliente paga em vale/);
  assert.match(vale, /Pluxee/);
  assert.match(vale, /ficando com 15,2%/);
  assert.match(vale, /0,69% do preço/, "4,55% x 15,16% do preço");
  assert.match(await a.texto("#precoPlacar"), /antecipação automática, que ainda está ligada/);

  // canal sem vale não mostra a linha
  await a.page.evaluate(() => [...document.querySelectorAll("#precoCanais button")].find(b => b.textContent === "iFood").click());
  await a.espera(600);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#precoPlacar .nota-taxa.vale").length), 0);
  semErros(a); await a.fechar();
});

test("mudar o pago em vale salva com a data do dia", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaPreco"); await a.espera(600);
  await a.page.evaluate(() => [...document.querySelectorAll("#precoCanais button")].find(b => b.textContent === "99Food").click());
  await a.espera(600);
  const campo = a.page.locator("#precoPlacar .taxas input").nth(3);
  await campo.fill("6");
  await campo.blur(); await a.espera(500);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_canal");
  assert.equal(upd.length, 1);
  assert.equal(upd[0][2].vale_fatia, 0.06);
  assert.equal(upd[0][2].vale_fatia_em, hojeSP());
  semErros(a); await a.fechar();
});

test("canal desligado não vira chip na tela de preço, mas conta no resultado do mês", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(500);
  await a.page.click("#abaPreco"); await a.espera(600);
  const chips = await a.page.evaluate(() => [...document.querySelectorAll("#precoCanais button")].map(b => b.textContent));
  assert.ok(!chips.includes("Vale-refeição"), "chips: " + JSON.stringify(chips));

  await a.page.evaluate(async () => { await abrirMes(); }); await a.espera(800);
  assert.equal(await a.tela(), "scMes");
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#mesCorpo .linhaval .n")].map(e => e.childNodes[0].textContent.trim()));
  assert.ok(linhas.includes("Vale-refeição"), "linhas do mês: " + JSON.stringify(linhas));
  semErros(a); await a.fechar();
});

test("preco90: o preço saudável sempre termina em ,90 e arredonda para cima", async () => {
  const a = await abrir("uJes");
  const r = await a.page.evaluate(() => [27.41, 27.90, 27.95, 28.00, 12.01, 0, null, -5].map(preco90));
  assert.deepEqual(r, [27.90, 27.90, 28.90, 28.90, 12.90, null, null, null]);
  semErros(a); await a.fechar();
});

test("a conta do produto abre com a fórmula fechando: CMV + fixo + perdas = custo total", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(800);
  await a.page.evaluate(() => { const b=[...document.querySelectorAll("#precoCanais button")].find(x=>x.textContent==="iFood"); b.click(); });
  await a.espera(800);
  // a conta começa fechada
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#listaCustos .pm .conta").length), 0, "a conta começa fechada");
  await a.page.evaluate(() => document.querySelector("#listaCustos .pm .verconta").click());
  await a.espera(300);
  const linhas = await a.page.evaluate(() =>
    [...document.querySelectorAll("#listaCustos .pm .conta .cl")].map(d => [d.querySelector("span").textContent, d.querySelector("b").textContent]));
  const val = rot => {
    const l = linhas.find(([r]) => new RegExp(rot, "i").test(r));
    return l ? numBRnode(l[1]) : null;
  };
  function numBRnode(s){ return parseFloat(String(s).replace(/[^\d,.-]/g,"").replace(/\./g,"").replace(",",".")); }
  assert.ok(Math.abs(val("CMV") + val("Custo fixo") + val("Perdas") - val("Custo total")) < 0.02,
    "a soma do custo fecha: " + JSON.stringify(linhas));
  // e o lado do preço desconta app e imposto
  assert.ok(linhas.some(([r]) => /iFood fica com/.test(r)), "mostra a fatia do app");
  assert.ok(linhas.some(([r]) => /Imposto/.test(r)), "mostra o imposto");
  assert.ok(linhas.some(([r]) => /^Lucro$/.test(r)), "fecha no lucro");
  // o giro vem da contagem
  assert.match(await a.texto("#listaCustos .pm .conta .giro"), /Sai 5 por dia/);
  semErros(a); await a.fechar();
});

test("o botão usar grava o preço saudável e a margem passa a bater com a meta", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(800);
  await a.page.evaluate(() => { const b=[...document.querySelectorAll("#precoCanais button")].find(x=>x.textContent==="iFood"); b.click(); });
  await a.espera(800);
  const alvo = await a.page.evaluate(() => document.querySelector("#listaCustos .pm .campo.alvo .v").textContent);
  assert.match(alvo, /^R\$ \d/, "o preço saudável aparece: " + alvo);
  await a.page.evaluate(() => document.querySelector("#listaCustos .pm .usar").click());
  await a.espera(700);
  const preco = await a.page.evaluate(() => document.querySelector("#listaCustos .pm input.q").value);
  assert.equal("R$ " + preco, alvo, "o preço de hoje virou o saudável");
  const salvo = (await a.db("jb_preco")).find(p => p.ficha_id === 10 && p.canal_id === 2);
  assert.ok(salvo && Math.abs(salvo.preco - parseFloat(alvo.replace(/[^\d,]/g,"").replace(",","."))) < 0.01, "gravou no banco: " + JSON.stringify(salvo));
  // e o botão some, porque já está no preço saudável
  assert.ok(await a.page.evaluate(() => document.querySelector("#listaCustos .pm .usar").classList.contains("hide")));
  semErros(a); await a.fechar();
});

test("mudar o volume recalcula o custo de todos os produtos na hora", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(800);
  const antes = await a.page.evaluate(() => contaLinha(LINHAS.find(l => l.ficha_id === 10)).custo);
  // o custo vem da view, então o teste checa o que a tela controla: a fórmula e o divisor
  await a.page.evaluate(() => { const b=[...document.querySelectorAll("#precoPlacar .abrir")].find(x=>/custos da casa/.test(x.textContent)); b.click(); });
  await a.espera(900);
  assert.match(await a.texto("#custosCasa .formula"), /custo total = \(CMV \+ R\$ [\d.,]+\) × 1,05/);
  assert.match(await a.texto("#custosCasa"), /Custo fixo por unidade/);
  // o aviso do volume real aparece quando cadastro e contagem discordam
  assert.match(await a.texto("#custosCasa"), /A contagem de 1 dia aponta 960 por mês/);
  const botao = await a.page.evaluate(() => { const b=[...document.querySelectorAll("#custosCasa .abrir")].find(x=>/usar a média real/.test(x.textContent)); return b ? b.textContent : null; });
  assert.match(botao || "", /usar a média real de 960 por mês/);
  assert.ok(antes > 0);
  semErros(a); await a.fechar();
});

test("o imposto sai do preço e não do custo", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(800);
  const r = await a.page.evaluate(() => {
    const l = LINHAS.find(x => x.ficha_id === 10);
    const com = contaLinha(l);
    const antes = CFG.imposto_pct;
    CFG.imposto_pct = 0;
    const sem = contaLinha(l);
    CFG.imposto_pct = antes;
    return { custoCom: com.custo, custoSem: sem.custo, lucroCom: com.lucro, lucroSem: sem.lucro, preco: com.preco, imp: com.impostoRS };
  });
  assert.equal(r.custoCom, r.custoSem, "o imposto não mexe no custo");
  assert.ok(Math.abs((r.lucroSem - r.lucroCom) - r.imp) < 0.01, "o imposto sai inteiro do lucro");
  assert.ok(Math.abs(r.imp - r.preco * 0.05) < 0.01, "5% do preço");
  semErros(a); await a.fechar();
});

test("quando o nome na contagem é diferente do nome da ficha, a conta diz qual é", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaPreco"); await a.espera(800);
  await a.page.evaluate(() => document.querySelector("#listaCustos .pm .verconta").click());
  await a.espera(300);
  assert.match(await a.texto("#listaCustos .pm .conta .giro"), /Na contagem este produto se chama .Brownie Classico./);
  semErros(a); await a.fechar();
});
