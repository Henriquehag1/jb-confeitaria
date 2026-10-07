const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);

const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

// quarta 30/09/2026: entrada da Yasmin às 18:40
const QUA_1852 = "2026-09-30T21:52:00Z";

test("Yasmin: Cheguei grava a hora uma vez só e não mostra atraso para ela", async () => {
  const a = await abrir("uYas", { agora: QUA_1852 });
  assert.equal(await a.tela(), "scHome");
  assert.ok(await a.visivel("btnCheguei"), "botão aparece");
  assert.match(await a.texto("#btnCheguei"), /Cheguei/);
  assert.match(await a.texto("#btnCheguei"), /entrada hoje é às 18:40/);

  await a.page.click("#btnCheguei"); await a.espera(400);
  const dia = (await a.db("jb_dia_trabalhado")).find(d => d.user_id === "uYas" && d.data === "2026-09-30");
  assert.equal(dia.chegada, new Date(QUA_1852).toISOString());
  assert.equal(dia.chegada_origem, "app");
  assert.match(await a.texto("#btnCheguei"), /Chegada às 18:52/);
  assert.doesNotMatch(await a.texto("#cardCheguei"), /atras|min/i, "ela não vê minutos de atraso");

  // um segundo toque não chama o banco de novo
  await a.page.click("#btnCheguei", { force: true }); await a.espera(300);
  const chamadas = (await a.log("rpc")).filter(l => l[1] === "jb_cheguei");
  assert.equal(chamadas.length, 1);
  semErros(a); await a.fechar();
});

test("de madrugada o Cheguei some (é o fim do turno de ontem)", async () => {
  const a = await abrir("uYas", { agora: "2026-09-30T04:30:00Z" });   // 01:30 em São Paulo
  assert.equal(await a.tela(), "scHome");
  assert.equal(await a.page.evaluate(() => !!document.getElementById("btnCheguei")), false);
  semErros(a); await a.fechar();
});

test("Eliana: botão com a entrada das 9h numa quinta", async () => {
  const a = await abrir("uEli", { agora: "2026-10-01T12:12:00Z" });   // quinta 09:12
  assert.ok(await a.visivel("btnCheguei"));
  assert.match(await a.texto("#btnCheguei"), /às 09:00/);
  await a.page.click("#btnCheguei"); await a.espera(400);
  assert.match(await a.texto("#btnCheguei"), /Chegada às 09:12/);
  semErros(a); await a.fechar();
});

test("gestor: resumo de atrasos, marca no calendário e correção da hora", async () => {
  const a = await abrir("uJes", {
    agora: "2026-09-30T23:00:00Z",
    db: db => {
      db.jb_dia_trabalhado = [
        { id: 1, user_id: "uYas", data: "2026-09-29", turno: "noite", status: "confirmado", origem: "auto", chegada: "2026-09-29T19:25:00Z", chegada_origem: "app" }, // 16:25, entrada 16:30
        { id: 2, user_id: "uYas", data: "2026-09-30", turno: "noite", status: "sugerido",   origem: "auto", chegada: "2026-09-30T21:52:00Z", chegada_origem: "app" }, // 18:52, entrada 18:40
        { id: 3, user_id: "uEli", data: "2026-09-24", turno: "dia",   status: "confirmado", origem: "auto", chegada: "2026-09-24T12:20:00Z", chegada_origem: "app" }, // 09:20
        { id: 4, user_id: "uEli", data: "2026-09-25", turno: "dia",   status: "confirmado", origem: "gestor" }
      ];
      db.jb_pessoal_mes = [
        { user_id: "uEli", nome: "Eliana", mes: "2026-09-01", dias_combinados: 8, dias_veio: 2, dias_pendentes: 0, custo: 280 },
        { user_id: "uYas", nome: "Yasmin", mes: "2026-09-01", dias_combinados: 30, dias_veio: 1, dias_pendentes: 1, custo: 3642.86 }
      ];
    }
  });
  await a.page.click("#btnDias"); await a.espera(500);
  assert.equal(await a.tela(), "scDias");

  const bloco = nome => `.pessoa:has(h3:text-is("${nome}"))`;
  a.texto = sel => a.page.locator(sel).first().innerText();
  assert.match(await a.texto(bloco("Yasmin") + " .res-atraso"), /1 atraso no mês, 12 min no total, de 2 dias com hora registrada/);
  assert.match(await a.texto(bloco("Eliana") + " .res-atraso"), /1 atraso no mês, 20 min no total, de 1 dia com hora registrada/);

  // dia 30 da Yasmin leva a marca de atraso; dia 29 não
  const cls = await a.page.evaluate(() => {
    const b = [...document.querySelectorAll(".pessoa")].find(p => p.querySelector("h3").textContent === "Yasmin");
    const cel = n => [...b.querySelectorAll(".cal button")].find(x => x.textContent === n);
    return { d30: cel("30").className, d29: cel("29").className, label: cel("30").getAttribute("aria-label") };
  });
  assert.match(cls.d30, /atraso/);
  assert.doesNotMatch(cls.d29, /atraso/);
  assert.match(cls.label, /chegou 18:52, 12 min de atraso/);

  // Eliana 25/09 sem hora: anotar 09:05
  await a.page.click(bloco("Eliana") + " .chegadas summary"); await a.espera(150);
  const linha25 = bloco("Eliana") + ' .ch-ln:has(.dia:text-matches("25/09"))';
  assert.match(await a.texto(linha25), /sem hora de chegada/);
  await a.page.click(linha25 + " .ch-ed");
  await a.page.fill(linha25 + " input[type=time]", "09:05");
  await a.page.click(linha25 + " form button"); await a.espera(500);

  const d4 = (await a.db("jb_dia_trabalhado")).find(d => d.id === 4);
  assert.equal(d4.chegada, "2026-09-25T09:05:00-03:00");
  assert.equal(d4.chegada_origem, "gestor");
  assert.equal(d4.chegada_por, "uJes");
  assert.match(await a.texto(bloco("Eliana") + " .res-atraso"), /2 atrasos no mês, 25 min no total/);

  // corrigir a Yasmin para 18:40 zera o atraso dela
  await a.page.click(bloco("Yasmin") + " .chegadas summary"); await a.espera(150);
  const linha30 = bloco("Yasmin") + ' .ch-ln:has(.dia:text-matches("30/09"))';
  await a.page.click(linha30 + " .ch-ed");
  await a.page.fill(linha30 + " input[type=time]", "18:40");
  await a.page.click(linha30 + " form button"); await a.espera(500);
  assert.match(await a.texto(bloco("Yasmin") + " .res-atraso"), /Chegou no horário em todos os 2 dias registrados/);

  // o atraso não mexe no valor a pagar
  assert.match(await a.texto(bloco("Yasmin") + " .sub"), /R\$ 3\.642,86/);
  semErros(a); await a.fechar();
});

