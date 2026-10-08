const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");
const AGORA = "2026-10-08T15:00:00Z";   // quinta, meio-dia em São Paulo
const bloco = nome => `.pessoa:has(h3:text-is("${nome}"))`;

const pessoal = db => {
  db.jb_pessoal_mes = [
    { user_id: "uEli", nome: "Eliana", mes: "2026-10-01", dias_combinados: 9, dias_veio: 2, dias_pendentes: 1, custo: 280 },
    { user_id: "uYas", nome: "Yasmin", mes: "2026-10-01", dias_combinados: 31, dias_veio: 5, dias_pendentes: 0, custo: 3683.33 }
  ];
  return db;
};

async function abrirDiasDe(uid, montar){
  const a = await abrir(uid || "uHen", { agora: AGORA, db: db => { pessoal(db); if(montar) montar(db); return db; } });
  a.texto = sel => a.page.locator(sel).first().innerText();
  await a.page.click("#btnDias"); await a.espera(500);
  return a;
}

test("contas puras da falta: horas da escala, virada da meia-noite e valor da hora", async () => {
  const a = await abrir("uHen", { agora: AGORA });
  const r = await a.page.evaluate(() => ({
    h1: eqHoras("18:00", "23:00"), h2: eqHoras("22:00", "02:00"), h3: eqHoras("16:30:00", "23:00:00"),
    t1: eqHorasTx(6.5), t2: eqHorasTx(5), t3: eqHorasTx(40 + 10 / 60),
    vh: eqValorHora({ user_id: "uYas", regime: "semanal", valor: 850 }, __DB.jb_escala, "2026-10-08"),
    vd: eqValorHora({ user_id: "uEli", regime: "diaria", valor: 140 }, __DB.jb_escala, "2026-10-08"),
    semana: eqHorasSemana(__DB.jb_escala, "uYas", "2026-10-08")
  }));
  assert.equal(r.h1, 5); assert.equal(r.h2, 4); assert.equal(r.h3, 6.5);
  assert.equal(r.t1, "6h30"); assert.equal(r.t2, "5h"); assert.equal(r.t3, "40h10");
  assert.ok(Math.abs(r.semana - (40 + 10 / 60)) < 1e-9);
  assert.equal(Math.round(r.vh * 100) / 100, 21.16);
  assert.equal(r.vd, null, "diarista não tem valor da hora para desconto");
  await a.fechar();
});

test("falta da Yasmin hoje com freela no lugar: desconta 6h30 e a freela vira conta a pagar", async () => {
  const a = await abrirDiasDe("uHen");
  assert.equal(await a.tela(), "scDias");
  assert.equal(await a.page.locator(bloco("Eliana") + " .eq-abre").count(), 0, "diarista não tem Registrar falta");

  await a.page.locator(bloco("Yasmin") + " .eq-abre").click(); await a.espera(200);
  assert.equal(await a.page.inputValue("#eqFaltaDia"), "2026-10-08");
  assert.equal(await a.page.inputValue("#eqFaltaEnt"), "16:30");
  assert.equal(await a.page.inputValue("#eqFaltaSai"), "23:00");
  assert.match(await a.texto("#eqFaltaConta"), /6h30 × R\$ 21,16 a hora = R\$ 137,55/);
  assert.equal(await a.page.isChecked("#eqDescSim"), true, "o padrão é descontar, mas o app pergunta");
  assert.match(await a.texto("#eqFormFalta"), /Descontar R\$ 137,55 do pagamento dela/);

  await a.page.check("#eqTemFreela"); await a.espera(150);
  await a.page.fill("#eqFreelaNome", "Ana");
  await a.page.fill("#eqFreelaValor", "120");
  await a.page.click("#eqFaltaSalvar"); await a.espera(500);

  const fa = await a.db("jb_falta");
  assert.equal(fa.length, 1);
  assert.equal(fa[0].user_id, "uYas"); assert.equal(fa[0].data, "2026-10-08");
  assert.equal(fa[0].horas, 6.5); assert.equal(fa[0].desconta, true); assert.equal(fa[0].valor_desconto, 137.55);

  const contas = (await a.db("jb_conta")).filter(c => c.tipo === "equipe");
  assert.equal(contas.length, 1);
  assert.equal(contas[0].valor, 120); assert.equal(contas[0].vencimento, "2026-10-08");
  assert.match(contas[0].descricao, /Freela Ana, .*08\/10.* no lugar de Yasmin/);

  const fr = await a.db("jb_freela");
  assert.equal(fr.length, 1);
  assert.equal(fr[0].falta_id, fa[0].id); assert.equal(fr[0].conta_id, contas[0].id); assert.equal(fr[0].no_lugar_de, "uYas");
  assert.equal(fr[0].entrada, "16:30"); assert.equal(fr[0].saida, "23:00");

  const dia8 = await a.page.locator(bloco("Yasmin") + ' .cal button:text-is("8")').getAttribute("class");
  assert.match(dia8, /falta/);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /1 falta no mês, desconto de R\$ 137,55/);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /Ana cobriu/);
  assert.match(await a.texto("#eqFreelas"), /Ana, 16:30 às 23:00 · R\$ 120,00 · no lugar de Yasmin · a pagar/);
  semErros(a); await a.fechar();
});

