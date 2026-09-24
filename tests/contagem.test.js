const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
const { hojeSP, diaMais } = require("./stub");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const comAbertura = (db, hoje, autor = "uJes") => {
  db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: autor, nome_responsavel: autor === "uJes" ? "Jessica" : "Yasmin", criado_em: hoje + "T18:00:00Z" });
  db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 10 }, { contagem_id: 5, produto_id: 2, qtd: 20 }, { contagem_id: 5, produto_id: 3, qtd: 6 });
  return db;
};

test("Yasmin fecha o turno: campos vazios, Enter pula de item, salva pelo RPC em uma chamada, vê só a confirmação", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.tela(), "scCount");
  assert.deepEqual(await a.page.evaluate(() => [...document.querySelectorAll("#countList .step input")].map(i => i.value)), ["", "", ""]);

  // Enter no primeiro campo leva o foco ao segundo
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("2");
  await inputs.nth(0).press("Enter");
  assert.equal(await a.page.evaluate(() => [...document.querySelectorAll("#countList .step input")].indexOf(document.activeElement)), 1);
  await inputs.nth(1).fill("5"); await inputs.nth(2).fill("6");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);

  const rpcs = await a.log("rpc");
  const salva = rpcs.filter(r => r[1] === "jb_salvar_contagem");
  assert.equal(salva.length, 1, "uma chamada só");
  assert.equal(salva[0][2].p_momento, "fechamento");
  assert.deepEqual(salva[0][2].p_itens, [{ produto_id: 1, qtd: 2 }, { produto_id: 2, qtd: 5 }, { produto_id: 3, qtd: 6 }]);
  assert.equal(await a.tela(), "scFeito");
  const feito = await a.texto("#scFeito");
  assert.ok(!/itens saíram/.test(feito), "equipe não vê número de saída");
  assert.equal((await a.db("jb_contagem")).length, 2);
  semErros(a); await a.fechar();
});

test("Jessica fecha e vê o resultado; item tirado da lista no meio do dia continua na contagem", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem_item.push({ contagem_id: 5, produto_id: 4, qtd: 3 });   // Torta antiga, inativa
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(400);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#countList .item .nome")].map(e => e.textContent));
  assert.equal(nomes.length, 4, "3 ativos mais o que saiu da lista hoje");
  assert.match(nomes[3], /Torta antiga \(saiu da lista hoje\)/);
  const inputs = a.page.locator("#countList .step input");
  for(let i = 0; i < 4; i++) await inputs.nth(i).fill(String([2, 5, 6, 1][i]));
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.equal(await a.tela(), "scRes");
  const cab = await a.texto("#resBox .res .hd");
  assert.match(cab, /25 itens/, "10-2 + 20-5 + 6-6 + 3-1 = 25");
  semErros(a); await a.fechar();
});

test("falha ao carregar os itens de uma contagem salva não abre a tela (não zera nada)", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje), falha: { jb_contagem_item: true } });
  await a.page.click("#btnAbertura"); await a.espera(400);
  assert.equal(await a.tela(), "scHome");
  assert.match(await a.texto("#homeMsg"), /Não consegui abrir a contagem salva/);
  semErros(a); await a.fechar();
});

test("falha do RPC mantém o rascunho e a mensagem certa; tentar de novo funciona", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => comAbertura(db, hoje), falha: { "rpc:jb_salvar_contagem": true } });
  await a.page.click("#btnFechamento"); await a.espera(300);
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("1"); await inputs.nth(1).fill("2"); await inputs.nth(2).fill("3");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.equal(await a.tela(), "scCount");
  assert.match(await a.texto("#countMsg"), /guardado no celular/);
  // a rede volta
  await a.page.evaluate(() => { window.__FALHA = {}; });
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.equal(await a.tela(), "scFeito");
  semErros(a); await a.fechar();
});

test("equipe tentando alterar contagem que não é dela recebe a mensagem de permissão", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T23:00:00Z" });
    return db;
  }});
  // fechamento já existe (da Jessica): equipe cai na tela de feito; força a contagem por dentro
  await a.page.evaluate(async () => { await abrirContagem("fechamento"); });
  await a.espera(300);
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("1"); await inputs.nth(1).fill("2"); await inputs.nth(2).fill("3");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(500);
  assert.match(await a.texto("#countMsg"), /não pode ser alterada por você/);
  semErros(a); await a.fechar();
});

