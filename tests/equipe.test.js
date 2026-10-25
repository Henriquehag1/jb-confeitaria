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

  await a.page.locator(bloco("Yasmin") + " .eq-faltas > .eq-abre").click(); await a.espera(200);
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
  assert.match(await a.texto("#eqFreelas"), /Ana[\s\S]*16:30 às 23:00 · R\$ 120,00 · no lugar de Yasmin · a pagar/);
  semErros(a); await a.fechar();
});

test("falta sem desconto quando o gestor escolhe não descontar", async () => {
  const a = await abrirDiasDe("uJes");
  await a.page.locator(bloco("Yasmin") + " .eq-faltas > .eq-abre").click(); await a.espera(150);
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

test("banco de horas: compensa a falta antes de descontar e devolve o saldo se a falta for cancelada", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_banco_horas = [{ id: 1, user_id: "uYas", data: "2026-10-04", minutos: 45, motivo: "Chegou 45 min antes", origem: "chegada", falta_id: null, cancelado: false }];
  });
  const r = await a.page.evaluate(() => ({ c1: eqCompensa(390, 45, 850 / (40 + 10 / 60)), c2: eqCompensa(60, 90, 21), c3: eqCompensa(60, 0, 21), t: eqMinTx(45), t2: eqMinTx(-75) }));
  assert.deepEqual([r.c1.usa, r.c1.resto, r.c1.desconto], [45, 345, 121.68]);
  assert.deepEqual([r.c2.usa, r.c2.resto, r.c2.desconto], [60, 0, null]);
  assert.deepEqual([r.c3.usa, r.c3.resto, r.c3.desconto], [0, 60, 21]);
  assert.equal(r.t, "45 min"); assert.equal(r.t2, "1h15");

  assert.match(await a.texto("#eqBanco-uYas summary"), /Banco de horas: saldo de 45 min/);
  await a.page.locator(bloco("Yasmin") + " .eq-faltas > .eq-abre").click(); await a.espera(200);
  assert.equal(await a.page.isChecked("#eqDescBanco"), true, "com saldo, o padrão é usar o banco");
  assert.match(await a.texto("#eqFormFalta"), /Usar o banco de horas \(saldo 45 min\): usa 45 min e desconta R\$ 121,68 pelo resto/);
  await a.page.click("#eqFaltaSalvar"); await a.espera(500);

  const fa = await a.db("jb_falta");
  assert.equal(fa[0].banco_min, 45); assert.equal(fa[0].desconta, true); assert.equal(fa[0].valor_desconto, 121.68);
  const bh = await a.db("jb_banco_horas");
  assert.equal(bh.length, 2);
  assert.equal(bh[1].minutos, -45); assert.equal(bh[1].falta_id, fa[0].id); assert.equal(bh[1].origem, "falta");
  assert.match(await a.texto("#eqBanco-uYas summary"), /sem saldo/);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /usou 45 min do banco · desconta R\$ 121,68/);

  const c = `${bloco("Yasmin")} [data-falta="${fa[0].id}"] .ch-ed`;
  await a.page.click(c); await a.espera(150); await a.page.click(c); await a.espera(500);
  assert.equal((await a.db("jb_banco_horas"))[1].cancelado, true);
  assert.match(await a.texto("#eqBanco-uYas summary"), /saldo de 45 min/);
  semErros(a); await a.fechar();
});

test("chegou antes da escala nova de domingo: Ver chegadas mostra e põe no banco", async () => {
  const a = await abrirDiasDe("uJes", db => {
    db.jb_dia_trabalhado = [{ id: 30, user_id: "uYas", data: "2026-10-04", turno: "noite", status: "confirmado", origem: "auto", chegada: "2026-10-04T17:15:00Z", chegada_origem: "app" }];
  });
  await a.page.locator(bloco("Yasmin") + " .chegadas summary").click(); await a.espera(150);
  const ln = bloco("Yasmin") + " .chegadas .ch-ln";
  assert.match(await a.texto(ln), /chegou 14:15 · entrada 15:00/);
  assert.match(await a.texto(ln + " .min"), /45 min antes/);
  await a.page.locator(ln + " button", { hasText: "pôr no banco" }).click(); await a.espera(500);
  const bh = await a.db("jb_banco_horas");
  assert.equal(bh.length, 1);
  assert.equal(bh[0].minutos, 45); assert.equal(bh[0].origem, "chegada"); assert.equal(bh[0].data, "2026-10-04");
  assert.match(await a.texto("#eqBanco-uYas summary"), /saldo de 45 min/);
  semErros(a); await a.fechar();
});