test("falta sem desconto quando o gestor escolhe não descontar", async () => {
  const a = await abrirDiasDe("uJes");
  await a.page.locator(bloco("Yasmin") + " .eq-abre").click(); await a.espera(150);
  await a.page.fill("#eqFaltaDia", "2026-10-06"); await a.espera(100);   // terça: 16:30 às 23:00
  await a.page.check("#eqDescNao");
  await a.page.fill("#eqFaltaMotivo", "consulta médica combinada");
  await a.page.click("#eqFaltaSalvar"); await a.espera(400);
  const fa = await a.db("jb_falta");
  assert.equal(fa.length, 1);
  assert.equal(fa[0].desconta, false); assert.equal(fa[0].valor_desconto, null);
  assert.equal(fa[0].motivo, "consulta médica combinada");
  assert.equal((await a.db("jb_freela") || []).length, 0);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /sem desconto/);
  semErros(a); await a.fechar();
});

test("cancelar pede dois toques e a freela cancelada sai de Contas a pagar", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_conta.push({ id: 40, tipo: "equipe", descricao: "Freela Bia, qua 07/10", competencia: "2026-10-01", vencimento: "2026-10-07", valor: 100,
      codigo_barras: null, documento: null, boleto_path: null, comprovante_path: null, pago_em: null, valor_pago: null, pago_por: null, nf_conta_fixa_id: null, obs: null, arquivada: false });
    db.jb_freela = [{ id: 1, nome: "Bia", data: "2026-10-07", entrada: "18:40", saida: "23:00", valor: 100, no_lugar_de: null, falta_id: null, conta_id: 40, cancelada: false }];
  });
  const cancela = '#eqFreelas [data-freela="1"] .ch-ed';
  await a.page.click(cancela); await a.espera(150);
  assert.equal((await a.db("jb_freela"))[0].cancelada, false, "um toque só arma");
  assert.match(await a.texto(cancela), /toque de novo/);
  await a.page.click(cancela); await a.espera(400);
  assert.equal((await a.db("jb_freela"))[0].cancelada, true);
  assert.equal((await a.db("jb_conta")).find(c => c.id === 40).arquivada, true);
  assert.match(await a.texto("#eqFreelas"), /Nenhuma freela no mês/);
  semErros(a); await a.fechar();
});

test("dia que o app anotou sozinho: Não veio tira, Veio confirma", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_dia_trabalhado = [
      { id: 7, user_id: "uEli", data: "2026-10-07", turno: "dia", status: "sugerido", origem: "auto" },
      { id: 8, user_id: "uEli", data: "2026-10-02", turno: "dia", status: "sugerido", origem: "auto" }
    ];
  });
  assert.match(await a.texto(bloco("Eliana") + " .eq-sug"), /Ela veio\?/);
  await a.page.click('[aria-label="Não veio em ' + await a.page.evaluate(() => dataCurta("2026-10-07")) + '"]'); await a.espera(400);
  assert.deepEqual((await a.db("jb_dia_trabalhado")).map(d => d.id), [8]);
  await a.page.click('[aria-label="Veio em ' + await a.page.evaluate(() => dataCurta("2026-10-02")) + '"]'); await a.espera(400);
  assert.equal((await a.db("jb_dia_trabalhado"))[0].status, "confirmado");
  assert.equal(await a.page.locator(bloco("Eliana") + " .eq-sug").count(), 0);
  semErros(a); await a.fechar();
});