test("gestor: lembrete de atraso sem data aparece junto do resumo e some ao resolver; equipe não lê", async () => {
  const a = await abrir("uHen", {
    agora: "2026-09-30T23:00:00Z",
    db: db => {
      db.jb_dia_trabalhado = [
        { id: 1, user_id: "uYas", data: "2026-09-20", turno: "noite", status: "confirmado", origem: "gestor", chegada: "2026-09-20T14:15:00-03:00", chegada_origem: "gestor" },
        { id: 2, user_id: "uYas", data: "2026-09-27", turno: "noite", status: "confirmado", origem: "auto",   chegada: "2026-09-27T14:30:00-03:00", chegada_origem: "gestor" }
      ];
      db.jb_ocorrencia = [{ id: 7, user_id: "uYas", mes: "2026-09-01", texto: "Atraso de 2h sem data: entrada às 16:30, chegou às 18:30.", resolvida: false }];
      db.jb_pessoal_mes = [{ user_id: "uYas", nome: "Yasmin", mes: "2026-09-01", dias_combinados: 30, dias_veio: 2, dias_pendentes: 0, custo: 3642.86 }];
    }
  });
  await a.page.click("#btnDias"); await a.espera(500);
  const bloco = `.pessoa:has(h3:text-is("Yasmin"))`;
  const txt = sel => a.page.locator(sel).first().innerText();
  assert.match(await txt(bloco + " .res-atraso"), /2 atrasos no mês, 45 min no total/);
  assert.match(await txt(bloco + " .lembrete"), /Não esquecer: Atraso de 2h sem data/);

  await a.page.click(bloco + " .lembrete-ok"); await a.espera(400);
  assert.equal(await a.page.locator(bloco + " .lembrete").count(), 0);
  const oc = (await a.db("jb_ocorrencia")).find(o => o.id === 7);
  assert.equal(oc.resolvida, true);
  semErros(a); await a.fechar();

  // a Yasmin não lê lembretes
  const y = await abrir("uYas", { agora: "2026-09-30T23:00:00Z",
    db: db => { db.jb_ocorrencia = [{ id: 7, user_id: "uYas", mes: "2026-09-01", texto: "x", resolvida: false }]; } });
  const lidos = await y.page.evaluate(async () => (await sb.from("jb_ocorrencia").select("*")).data);
  assert.deepEqual(lidos, []);
  semErros(y); await y.fechar();
});

