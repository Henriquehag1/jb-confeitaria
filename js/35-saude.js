/* JB OS · saúde do negócio. Só gestor.
   Junta, num lugar só, o que os outros módulos já calculam: quanto sobra, para onde vai o
   dinheiro, o imposto certo, o turno da noite, a equipe e se dá para contratar. Nada aqui é
   digitado: muda sozinho quando muda preço, insumo, conta fixa, faturamento ou escala.
   Todo número tem um "?" que abre de onde ele sai e a conta com os valores do mês. */

let SAUDE = null;

/* Referências de mercado (setembro de 2026). Fonte: claude/jb-custo-de-uma-contratacao-40h-set2026.md */
const REF_EQUIPE = {
  pisoMes44h: 2320.41,        // auxiliar de confeitaria, 44h (CAGED)
  horasMes44h: 220,
  clt40hCusto: 2918.22,       // salário proporcional a 40h + 32,2% de encargos + vale-transporte
  clt40hSalario: 2109.46,
  clt40hLiquido: 1790,
  diariaFreela: 140,          // diária de produção já praticada na casa
  tetoEquipe: 0.25,           // equipe até 25% da venda: referência para confeitaria de delivery
  margemNoite: 0.30           // da contribuição da noite, 30% fica para a casa
};
const SEMANAS_MES = 52 / 12;

function saudeVeredito(sobra){
  if(sobra == null) return { tom: "cinza", rot: "Sem dados", frase: "Ainda não há mês fechado com faturamento." };
  if(sobra >= 0.10) return { tom: "verde", rot: "Saudável", frase: "Dá lucro com folga, depois de pagar tudo." };
  if(sobra >= 0.03) return { tom: "amarelo", rot: "Atenção", frase: "Dá lucro, mas com pouca folga para imprevisto." };
  if(sobra >= 0) return { tom: "ambar", rot: "No limite", frase: "Paga tudo e o pró-labore. Sobra quase nada." };
  return { tom: "vermelho", rot: "No vermelho", frase: "A venda não paga todas as contas e o pró-labore." };
}

/* o mês de referência é o último mês fechado com venda: o mês corrente ainda está pela metade */
function saudeMesRef(destinos, hoje){
  const atual = primeiroDia(hoje);
  return destinos.filter(d => d.mes < atual && Number(d.bruto_estimado) > 0)
                 .sort((a, b) => a.mes < b.mes ? 1 : -1)[0] || null;
}

/* ============================================================
   CONTAS PURAS (testáveis sem tela)
   ============================================================ */
/* O lucro do mês, linha a linha, como uma conta de padaria:
   o que os clientes pagaram − app − imposto − ingrediente = sobrou da venda
   sobrou da venda − cada conta fixa do mês (equipe, aluguel, ..., pró-labore) = lucro.
   As contas fixas entram pelo valor do mês, item por item (não divididas por doce). */
const r2 = v => Math.round(v * 100) / 100;
function saudeLucroMes(D, fixos, extra){
  if(!D) return null;
  const bruto = r2(Number(D.bruto_estimado));
  const app = r2(bruto * Number(D.app)), imposto = r2(bruto * Number(D.imposto)), ingrediente = r2(bruto * Number(D.ingrediente));
  const margem = r2(bruto - app - imposto - ingrediente);
  const itens = (fixos || []).map(f => ({ nome: f.nome, valor: r2(Number(f.valor)), origem: f.origem, obs: f.obs || "" }))
                             .sort((a, b) => b.valor - a.valor);
  const fixo = r2(itens.reduce((s, f) => s + f.valor, 0));
  /* ajuda extra do mês (Eliana e freelas): sai da bolsa, depois das contas fixas */
  const extras = (extra || []).filter(e => Number(e.valor) > 0).map(e => ({ nome: e.nome, valor: r2(Number(e.valor)), detalhe: e.detalhe || "" }));
  const extraTotal = r2(extras.reduce((s, e) => s + e.valor, 0));
  const antesExtra = r2(margem - fixo);
  const lucro = r2(antesExtra - extraTotal);
  return { bruto, app, imposto, ingrediente, margem, itens, fixo, antesExtra, extras, extraTotal, lucro, sobra: bruto > 0 ? lucro / bruto : null };
}