test("adendo grava linhas novas e aparece somado no resultado da Jessica", async () => {
  const hoje = hojeSP();
  const a = await abrir("uYas", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 2 }, { contagem_id: 6, produto_id: 2, qtd: 5 }, { contagem_id: 6, produto_id: 3, qtd: 6 });
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(300);
  assert.equal(await a.tela(), "scFeito");
  await a.page.click("#btnAdendo"); await a.espera(300);
  await a.page.locator("#adList .step input").nth(1).fill("1");
  await a.page.fill("#adTexto", "Pedido do iFood 22h40");
  await a.espera(150);
  await a.page.click("#btnAdSalvar"); await a.espera(400);
  const ad = await a.db("jb_adendo");
  assert.equal(ad.length, 2);
  assert.equal(ad[0].produto_id, 2); assert.equal(ad[0].qtd, 1);
  assert.equal(ad[1].texto, "Pedido do iFood 22h40");
  assert.equal(await a.tela(), "scFeito");
  semErros(a); await a.fechar();
});

test("resultado do turno: tabela com o que saiu e o que ficou na geladeira, já descontando o que saiu depois", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 2 }, { contagem_id: 6, produto_id: 2, qtd: 5 }, { contagem_id: 6, produto_id: 3, qtd: 6 });
    db.jb_adendo.push({ id: 1, data: hoje, produto_id: 1, qtd: 1, texto: null, registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:40:00Z" });
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(500);
  assert.equal(await a.tela(), "scRes");

  const cabecalho = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres thead th")].map(e => e.textContent));
  assert.deepEqual(cabecalho, ["Item", "Deixei", "Saiu", "Ficou"]);

  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr")].map(tr =>
    [...tr.children].map(td => td.textContent.replace(/\s+/g, " ").trim())));
  // a tabela vem em ranking: bolo gelado vendeu 15, brownie 9, pudim 0
  assert.match(linhas[0][0], /Bolo Gelado/);
  assert.deepEqual(linhas[0].slice(1), ["20", "15", "5"]);
  // brownie: deixou 10, sobrou 2 no fechamento, 1 saiu depois -> saiu 9 e ficou 1
  assert.match(linhas[1][0], /Brownie/);
  assert.match(linhas[1][0], /sendo 1 depois do fechamento/);
  assert.deepEqual(linhas[1].slice(1), ["10", "9", "1"]);
  assert.match(linhas[2][0], /Pudim/);
  assert.deepEqual(linhas[2].slice(1), ["6", "0", "6"]);

  const rodape = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tfoot tr")[0].children].map(e => e.textContent));
  assert.deepEqual(rodape, ["Total", "36", "24", "12"]);
  assert.match(await a.texto("#resBox .resumo .ficou"), /12/);
  assert.match(await a.texto("#resBox .resumo .ficou"), /ficaram na geladeira/);
  semErros(a); await a.fechar();
});

test("dia ainda sem fechamento: a tabela não inventa saída, mostra o que está na geladeira", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.evaluate(async () => { await mostrarResultado(hojeSP()); });
  await a.espera(400);
  assert.equal(await a.tela(), "scRes");
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr")].map(tr =>
    [...tr.children].map(td => td.textContent.replace(/\s+/g, " ").trim())));
  assert.deepEqual(linhas[0].slice(1), ["10", "?", "?"]);
  assert.match(await a.texto("#resBox .res .hd"), /Turno em andamento/);
  assert.match(await a.texto("#resBox .tip"), /ainda não foi fechado/);
  semErros(a); await a.fechar();
});