test("Contas a pagar: quinzena da Yasmin já com a falta descontada e a diária da Eliana somando sozinha", async () => {
  const a = await abrir("uHen", { agora: AGORA, db: db => {
    db.jb_conta.push({ id: 41, tipo: "fixa", descricao: "Funcionária do ateliê, quinzena do dia 18", competencia: "2026-10-01", vencimento: "2026-10-18", valor: 1700,
      codigo_barras: null, documento: null, boleto_path: null, comprovante_path: null, pago_em: null, valor_pago: null, pago_por: null, nf_conta_fixa_id: 54,
      obs: null, arquivada: false, equipe_user_id: "uYas", periodo_ini: "2026-10-03", periodo_fim: "2026-10-17" });
    db.jb_falta = [
      { id: 1, user_id: "uYas", data: "2026-10-08", horas: 6.5, desconta: true, valor_desconto: 137.55, cancelada: false },
      { id: 2, user_id: "uYas", data: "2026-09-27", horas: 8, desconta: true, valor_desconto: 169.29, cancelada: false },   // outra quinzena
      { id: 3, user_id: "uYas", data: "2026-10-10", horas: 5, desconta: true, valor_desconto: 105.81, cancelada: true }    // cancelada
    ];
    db.jb_dia_trabalhado = [
      { id: 20, user_id: "uEli", data: "2026-10-01", turno: "dia", status: "confirmado", origem: "gestor", pago_em: "2026-10-06T15:00:00Z", pago_por: "uHen" },
      { id: 21, user_id: "uEli", data: "2026-10-08", turno: "dia", status: "confirmado", origem: "gestor" },
      { id: 22, user_id: "uEli", data: "2026-10-09", turno: "dia", status: "sugerido", origem: "auto" }
    ];
    return db;
  } });
  a.texto = sel => a.page.locator(sel).first().innerText();
  await a.page.click("#btnContas"); await a.espera(500);
  const card = '#contasLista .enc.conta[data-id="41"]';
  assert.match(await a.texto(card + " .enc-dir b"), /R\$ 1\.562,45/);
  assert.match(await a.texto(card + " .conta-falta"), /R\$ 1\.700,00 menos falta de .*08\/10 \(6h30, R\$ 137,55\) = R\$ 1\.562,45/);

  const eli = '#contaDiarias [data-diaria="uEli"]';
  assert.match(await a.texto(eli), /Eliana, diária de R\$ 140,00/);
  assert.match(await a.texto(eli), /1 dia em aberto: .*08\/10/);
  assert.match(await a.texto(eli + " .enc-dir b"), /R\$ 140,00/);

  await a.page.locator(card + " button", { hasText: "Paguei" }).click(); await a.espera(200);
  assert.equal(await a.page.inputValue("#contaValorPago"), "1562,45");

  await a.page.locator(eli + " button", { hasText: "Marcar como pagos" }).click(); await a.espera(500);
  assert.equal(await a.tela(), "scDias");
  semErros(a); await a.fechar();
});

test("Yasmin e Eliana não veem faltas nem freelas", async () => {
  for(const uid of ["uYas", "uEli"]){
    const a = await abrir(uid, { agora: AGORA, db: db => { db.jb_falta = [{ id: 1, user_id: "uYas", data: "2026-10-08", horas: 6.5, desconta: true, valor_desconto: 137.55, cancelada: false }]; return db; } });
    const r = await a.page.evaluate(async () => (await sb.from("jb_falta").select("*")).data.length);
    assert.equal(r, 0);
    assert.equal(await a.visivel("btnDias"), false);
    semErros(a); await a.fechar();
  }
});