function saudeCalcular(x){
  const D0 = x.destino, K = x.kpi || {}, P = x.param || {};
  let fixos = x.fixos;
  if(!fixos && K.custo_fixo_mes != null) fixos = [{ nome: "Contas fixas do mês", valor: K.custo_fixo_mes, origem: "item" }];
  const extra = (x.equipe || []).filter(p => p.regime === "diaria" || p.regime === "freela").map(p => ({ nome: p.nome, valor: p.mes, detalhe: p.detalhe }));
  const L = saudeLucroMes(D0, fixos || [], extra);
  const bruto = L ? L.bruto : 0;
  const sobra = L ? L.sobra : null;
  const lucro = L ? L.lucro : null;
  /* a fatia das contas fixas e a sobra, a cada R$ 100, saem da mesma conta do lucro */
  const D = D0 ? Object.assign({}, D0, bruto > 0 ? { custo_fixo: L.fixo / bruto, sobra } : {}) : null;
  const plItem = L ? L.itens.find(f => f.origem === "pro_labore") : null;
  const proLabore = plItem ? plItem.valor : Number(K.pro_labore || 0);
  const r = { mes: D ? D.mes : null, bruto, sobra, lucro, proLabore, donoLeva: lucro == null ? null : r2(proLabore + lucro),
              veredito: saudeVeredito(sobra), destino: D, conta: L, app: D ? Number(D.app) : null };

  r.udia = K.unidades_dia != null ? Number(K.unidades_dia) : null;
  r.equilibrio = K.equilibrio_dia != null ? Number(K.equilibrio_dia) : null;
  r.contribUn = K.contrib_un != null ? Number(K.contrib_un) : null;
  r.custoFixo = L && L.itens.length ? L.fixo : (K.custo_fixo_mes != null ? Number(K.custo_fixo_mes) : null);
  r.folga = r.udia != null && r.equilibrio ? (r.udia - r.equilibrio) / r.equilibrio : null;

  const eq = x.equipe || [];
  r.equipe = eq;
  r.equipeTotal = eq.reduce((s, p) => s + Number(p.mes || 0), 0);
  r.equipePct = bruto > 0 ? r.equipeTotal / bruto : null;

  const ref = REF_EQUIPE;
  r.cabe = lucro != null ? Math.max(0, lucro) : 0;
  r.faltaClt = Math.max(0, ref.clt40hCusto - r.cabe);
  r.unExtraDia = r.contribUn > 0 ? Math.ceil(r.faltaClt / r.contribUn / 30) : null;
  r.pontosApp = bruto > 0 ? r.faltaClt / bruto : null;
  r.freelaRef = Number(P.freela_noite || ref.diariaFreela);
  /* bolsa de ajuda extra do mês seguinte: uma fatia do que sobrou antes da Eliana e dos freelas */
  const fatiaBolsa = P.bolsa_fatia != null ? Number(P.bolsa_fatia) : 0.5;
  const totalBolsa = L ? r2(Math.max(0, L.antesExtra) * fatiaBolsa) : 0;
  r.bolsa = { fatia: fatiaBolsa, antesExtra: L ? L.antesExtra : null, total: totalBolsa, noites: Math.floor(totalBolsa / r.freelaRef) };
  r.diariasCabem = r.bolsa.noites;
  /* mais uma noite de freela na bolsa: quanto a sobra precisa crescer e quantos doces a mais por dia pagam isso */
  r.doceMes = r.contribUn > 0 ? Math.round(r.contribUn * 30 * 100) / 100 : null;
  if(L && r.doceMes && fatiaBolsa > 0){
    const faltaBolsa = r2((r.bolsa.noites + 1) * r.freelaRef - totalBolsa);
    const faltaSobra = r2(faltaBolsa / fatiaBolsa);
    r.proxFreela = { noite: r.bolsa.noites + 1, faltaBolsa, falta: faltaSobra, doces: Math.max(1, Math.ceil(faltaSobra / r.doceMes)) };
  } else r.proxFreela = null;
  /* venda bruta que paga uma diária: de cada R$ 100 vendidos sobram (100 − app − imposto − ingrediente) */
  r.margemPct = L && L.bruto > 0 ? L.margem / L.bruto : null;
  r.vendaPorDiaria = r.margemPct > 0 ? { valor: r.freelaRef, venda: r2(r.freelaRef / r.margemPct),
                                          doces: r.contribUn > 0 ? Math.ceil(r.freelaRef / r.contribUn) : null } : null;

  const I = x.imposto;
  r.imposto = I ? {
    usado: Number(I.aliquota_usada), modo: I.modo, anexo: I.anexo, faixa: I.faixa, rbt12: Number(I.rbt12),
    meses: I.meses_com_dado, pago: I.pago_sobre_bruto != null ? Number(I.pago_sobre_bruto) : null
  } : null;
  if(r.imposto && r.imposto.pago != null && bruto > 0)
    r.imposto.diferencaMes = Math.max(0, (r.imposto.usado - r.imposto.pago) * bruto);

  r.caixa = K.entradas != null ? { entrou: Number(K.entradas), saiu: Number(K.saidas || 0), sobrou: Number(K.entradas) - Number(K.saidas || 0) } : null;

  r.noite = saudeNoite(r, P, x.yasmin);
  r.yasmin = saudeYasmin(r, P, x.yasmin);
  r.recomendacoes = saudeRecomendacoes(r);
  return r;
}

/* o turno da noite: quanto ele deixa por noite e quanto dá para pagar a quem cobre */
function saudeNoite(r, P, Y){
  const fatia = P.fatia_noite != null ? Number(P.fatia_noite) : null;
  if(fatia == null || r.contribUn == null || r.udia == null) return null;
  const noites = Number(P.noites_mes || 30);
  const porNoite = Math.round(r.contribUn * r.udia * fatia * 100) / 100;
  const teto = porNoite;
  const recomendado = Math.floor(porNoite * (1 - REF_EQUIPE.margemNoite));
  const freela = r.freelaRef;
  const custoAtual = Y ? Math.round(Number(Y.semanal) / 7 * 100) / 100 : null;
  return { fatia, noites, porNoite, mes: porNoite * noites, teto, recomendado, freela, sobraFreela: porNoite - freela,
           custoAtual, sobraAtual: custoAtual != null ? porNoite - custoAtual : null,
           sobraAtualMes: custoAtual != null ? (porNoite - custoAtual) * noites : null };
}

/* Yasmin: manter, renegociar, trocar por freelas ou registrar. Folga sugerida = o turno mais longo
   (o freela cobra por noite, então cobrir o turno mais longo é o que mais economiza). */