test("reposição durante o dia soma na geladeira em vez de trocar o número", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.click("#btnAbertura"); await a.espera(400);
  assert.equal(await a.tela(), "scCount");
  // reabrir a abertura já salva cai no modo repor: campos vazios e o que já tem na linha
  assert.equal(await a.page.evaluate(() => MODO), "repor");
  assert.deepEqual(await a.page.evaluate(() => [...document.querySelectorAll("#countList .step input")].map(i => i.value)), ["", "", ""]);
  const bases = await a.page.evaluate(() => [...document.querySelectorAll("#countList .item .base")].map(e => e.textContent));
  assert.deepEqual(bases, ["tem 10 na geladeira", "tem 20 na geladeira", "tem 6 na geladeira"]);

  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("5"); await a.espera(150);
  assert.equal(await a.page.evaluate(() => document.querySelector("#countList .item .base").textContent), "tem 10, fica 15");
  assert.match(await a.page.evaluate(() => $("btnSalvar").textContent), /Somar à geladeira/);

  await a.page.click("#btnSalvar"); await a.espera(600);
  const salva = (await a.log("rpc")).filter(r => r[1] === "jb_salvar_contagem");
  assert.equal(salva.length, 1);
  assert.equal(salva[0][2].p_momento, "abertura");
  assert.deepEqual(salva[0][2].p_itens, [{ produto_id: 1, qtd: 15 }, { produto_id: 2, qtd: 20 }, { produto_id: 3, qtd: 6 }]);
  assert.equal((await a.db("jb_contagem")).length, 1, "não criou contagem nova");
  assert.equal(await a.tela(), "scHome");
  assert.match(await a.texto("#homeMsg"), /Reposição somada: 1 item\. A geladeira agora tem 41 itens\./);

  // e corrigir continua existindo, com os totais na tela
  await a.page.click("#btnAbertura"); await a.espera(400);
  await a.page.click("#btnModoContar"); await a.espera(400);
  assert.equal(await a.page.evaluate(() => MODO), "contar");
  assert.deepEqual(await a.page.evaluate(() => [...document.querySelectorAll("#countList .step input")].map(i => i.value)), ["15", "20", "6"]);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#countList .item .base").length), 0);
  semErros(a); await a.fechar();
});

const comOntemFechado = (db, hoje) => {
  const ontem = diaMais(hoje, -1);
  db.jb_contagem.push({ id: 20, data: ontem, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: ontem + "T10:00:00Z" });
  db.jb_contagem_item.push({ contagem_id: 20, produto_id: 1, qtd: 12 }, { contagem_id: 20, produto_id: 2, qtd: 20 }, { contagem_id: 20, produto_id: 3, qtd: 8 });
  db.jb_contagem.push({ id: 21, data: ontem, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: ontem + "T23:00:00Z" });
  db.jb_contagem_item.push({ contagem_id: 21, produto_id: 1, qtd: 4 }, { contagem_id: 21, produto_id: 2, qtd: 6 }, { contagem_id: 21, produto_id: 3, qtd: 3 });
  return db;
};

test("abertura cruza com o fechamento de ontem: mostra o saldo, não zera o que não foi contado", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comOntemFechado(db, hoje), confirmar: true });
  await a.page.click("#btnAbertura"); await a.espera(600);
  assert.equal(await a.tela(), "scCount");

  const dicas = await a.page.evaluate(() => [...document.querySelectorAll("#countList .item .base")].map(e => e.textContent));
  assert.deepEqual(dicas, ["ontem ficaram 4", "ontem ficaram 6", "ontem ficaram 3"]);
  assert.match(await a.texto("#countMsg"), /Confira a geladeira contra o que ficou ontem/);
  assert.match(await a.page.evaluate(() => $("btnSalvar").textContent), /Confere com ontem, abrir o turno/,
    "sem digitar nada, o botão confirma em vez de mandar recontar");

  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("10"); await a.espera(120);
  assert.equal(await a.page.evaluate(() => document.querySelector("#countList .item .base").textContent), "ontem ficaram 4, entraram 6");
  await inputs.nth(1).fill("2"); await a.espera(120);
  assert.equal(await a.page.evaluate(() => [...document.querySelectorAll("#countList .item .base")][1].textContent), "ontem ficaram 6, faltam 4");
  // o terceiro fica em branco de propósito

  await a.page.click("#btnSalvar"); await a.espera(700);
  assert.equal(a.confirms.length, 0, "item em branco que tem saldo de ontem salva direto, sem perguntar");

  const salva = (await a.log("rpc")).filter(r => r[1] === "jb_salvar_contagem");
  assert.deepEqual(salva[0][2].p_itens, [{ produto_id: 1, qtd: 10 }, { produto_id: 2, qtd: 2 }, { produto_id: 3, qtd: 3 }],
    "o item em branco manteve os 3 que ficaram ontem, não virou zero");
  assert.equal(await a.tela(), "scHome");
  assert.match(await a.texto("#homeMsg"), /Entraram 6 itens novos/);
  assert.match(await a.texto("#homeMsg"), /faltaram 4 itens/);
  semErros(a); await a.fechar();
});