test("banco negativo: atrasos aparecem devendo, com etiqueta em Ver chegadas e aviso no pagamento", async () => {
  const banco = [
    { id: 1, user_id: "uYas", data: "2026-10-04", minutos: 45, motivo: "Chegou 45 min antes", origem: "chegada", falta_id: null, dia_id: 30, cancelado: false },
    { id: 2, user_id: "uYas", data: "2026-10-02", minutos: -25, motivo: "Atraso: entrada 18:40, chegou 19:05", origem: "atraso", falta_id: null, dia_id: 31, cancelado: false },
    { id: 3, user_id: "uYas", data: "2026-09-30", minutos: -120, motivo: "Atraso de 2h sem data", origem: "manual", falta_id: null, dia_id: null, cancelado: false }
  ];
  const a = await abrirDiasDe("uHen", db => {
    db.jb_banco_horas = banco.map(b => ({ ...b }));
    db.jb_dia_trabalhado = [{ id: 31, user_id: "uYas", data: "2026-10-02", turno: "noite", status: "confirmado", origem: "auto", chegada: "2026-10-02T22:05:00Z", chegada_origem: "app" }];
  });
  const sm = await a.texto("#eqBanco-uYas summary");
  assert.match(sm, /Banco de horas: devendo 1h40/);
  assert.match(sm, /ainda sem decisão: abone o atraso aqui ou compense com horas a mais/);
  assert.equal(await a.page.getAttribute("#eqBanco-uYas summary", "class"), "neg");
  await a.page.click("#eqBanco-uYas summary"); await a.espera(100);
  assert.match(await a.texto('#eqBanco-uYas [data-banco="2"] .ch-ed'), /abonar/);
  await a.page.locator(bloco("Yasmin") + " .chegadas summary").click(); await a.espera(100);
  assert.match(await a.texto(bloco("Yasmin") + " .chegadas .ch-ln"), /−25 min no banco/);
  semErros(a); await a.fechar();

  const c = await abrir("uHen", { agora: AGORA, db: db => {
    db.jb_banco_horas = banco.map(b => ({ ...b }));
    db.jb_conta.push({ id: 41, tipo: "equipe", descricao: "Yasmin, 2 semanas (01/10 a 14/10)", competencia: "2026-10-01", vencimento: "2026-10-15", valor: 1700,
      codigo_barras: null, documento: null, boleto_path: null, comprovante_path: null, pago_em: null, valor_pago: null, pago_por: null, nf_conta_fixa_id: null,
      obs: null, arquivada: false, equipe_user_id: "uYas", periodo_ini: "2026-10-01", periodo_fim: "2026-10-14" });
    return db; } });
  await c.page.click("#btnContas"); await c.espera(500);
  assert.match(await c.texto('#contasLista .enc.conta[data-id="41"] .conta-banco'), /Banco de horas: devendo 1h40/);
  semErros(c); await c.fechar();
});

/* ===== Resumo do pagamento para enviar (só gestor) ===== */
const comQuinzena = db => {
  db.jb_conta.push({ id: 41, tipo: "fixa", descricao: "Funcionária do ateliê, quinzena do dia 18", competencia: "2026-10-01", vencimento: "2026-10-18", valor: 1700,
    codigo_barras: null, documento: null, boleto_path: null, comprovante_path: null, pago_em: null, valor_pago: null, pago_por: null, nf_conta_fixa_id: 54,
    obs: null, arquivada: false, equipe_user_id: "uYas", periodo_ini: "2026-10-03", periodo_fim: "2026-10-17" });
  db.jb_falta = [
    { id: 1, user_id: "uYas", data: "2026-10-08", entrada: "16:30:00", saida: "23:00:00", horas: 6.5, desconta: true, valor_desconto: 137.55, banco_min: 0, motivo: "Médico", cancelada: false },
    { id: 4, user_id: "uYas", data: "2026-10-06", entrada: "18:00:00", saida: "23:00:00", horas: 5, desconta: true, valor_desconto: 89.04, banco_min: 45, motivo: null, cancelada: false },
    { id: 2, user_id: "uYas", data: "2026-09-27", entrada: "16:30:00", saida: "23:00:00", horas: 8, desconta: true, valor_desconto: 169.29, banco_min: 0, cancelada: false },
    { id: 3, user_id: "uYas", data: "2026-10-10", entrada: "16:30:00", saida: "23:00:00", horas: 5, desconta: true, valor_desconto: 105.81, banco_min: 0, cancelada: true }
  ];
  db.jb_banco_horas = [{ id: 1, user_id: "uYas", data: "2026-10-04", minutos: -25, motivo: "Atraso", origem: "chegada", falta_id: null, cancelado: false }];
  db.jb_dia_trabalhado = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-07"].map((d, i) =>
    ({ id: 60 + i, user_id: "uYas", data: d, turno: "noite", status: "confirmado", origem: "gestor" }));
};