function saudeYasmin(r, P, Y){
  if(!Y || !Y.semanal || !Y.horasSemana) return null;
  const semanal = Number(Y.semanal), horas = Number(Y.horasSemana);
  const hora = semanal / horas;
  const folga = (Y.escala || []).slice().sort((a, b) => b.horas - a.horas)[0] || null;
  const freela = r.freelaRef;
  const hFolga = folga ? folga.horas : 0;
  const novaSemana = Math.round(hora * (horas - hFolga) * 100) / 100;
  const cen = [
    { id: "manter", rot: "Manter como está", mes: semanal * SEMANAS_MES,
      det: "7 noites por semana, sem folga, sem registro." },
    { id: "renegociar", rot: "Renegociar", mes: (novaSemana + freela) * SEMANAS_MES,
      det: "6 noites, folga " + (folga ? "no " + folga.nome : "num dia") + ", mesma hora (R$ " + moeda(hora) + "). Ela recebe R$ " + moeda(novaSemana) + " por semana; o " + (folga ? folga.nome : "dia de folga") + " vai com freela de R$ " + moeda(freela) + "." },
    { id: "freelas", rot: "Só freelas", mes: freela * 30,
      det: "30 noites de freela a R$ " + moeda(freela) + ". Sem constância: cada noite é uma pessoa diferente." },
    { id: "registrar", rot: "Registrar (CLT 40h)", mes: REF_EQUIPE.clt40hCusto + freela * SEMANAS_MES,
      det: "Salário de R$ " + moeda(REF_EQUIPE.clt40hSalario) + " mais encargos, e freela no dia de folga. Ela passaria a receber cerca de R$ " + moeda(REF_EQUIPE.clt40hLiquido) + " líquidos: dificilmente aceita." }
  ];
  cen.forEach(c => { c.mes = Math.round(c.mes * 100) / 100; c.dif = Math.round((c.mes - cen[0].mes) * 100) / 100; });
  const N = r.noite;
  let decisao, tom, porque;
  if(N && N.custoAtual != null && N.porNoite >= N.custoAtual * 1.15){
    decisao = "Manter e renegociar a folga"; tom = "verde";
    porque = "A noite se paga: deixa R$ " + moeda(N.porNoite) + " e ela custa R$ " + moeda(N.custoAtual) + ". Despedir faria perder isso; só freelas custa mais que renegociar e não tem constância.";
  } else if(N && N.custoAtual != null && N.porNoite >= N.custoAtual){
    decisao = "Renegociar já"; tom = "ambar";
    porque = "A noite mal se paga: deixa R$ " + moeda(N.porNoite) + " e ela custa R$ " + moeda(N.custoAtual) + ". Folga com freela já reduz o custo.";
  } else if(N && N.custoAtual != null){
    decisao = "Renegociar valor ou dias"; tom = "vermelho";
    porque = "A noite não se paga: deixa R$ " + moeda(N.porNoite) + " e ela custa R$ " + moeda(N.custoAtual) + ". Antes de despedir, reduza dias ou valor.";
  } else { decisao = "Sem dados da noite"; tom = "cinza"; porque = ""; }
  const melhor = cen.slice(1).reduce((a, b) => a.mes <= b.mes ? a : b);
  return { semanal, horas, hora, folga, novaSemana, cenarios: cen, recomendado: "renegociar", decisao, tom, porque,
           economia: Math.round((cen[0].mes - cen[1].mes) * 100) / 100, maisBarato: melhor.id };
}

function saudeRecomendacoes(r){
  const l = [];
  if(r.app != null && r.app >= 0.35)
    l.push({ tom: "ambar", t: "A maior conta é o app: R$ " + moeda(r.app * 100) + " de cada R$ 100.",
             d: "Cada 1 ponto a menos de promoção vale cerca de R$ " + moeda(r.bruto * 0.01) + " por mês." });
  if(r.folga != null && r.folga < 0.15)
    l.push({ tom: r.folga < 0 ? "vermelho" : "ambar", t: "Folga pequena sobre o ponto de equilíbrio.",
             d: "Vende " + r.udia + " por dia e precisa de " + r.equilibrio + ". Uma semana fraca já vira prejuízo." });
  if(r.yasmin && r.yasmin.tom !== "cinza")
    l.push({ tom: r.yasmin.tom, t: "Yasmin: " + r.yasmin.decisao.toLowerCase() + ".",
             d: r.yasmin.economia > 0 ? "6 noites com folga, mesma hora, economiza R$ " + moeda(r.yasmin.economia) + " por mês." : r.yasmin.porque });
  if(r.imposto && r.imposto.diferencaMes > 100)
    l.push({ tom: "ambar", t: "Imposto pago abaixo da tabela.",
             d: "Cerca de R$ " + moeda(r.imposto.diferencaMes) + " por mês de diferença. O preço já está protegido; a declaração é com o contador." });
  if(r.lucro != null && r.lucro < REF_EQUIPE.clt40hCusto)
    l.push({ tom: "cinza", t: "Contratar mais alguém registrado ainda não cabe.",
             d: "Para pico de trabalho, freela por noite." });
  if(r.equipePct != null && r.equipePct <= REF_EQUIPE.tetoEquipe)
    l.push({ tom: "verde", t: "Equipe do tamanho certo.",
             d: pct(r.equipePct) + " da venda; a referência é até " + pct(REF_EQUIPE.tetoEquipe) + ". O aperto não vem da folha." });
  return l;
}

/* ============================================================
   CARREGAR
   ============================================================ */
const DIA_NOME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