test("resultado do turno separa o que veio de ontem do que entrou hoje", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comOntemFechado(db, hoje);
    comAbertura(db, hoje);                                   // hoje: 10, 20, 6
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 2 }, { contagem_id: 6, produto_id: 2, qtd: 5 }, { contagem_id: 6, produto_id: 3, qtd: 6 });
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(600);
  const cabecalho = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres thead th")].map(e => e.textContent));
  assert.deepEqual(cabecalho, ["Item", "Ontem", "Entrou", "Saiu", "Ficou"]);
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr")].map(tr =>
    [...tr.children].slice(1).map(td => td.textContent)));
  // em ranking: bolo gelado vendeu 15, brownie 8, pudim 0
  assert.deepEqual(linhas[0], ["6", "14", "15", "5"]);
  // brownie: ontem ficaram 4, a abertura contou 10, então entraram 6; saiu 8 e ficou 2
  assert.deepEqual(linhas[1], ["4", "6", "8", "2"]);
  assert.deepEqual(linhas[2], ["3", "3", "0", "6"]);
  assert.match(await a.texto("#resBox .tip"), /Ontem mais Entrou menos Saiu/);
  semErros(a); await a.fechar();
});

test("item que aparece na abertura com menos do que ficou ontem vira aviso no resultado", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comOntemFechado(db, hoje);
    db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T10:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 1 }, { contagem_id: 5, produto_id: 2, qtd: 6 }, { contagem_id: 5, produto_id: 3, qtd: 3 });
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 1 }, { contagem_id: 6, produto_id: 2, qtd: 6 }, { contagem_id: 6, produto_id: 3, qtd: 3 });
    return db;
  }});
  await a.page.evaluate(async () => { await mostrarResultado(hojeSP()); }); await a.espera(600);
  assert.match(await a.texto("#resBox .msg.warn"), /apareceram na abertura com menos/);
  semErros(a); await a.fechar();
});

test("perda com motivo sai da conta da venda e aparece no resultado", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 2 }, { contagem_id: 6, produto_id: 2, qtd: 5 }, { contagem_id: 6, produto_id: 3, qtd: 6 });
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(600);
  assert.equal(await a.tela(), "scRes");
  assert.match(await a.texto("#resBox .resumo .saiu"), /23/, "36 deixados, 13 sobraram, 23 saíram");

  await a.page.evaluate(() => [...document.querySelectorAll("#resBox .mais")].find(b => /Registrar perda/.test(b.textContent)).click());
  await a.espera(500);
  assert.equal(await a.tela(), "scPerda");

  // dois brownies venceram
  await a.page.evaluate(() => [...document.querySelectorAll("#peMotivos button")].find(b => b.textContent === "Venceu").click());
  await a.page.locator("#peList .step input").nth(0).fill("2");
  await a.page.fill("#peObs", "sobrou do sábado");
  await a.espera(200);
  await a.page.click("#btnPeSalvar"); await a.espera(700);

  const perdas = await a.db("jb_perda");
  assert.equal(perdas.length, 1);
  assert.equal(perdas[0].produto_id, 1);
  assert.equal(perdas[0].qtd, 2);
  assert.equal(perdas[0].motivo, "venceu");
  assert.equal(perdas[0].obs, "sobrou do sábado");

  assert.equal(await a.tela(), "scRes");
  assert.match(await a.texto("#resBox .resumo .saiu"), /21vendidos/, "23 saíram, 2 se perderam, 21 viraram venda");
  assert.match(await a.texto("#resBox .resumo .perdido"), /2/);
  const comNota = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr")]
    .map(tr => tr.textContent).filter(t => /não virou venda/.test(t)));
  assert.equal(comNota.length, 1);
  assert.match(comNota[0], /Brownie/);
  assert.match(await a.texto("#resBox .adja"), /Venceu: sobrou do sábado/);
  semErros(a); await a.fechar();
});