test("resumo do pagamento: período a pagar, faltas com dia e horário, total e valor a receber, pronto para copiar", async () => {
  for(const uid of ["uHen", "uJes"]){
    const a = await abrirDiasDe(uid, comQuinzena);
    const rel = bloco("Yasmin") + " .eq-rel";
    assert.equal(await a.page.locator(rel).count(), 1, "o gestor vê o resumo");
    assert.equal(await a.page.locator(bloco("Eliana") + " .eq-rel").count(), 0, "diarista não tem resumo");
    await a.page.locator(rel + " summary").click(); await a.espera(500);
    assert.equal(await a.page.inputValue("#eqRelPeriodo-uYas"), "2026-10-03|2026-10-17", "abre na quinzena a pagar");
    const t = await a.page.inputValue("#eqRelTexto-uYas");
    assert.match(t, /^Oi, Yasmin! Segue o resumo do seu pagamento de 03\/10 a 17\/10\./);
    assert.match(t, /Dias trabalhados no período: 4\./);
    assert.match(t, /Valor do período: R\$ 1\.700,00\./);
    assert.match(t, /• Falta em 06\/10 \(ter\), 18:00 às 23:00, 5h \(45 min compensadas com o banco de horas\): R\$ 89,04/);
    assert.match(t, /• Falta em 08\/10 \(qui\), 16:30 às 23:00, 6h30: R\$ 137,55/);
    assert.ok(t.indexOf("06/10") < t.indexOf("08/10"), "em ordem de data");
    assert.match(t, /Total de descontos: R\$ 226,59\./);
    assert.match(t, /Valor a receber: R\$ 1\.473,41\./);
    assert.doesNotMatch(t, /27\/09|10\/10/, "fora do período e cancelada não entram");
    assert.doesNotMatch(t, /Médico/, "o motivo da falta não vai na mensagem");
    assert.doesNotMatch(t, /Banco de horas:/, "banco só se marcar");
    assert.doesNotMatch(t, / [–—-] /, "sem travessão");

    await a.page.check("#eqRelBanco-uYas"); await a.espera(200);
    const t2 = await a.page.inputValue("#eqRelTexto-uYas");
    assert.match(t2, /Banco de horas: faltam 25 min para compensar \(ainda não descontado\)\./);
    assert.match(t2, /• 04\/10 \(dom\): −25 min, Atraso/);

    await a.page.evaluate(() => { window.__copiado = null; navigator.clipboard.writeText = async s => { window.__copiado = s; }; });
    await a.page.click("#eqRelCopiar-uYas"); await a.espera(200);
    assert.equal(await a.page.evaluate(() => window.__copiado), t2);
    semErros(a); await a.fechar();
  }
});

test("resumo do pagamento: outras datas sem conta lançada mostram só os descontos", async () => {
  const a = await abrirDiasDe("uHen", comQuinzena);
  const rel = bloco("Yasmin") + " .eq-rel";
  await a.page.locator(rel + " summary").click(); await a.espera(500);
  await a.page.fill("#eqRelDe-uYas", "2026-09-20");
  await a.page.fill("#eqRelAte-uYas", "2026-09-30"); await a.page.locator("#eqRelAte-uYas").dispatchEvent("change"); await a.espera(500);
  const t = await a.page.inputValue("#eqRelTexto-uYas");
  assert.match(t, /de 20\/09 a 30\/09/);
  assert.match(t, /Desconto:\n• Falta em 27\/09 \(dom\), 16:30 às 23:00, 8h: R\$ 169,29/);
  assert.doesNotMatch(t, /Valor a receber/);
  assert.match(await a.page.locator(rel).innerText(), /Não há conta a pagar lançada/);
  semErros(a); await a.fechar();
});