async function carregarSaude(){
  const hoje = hojeSP();
  const [dest, kpi, imp, ac, es, pr, cf] = await Promise.all([
    sb.from("jb_kpi_destino").select("*"),
    sb.from("jb_kpi_mes").select("*"),
    sb.from("jb_imposto_estimado").select("*").maybeSingle(),
    sb.from("jb_acordo").select("user_id,inicio,fim,regime,valor"),
    sb.from("jb_escala").select("user_id,dia_semana,entrada,saida,inicio,fim"),
    sb.from("jb_parametro").select("chave,valor,fonte,medido_em"),
    sb.from("jb_custo_fixo_calculado").select("origem,nome,valor,obs").order("ordem")
  ]);
  const fixos = ((cf && !cf.error && cf.data) || []).filter(f => Number(f.valor) > 0);
  const destinos = (dest && !dest.error && dest.data) || [];
  const D = saudeMesRef(destinos, hoje);
  if(!D) return { vazio: true };
  const ini = D.mes, fim = ultimoDia(D.mes);
  const K = ((kpi && kpi.data) || []).find(k => k.mes === D.mes) || null;
  const acordos = ((ac && ac.data) || []).filter(a => a.inicio <= fim && (!a.fim || a.fim >= ini));
  const escalas = (es && es.data) || [];
  const param = {}, fontes = {};
  ((pr && !pr.error && pr.data) || []).forEach(p => { param[p.chave] = Number(p.valor); fontes[p.chave] = p; });

  const [dt, fr, us] = await Promise.all([
    sb.from("jb_dia_trabalhado").select("id,user_id,data,status").eq("status", "confirmado").gte("data", ini).lte("data", fim),
    sb.from("jb_freela").select("valor,data").eq("cancelada", false).gte("data", ini).lte("data", fim),
    sb.from("jb_usuario").select("user_id,nome")
  ]);
  const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
  const dias = (dt && dt.data) || [];
  const equipe = [];
  let yasmin = null;
  const vale = hoje;   // a escala e o acordo de hoje: é sobre eles que se decide
  acordos.forEach(a => {
    const nome = nomes[a.user_id] || "Pessoa";
    if(a.regime === "semanal"){
      const h = eqHorasSemana(escalas, a.user_id, fim);
      equipe.push({ nome, regime: "semanal", mes: Number(a.valor) * SEMANAS_MES, hora: h > 0 ? Number(a.valor) / h : null,
                    detalhe: "R$ " + moeda(Number(a.valor)) + " por semana" + (h > 0 ? ", " + eqHorasTx(h) : "") });
      if(!a.fim || a.fim >= vale){
        const hs = eqHorasSemana(escalas, a.user_id, vale);
        const esc = [0,1,2,3,4,5,6].map(d => {
          const e = escalas.find(x => x.user_id === a.user_id && x.dia_semana === d && eqVigente(x, vale));
          return e ? { dia: d, nome: DIA_NOME[d], horas: eqHoras(e.entrada, e.saida) || 0 } : null;
        }).filter(Boolean);
        yasmin = { nome, semanal: Number(a.valor), horasSemana: hs, escala: esc };
      }
    } else if(a.regime === "diaria"){
      const n = dias.filter(d => d.user_id === a.user_id).length;
      equipe.push({ nome, regime: "diaria", mes: n * Number(a.valor), hora: Number(a.valor) / 8,
                    detalhe: n + (n === 1 ? " dia" : " dias") + " × R$ " + moeda(Number(a.valor)) });
    }
  });
  const freelas = (fr && fr.data) || [];
  if(freelas.length) equipe.push({ nome: "Freelas", regime: "freela", mes: freelas.reduce((s, f) => s + Number(f.valor), 0), hora: null,
                                   detalhe: freelas.length + (freelas.length === 1 ? " noite" : " noites") });

  const r = saudeCalcular({ destino: D, kpi: K, fixos: fixos.length ? fixos : null, equipe, param, yasmin, imposto: (imp && !imp.error && imp.data) || null });
  const fixoMes = r.custoFixo || 0;
  const tendencia = destinos.filter(d => d.mes <= D.mes && Number(d.bruto_estimado) > 0)
    .sort((a, b) => a.mes < b.mes ? -1 : 1).slice(-4)
    .map(d => { const L = saudeLucroMes(d, [{ nome: "fixas", valor: fixoMes }], d.mes === D.mes ? r.conta.extras : []);
                return { mes: d.mes, lucro: L.lucro, margem: L.margem, extra: L.extraTotal, sobra: L.sobra, bruto: L.bruto }; });
  r.tendencia = tendencia;
  r.fontes = fontes;
  r.yasminNome = yasmin ? yasmin.nome : "Yasmin";
  return r;
}

async function abrirSaude(){
  aviso("saudeMsg", "", "");
  $("saudeCorpo").innerHTML = "<p class='tip'>Fazendo as contas...</p>";
  show("scSaude");
  try { SAUDE = await carregarSaude(); }
  catch(e){ SAUDE = null; }
  montarSaude();
}

async function resumoSaudeHome(){
  const [dd, cf] = await Promise.all([
    sb.from("jb_kpi_destino").select("mes,bruto_estimado,app,imposto,ingrediente"),
    sb.from("jb_custo_fixo_calculado").select("origem,nome,valor")
  ]);
  if(dd.error || !dd.data) return null;
  const D = saudeMesRef(dd.data, hojeSP());
  if(!D || cf.error || !cf.data || !cf.data.length) return null;
  const extra = await bolsaGastoMes(D.mes).catch(() => null);
  const L = saudeLucroMes(D, cf.data, extra ? extra.itens : []);
  return { mes: D.mes, lucro: L.lucro, veredito: saudeVeredito(L.sobra) };
}

/* ============================================================
   TELA
   ============================================================ */
const reais = v => (v < 0 ? "− R$ " : "R$ ") + moeda(Math.abs(v));
function sdCard(titulo, id){
  const c = document.createElement("div"); c.className = "sd-card"; if(id) c.id = id;
  if(titulo){ const h = document.createElement("h3"); h.textContent = titulo; c.appendChild(h); }
  return c;
}
/* linha "rótulo ... valor". exp = [título, [o que é, de onde sai], a conta] abre com um toque */
function sdLinha(alvo, rot, val, cls, exp){
  const l = document.createElement("div"); l.className = "sd-ln" + (cls ? " " + cls : "");
  const a = document.createElement("span"); a.textContent = rot;
  const b = document.createElement("b"); b.textContent = val;
  l.append(a, b); alvo.appendChild(l);
  if(exp) explicar(l, exp[0], exp[1], { conta: exp[2], tudoClicavel: true });
  return l;
}
function sdTexto(alvo, t, cls){ const p = document.createElement("p"); p.className = "sd-tx" + (cls ? " " + cls : ""); p.textContent = t; alvo.appendChild(p); return p; }
const n0 = v => Math.round(v).toLocaleString("pt-BR");