test("falta na abertura oferece registrar a perda já preenchida", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comOntemFechado(db, hoje), confirmar: true });
  await a.page.click("#btnAbertura"); await a.espera(600);
  const inputs = a.page.locator("#countList .step input");
  await inputs.nth(0).fill("4"); await inputs.nth(1).fill("2"); await inputs.nth(2).fill("3");
  await a.espera(150);
  await a.page.click("#btnSalvar"); await a.espera(700);

  assert.equal(await a.tela(), "scHome");
  assert.match(await a.texto("#homeMsg"), /faltaram 4 itens/);
  await a.page.evaluate(() => document.querySelector("#homeMsg .mais").click());
  await a.espera(500);
  assert.equal(await a.tela(), "scPerda");
  const valores = await a.page.evaluate(() => [...document.querySelectorAll("#peList .step input")].map(i => i.value));
  assert.deepEqual(valores, ["", "4", ""], "veio preenchido só com o que faltou");
  assert.match(await a.texto("#peMsg"), /Já preenchi com o que faltou/);
  assert.match(await a.texto("#peData"), /depois de fechar/, "a perda pertence à sobra de ontem");
  assert.equal(await a.page.evaluate(() => PE_DIA), diaMais(hojeSP(), -1));

  // registrada como perda de depois do fechamento: some do saldo de ontem, não da venda
  await a.page.click("#btnPeSalvar"); await a.espera(700);
  const perdas = await a.db("jb_perda");
  assert.equal(perdas.length, 1);
  assert.equal(perdas[0].apos_fechamento, true);
  assert.equal(perdas[0].qtd, 4);
  assert.match(await a.texto("#homeMsg"), /Saiu do saldo que abre o dia seguinte/);
  semErros(a); await a.fechar();
});

test("perda de depois do fechamento fecha o buraco da manhã seguinte", async () => {
  const hoje = hojeSP(), ontem = diaMais(hoje, -1);
  const a = await abrir("uJes", { db: db => {
    comOntemFechado(db, hoje);                                  // ontem sobrou 4, 6 e 3
    db.jb_perda.push({ id: 1, data: ontem, produto_id: 2, qtd: 4, motivo: "venceu", apos_fechamento: true,
                       obs: null, registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T09:00:00Z" });
    db.jb_contagem.push({ id: 5, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T10:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 5, produto_id: 1, qtd: 4 }, { contagem_id: 5, produto_id: 2, qtd: 2 }, { contagem_id: 5, produto_id: 3, qtd: 3 });
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 4 }, { contagem_id: 6, produto_id: 2, qtd: 2 }, { contagem_id: 6, produto_id: 3, qtd: 3 });
    return db;
  }});
  await a.page.evaluate(async () => { await mostrarResultado(hojeSP()); }); await a.espera(600);
  const bolo = await a.page.evaluate(() => {
    const tr = [...document.querySelectorAll("#resBox .tres tbody tr")].find(l => /Bolo Gelado/.test(l.textContent));
    return [...tr.children].slice(1).map(td => td.textContent);
  });
  // o bolo gelado: ontem sobraram 6, 4 se perderam depois de fechar, então o saldo é 2 e não falta nada
  assert.deepEqual(bolo, ["2", "0", "0", "2"]);
  assert.equal(await a.page.evaluate(() => document.querySelectorAll("#resBox .msg.warn").length), 0, "sem aviso de sumiço");
  semErros(a); await a.fechar();
});

