const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const AGORA = "2026-11-14T15:00:00Z";   // sábado, meio-dia em São Paulo: ontem é 13/11

/* o que o banco devolve (jb_conferencia_geladeira), igual ao dia 13/11 real */
const DIA13 = {
  data: "2026-11-13", lido: true, fechado: true, saipos_itens: 94, saipos_valor: 3710.42, saiu: 124, vendido: 114, diferenca: 10,
  categorias: [
    { cat: "gelado", saiu: 47, vendido: 45, sem_sabor: 0, diferenca: 2 },
    { cat: "pote", saiu: 44, vendido: 40, sem_sabor: 8, diferenca: 4 },
    { cat: "nuvem", saiu: 25, vendido: 22, sem_sabor: 0, diferenca: 3 },
    { cat: "outro", saiu: 8, vendido: 7, sem_sabor: 0, diferenca: 1 }
  ],
  produtos: [
    { produto_id: 9, nome: "Bolo Gelado Supreme", cat: "gelado", saiu: 20, vendido: 19, diferenca: 1 },
    { produto_id: 10, nome: "Bolo Gelado Coco & Doce de Leite", cat: "gelado", saiu: 14, vendido: 14, diferenca: 0 },
    { produto_id: 12, nome: "Bolo Gelado Brigadeiro", cat: "gelado", saiu: 13, vendido: 12, diferenca: 1 },
    { produto_id: 4, nome: "No Pote | Bolo Choco Maracujá", cat: "pote", saiu: 17, vendido: 15, diferenca: 2 },
    { produto_id: 26, nome: "Bolo Nuvem", cat: "nuvem", saiu: 25, vendido: 22, diferenca: 3 }
  ],
  nao_mapeados: [], perdas: [{ produto_id: 9, qtd: 4, motivo: "venceu", obs: null, foto: false, quem: "Jessica" }]
};
const DIAS = [
  { data: "2026-11-11", lido: true, fechado: true, saiu: 128, vendido: 120, diferenca: 8, categorias: [], produtos: [], nao_mapeados: [], perdas: [] },
  { data: "2026-11-12", lido: false, fechado: true, saiu: 0, vendido: 0, diferenca: 0, categorias: [], produtos: [], nao_mapeados: [], perdas: [] },
  DIA13
];
const comConf = db => {
  db.__conf = JSON.parse(JSON.stringify(DIAS));
  db.jb_perda.push(
    { id: 901, data: "2026-11-03", produto_id: 9, qtd: 2, motivo: "consumo", obs: "Jessica", anulada: false, apos_fechamento: false },
    { id: 902, data: "2026-11-10", produto_id: 4, qtd: 1, motivo: "consumo", obs: "jessica ", anulada: false, apos_fechamento: false },
    { id: 903, data: "2026-11-12", produto_id: 26, qtd: 3, motivo: "consumo", obs: "família", anulada: false, apos_fechamento: false },
    { id: 904, data: "2026-11-12", produto_id: 26, qtd: 5, motivo: "consumo", obs: "família", anulada: true, apos_fechamento: false },
    { id: 905, data: "2026-10-30", produto_id: 26, qtd: 4, motivo: "consumo", obs: "Henrique", anulada: false, apos_fechamento: false },
    { id: 906, data: "2026-11-12", produto_id: 9, qtd: 2, motivo: "cortesia", obs: "cliente", anulada: false, apos_fechamento: false });
  return db;
};

test("contas puras: situação do dia e alertas", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(() => ({
    tol: [confgTolerancia(10), confgTolerancia(124), confgTolerancia(300)],
    ok: confgStatus({ lido: true, fechado: true, saiu: 120, diferenca: 2 }),
    zero: confgStatus({ lido: true, fechado: true, saiu: 120, diferenca: 0 }),
    ruim: confgStatus({ lido: true, fechado: true, saiu: 124, diferenca: 10 }),
    mais: confgStatus({ lido: true, fechado: true, saiu: 100, diferenca: -5 }),
    sem: confgStatus({ lido: false, fechado: true }),
    aberto: confgStatus({ lido: true, fechado: false }),
    al: confgAlertas({ lido: true, fechado: true,
      perdas: [{ motivo: "contagem", qtd: 12, obs: "contei errado" }, { motivo: "venceu", qtd: 4, foto: false }, { motivo: "cortesia", qtd: 2, foto: false }],
      nao_mapeados: [{ nome: "Coxinha nova", qtd: 3 }] })
  }));
  assert.deepEqual(r.tol, [2, 2, 6]);
  assert.deepEqual(r.ok, { tom: "ok", rot: "bateu (diferença de 2)" });
  assert.deepEqual(r.zero, { tom: "ok", rot: "bateu" });
  assert.deepEqual(r.ruim, { tom: "ruim", rot: "10 doces saíram sem venda" });
  assert.deepEqual(r.mais, { tom: "atencao", rot: "vendeu 5 a mais do que saiu" });
  assert.equal(r.sem.rot, "Saipos ainda não lido");
  assert.equal(r.aberto.rot, "dia sem fechamento");
  assert.equal(r.al.length, 3);
  assert.match(r.al[0], /Acerto de contagem de 12 \(contei errado\): conta como diferença/);
  assert.match(r.al[1], /Perda de 4 sem foto/);
  assert.match(r.al[2], /1 nome do Saipos sem ligação com a geladeira: Coxinha nova \(3\)/);
  semErros(a); await a.fechar();
});