test("Yasmin não tem o resumo do pagamento nem lê o que ele usa", async () => {
  const a = await abrir("uYas", { agora: AGORA, db: db => { comQuinzena(db); return db; } });
  assert.equal(await a.page.locator(".eq-rel").count(), 0);
  assert.equal(await a.visivel("btnDias"), false);
  const r = await a.page.evaluate(async () => ({
    conta: (await sb.from("jb_conta").select("*").eq("equipe_user_id", "uYas")).data.length,
    falta: (await sb.from("jb_falta").select("*")).data.length,
    banco: (await sb.from("jb_banco_horas").select("*")).data.length
  }));
  assert.deepEqual(r, { conta: 0, falta: 0, banco: 0 });
  semErros(a); await a.fechar();
});

test("Registrar freela: nome pela lista da casa e aviso antes de lançar a segunda diária no mesmo dia", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_freela_pessoa = [{ id: 1, nome: "Markus Porthos", ativo: true }, { id: 2, nome: "Sabrina", ativo: true }];
    db.jb_conta.push({ id: 90, tipo: "equipe", descricao: "Freela Bella, 07/10", competencia: "2026-10-01", vencimento: "2026-10-07", valor: 120, pago_em: null, arquivada: false });
    db.jb_freela = [{ id: 1, nome: "Bella", data: "2026-10-07", valor: 120, conta_id: 90, cancelada: false }];
  });
  await a.page.click("#eqFreelaAbre"); await a.espera(200);
  assert.equal(await a.page.locator("#eqFrNomeSel").count(), 1, "seletor com as freelas da casa");
  await a.page.selectOption("#eqFrNomeSel", "Sabrina"); await a.espera(150);
  await a.page.fill("#eqFrValor", "130"); await a.page.fill("#eqFrDia", "2026-10-06");
  await a.page.click("#eqFrSalvar"); await a.espera(400);
  let fr = await a.db("jb_freela");
  assert.ok(fr.some(f => f.nome === "Sabrina" && f.data === "2026-10-06"), "nome igual ao da lista");

  /* pessoa nova com o mesmo primeiro nome de quem já tem diária no dia */
  await a.page.click("#eqFreelaAbre"); await a.espera(200);
  await a.page.selectOption("#eqFrNomeSel", "__nova"); await a.espera(150);
  await a.page.fill("#eqFrNome", "Bela"); await a.page.fill("#eqFrValor", "120"); await a.page.fill("#eqFrDia", "2026-10-07");
  await a.page.click("#eqFrSalvar"); await a.espera(300);
  assert.match(await a.texto("#diasMsg"), /Bella já tem diária em 07\/10 \(R\$ 120,00\)\. Se é um segundo turno no mesmo dia, toque em Salvar freela de novo/);
  fr = await a.db("jb_freela");
  assert.equal(fr.filter(f => f.data === "2026-10-07").length, 1, "não lançou a repetida");
  await a.page.click("#eqFrSalvar"); await a.espera(400);
  fr = await a.db("jb_freela");
  assert.equal(fr.filter(f => f.data === "2026-10-07").length, 2, "na segunda vez, lança");
  assert.ok((await a.log("insert")).some(x => x[1] === "jb_freela_pessoa" && x[2][0].nome === "Bela"), "pessoa nova entra na lista");
  semErros(a); await a.fechar();
});

test("Registrar falta com freela que já tinha diária lançada no dia: liga a diária à falta, não lança outra", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_conta.push({ id: 91, tipo: "equipe", descricao: "Freela Bella, 08/10 no lugar de Yasmin", competencia: "2026-10-01", vencimento: "2026-10-08", valor: 120, pago_em: null, arquivada: false });
    db.jb_freela = [{ id: 1, nome: "Bella", data: "2026-10-08", valor: 120, conta_id: 91, cancelada: false, entrada: "16:30", saida: "23:00" }];
  });
  await a.page.locator(bloco("Yasmin") + " .eq-faltas > .eq-abre").click(); await a.espera(200);
  await a.page.check("#eqTemFreela"); await a.espera(150);
  await a.page.fill("#eqFreelaNome", "Bella");
  await a.page.click("#eqFaltaSalvar"); await a.espera(500);
  const fa = await a.db("jb_falta"), fr = await a.db("jb_freela");
  assert.equal(fa.length, 1);
  assert.equal(fr.length, 1, "continua uma diária só");
  assert.equal(fr[0].falta_id, fa[0].id); assert.equal(fr[0].no_lugar_de, "uYas");
  assert.equal((await a.db("jb_conta")).filter(c => c.tipo === "equipe").length, 1);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /Bella cobriu/);
  semErros(a); await a.fechar();
});