test("Yasmin não lê atraso nem chegadas de outros dias; vê só a chegada de hoje", async () => {
  const a = await abrir("uYas", { agora: "2026-09-30T22:10:00Z",
    db: db => { db.jb_dia_trabalhado = [
      { id: 1, user_id: "uYas", data: "2026-09-27", turno: "noite", status: "confirmado", origem: "auto", chegada: "2026-09-27T14:30:00-03:00", chegada_origem: "gestor" },
      { id: 2, user_id: "uYas", data: "2026-09-30", turno: "noite", status: "sugerido", origem: "auto", chegada: "2026-09-30T21:52:00Z", chegada_origem: "app" } ]; } });
  assert.match(await a.texto("#btnCheguei"), /Chegada às 18:52/);
  const r = await a.page.evaluate(async () => ({
    atraso: (await sb.from("jb_atraso_dia").select("*")).data,
    rpc: (await sb.rpc("jb_minha_chegada_hoje")).data
  }));
  assert.deepEqual(r.atraso, []);
  assert.equal(r.rpc, "2026-09-30T21:52:00Z");
  assert.doesNotMatch(await a.page.locator("body").innerText(), /atras|14:30/i);
  const leitura = (await a.log("select")).filter(l => l[1] === "jb_dia_trabalhado" && /chegada/.test(String(l[2])));
  assert.equal(leitura.length, 0, "o app da equipe não pede a coluna chegada");
  semErros(a); await a.fechar();
});

test("gestor marca dias como pagos (pagamento adiantado), desfaz, e dia pago não se apaga com um toque", async () => {
  const a = await abrir("uJes", {
    agora: "2026-10-07T15:00:00Z",
    db(db){
      db.jb_dia_trabalhado = [
        { id: 86, user_id: "uEli", data: "2026-10-01", turno: "dia", status: "confirmado", origem: "gestor" },
        { id: 90, user_id: "uEli", data: "2026-10-02", turno: "dia", status: "confirmado", origem: "auto" },
        { id: 91, user_id: "uYas", data: "2026-10-02", turno: "noite", status: "confirmado", origem: "auto" }
      ];
      db.jb_pessoal_mes = [
        { user_id: "uEli", nome: "Eliana", mes: "2026-10-01", dias_combinados: 10, dias_veio: 2, dias_pendentes: 0, custo: 280 },
        { user_id: "uYas", nome: "Yasmin", mes: "2026-10-01", dias_combinados: 31, dias_veio: 1, dias_pendentes: 0, custo: 3764.29 }
      ];
    }
  });
  await a.page.click("#btnDias"); await a.espera(500);
  const eli = '.pessoa:has(h3:text-is("Eliana"))';
  const tx = sel => a.page.locator(sel).first().innerText();
  assert.match(await tx(eli + " .res-pagto"), /Nenhum dia marcado como pago · falta pagar 2 dias \(R\$ 280,00\)/);

  await a.page.click(eli + " .pagto summary"); await a.espera(150);
  assert.equal(await a.page.locator(eli + " .pg-ok").isDisabled(), true, "sem dia escolhido o botão não age");
  const cks = a.page.locator(eli + " .pg-ln input[type=checkbox]");
  assert.equal(await cks.count(), 2);
  await cks.nth(0).check(); await cks.nth(1).check();
  assert.match(await tx(eli + " .pg-ok"), /Marcar 2 dias como pagos \(R\$ 280,00\)/);
  await a.page.click(eli + " .pg-ok"); await a.espera(400);

  const dias = (await a.db("jb_dia_trabalhado")).filter(d => d.user_id === "uEli");
  assert.ok(dias.every(d => d.pago_em && d.pago_por === "uJes"), "os dois dias ficaram pagos, com quem marcou");
  assert.equal((await a.db("jb_dia_trabalhado")).find(d => d.id === 91).pago_em, undefined, "o dia da Yasmin não foi tocado");
  assert.match(await tx(eli + " .res-pagto"), /Já pago: 2 dias \(R\$ 280,00\) · tudo o que veio está pago/);
  assert.match(await a.page.locator(eli + ' .cal button:text-is("1")').getAttribute("class"), /pago/);
  assert.match(await a.page.locator(eli + ' .cal button:text-is("2")').getAttribute("aria-label"), /pago/);

  // tocar no dia pago não apaga
  await a.page.click(eli + ' .cal button:text-is("1")'); await a.espera(300);
  assert.equal((await a.db("jb_dia_trabalhado")).some(d => d.id === 86), true);
  assert.match(await tx("#diasMsg"), /já está marcado como pago/);

  // desfazer um dia
  await a.page.locator(eli + " .pg-ln.pago .ch-ed").first().click(); await a.espera(400);
  assert.equal((await a.db("jb_dia_trabalhado")).find(d => d.id === 86).pago_em, null);
  assert.match(await tx(eli + " .res-pagto"), /Já pago: 1 dia \(R\$ 140,00\) · falta pagar 1 dia \(R\$ 140,00\)/);
  semErros(a); await a.fechar();
});

test("equipe não lê quais dias foram pagos", async () => {
  const a = await abrir("uEli", {
    agora: "2026-10-07T15:00:00Z",
    db(db){ db.jb_dia_trabalhado = [{ id: 86, user_id: "uEli", data: "2026-10-01", turno: "dia", status: "confirmado", origem: "gestor", pago_em: "2026-10-07T12:00:00Z", pago_por: "uJes" }]; }
  });
  const linhas = await a.page.evaluate(async () => (await sb.from("jb_dia_pago").select("*")).data);
  assert.deepEqual(linhas, []);
  assert.doesNotMatch(await a.page.locator("body").innerText(), /pago/i);
  semErros(a); await a.fechar();
});