test("item da abertura que não foi contado no fechamento aparece como não contado, não como venda", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => {
    comAbertura(db, hoje);
    db.jb_contagem.push({ id: 6, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 6, produto_id: 1, qtd: 2 }, { contagem_id: 6, produto_id: 2, qtd: 5 });   // sem o Pudim
    return db;
  }});
  await a.page.click("#btnFechamento"); await a.espera(400);
  assert.equal(await a.tela(), "scRes");
  const linhas = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .res .ln")].map(l => l.textContent.replace(/\s+/g, " ").trim()));
  assert.match(linhas[2], /Pudim.*não foi contado no fechamento.*\?/);
  assert.match(await a.texto("#resBox .res .hd"), /23 itens/, "8 + 15, sem o pudim");
  semErros(a); await a.fechar();
});

test("resultado do turno vem em ranking e cada dia tem o seu, do mais vendido ao menos vendido", async () => {
  const hoje = hojeSP();
  const ontem = diaMais(hoje, -1);
  const a = await abrir("uJes", { db: db => {
    // ontem: pudim vendeu 9, brownie 4, bolo 1
    db.jb_contagem.push({ id: 11, data: ontem, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: ontem + "T18:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 11, produto_id: 1, qtd: 10 }, { contagem_id: 11, produto_id: 2, qtd: 10 }, { contagem_id: 11, produto_id: 3, qtd: 10 });
    db.jb_contagem.push({ id: 12, data: ontem, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: ontem + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 12, produto_id: 1, qtd: 6 }, { contagem_id: 12, produto_id: 2, qtd: 9 }, { contagem_id: 12, produto_id: 3, qtd: 1 });
    // hoje: bolo vendeu 18, brownie 5, pudim 0
    db.jb_contagem.push({ id: 13, data: hoje, momento: "abertura", registrado_por: "uJes", nome_responsavel: "Jessica", criado_em: hoje + "T10:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 13, produto_id: 1, qtd: 10 }, { contagem_id: 13, produto_id: 2, qtd: 20 }, { contagem_id: 13, produto_id: 3, qtd: 4 });
    db.jb_contagem.push({ id: 14, data: hoje, momento: "fechamento", registrado_por: "uYas", nome_responsavel: "Yasmin", criado_em: hoje + "T23:00:00Z" });
    db.jb_contagem_item.push({ contagem_id: 14, produto_id: 1, qtd: 5 }, { contagem_id: 14, produto_id: 2, qtd: 2 }, { contagem_id: 14, produto_id: 3, qtd: 4 });
    return db;
  }});

  const nomes = () => a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr .txt")].map(e => e.childNodes[0].textContent.trim()));
  // Saiu é sempre a penúltima coluna, tenha ou não a coluna Ontem
  const saiu = () => a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr")]
    .map(tr => tr.children[tr.children.length - 2].textContent.trim()));

  await a.page.evaluate(async d => { await mostrarResultado(d); }, hoje); await a.espera(500);
  assert.deepEqual(await nomes(), ["Bolo Gelado Supreme", "Brownie Brigadeiro", "Pudim"]);
  assert.deepEqual(await saiu(), ["18", "5", "0"]);

  // outro dia, outro ranking: a ordem acompanha o fechamento daquele dia
  await a.page.evaluate(async d => { await mostrarResultado(d); }, ontem); await a.espera(500);
  assert.deepEqual(await nomes(), ["Pudim", "Brownie Brigadeiro", "Bolo Gelado Supreme"]);
  assert.deepEqual(await saiu(), ["9", "4", "1"]);
  semErros(a); await a.fechar();
});

test("turno ainda aberto mantém a ordem da geladeira, porque ninguém sabe o que vendeu", async () => {
  const hoje = hojeSP();
  const a = await abrir("uJes", { db: db => comAbertura(db, hoje) });
  await a.page.evaluate(async () => { await mostrarResultado(hojeSP()); }); await a.espera(500);
  const nomes = await a.page.evaluate(() => [...document.querySelectorAll("#resBox .tres tbody tr .txt")].map(e => e.childNodes[0].textContent.trim()));
  assert.deepEqual(nomes, ["Brownie Brigadeiro", "Bolo Gelado Supreme", "Pudim"]);
  semErros(a); await a.fechar();
});