test("quadro de cada freela: calendário, a pagar, quem cobriu e marcar como pago", async () => {
  const a = await abrirDiasDe("uHen", db => {
    db.jb_freela_pessoa = [{ id: 1, nome: "Sabrina", ativo: true }, { id: 2, nome: "Isabella Freitas", ativo: true }];
    db.jb_conta.push({ id: 81, tipo: "equipe", descricao: "Freela Sabrina, 02/10", competencia: "2026-10-01", vencimento: "2026-10-02", valor: 130, pago_em: "2026-10-03", arquivada: false },
                     { id: 82, tipo: "equipe", descricao: "Freela Sabrina, 03/10", competencia: "2026-10-01", vencimento: "2026-10-03", valor: 130, pago_em: null, arquivada: false },
                     { id: 83, tipo: "equipe", descricao: "Freela Sabrina, 06/10", competencia: "2026-10-01", vencimento: "2026-10-06", valor: 90, pago_em: null, arquivada: false });
    db.jb_freela = [{ id: 1, nome: "Sabrina", data: "2026-10-02", valor: 130, conta_id: 81, cancelada: false, entrada: "11:00", saida: "18:00" },
                    { id: 2, nome: "Sabrina", data: "2026-10-03", valor: 130, conta_id: 82, cancelada: false, entrada: "11:00", saida: "18:00" },
                    { id: 3, nome: "Sabrina", data: "2026-10-06", valor: 90, conta_id: 83, cancelada: false }];
  });
  const q = `.fr-pessoa[data-pessoa="sabrina"]`;
  const t = await a.texto(q);
  assert.match(t, /3 dias no mês · R\$ 350,00/);
  assert.match(t, /A pagar agora: R\$ 220,00 \(03 e 06\/10\)/);
  assert.match(await a.page.locator(q + ' .cal button:text-is("2")').getAttribute("class"), /veio pago/);
  assert.match(await a.page.locator(q + ' .cal button:text-is("3")').getAttribute("class"), /^veio$/);
  assert.match(await a.texto(`.fr-pessoa[data-pessoa="isabela"]`), /Nenhum dia neste mês/);

  /* toque num dia vazio: Registrar freela já com o nome, o dia e o valor de antes */
  await a.page.locator(q + ' .cal button:text-is("7")').click(); await a.espera(250);
  assert.equal(await a.page.inputValue("#eqFrDia"), "2026-10-07");
  assert.equal(await a.page.inputValue("#eqFrNomeSel"), "Sabrina");
  assert.equal(await a.page.inputValue("#eqFrValor"), "90,00");
  await a.page.locator("#eqFormFreela button.sec").click(); await a.espera(250);

  /* marcar os dois dias em aberto como pagos */
  await a.page.locator(q + " .fr-pagar summary").click(); await a.espera(150);
  assert.match(await a.texto(q + " .fr-pagar .pg-ok"), /Marcar 2 dias como pagos \(R\$ 220,00\)/);
  await a.page.locator(q + " .fr-pagar .pg-ok").click(); await a.espera(500);
  const cs = (await a.db("jb_conta")).filter(c => c.id === 82 || c.id === 83);
  assert.deepEqual(cs.map(c => [c.pago_em, c.valor_pago, c.pago_por]), [["2026-10-08", 130, "manual"], ["2026-10-08", 90, "manual"]]);
  assert.match(await a.texto(q), /Tudo pago/);
  semErros(a); await a.fechar();
});

test("freela no lugar de quem faltou: mostra de onde sai o dinheiro", async () => {
  const a = await abrirDiasDe("uHen");
  await a.page.locator(bloco("Yasmin") + " .eq-faltas > .eq-abre").click(); await a.espera(200);
  await a.page.check("#eqTemFreela"); await a.espera(150);
  await a.page.fill("#eqFreelaNome", "Ana"); await a.page.fill("#eqFreelaValor", "120");
  await a.page.click("#eqFaltaSalvar"); await a.espera(500);
  assert.match(await a.texto(`.fr-pessoa[data-pessoa="ana"]`), /Cobriu a falta de Yasmin: R\$ 137,55 descontados da quinzena dela pagam esta diária; sobram R\$ 17,55 na bolsa/);
  assert.match(await a.texto(bloco("Yasmin") + " .eq-faltas"), /Ana cobriu \(o desconto paga a diária dela, R\$ 120,00\)/);
  semErros(a); await a.fechar();
});