test("consumo da casa: soma do mês por quem levou (pura)", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(() => consumoResumo([
    { motivo: "consumo", qtd: 2, obs: "Jessica" }, { motivo: "consumo", qtd: 1, obs: " jessica" },
    { motivo: "consumo", qtd: 3, obs: "família" }, { motivo: "consumo", qtd: 9, obs: "x", anulada: true },
    { motivo: "cortesia", qtd: 4, obs: "cliente" }]));
  assert.deepEqual(r, { total: 6, quem: [{ nome: "Família", qtd: 3 }, { nome: "Jessica", qtd: 3 }] });
  semErros(a); await a.fechar();
});

test("a Home do gestor mostra ontem contra o Saipos; a equipe não vê", async () => {
  const a = await abrir("uJes", { agora: AGORA, db: comConf });
  assert.match(await a.texto("#consumoCard"), /Consumo da casa · novembro/);
  assert.match(await a.texto("#consumoCard"), /6 doces no mês\./);
  assert.match(await a.texto("#consumoCard"), /Família 3 · Jessica 3/);
  assert.match(await a.texto("#cardConferencia"), /Geladeira x Saipos · ontem/);
  assert.match(await a.texto("#cardConferencia"), /Saíram 124, Saipos vendeu 114: 10 doces saíram sem venda\./);
  assert.equal(await a.page.$eval("#confgCard .gd-res", e => e.dataset.tom), "baixo");
  semErros(a); await a.fechar();

  const y = await abrir("uYas", { agora: AGORA, db: comConf });
  assert.equal(await y.texto("#cardConferencia"), "");
  assert.equal((await y.log("rpc")).filter(r => r[1] === "jb_conferencia_geladeira").length, 0, "nem pede ao banco");
  semErros(y); await y.fechar();
});

test("a tela: últimos dias, o de ontem aberto, categoria e doce por doce", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: comConf });
  await a.page.click("#confgCard"); await a.espera(500);
  assert.equal(await a.tela(), "scConfg");
  assert.equal(await a.titulo(), "Geladeira x Saipos");
  const rpc = (await a.log("rpc")).filter(r => r[1] === "jb_conferencia_geladeira").pop()[2];
  assert.deepEqual(rpc, { p_de: "2026-10-31", p_ate: "2026-11-13" }, "14 dias até ontem");
  const dias = await a.page.$$eval(".confg-dia", l => l.map(d => [d.dataset.data, d.dataset.tom, d.open]));
  assert.deepEqual(dias, [["2026-11-13", "ruim", true], ["2026-11-12", "info", false], ["2026-11-11", "ruim", false]]);
  assert.match(await a.texto(".confg-tot"), /18 doces sem venda em 2 dias/);
  const corpo = await a.texto('.confg-dia[data-data="2026-11-13"] .confg-corpo');
  assert.match(corpo, /Perda de 4 sem foto/);
  assert.match(corpo, /Bolos gelados.*saíram 47 · vendidos 45 · \+2/);
  assert.match(corpo, /Bolos de pote.*saíram 44 · vendidos 40 · \+4/);
  assert.match(corpo, /8 doces de combo vieram sem o sabor no Saipos/);
  assert.match(corpo, /Pote Bolo Choco Maracujá17 \/ 15\+2/);
  assert.match(await a.texto('.confg-dia[data-data="2026-11-12"]'), /Saipos ainda não lido/);
  semErros(a); await a.fechar();
});