function montarSaude(){
  const box = $("saudeCorpo");
  box.innerHTML = "";
  fecharExplicacao();
  const S = SAUDE;
  if(!S || S.vazio){
    sdTexto(box, "Ainda não há mês fechado com faturamento. Quando o Nosso Financeiro lançar as entradas do mês, esta tela se monta sozinha.");
    return;
  }
  const D = S.destino, M = mesLongo(S.mes).split(" ")[0].toLowerCase();

  /* 1. veredito */
  const v = sdCard(null, "sdVeredito"); v.classList.add("sd-veredito", "tom-" + S.veredito.tom);
  const et = document.createElement("span"); et.className = "sd-selo"; et.textContent = S.veredito.rot; v.appendChild(et);
  const q = document.createElement("p"); q.className = "sd-pergunta"; q.textContent = "O negócio está dando lucro? " + mesLongo(S.mes); v.appendChild(q);
  const n = document.createElement("div"); n.className = "sd-numero"; n.id = "sdLucro";
  n.textContent = reais(S.lucro);
  const ns = document.createElement("small"); ns.textContent = " de lucro no mês"; n.appendChild(ns);
  v.appendChild(n);
  const C = S.conta;
  explicar(n, "Lucro do mês", ["O que sobra da venda de " + M + " depois de pagar app, imposto, ingrediente, contas fixas, pró-labore e a ajuda extra (Eliana e freelas).",
    "Linha por linha logo abaixo, em \"De onde sai o lucro\"."], { conta: reais(C.margem) + " que sobraram da venda − " + reais(C.fixo) + " de contas fixas" + (C.extraTotal ? " − " + reais(C.extraTotal) + " de ajuda extra" : "") + " = " + reais(S.lucro), tudoClicavel: true });
  sdTexto(v, S.veredito.frase);
  const mini = document.createElement("div"); mini.className = "sd-mini";
  [["Sobra de cada R$ 100", reais(S.sobra * 100), ["Sobra de cada R$ 100", ["O que fica depois de tudo, a cada R$ 100 que o cliente paga."], reais(S.lucro) + " ÷ R$ " + moeda(S.bruto) + " × 100 = " + reais(S.sobra * 100)]],
   ["Pró-labore", reais(S.proLabore), ["Pró-labore", ["O salário do dono, já pago dentro das contas fixas.", "Vem de Custos e preços, custos da casa."], null]],
   ["O dono leva", reais(S.donoLeva), ["O dono leva", ["Pró-labore mais o lucro do mês."], "R$ " + moeda(S.proLabore) + " + " + reais(S.lucro) + " = " + reais(S.donoLeva)]]].forEach(([a, b, ex]) => {
    const d = document.createElement("div"); const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; d.append(y, x); mini.appendChild(d);
    explicar(d, ex[0], ex[1], { conta: ex[2], tudoClicavel: true, depois: mini });
  });
  v.appendChild(mini);
  box.appendChild(v);

  /* 1b. de onde sai o lucro: a conta inteira, linha por linha */
  const lc = sdCard("De onde sai o lucro de " + M, "sdConta");
  lc.classList.add("sd-extrato");
  sdLinha(lc, "Os clientes pagaram", reais(C.bruto), "entra", ["Venda do mês", ["O que os clientes pagaram, no preço cheio do cardápio.",
    "Vem do que cada canal repassou no Nosso Financeiro, voltado ao preço antes da comissão do app."]]);
  [["App e promoção", C.app, D.app, "Comissão do app e desconto que a casa banca, medidos em cada canal."],
   ["Imposto (Simples)", C.imposto, D.imposto, "Alíquota da tabela do Simples, a mesma usada nos preços."],
   ["Ingrediente e embalagem", C.ingrediente, D.ingrediente, "Pelas fichas técnicas dos doces vendidos, com 5% de perda."]].forEach(([rot, val, f, o]) =>
    sdLinha(lc, "− " + rot, reais(val), "sai", [rot, [o], "R$ " + moeda(C.bruto) + " × " + pct(f) + " = " + reais(val)]));
  sdLinha(lc, "= Sobrou da venda", reais(C.margem), "sub", ["Sobrou da venda", ["O que a venda deixa para pagar as contas da casa."],
    "R$ " + moeda(C.bruto) + " − " + moeda(C.app) + " − " + moeda(C.imposto) + " − " + moeda(C.ingrediente) + " = " + reais(C.margem)]);
  C.itens.forEach(f => {
    const nome = f.origem === "folha" ? f.nome.replace(/^Folha: /, "") + " (equipe)" : f.nome;
    const obs = (f.obs || "").split(/\.\s/)[0].replace(/\.$/, "");
    sdLinha(lc, "− " + nome, reais(f.valor), "sai", [nome, [(obs ? obs + ". " : "") + "Valor do mês em Custos e preços, custos da casa."]]);
  });
  C.extras.forEach(e => sdLinha(lc, "− " + e.nome + " (ajuda extra)", reais(e.valor), "sai", [e.nome, [(e.detalhe ? e.detalhe + ". " : "") + "Sai da bolsa de ajuda extra do mês."]]));
  sdLinha(lc, "= Lucro do mês", reais(C.lucro), "total " + (C.lucro >= 0 ? "bom" : "alerta"), ["Lucro do mês", ["Sobrou da venda menos todas as contas fixas."],
    reais(C.margem) + " − " + reais(C.fixo) + (C.extraTotal ? " − " + reais(C.extraTotal) + " de ajuda extra" : "") + " = " + reais(C.lucro)]);
  sdTexto(lc, "Não é o extrato do banco: é a venda do mês menos o que ela custou. O banco está no fim da tela, em \"E o caixa?\".", "nota");
  box.appendChild(lc);

  /* 2. tendência */
  if(S.tendencia && S.tendencia.length > 1){
    const t = sdCard("Lucro mês a mês", "sdTendencia");
    const mx = Math.max(...S.tendencia.map(x => Math.abs(x.lucro)), 1);
    const g = document.createElement("div"); g.className = "sd-colunas";
    S.tendencia.forEach(x => {
      const c = document.createElement("div"); c.className = "sd-col" + (x.lucro < 0 ? " neg" : "") + (x.mes === S.mes ? " atual" : "");
      const val = document.createElement("b"); val.textContent = (x.lucro < 0 ? "−" : "") + "R$ " + n0(Math.abs(x.lucro));
      const bar = document.createElement("i"); bar.style.height = Math.max(4, Math.abs(x.lucro) / mx * 70) + "px";
      const m = document.createElement("span"); m.textContent = mesCurto(x.mes);
      c.append(val, bar, m); g.appendChild(c);
    });
    t.appendChild(g);
    explicar(g, "Lucro mês a mês", ["Mesma conta do lucro: o que sobrou da venda de cada mês menos as contas fixas de hoje (R$ " + moeda(S.custoFixo) + ").", "A ajuda extra só entra no mês do topo."],
      { conta: S.tendencia.map(x => mesCurto(x.mes) + ": R$ " + n0(x.margem) + " − R$ " + n0(S.custoFixo) + (x.extra ? " − R$ " + n0(x.extra) : "") + " = " + (x.lucro < 0 ? "−" : "") + "R$ " + n0(Math.abs(x.lucro))).join(" · "), tudoClicavel: true });
    sdTexto(t, "Com as contas fixas de hoje. Venda: " + S.tendencia.map(x => mesCurto(x.mes).toLowerCase() + " R$ " + n0(x.bruto)).join(" · ") + ".", "nota");
    box.appendChild(t);
  }

  /* 3. para onde vai cada R$ 100 */
  const pv = sdCard("Para onde vai cada R$ 100", "sdDestino");
  const fatias = [
    ["App e promoção", Number(D.app), "app", ["App e promoção", ["Comissão do app e desconto que a casa banca.", "Fatia medida de cada canal, pesada pelo quanto cada um vendeu."]]],
    ["Imposto", Number(D.imposto), "imp", ["Imposto", ["Simples Nacional sobre a venda.", "Calculado pela tabela com a venda de 12 meses."]]],
    ["Ingrediente e embalagem", Number(D.ingrediente), "ing", ["Ingrediente e embalagem", ["O que entra em cada doce pela ficha técnica, com 5% de perda.", "Muda quando muda o preço de um insumo."]]],
    ["Contas fixas e pró-labore", Number(D.custo_fixo), "fixo", ["Contas fixas e pró-labore", ["Aluguel, luz, equipe, contador, sistema, parcelamento e pró-labore.", "Item por item em \"De onde sai o lucro\"."], S.custoFixo != null ? "R$ " + moeda(S.custoFixo) + " por mês" : null]],
    [Number(D.sobra) >= 0 ? "Sobra" : "Falta", Math.abs(Number(D.sobra)), Number(D.sobra) >= 0 ? "sobra" : "falta", ["Sobra", ["O que fica depois de tudo."]]]
  ];
  const pilha = document.createElement("div"); pilha.className = "sd-pilha";
  fatias.forEach(([, f, cls]) => { const s = document.createElement("i"); s.className = cls; s.style.width = Math.max(0, f * 100) + "%"; pilha.appendChild(s); });
  pv.appendChild(pilha);
  fatias.forEach(([rot, f, cls, ex]) => sdLinha(pv, rot, "R$ " + moeda(f * 100), "cor-" + cls,
    [ex[0], ex[1], (ex[2] ? ex[2] + ". " : "") + "R$ " + moeda(f * 100) + " de cada R$ 100 = R$ " + moeda(f * S.bruto) + " no mês"]));
  box.appendChild(pv);

  /* 4. folga */
  if(S.udia != null && S.equilibrio != null){
    const f = sdCard("Quanto falta para dar prejuízo", "sdFolga");
    sdLinha(f, "Vendendo por dia", S.udia + " doces", null, ["Vendendo por dia", ["Média de doces vendidos por dia.", "Vem da contagem da geladeira dos últimos 60 dias."]]);
    sdLinha(f, "Precisa vender", S.equilibrio + " doces", null, ["Ponto de equilíbrio", ["Quantos doces por dia pagam todas as contas fixas.", "Contas fixas do mês ÷ o que cada doce deixa ÷ 30 dias."],
      "R$ " + moeda(S.custoFixo) + " ÷ R$ " + moeda(S.contribUn) + " ÷ 30 = " + S.equilibrio]);
    sdLinha(f, "Folga", (S.folga >= 0 ? "" : "−") + Math.round(Math.abs(S.folga) * 100) + "%", S.folga < 0.15 ? "alerta" : "bom",
      ["Folga", ["Quanto a venda está acima do mínimo. Abaixo de 15% é pouco."], "(" + S.udia + " − " + S.equilibrio + ") ÷ " + S.equilibrio + " = " + Math.round(S.folga * 100) + "%"]);
    box.appendChild(f);
  }

  /* 5. turno da noite */
  if(S.noite){
    const N = S.noite, F = S.fontes.fatia_noite;
    const c = sdCard("O turno da noite (depois das 18h)", "sdNoite");
    const big = document.createElement("div"); big.className = "sd-noite";
    [["Cada noite deixa", reais(N.porNoite), "bom"], ["Custo da noite hoje", N.custoAtual != null ? reais(N.custoAtual) : "—", ""],
     ["Sobra por noite", N.sobraAtual != null ? reais(N.sobraAtual) : "—", N.sobraAtual != null && N.sobraAtual < 0 ? "alerta" : "bom"]].forEach(([a, b, cls]) => {
      const d = document.createElement("div"); d.className = cls; const y = document.createElement("b"); y.textContent = b; const x = document.createElement("span"); x.textContent = a; d.append(y, x); big.appendChild(d);
    });
    c.appendChild(big);
    explicar(big, "Quanto a noite deixa", ["O que as vendas da noite deixam depois de app, imposto e ingrediente. É disso que sai quem trabalha à noite.",
      "A noite é " + pct(N.fatia) + " da venda" + (F && F.fonte ? " (" + F.fonte + ")" : "") + "."],
      { conta: "R$ " + moeda(S.contribUn) + " por doce × " + S.udia + " doces × " + pct(N.fatia) + " = R$ " + moeda(N.porNoite) + " por noite. Hoje a noite custa R$ " + moeda(S.yasmin ? S.yasmin.semanal : 0) + " ÷ 7 = R$ " + moeda(N.custoAtual || 0) + ".", tudoClicavel: true });
    sdLinha(c, "Freela: empata em", reais(N.teto) + " por noite", null, ["Teto do freela", ["Acima disso a noite dá prejuízo."], "= o que a noite deixa, R$ " + moeda(N.porNoite)]);
    sdLinha(c, "Freela: pague até", reais(N.recomendado) + " por noite", "bom", ["Valor recomendado para o freela", ["Deixa 30% do que a noite rende para a casa."], "R$ " + moeda(N.porNoite) + " × 70% = R$ " + moeda(N.recomendado)]);
    sdLinha(c, "Freela de R$ " + moeda(N.freela) + " deixa", reais(N.sobraFreela) + " por noite", N.sobraFreela < 0 ? "alerta" : "bom",
      ["Freela de hoje", ["O valor combinado com a última freela."], "R$ " + moeda(N.porNoite) + " − R$ " + moeda(N.freela) + " = " + reais(N.sobraFreela)]);
    const B = S.bolsa;
    const mProx = mesLongo(mesSeguinte(S.mes)).split(" ")[0].toLowerCase();
    sdLinha(c, "Bolsa de ajuda extra de " + mProx, reais(B.total) + " · " + B.noites + (B.noites === 1 ? " noite" : " noites"), B.noites < 2 ? "alerta" : "bom",
      ["Bolsa de ajuda extra", ["Para Eliana e freelas além de quem cobre a noite e o domingo.", "É " + pct(B.fatia) + " do que sobrou em " + M + " antes da ajuda extra; o resto fica de lucro.", "O saldo do mês, dia a dia, está em Quem veio no ateliê."],
       reais(B.antesExtra) + " × " + pct(B.fatia) + " = " + reais(B.total) + " ÷ R$ " + moeda(N.freela) + " = " + B.noites + (B.noites === 1 ? " noite" : " noites")]);
    if(S.vendaPorDiaria){
      const V = S.vendaPorDiaria;
      sdLinha(c, "Para pagar 1 diária de R$ " + moeda(V.valor), reais(V.venda) + " de venda" + (V.doces ? " · " + V.doces + " doces" : ""), null,
        ["Venda que paga uma diária", ["De cada R$ 100 vendidos, sobram R$ " + moeda(S.margemPct * 100) + " depois de app, imposto e ingrediente. É disso que sai a diária.",
          "Em doces: cada doce deixa R$ " + moeda(S.contribUn) + "."],
         "R$ " + moeda(V.valor) + " ÷ " + pct(S.margemPct) + " = " + reais(V.venda) + " de venda" + (V.doces ? " · R$ " + moeda(V.valor) + " ÷ R$ " + moeda(S.contribUn) + " = " + V.doces + " doces" : "")]);
    }
    if(S.proxFreela){
      const X = S.proxFreela;
      sdLinha(c, "Para mais 1 noite de freela", "+" + X.doces + (X.doces === 1 ? " doce por dia" : " doces por dia"), null,
        ["Mais uma noite de freela", ["Quanto a venda precisa subir para a bolsa pagar a " + X.noite + "ª noite do mês.",
          "Metade do que a venda a mais deixa vai para a bolsa. Cada doce a mais por dia deixa R$ " + moeda(S.doceMes) + " no mês (R$ " + moeda(S.contribUn) + " × 30)."],
         "Faltam R$ " + moeda(X.faltaBolsa) + " na bolsa = R$ " + moeda(X.falta) + " de sobra ÷ R$ " + moeda(S.doceMes) + " = " + X.doces + (X.doces === 1 ? " doce" : " doces") + " por dia"]);
    }
    sdTexto(c, "A noite precisa de 1 pessoa. Quem cobre se paga até " + reais(N.teto) + " por noite.", "nota");
    box.appendChild(c);
  }

  /* 6. Yasmin: o que fazer */
  if(S.yasmin){
    const Y = S.yasmin, nome = S.yasminNome;
    const c = sdCard(nome + ": o que fazer", "sdYasmin");
    const d = document.createElement("div"); d.className = "sd-decisao tom-" + Y.tom;
    const b = document.createElement("b"); b.textContent = Y.decisao;
    const p = document.createElement("p"); p.textContent = Y.porque;
    d.append(b, p); c.appendChild(d);
    const tab = document.createElement("div"); tab.className = "sd-cenarios";
    Y.cenarios.forEach(x => {
      const l = document.createElement("div"); l.className = "sd-cen" + (x.id === Y.recomendado ? " rec" : "");
      l.dataset.cen = x.id;
      const t = document.createElement("span"); t.className = "t"; t.textContent = x.rot + (x.id === Y.recomendado ? " ✓" : "");
      const vv = document.createElement("b"); vv.textContent = "R$ " + n0(x.mes);
      const extra = { freelas: " · sem constância", registrar: " · ela ganha menos" }[x.id] || "";
      const df = document.createElement("small"); df.textContent = x.id === "manter" ? "hoje" : (x.dif <= 0 ? "economiza R$ " + n0(-x.dif) : "+ R$ " + n0(x.dif)) + extra;
      df.className = x.dif < 0 ? "bom" : x.dif > 0 ? "alerta" : "";
      l.append(t, vv, df); tab.appendChild(l);
      explicar(l, x.rot, [x.det], { conta: "R$ " + moeda(x.mes) + " por mês" + (x.id === "manter" ? " (R$ " + moeda(Y.semanal) + " × 52 ÷ 12)" : ""), tudoClicavel: true, depois: l });
    });
    c.appendChild(tab);
    sdLinha(c, "Hora dela hoje", "R$ " + moeda(Y.hora), Y.hora > REF_EQUIPE.pisoMes44h / REF_EQUIPE.horasMes44h * 1.3 ? "alerta" : "",
      ["Hora dela", ["Valor da semana ÷ horas da escala."], "R$ " + moeda(Y.semanal) + " ÷ " + eqHorasTx(Y.horas) + " = R$ " + moeda(Y.hora) + ". Piso de mercado: R$ " + moeda(REF_EQUIPE.pisoMes44h / REF_EQUIPE.horasMes44h) + " a hora."]);
    sdTexto(c, "7 noites sem folga é risco trabalhista. A folga semanal resolve isso e ainda economiza.", "nota");
    box.appendChild(c);
  }

  /* 7. imposto */
  if(S.imposto){
    const I = S.imposto;
    const c = sdCard("Imposto usado nos preços", "sdImposto");
    sdLinha(c, "Alíquota usada", pct(I.usado) + (I.modo === "auto" ? " · automática" : " · fixa"), null,
      ["Alíquota do Simples", ["Tabela do Simples, Anexo " + I.anexo + ", faixa " + I.faixa + ".", "A faixa sai da venda dos últimos 12 meses" + (I.meses < 12 ? " (média de " + I.meses + " meses × 12)" : "") + "."],
       "Venda de 12 meses R$ " + moeda(I.rbt12) + " → " + pct(I.usado)]);
    if(I.pago != null) sdLinha(c, "DAS pago (3 meses)", pct(I.pago) + " da venda", I.pago < I.usado - 0.01 ? "alerta" : "",
      ["DAS pago", ["O que foi pago de DAS nos últimos 3 meses, sobre a venda estimada desses meses.", "Abaixo da tabela: falta declarar parte da venda. Assunto do contador."],
       I.diferencaMes != null ? "Diferença: cerca de R$ " + moeda(I.diferencaMes) + " por mês" : null]);
    box.appendChild(c);
  }

  /* 8. equipe */
  const e = sdCard("Equipe", "sdEquipe");
  S.equipe.forEach(pp => {
    const l = sdLinha(e, pp.nome, "R$ " + moeda(pp.mes), null, [pp.nome, [pp.detalhe + "."], pp.regime === "semanal" ? "× 52 semanas ÷ 12 = R$ " + moeda(pp.mes) + " por mês" : "= R$ " + moeda(pp.mes) + " no mês"]);
    const sm = document.createElement("small"); sm.textContent = pp.detalhe + (pp.hora ? " · R$ " + moeda(pp.hora) + "/h" : "");
    l.querySelector("span").appendChild(sm);
  });
  sdLinha(e, "Equipe no mês", "R$ " + moeda(S.equipeTotal) + " · " + pct(S.equipePct || 0), S.equipePct != null && S.equipePct > REF_EQUIPE.tetoEquipe ? "alerta" : "bom",
    ["Peso da equipe", ["Quanto da venda vai para quem trabalha (sem o pró-labore). Até " + pct(REF_EQUIPE.tetoEquipe) + " é saudável."], "R$ " + moeda(S.equipeTotal) + " ÷ R$ " + moeda(S.bruto) + " = " + pct(S.equipePct || 0)]);
  box.appendChild(e);

  /* 9. contratar */
  const k = sdCard("Dá para contratar registrado?", "sdContratar");
  sdLinha(k, "Cabe no lucro", "R$ " + moeda(S.cabe) + " por mês", S.cabe >= REF_EQUIPE.clt40hCusto ? "bom" : "alerta", ["Cabe no lucro", ["O lucro do mês: é o máximo de custo novo sem ir para o vermelho."]]);
  sdLinha(k, "CLT 40h custa", "R$ " + moeda(REF_EQUIPE.clt40hCusto), null, ["Custo de uma CLT de 40h", ["Salário de R$ " + moeda(REF_EQUIPE.clt40hSalario) + " (piso proporcional) + 32,2% de encargos + vale-transporte."]]);
  if(S.faltaClt > 0) sdLinha(k, "Para caber", "+" + S.unExtraDia + " doces/dia", "alerta",
    ["O que precisa mudar", ["Vender mais por dia ou baixar a fatia dos apps."], "Faltam R$ " + moeda(S.faltaClt) + " ÷ R$ " + moeda(S.contribUn) + " por doce ÷ 30 = " + S.unExtraDia + " doces por dia, ou " + (S.pontosApp * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " pontos a menos de app"]);
  box.appendChild(k);

  /* 10. conselhos */
  if(S.recomendacoes.length){
    const r = sdCard("O que fazer agora", "sdConselhos");
    S.recomendacoes.forEach(x => {
      const dd = document.createElement("div"); dd.className = "sd-cons tom-" + x.tom;
      const bb = document.createElement("b"); bb.textContent = x.t;
      const pp = document.createElement("p"); pp.textContent = x.d;
      dd.append(bb, pp); r.appendChild(dd);
    });
    box.appendChild(r);
  }

  /* 11. caixa */
  if(S.caixa){
    const c = sdCard("E o caixa?", "sdCaixa");
    sdLinha(c, "Sobrou no caixa", reais(S.caixa.sobrou), null, ["Caixa do Nosso Financeiro", ["Entrou menos saiu no mês, como está no banco.",
      "Não bate com o lucro: compra no cartão entra só a parcela do mês, parte do repasse é venda do mês anterior, e o pró-labore não sai da conta."],
      "R$ " + moeda(S.caixa.entrou) + " − R$ " + moeda(S.caixa.saiu) + " = " + reais(S.caixa.sobrou)]);
    sdTexto(c, "Para saber se dá lucro, vale o número do topo.", "nota");
    box.appendChild(c);
  }
}
