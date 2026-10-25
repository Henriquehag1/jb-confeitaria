/* JB OS · equipe: faltas de quem tem valor fixo por semana e freelas que cobrem o ateliê.
   Só o gestor vê e mexe (RLS de jb_falta e jb_freela).
   A falta desconta as horas do dia (escala × valor da hora) da quinzena que cobre aquele dia.
   A freela vira uma conta a pagar (tipo "equipe") em Contas a pagar. */

let FALTAS  = [];        // jb_falta do mês aberto, sem as canceladas
let FREELAS = [];        // jb_freela do mês aberto, sem as canceladas
let ESCALAS = [];        // jb_escala de todo mundo
let FREELA_CONTAS = {};  // conta_id -> { id, pago_em, arquivada }
let EQ_FORM = null;      // formulário aberto: { tipo: "falta", uid, ... } ou { tipo: "freela", ... }
let EQ_CANCELA = null;   // "falta:12" ou "freela:3": primeiro toque em cancelar, espera o segundo
const BANCO_ABERTO = {};  // por pessoa: a lista do banco fica aberta entre uma ação e outra
let BANCO = [];          // jb_banco_horas de todo o tempo (não cancelados): o saldo não zera na virada do mês
let FR_AC = null;        // a liberação de freela mais recente em vigor (jb_freela_acesso) ou null; undefined = não deu para ler
let FR_ACS = [];         // todas as liberações em vigor: cada freela tem o seu código
let FR_AC_FORM = null;   // formulário de liberar aberto: { nome, ate }
let FR_AC_MSG = null;    // mensagem pronta depois de liberar
let FR_AC_REG = "";      // o que aconteceu com a diária ao liberar
const APP_LINK = "https://henriquehag1.github.io/jb-confeitaria/";

/* ============================================================
   CONTAS PURAS
   ============================================================ */
function eqMin(hhmm){
  if(!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
}
/* horas entre a entrada e a saída; passando da meia-noite, soma o dia */
function eqHoras(ent, sai){
  const a = eqMin(ent), b = eqMin(sai);
  if(a == null || b == null) return null;
  let d = b - a;
  if(d <= 0) d += 1440;
  return d / 60;
}
function eqHorasTx(h){
  const t = Math.round(h * 60);
  const hh = Math.floor(t / 60), mm = t % 60;
  return hh + "h" + (mm ? String(mm).padStart(2, "0") : "");
}
const eqHHMM = t => t ? String(t).slice(0, 5) : "";
function eqVigente(e, iso){ return e.inicio <= iso && (!e.fim || e.fim >= iso); }
function eqEscalaDoDia(escalas, uid, iso){
  const dw = diaDaSemana(iso);
  return escalas.find(e => e.user_id === uid && e.dia_semana === dw && eqVigente(e, iso)) || null;
}
function eqHorasSemana(escalas, uid, iso){
  return escalas.filter(e => e.user_id === uid && eqVigente(e, iso))
                .reduce((s, e) => s + (eqHoras(e.entrada, e.saida) || 0), 0);
}
/* valor da hora de quem ganha por semana: o combinado da semana dividido pelas horas da escala */
function eqValorHora(acordo, escalas, iso){
  if(!acordo || acordo.regime !== "semanal" || acordo.valor == null) return null;
  const h = eqHorasSemana(escalas, acordo.user_id, iso);
  return h > 0 ? Number(acordo.valor) / h : null;
}
const eqDesconto = (horas, vh) => Math.round(horas * vh * 100) / 100;
/* banco de horas: minutos a mais (+) e usados (-) */
const eqSaldo = (banco, uid) => banco.filter(b => b.user_id === uid).reduce((s, b) => s + Number(b.minutos), 0);
function eqMinTx(n){
  const a = Math.abs(Math.round(n));
  const h = Math.floor(a / 60), m = a % 60;
  return (h ? h + "h" + (m ? String(m).padStart(2, "0") : "") : m + " min");
}
/* a falta usa o saldo primeiro; o que sobrar vira desconto pelas horas */
function eqCompensa(faltaMin, saldo, vh){
  const usa = Math.max(0, Math.min(faltaMin, saldo));
  const resto = faltaMin - usa;
  return { usa, resto, desconto: resto > 0 && vh ? Math.round(resto / 60 * vh * 100) / 100 : null };
}
const eqNome = uid => { const r = DIAS_RES.find(x => x.user_id === uid); return r ? r.nome : "Pessoa"; };

/* ============================================================
   CARREGAR
   ============================================================ */
async function carregarEquipe(ini, fim){
  const [fa, fr, es, bh] = await Promise.all([
    sb.from("jb_falta").select("*").eq("cancelada", false).gte("data", ini).lte("data", fim).order("data"),
    sb.from("jb_freela").select("*").eq("cancelada", false).gte("data", ini).lte("data", fim).order("data"),
    sb.from("jb_escala").select("user_id,dia_semana,entrada,saida,inicio,fim"),
    sb.from("jb_banco_horas").select("id,user_id,data,minutos,motivo,origem,falta_id,dia_id").eq("cancelado", false).order("data")
  ]);
  await carregarFreelaAcesso();
  await carregarFreelasFixas(true).catch(() => null);
  BANCO = (bh && !bh.error && bh.data) || [];
  FALTAS  = (fa && !fa.error && fa.data) || [];
  FREELAS = (fr && !fr.error && fr.data) || [];
  ESCALAS = (es && !es.error && es.data) || [];
  FREELA_CONTAS = {};
  const ids = FREELAS.map(f => f.conta_id).filter(Boolean);
  if(ids.length){
    const r = await sb.from("jb_conta").select("id,pago_em,arquivada").in("id", ids);
    ((r && !r.error && r.data) || []).forEach(c => { FREELA_CONTAS[c.id] = c; });
  }
}
async function recarregarEquipe(){
  await carregarEquipe(DIAS_MES, ultimoDia(DIAS_MES));
  montarCalendarioDias();
}

/* ============================================================
   DIAS QUE O APP ANOTOU SOZINHO: veio ou não veio
   ============================================================ */
function blocoSugeridos(uid){
  const wrap = document.createElement("div");
  const sug = DIAS.filter(d => d.user_id === uid && d.status === "sugerido").sort((a, b) => a.data < b.data ? -1 : 1);
  if(!sug.length) return wrap;
  wrap.className = "eq-sug";
  const t = document.createElement("p");
  t.className = "eq-tit";
  t.textContent = "O app anotou porque ela abriu o app. Ela veio?";
  wrap.appendChild(t);
  sug.forEach(d => {
    const ln = document.createElement("div");
    ln.className = "eq-ln";
    const dia = document.createElement("span"); dia.className = "dia"; dia.textContent = dataCurta(d.data);
    const sim = document.createElement("button"); sim.type = "button"; sim.textContent = "Veio";
    sim.setAttribute("aria-label", "Veio em " + dataCurta(d.data));
    sim.onclick = travar(sim, () => alternarDia(uid, d.data));
    const nao = document.createElement("button"); nao.type = "button"; nao.className = "sec"; nao.textContent = "Não veio";
    nao.setAttribute("aria-label", "Não veio em " + dataCurta(d.data));
    nao.onclick = travar(nao, () => descartarSugestao(d));
    ln.append(dia, sim, nao);
    wrap.appendChild(ln);
  });
  return wrap;
}
async function descartarSugestao(d){
  const { error } = await sb.from("jb_dia_trabalhado").delete().eq("id", d.id).eq("status", "sugerido");
  if(error){ aviso("diasMsg", "Não consegui tirar esse dia agora.", "err"); return; }
  DIAS = DIAS.filter(x => x.id !== d.id);
  const { data: rs } = await sb.from("jb_pessoal_mes").select("*").eq("mes", DIAS_MES);
  DIAS_RES = rs || DIAS_RES;
  toast(dataCurta(d.data) + " tirado: não veio.");
  montarCalendarioDias();
}

/* ============================================================
   FALTAS (quem ganha por semana)
   ============================================================ */
function blocoFaltas(uid, ac){
  const wrap = document.createElement("div");
  wrap.className = "eq-faltas";
  const minhas = FALTAS.filter(f => f.user_id === uid);
  const vh = eqValorHora(ac, ESCALAS, DIAS_MES);

  const res = document.createElement("p");
  res.className = "eq-tit";
  const desc = minhas.filter(f => f.desconta).reduce((s, f) => s + Number(f.valor_desconto || 0), 0);
  res.textContent = (minhas.length
    ? (minhas.length === 1 ? "1 falta no mês" : minhas.length + " faltas no mês") + (desc ? ", desconto de R$ " + moeda(desc) : ", sem desconto")
    : "Nenhuma falta no mês") + (vh ? " · hora vale R$ " + moeda(vh) : "");
  wrap.appendChild(res);

  minhas.forEach(f => {
    const ln = document.createElement("div");
    ln.className = "eq-ln";
    ln.dataset.falta = f.id;
    const dia = document.createElement("span"); dia.className = "dia"; dia.textContent = dataCurta(f.data);
    const info = document.createElement("span"); info.className = "info";
    const fr = FREELAS.find(x => x.falta_id === f.id);
    info.textContent = (f.entrada && f.saida ? eqHHMM(f.entrada) + " às " + eqHHMM(f.saida) + ", " : "") + eqHorasTx(Number(f.horas))
      + (Number(f.banco_min) ? " · usou " + eqMinTx(Number(f.banco_min)) + " do banco" : "")
      + (f.desconta ? " · desconta R$ " + moeda(Number(f.valor_desconto)) : (Number(f.banco_min) ? "" : " · sem desconto"))
      + (fr ? " · " + fr.nome + " cobriu" + (f.desconta ? " (o desconto paga a diária dela, R$ " + moeda(Number(fr.valor)) + ")" : "") : "")
      + (f.motivo ? " · " + f.motivo : "");
    ln.append(dia, info, botaoCancelar("falta:" + f.id, "Cancelar a falta de " + dataCurta(f.data), () => cancelarFalta(f)));
    wrap.appendChild(ln);
  });

  wrap.appendChild(blocoBanco(uid));

  if(EQ_FORM && EQ_FORM.tipo === "falta" && EQ_FORM.uid === uid){
    wrap.appendChild(formFalta(uid, ac));
  } else {
    const b = document.createElement("button");
    b.type = "button"; b.className = "eq-abre"; b.textContent = "Registrar falta";
    b.onclick = () => { EQ_FORM = novoFormFalta(uid, hojeSP()); EQ_CANCELA = null; montarCalendarioDias(); };
    wrap.appendChild(b);
  }
  return wrap;
}

function novoFormFalta(uid, iso){
  const e = eqEscalaDoDia(ESCALAS, uid, iso);
  return { tipo: "falta", uid, data: iso, entrada: e ? eqHHMM(e.entrada) : "", saida: e ? eqHHMM(e.saida) : "",
           modo: eqSaldo(BANCO, uid) > 0 ? "banco" : "desconta", motivo: "", temFreela: false, nome: "", valor: "" };
}

function campo(rotulo, el){
  const l = document.createElement("label");
  const s = document.createElement("span"); s.textContent = rotulo;
  l.append(s, el);
  return l;
}
function entrada(tipo, valor, onch, attrs){
  const i = document.createElement("input");
  i.type = tipo; i.value = valor == null ? "" : valor;
  Object.entries(attrs || {}).forEach(([k, v]) => i.setAttribute(k, v));
  i.oninput = () => onch(i.value);
  return i;
}

function formFalta(uid, ac){
  const st = EQ_FORM;
  const f = document.createElement("div");
  f.className = "eq-form"; f.id = "eqFormFalta";
  const vh = eqValorHora(ac, ESCALAS, st.data || DIAS_MES);

  const saldo = eqSaldo(BANCO, uid);
  const conta = document.createElement("p"); conta.className = "eq-conta"; conta.id = "eqFaltaConta";
  const atualizar = () => {
    const h = eqHoras(st.entrada, st.saida);
    if(!h){ conta.textContent = "Diga das que horas até que horas ela faltaria."; return; }
    if(!vh){ conta.textContent = eqHorasTx(h) + ". Sem valor da hora: a escala dela não está completa."; return; }
    const d = eqDesconto(h, vh);
    conta.textContent = eqHorasTx(h) + " × R$ " + moeda(vh) + " a hora = R$ " + moeda(d);
    rotDesc.textContent = "Descontar R$ " + moeda(d) + " do pagamento dela";
    if(saldo > 0){
      const c = eqCompensa(Math.round(h * 60), saldo, vh);
      rotBanco.textContent = "Usar o banco de horas (saldo " + eqMinTx(saldo) + "): usa " + eqMinTx(c.usa)
        + (c.resto > 0 ? " e desconta R$ " + moeda(c.desconto) + " pelo resto" : ", sem desconto");
    }
  };

  const lin = document.createElement("div"); lin.className = "eq-linha";
  const iDia = entrada("date", st.data, v => {
    st.data = v;
    const e = v ? eqEscalaDoDia(ESCALAS, uid, v) : null;
    st.entrada = e ? eqHHMM(e.entrada) : ""; st.saida = e ? eqHHMM(e.saida) : "";
    iEnt.value = st.entrada; iSai.value = st.saida; atualizar();
  }, { id: "eqFaltaDia", "aria-label": "Dia da falta" });
  const iEnt = entrada("time", st.entrada, v => { st.entrada = v; atualizar(); }, { id: "eqFaltaEnt", "aria-label": "Faltou a partir de" });
  const iSai = entrada("time", st.saida, v => { st.saida = v; atualizar(); }, { id: "eqFaltaSai", "aria-label": "Faltou até" });
  lin.append(campo("Dia", iDia), campo("Das", iEnt), campo("Até", iSai));
  f.appendChild(lin);
  f.appendChild(conta);

  /* o app pergunta sempre: banco de horas (se houver saldo), descontar ou não */
  const perg = document.createElement("div"); perg.className = "eq-opcoes"; perg.setAttribute("role", "radiogroup");
  const rotDesc = document.createElement("span");
  const rotBanco = document.createElement("span");
  const opc = (valor, rot, id) => {
    const l = document.createElement("label");
    const r = document.createElement("input"); r.type = "radio"; r.name = "eqDesconta"; r.id = id; r.checked = st.modo === valor;
    r.onchange = () => { st.modo = valor; };
    l.append(r, rot);
    return l;
  };
  const rotNao = document.createElement("span"); rotNao.textContent = "Não descontar (falta combinada ou abonada)";
  if(saldo > 0) perg.appendChild(opc("banco", rotBanco, "eqDescBanco"));
  perg.append(opc("desconta", rotDesc, "eqDescSim"), opc("abona", rotNao, "eqDescNao"));
  f.appendChild(perg);
  rotDesc.textContent = "Descontar as horas do pagamento dela";

  f.appendChild(campo("Motivo (opcional)", entrada("text", st.motivo, v => { st.motivo = v; }, { id: "eqFaltaMotivo", maxlength: "200" })));

  /* freela no lugar */
  const ck = document.createElement("label"); ck.className = "eq-ck";
  const ci = document.createElement("input"); ci.type = "checkbox"; ci.id = "eqTemFreela"; ci.checked = st.temFreela;
  ci.onchange = () => { st.temFreela = ci.checked; montarCalendarioDias(); };
  ck.append(ci, document.createTextNode(" Veio uma freela no lugar"));
  f.appendChild(ck);
  if(st.temFreela){
    const lf = document.createElement("div"); lf.className = "eq-linha";
    lf.append(...campoNomeFreela(st, "eqFreelaNome", "Nome da freela"),
      campo("Valor combinado (R$)", entrada("text", st.valor, v => { st.valor = v; }, { id: "eqFreelaValor", inputmode: "decimal" }))
    );
    f.appendChild(lf);
    const n = document.createElement("p"); n.className = "eq-nota";
    n.textContent = "A freela entra em Contas a pagar no mesmo dia, com o horário da falta. Se a diária dela nesse dia já foi lançada em Freelas, o app liga essa diária à falta em vez de lançar outra.";
    f.appendChild(n);
  }

  const acs = document.createElement("div"); acs.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = "eqFaltaSalvar"; ok.textContent = "Salvar falta";
  ok.onclick = travar(ok, () => salvarFalta(uid, ac));
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Fechar";
  cx.onclick = () => { EQ_FORM = null; montarCalendarioDias(); };
  acs.append(ok, cx);
  f.appendChild(acs);
  atualizar();
  return f;
}

async function salvarFalta(uid, ac){
  const st = EQ_FORM;
  const h = eqHoras(st.entrada, st.saida);
  if(!st.data){ aviso("diasMsg", "Diga o dia da falta.", "warn"); return; }
  if(!h){ aviso("diasMsg", "Diga das que horas até que horas ela faltou.", "warn"); return; }
  if(FALTAS.some(x => x.user_id === uid && x.data === st.data)){ aviso("diasMsg", "Já tem falta registrada nesse dia.", "warn"); return; }
  const vh = eqValorHora(ac, ESCALAS, st.data);
  if(st.modo !== "abona" && !vh){ aviso("diasMsg", "Não sei o valor da hora dela. Marque sem desconto ou complete a escala.", "warn"); return; }
  const saldo = eqSaldo(BANCO, uid);
  const comp = st.modo === "banco" ? eqCompensa(Math.round(h * 60), saldo, vh) : null;
  let valorFreela = null, jaLancada = null;
  if(st.temFreela){
    if(!st.nome.trim()){ aviso("diasMsg", "Diga o nome da freela.", "warn"); return; }
    jaLancada = diariaRepetida(st.nome, st.data);
    if(jaLancada && jaLancada.falta_id){
      if(st.confirmaDup !== st.nome + st.data){
        st.confirmaDup = st.nome + st.data;
        aviso("diasMsg", jaLancada.nome + " já tem diária em " + diaCurto(st.data) + " (" + reais(jaLancada.valor) + "), ligada a outra falta. Se foi outro turno, toque em Salvar falta de novo.", "warn");
        return;
      }
      jaLancada = null;
    }
    if(!jaLancada){
      valorFreela = numBR(st.valor);
      if(valorFreela == null || !(valorFreela >= 0)){ aviso("diasMsg", "Diga o valor combinado com a freela.", "warn"); return; }
    }
  }
  aviso("diasMsg", "", "");

  const linha = { user_id: uid, data: st.data, entrada: st.entrada, saida: st.saida,
                  horas: Math.round(h * 100) / 100, valor_hora: vh ? Math.round(vh * 10000) / 10000 : null,
                  desconta: st.modo === "desconta" || !!(comp && comp.desconto),
                  valor_desconto: st.modo === "desconta" ? eqDesconto(h, vh) : (comp && comp.desconto) || null,
                  banco_min: comp ? comp.usa : 0,
                  motivo: st.motivo.trim() || null, cancelada: false, criado_por: EU.user_id };
  const { data: fa, error } = await sb.from("jb_falta").insert(linha).select("*").single();
  if(error || !fa){ aviso("diasMsg", "Não consegui salvar a falta agora.", "err"); return; }
  if(comp && comp.usa > 0){
    const { error: eb } = await sb.from("jb_banco_horas").insert({ user_id: uid, data: st.data, minutos: -comp.usa,
      motivo: "Usado na falta de " + diaCurto(st.data), origem: "falta", falta_id: fa.id, cancelado: false, criado_por: EU.user_id });
    if(eb) aviso("diasMsg", "A falta ficou salva, mas não consegui tirar as horas do banco. Confira o saldo.", "warn");
  }

  if(st.temFreela && st.nova) await guardarFreelaFixa(st.nome).catch(() => null);
  if(jaLancada){
    /* a diária já estava em Freelas: só passa a ser a de quem cobriu esta falta */
    const { error: el } = await sb.from("jb_freela").update({ falta_id: fa.id, no_lugar_de: uid }).eq("id", jaLancada.id);
    if(el) aviso("diasMsg", "A falta ficou salva, mas não consegui ligar a diária de " + jaLancada.nome + " a ela.", "warn");
  } else if(st.temFreela){
    const ok = await criarFreela({ nome: st.nome.trim(), data: st.data, entrada: st.entrada, saida: st.saida,
                                   valor: valorFreela, no_lugar_de: uid, falta_id: fa.id });
    if(!ok){
      aviso("diasMsg", "A falta ficou salva, mas a freela não. Registre a freela em Freelas, mais abaixo.", "warn");
      EQ_FORM = null; await recarregarEquipe(); return;
    }
  }
  EQ_FORM = null;
  toast("Falta de " + dataCurta(st.data) + " salva"
    + (comp && comp.usa ? ": usou " + eqMinTx(comp.usa) + " do banco" : "")
    + (linha.desconta ? (comp && comp.usa ? " e " : ": ") + "desconta R$ " + moeda(linha.valor_desconto) : "") + "."
    + (jaLancada ? " A diária de " + jaLancada.nome + " que já estava lançada ficou ligada a esta falta." : ""));
  await recarregarEquipe();
}

async function cancelarFalta(f){
  const { error } = await sb.from("jb_falta").update({ cancelada: true, cancelada_em: new Date().toISOString() }).eq("id", f.id);
  if(error){ aviso("diasMsg", "Não consegui cancelar a falta agora.", "err"); return; }
  /* as horas do banco usadas nessa falta voltam para o saldo */
  if(BANCO.some(b => b.falta_id === f.id))
    await sb.from("jb_banco_horas").update({ cancelado: true, cancelado_em: new Date().toISOString() }).eq("falta_id", f.id);
  EQ_CANCELA = null;
  toast("Falta de " + dataCurta(f.data) + " cancelada.");
  await recarregarEquipe();
}

/* primeiro toque arma, segundo toque cancela: nada some com um toque sem querer */
function botaoCancelar(chave, rotulo, fn, verbo){
  const b = document.createElement("button");
  b.type = "button"; b.className = "ch-ed";
  const armado = EQ_CANCELA === chave;
  const v = verbo || "cancelar";
  b.textContent = armado ? "toque de novo para " + v : v;
  b.setAttribute("aria-label", rotulo);
  b.onclick = armado ? travar(b, fn) : () => { EQ_CANCELA = chave; montarCalendarioDias(); };
  return b;
}

/* ============================================================
   ACESSO AO APP PARA FREELA
   A freela não tem conta: o gestor libera aqui, o banco gera um código de 6 números,
   e o primeiro celular que digitar o código fica com o acesso até a hora escolhida.
   ============================================================ */
async function carregarFreelaAcesso(){
  const r = await sb.from("jb_freela_acesso").select("id,nome,valido_de,valido_ate,erros,token_em,encerrado_em")
    .is("encerrado_em", null).gte("valido_ate", agora().toISOString()).order("id", { ascending: false }).limit(12);
  FR_ACS = (r && !r.error) ? (r.data || []) : [];
  FR_AC = (r && !r.error) ? (FR_ACS[0] || null) : undefined;
}

/* opções de validade: até as próximas 6h da manhã (o fim do turno da noite), 24 horas, 3 dias */
function frAcOpcoes(){
  const t = agora().getTime();
  let seis = Date.parse(hojeSP() + "T06:00:00-03:00");
  while(seis < t + 2 * 3600000) seis += 86400000;
  return [
    { id: "dias",  rotulo: "Até o fim do último dia de trabalho", ate: null },
    { id: "turno", rotulo: "Até " + quandoAte(new Date(seis).toISOString()), ate: new Date(seis).toISOString() },
    { id: "24h",   rotulo: "24 horas", ate: new Date(t + 86400000).toISOString() },
    { id: "3d",    rotulo: "3 dias",   ate: new Date(t + 3 * 86400000).toISOString() }
  ];
}

/* "Até o fim do último dia de trabalho": a saída do último dia mais 1 hora (sem horário, até as 6h do dia
   seguinte). Nunca passa de 4 dias a partir de agora, que é o limite do banco. */
function frAcAteDosDias(st){
  const ult = (st.dias || []).slice().sort().pop() || diaDoTurnoSP();
  let fim;
  if(st.saida){
    fim = Date.parse(ult + "T" + st.saida + ":00-03:00") + 3600000;
    if(st.entrada && st.saida < st.entrada) fim += 86400000;   // passa da meia-noite
  } else {
    fim = Date.parse(ult + "T06:00:00-03:00") + 86400000;
  }
  const t = agora().getTime();
  fim = Math.min(fim, t + 4 * 86400000 - 300000);
  if(fim < t + 2 * 3600000) fim = t + 2 * 3600000;
  return new Date(fim).toISOString();
}

function frAcMensagem(nome, ate, codigo){
  return "Oi, " + nome + "! Liberei o app da JB para você ver o que fazer hoje, registrar o que fez e fechar a geladeira.\n\n" +
    "1. Abra " + APP_LINK + "\n" +
    "2. Toque em Freela\n" +
    "3. Digite o código " + codigo + "\n\n" +
    "Seu acesso vale até " + quandoAte(ate) + ". Entre pelo seu celular: o código funciona em um celular só.\n\n" +
    "Qualquer dúvida me chama. Obrigada!";
}

function blocoFreelaAcesso(){
  const box = document.createElement("div");
  box.className = "fr-ac"; box.id = "frAcesso";
  const h = document.createElement("h4"); h.textContent = "Acesso ao app para freela";
  box.appendChild(h);
  if(FR_AC === undefined){
    const p = document.createElement("p"); p.className = "nota"; p.textContent = "Não consegui ler o acesso de freela agora. Toque em atualizar.";
    box.appendChild(p); return box;
  }

  if(FR_AC_MSG){
    const p = document.createElement("p"); p.className = "fr-ac-ok"; p.textContent = "Liberado. O código só aparece agora: mande esta mensagem para ela.";
    if(FR_AC_REG){ const r = document.createElement("p"); r.className = "nota"; r.id = "frAcReg"; r.textContent = FR_AC_REG; box.appendChild(r); }
    const ta = document.createElement("textarea"); ta.id = "frAcTexto"; ta.className = "eq-rel-texto"; ta.rows = 10; ta.value = FR_AC_MSG;
    ta.setAttribute("aria-label", "Mensagem para a freela");
    const bt = document.createElement("button"); bt.type = "button"; bt.className = "eq-rel-copiar"; bt.id = "frAcCopiar"; bt.textContent = "Copiar mensagem";
    bt.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch(e){}
      if(!ok){ ta.focus(); ta.select(); try { ok = document.execCommand("copy"); } catch(e){} }
      toast(ok ? "Mensagem copiada. Cole no WhatsApp dela." : "Não deu para copiar sozinho: o texto ficou selecionado, copie e cole.");
    };
    const fim = document.createElement("button"); fim.type = "button"; fim.className = "sec"; fim.textContent = "Pronto";
    fim.onclick = () => { FR_AC_MSG = null; FR_AC_REG = ""; montarCalendarioDias(); };
    const acs = document.createElement("div"); acs.className = "enc-acoes"; acs.append(bt, fim);
    box.append(p, ta, acs);
    return box;
  }

  if(FR_AC_FORM){ box.appendChild(formFreelaAcesso()); return box; }

  /* uma linha por freela liberada: cada uma tem o seu código e pode ser encerrada sozinha */
  const linhaAcesso = ac => ac.nome + " pode entrar até " + quandoAte(ac.valido_ate) + ". " +
    (ac.token_em ? "Já entrou num celular às " + new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(ac.token_em)) + "."
     : ac.erros >= 5 ? "O código foi bloqueado depois de 5 tentativas erradas. Libere de novo para gerar outro."
     : "Ainda ninguém entrou.");
  const sub = document.createElement("p"); sub.className = "sub"; sub.id = "frAcStatus";
  sub.textContent = FR_ACS.length
    ? FR_ACS.map(linhaAcesso).join(" ")
    : "Ninguém liberado agora. Libere quando uma freela vier produzir ou fechar a geladeira.";
  box.appendChild(sub);
  if(FR_ACS.length){
    const lista = document.createElement("div"); lista.className = "fr-ac-lista"; lista.id = "frAcLista";
    FR_ACS.forEach(ac => {
      const l = document.createElement("div"); l.className = "fr-ac-linha"; l.dataset.id = ac.id;
      const n = document.createElement("span"); n.textContent = ac.nome;
      const novo = document.createElement("button"); novo.type = "button"; novo.className = "ch-ed fr-ac-novo"; novo.textContent = "novo código";
      novo.setAttribute("aria-label", "Gerar um código novo para " + ac.nome);
      novo.onclick = () => abrirFormFreelaAcesso(ac.nome);
      const enc = botaoCancelar("fracesso:" + ac.id, "Encerrar o acesso de " + ac.nome, () => encerrarFreelaAcesso(ac.id), "encerrar");
      l.append(n, novo);
      if(ac.token_em){
        /* abriram o código no celular errado (por exemplo, num teste): o código volta a valer para ela */
        const solta = botaoCancelar("frsolta:" + ac.id, "Soltar o celular de " + ac.nome, () => soltarCelularFreela(ac.id, ac.nome), "soltar celular");
        solta.classList.add("fr-ac-solta");
        l.appendChild(solta);
      }
      l.appendChild(enc);
      lista.appendChild(l);
    });
    box.appendChild(lista);
  }

  /* conferência: ver o app como cada freela vê, sem código e sem ocupar o celular dela */
  const nomesConf = [...new Set([...(FREELAS_FIXAS || []), ...FR_ACS.map(a => limpaNome(a.nome))].filter(Boolean))];
  if(nomesConf.length){
    const cf = document.createElement("div"); cf.className = "fr-ac-conf"; cf.id = "frAcConf";
    const r = document.createElement("span"); r.className = "rot"; r.textContent = "Ver o app como a freela vê (só para conferir, nada é salvo):";
    cf.appendChild(r);
    nomesConf.forEach(n => {
      const b = document.createElement("button"); b.type = "button"; b.className = "quem-chip"; b.textContent = n; b.dataset.nome = n;
      b.onclick = travar(b, () => entrarConferencia(n));
      cf.appendChild(b);
    });
    box.appendChild(cf);
  }

  const acs = document.createElement("div"); acs.className = "enc-acoes";
  const b = document.createElement("button"); b.type = "button"; b.className = "eq-abre"; b.id = "frAcAbre";
  b.textContent = FR_ACS.length ? "Liberar outra freela" : "Liberar acesso";
  b.onclick = () => abrirFormFreelaAcesso("");
  acs.appendChild(b);
  box.appendChild(acs);
  if(FR_ACS.length){
    const n = document.createElement("p"); n.className = "nota";
    n.textContent = "Cada freela tem o seu código e pode estar no app ao mesmo tempo. O código abriu no celular errado? Toque em soltar celular: o mesmo código volta a valer para ela. Perdeu a mensagem? Toque em novo código.";
    box.appendChild(n);
  }
  return box;
}

function abrirFormFreelaAcesso(nome){
  FR_AC_FORM = { nome: nome || "", op: "dias", ops: frAcOpcoes(), valor: "", entrada: "", saida: "", no_lugar_de: "", nova: false,
                 dias: [diaDoTurnoSP()] };
  EQ_CANCELA = null; montarCalendarioDias();
  const f = $("frAcForm"); if(f && f.scrollIntoView) f.scrollIntoView({ block: "start" });
}

function formFreelaAcesso(){
  const st = FR_AC_FORM;
  const f = document.createElement("div"); f.className = "eq-form"; f.id = "frAcForm";
  /* As freelas da casa vêm num seletor: o nome da liberação tem que ser igual ao do plano de produção.
     "Nova pessoa" abre o campo para digitar; ela entra na lista quando o acesso é liberado. */
  const fixas = FREELAS_FIXAS || [];
  if(fixas.length){
    const sel = document.createElement("select"); sel.id = "frAcNomeSel";
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Escolha a freela"; sel.appendChild(o0);
    fixas.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
    const on = document.createElement("option"); on.value = "__nova"; on.textContent = "Nova pessoa..."; sel.appendChild(on);
    const naLista = fixas.find(n => n.toLowerCase() === limpaNome(st.nome).toLowerCase());
    if(st.nova || (st.nome && !naLista)){ sel.value = "__nova"; st.nova = true; } else { sel.value = naLista || ""; if(naLista) st.nome = naLista; }
    sel.onchange = () => {
      st.nova = sel.value === "__nova";
      st.nome = st.nova ? "" : sel.value;
      montarCalendarioDias();
      if(st.nova){ const i = document.getElementById("frAcNome"); if(i) i.focus(); }
    };
    f.appendChild(campo("Nome da freela", sel));
    if(st.nova){
      const inp = entrada("text", st.nome, v => { st.nome = v; }, { id: "frAcNome", maxlength: "40", autocomplete: "off", placeholder: "Nome e sobrenome" });
      f.appendChild(campo("Nome da pessoa nova", inp));
    }
  } else {
    const nomes = [...new Set(FREELAS.map(x => limpaNome(x.nome)).filter(Boolean))];
    const inp = entrada("text", st.nome, v => { st.nome = v; }, { id: "frAcNome", maxlength: "40", autocomplete: "off", list: "frAcNomes" });
    const dl = document.createElement("datalist"); dl.id = "frAcNomes";
    nomes.forEach(n => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); });
    f.append(campo("Nome da freela", inp), dl);
  }

  const sel = document.createElement("select"); sel.id = "frAcAte";
  st.ops.forEach(o => { const op = document.createElement("option"); op.value = o.id; op.textContent = o.rotulo; if(o.id === st.op) op.selected = true; sel.appendChild(op); });
  sel.onchange = () => { st.op = sel.value; };
  f.appendChild(campo("Vale até", sel));

  /* A diária vai junto: com o valor preenchido, o app já registra a freela do dia
     e lança a conta a pagar, como em "Registrar freela". Só o gestor vê esta parte. */
  /* Dias de trabalho: um ou mais. A diária entra em cada dia escolhido (não no dia em que liberou). */
  if(!st.dias || !st.dias.length) st.dias = [diaDoTurnoSP()];
  const base = diaDoTurnoSP();
  const opDias = [0, 1, 2, 3].map(n => { const d = new Date(base + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); });
  const gd = document.createElement("div"); gd.className = "fr-ac-dias"; gd.id = "frAcDias";
  opDias.forEach((iso, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "quem-chip"; b.dataset.dia = iso;
    b.textContent = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : dataCurta(iso);
    b.setAttribute("aria-pressed", String(st.dias.includes(iso)));
    b.onclick = () => {
      const tem = st.dias.includes(iso);
      if(tem && st.dias.length === 1) return;          // pelo menos um dia
      st.dias = tem ? st.dias.filter(x => x !== iso) : [...st.dias, iso].sort();
      montarCalendarioDias();
    };
    gd.appendChild(b);
  });
  f.appendChild(campo("Dias de trabalho", gd));

  const jaDias = st.dias.filter(d => frDiariaDoDia(st.nome, d));
  const novosDias = st.dias.filter(d => !jaDias.includes(d));
  const tit = document.createElement("p"); tit.className = "fr-ac-sub"; tit.textContent = "Diária combinada";
  f.appendChild(tit);
  if(jaDias.length){
    const p = document.createElement("p"); p.className = "nota"; p.id = "frAcJaTem";
    p.textContent = "A diária de " + limpaNome(st.nome) + " de " + jaDias.map(dataCurta).join(", ") + (jaDias.length === 1 ? " já está registrada" : " já estão registradas") + ". Não vou lançar outra" + (jaDias.length === 1 ? "." : "s.");
    f.appendChild(p);
  }
  if(novosDias.length){
    const l1 = document.createElement("div"); l1.className = "eq-linha";
    l1.append(
      campo("Valor por dia (R$)", entrada("text", st.valor, v => { st.valor = v; }, { id: "frAcValor", inputmode: "decimal", placeholder: "ex.: 120" })),
      campo("Das", entrada("time", st.entrada, v => { st.entrada = v; }, { id: "frAcEnt" })),
      campo("Até", entrada("time", st.saida, v => { st.saida = v; }, { id: "frAcSai" }))
    );
    const lugar = document.createElement("select"); lugar.id = "frAcLugar";
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Ninguém, foi ajuda extra"; lugar.appendChild(o0);
    const pessoas = [];
    (ACORDOS || []).forEach(a => { if(!pessoas.includes(a.user_id)) pessoas.push(a.user_id); });
    pessoas.forEach(u => { const o = document.createElement("option"); o.value = u; o.textContent = eqNome(u); lugar.appendChild(o); });
    lugar.value = st.no_lugar_de || "";
    lugar.onchange = () => { st.no_lugar_de = lugar.value; };
    f.append(l1, campo("No lugar de", lugar));
    const nv = document.createElement("p"); nv.className = "nota";
    nv.textContent = "Com o valor, entra uma diária em cada dia (" + novosDias.map(dataCurta).join(", ") + ") em Quem veio e em Contas a pagar. Sem valor, libero só o acesso e a diária você registra depois.";
    f.appendChild(nv);
  }

  const nota = document.createElement("p"); nota.className = "nota";
  nota.textContent = "O app gera um código de 6 números para ela entrar pelo botão Freela. Ela vê o que você mandou para ela no plano, registra quanto fez, fecha o turno e anota o que saiu depois: nada de valores, dias ou histórico.";
  f.appendChild(nota);

  const err = document.createElement("div"); err.id = "frAcErr"; f.appendChild(err);
  const acs = document.createElement("div"); acs.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = "frAcSalvar"; ok.textContent = "Liberar acesso";
  ok.onclick = travar(ok, liberarFreelaAcesso);
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Cancelar";
  cx.onclick = () => { FR_AC_FORM = null; montarCalendarioDias(); };
  acs.append(ok, cx); f.appendChild(acs);
  return f;
}

/* a diária desta pessoa no dia do turno, se já foi lançada */
function frDiariaDoDia(nome, diaPedido){
  const n = (nome || "").trim().toLowerCase();
  if(!n) return null;
  const dia = diaPedido || diaDoTurnoSP();
  return FREELAS.find(f => f.data === dia && (f.nome || "").trim().toLowerCase() === n) || null;
}

async function liberarFreelaAcesso(){
  const st = FR_AC_FORM;
  const nome = (st.nome || "").trim().replace(/\s+/g, " ");
  if(!nome){ aviso("frAcErr", "Escreva o nome da freela.", "err"); return; }
  const dias = (st.dias && st.dias.length ? st.dias : [diaDoTurnoSP()]).slice().sort();
  const novosDias = dias.filter(d => !frDiariaDoDia(nome, d));
  const temValor = novosDias.length > 0 && String(st.valor || "").trim() !== "";
  const valor = temValor ? numBR(st.valor) : null;
  if(temValor && (valor == null || !(valor > 0) || valor > 2000)){ aviso("frAcErr", "Confira o valor combinado.", "err"); return; }
  if(temValor && (!!st.entrada !== !!st.saida)){ aviso("frAcErr", "Preencha o horário de começo e de fim, ou deixe os dois em branco.", "err"); return; }
  const op = st.ops.find(o => o.id === st.op) || st.ops[0];
  const ate = op.id === "dias" ? frAcAteDosDias({ ...st, dias }) : op.ate;
  const { data, error } = await sb.rpc("jb_freela_liberar", { p_nome: nome, p_ate: ate });
  if(error || !data || !data.codigo){ aviso("frAcErr", "Não consegui liberar agora. Confira a internet e tente de novo.", "err"); return; }
  if(st.nova) await guardarFreelaFixa(nome).catch(() => null);
  let ok = 0, falhou = 0;
  if(temValor){
    for(const d of novosDias){
      const r = await criarFreela({ nome, data: d, entrada: st.entrada || "", saida: st.saida || "", valor,
                                    no_lugar_de: st.no_lugar_de || null, obs: "Liberada com código no app.", acesso_id: data.id });
      if(r) ok++; else falhou++;
    }
  }
  FR_AC_FORM = null;
  FR_AC_MSG = frAcMensagem(nome, ate, data.codigo);
  const jaTinha = dias.length - novosDias.length;
  FR_AC_REG = (ok ? (ok === 1 ? "Diária de R$ " + moeda(valor) + " registrada" : ok + " diárias de R$ " + moeda(valor) + " registradas")
                    + " (" + novosDias.slice(0, ok).map(dataCurta).join(", ") + ") e lançada" + (ok === 1 ? "" : "s") + " em Contas a pagar." : "")
            + (falhou ? " Não consegui registrar " + falhou + (falhou === 1 ? " diária" : " diárias") + ": use Registrar freela." : "")
            + (jaTinha ? " " + (jaTinha === 1 ? "Um dia já estava registrado" : jaTinha + " dias já estavam registrados") + ", não lancei de novo." : "")
            + (!temValor && novosDias.length ? " Diária não registrada: quando souber o valor, use Registrar freela." : "");
  FR_AC_REG = FR_AC_REG.trim();
  await recarregarEquipe();
}

async function soltarCelularFreela(id, nome){
  const { error } = await sb.rpc("jb_freela_soltar_celular", { p_id: id });
  EQ_CANCELA = null;
  if(error){ toast("Não consegui agora. Tente de novo.", "err"); return; }
  toast("Pronto: o código de " + nome + " volta a valer. Ela entra pelo celular dela com o mesmo código.");
  await recarregarEquipe();
}

async function encerrarFreelaAcesso(id){
  const { error } = id ? await sb.rpc("jb_freela_encerrar_um", { p_id: id }) : await sb.rpc("jb_freela_encerrar");
  EQ_CANCELA = null;
  if(error){ toast("Não consegui encerrar agora. Tente de novo.", "err"); return; }
  toast("Acesso de freela encerrado.");
  await recarregarEquipe();
}

/* ============================================================
   FREELAS
   ============================================================ */
async function criarFreela(fr){
  const quem = fr.no_lugar_de ? " no lugar de " + eqNome(fr.no_lugar_de) : "";
  const descricao = ("Freela " + fr.nome + ", " + diaCurto(fr.data) + quem).slice(0, 140);
  const { data: c, error: ec } = await sb.from("jb_conta").insert({
    tipo: "equipe", descricao, competencia: primeiroDia(fr.data), vencimento: fr.data, valor: fr.valor,
    obs: (fr.entrada && fr.saida ? "Das " + fr.entrada + " às " + fr.saida + ". " : "") + "Lançada em Quem veio no ateliê.", arquivada: false,
    criado_por: EU.user_id
  }).select("id").single();
  if(ec || !c) return false;
  const { error } = await sb.from("jb_freela").insert({
    nome: fr.nome, data: fr.data, entrada: fr.entrada || null, saida: fr.saida || null, valor: fr.valor,
    no_lugar_de: fr.no_lugar_de || null, falta_id: fr.falta_id || null, conta_id: c.id, obs: fr.obs || null, cancelada: false, criado_por: EU.user_id,
    ...(fr.acesso_id ? { acesso_id: fr.acesso_id } : {})
  });
  if(error){
    await sb.from("jb_conta").update({ arquivada: true }).eq("id", c.id);
    return false;
  }
  return true;
}

function blocoFreelas(){
  const bloco = document.createElement("div");
  bloco.className = "pessoa eq-freelas"; bloco.id = "eqFreelas";
  const h = document.createElement("h3"); h.textContent = "Freelas";
  bloco.appendChild(h);
  const tot = FREELAS.reduce((s, f) => s + Number(f.valor || 0), 0);
  const sub = document.createElement("div"); sub.className = "sub";
  const aPagarTot = FREELAS.filter(f => { const c = FREELA_CONTAS[f.conta_id]; return !(c && c.pago_em); }).reduce((t, f) => t + Number(f.valor || 0), 0);
  sub.textContent = FREELAS.length
    ? (FREELAS.length === 1 ? "1 diária de freela" : FREELAS.length + " diárias de freela") + " no mês, R$ " + moeda(tot)
      + (aPagarTot > 0 ? " · a pagar R$ " + moeda(aPagarTot) : " · tudo pago")
    : "Nenhuma freela no mês.";
  bloco.appendChild(sub);

  /* um quadro por pessoa, igual ao da Yasmin e da Eliana: dias que veio, pagos e a pagar */
  freelaPessoas().forEach(fp => bloco.appendChild(blocoFreelaPessoa(fp)));

  if(EQ_FORM && EQ_FORM.tipo === "freela"){
    bloco.appendChild(formFreela());
  } else {
    const acs = document.createElement("div"); acs.className = "enc-acoes";
    const b = document.createElement("button"); b.type = "button"; b.className = "eq-abre"; b.id = "eqFreelaAbre";
    b.textContent = "Registrar freela";
    b.onclick = () => { EQ_FORM = { tipo: "freela", data: hojeSP(), entrada: "", saida: "", nome: "", valor: "", no_lugar_de: "", obs: "" }; EQ_CANCELA = null; montarCalendarioDias(); };
    acs.appendChild(b);
    if(FREELAS.some(f => { const c = FREELA_CONTAS[f.conta_id]; return !(c && c.pago_em); })){
      const p = document.createElement("button"); p.type = "button"; p.className = "sec"; p.textContent = "Pagar em Contas a pagar";
      p.onclick = () => { CONTA_PAINEL = null; CONTA_NOVA = false; abrirContas(); };
      acs.appendChild(p);
    }
    bloco.appendChild(acs);
  }
  bloco.appendChild(blocoFreelaAcesso());
  return bloco;
}

/* as freelas do mês, uma por pessoa (Bela e Bella juntas), mais as da lista da casa sem dia no mês */
function freelaPessoas(){
  const porChave = {};
  FREELAS.forEach(f => {
    const k = confChave(f.nome); if(!k) return;
    const p = porChave[k] || (porChave[k] = { chave: k, nome: f.nome, dias: [] });
    p.dias.push(f);
    if((FREELAS_FIXAS || []).includes(f.nome)) p.nome = f.nome;
  });
  (FREELAS_FIXAS || []).forEach(n => { const k = confChave(n); if(k && !porChave[k]) porChave[k] = { chave: k, nome: n, dias: [] }; });
  return Object.values(porChave).sort((a, b) => b.dias.length - a.dias.length || a.nome.localeCompare(b.nome, "pt-BR"));
}
const FR_PAG_ABERTO = {};

function blocoFreelaPessoa(fp){
  const w = document.createElement("div"); w.className = "fr-pessoa"; w.dataset.pessoa = fp.chave;
  const h = document.createElement("h4"); h.textContent = fp.nome; w.appendChild(h);
  const pago = f => { const c = f.conta_id ? FREELA_CONTAS[f.conta_id] : null; return !!(c && c.pago_em); };
  const dias = fp.dias.slice().sort((a, b) => a.data < b.data ? -1 : 1);
  const abertos = dias.filter(f => !pago(f));
  const tot = dias.reduce((t, f) => t + Number(f.valor || 0), 0), aPagar = abertos.reduce((t, f) => t + Number(f.valor || 0), 0);
  const sub = document.createElement("div"); sub.className = "sub";
  if(!dias.length) sub.textContent = "Nenhum dia neste mês.";
  else {
    const b = document.createElement("b"); b.textContent = dias.length + (dias.length === 1 ? " dia" : " dias");
    sub.append(b, document.createTextNode(" no mês · R$ " + moeda(tot)));
    sub.appendChild(document.createElement("br"));
    const ap = document.createElement("span"); ap.className = "a-pagar";
    ap.textContent = abertos.length ? "A pagar agora: R$ " + moeda(aPagar) + " (" + listaDiasTx(abertos.map(f => f.data)) + ")" : "Tudo pago.";
    sub.appendChild(ap);
  }
  w.appendChild(sub);
  if(!dias.length){
    const r = document.createElement("button"); r.type = "button"; r.className = "fr-reg";
    r.textContent = "Registrar um dia de " + fp.nome.split(" ")[0];
    r.onclick = () => abrirFreelaNoDia(fp, hojeSP());
    w.appendChild(r);
    return w;
  }

  /* calendário do mês: toque num dia vazio registra a diária desse dia */
  const ini = DIAS_MES, fim = ultimoDia(DIAS_MES), hoje = hojeSP();
  const cal = document.createElement("div"); cal.className = "cal fr-cal";
  ["D","S","T","Q","Q","S","S"].forEach(d => { const c = document.createElement("div"); c.className = "dow"; c.textContent = d; cal.appendChild(c); });
  for(let i = 0; i < diaDaSemana(ini); i++){ const v = document.createElement("div"); v.className = "vazio"; cal.appendChild(v); }
  for(let d = 1; d <= Number(fim.slice(8)); d++){
    const iso = ini.slice(0, 8) + String(d).padStart(2, "0");
    const doDia = dias.filter(f => f.data === iso);
    const b = document.createElement("button"); b.type = "button"; b.textContent = String(d);
    let cls = doDia.length ? "veio" : "";
    if(doDia.length && doDia.every(pago)) cls += " pago";
    if(doDia.some(f => f.no_lugar_de)) cls += " cobre";
    if(iso > hoje) cls += " futuro";
    b.className = cls.trim();
    b.setAttribute("aria-label", DOW[diaDaSemana(iso)] + " " + diaCurto(iso) + ", "
      + (doDia.length ? "veio" + (doDia.some(f => f.no_lugar_de) ? ", no lugar de " + eqNome(doDia.find(f => f.no_lugar_de).no_lugar_de) : "")
                        + (doDia.every(pago) ? ", pago" : ", a pagar") : "não veio"));
    b.onclick = () => {
      if(doDia.length){
        const ln = w.querySelector("[data-freela='" + doDia[0].id + "']");
        if(ln){ ln.classList.add("fr-destaque"); if(ln.scrollIntoView) ln.scrollIntoView({ block: "center" }); setTimeout(() => ln.classList.remove("fr-destaque"), 1600); }
      } else abrirFreelaNoDia(fp, iso);
    };
    cal.appendChild(b);
  }
  w.appendChild(cal);

  /* os dias, um por linha: horário, valor, quem cobriu e de onde sai o dinheiro */
  dias.forEach(f => {
    const ln = document.createElement("div"); ln.className = "eq-ln"; ln.dataset.freela = f.id;
    const dia = document.createElement("span"); dia.className = "dia"; dia.textContent = dataCurta(f.data);
    const c = f.conta_id ? FREELA_CONTAS[f.conta_id] : null;
    const info = document.createElement("span"); info.className = "info";
    const cab = [f.nome !== fp.nome ? f.nome : "", f.entrada && f.saida ? eqHHMM(f.entrada) + " às " + eqHHMM(f.saida) : ""].filter(Boolean).join(", ");
    info.textContent = (cab ? cab + " · " : "") + "R$ " + moeda(Number(f.valor))
      + (f.no_lugar_de ? " · no lugar de " + eqNome(f.no_lugar_de) : "")
      + (c && c.pago_em ? " · paga em " + diaCurto(String(c.pago_em).slice(0, 10)) : " · a pagar");
    ln.append(dia, info);
    const de = origemDoDinheiro(f);
    if(de){ const o = document.createElement("span"); o.className = "fr-origem"; o.textContent = de; ln.appendChild(o); }
    if(!(c && c.pago_em)) ln.appendChild(botaoCancelar("freela:" + f.id, "Cancelar a freela de " + dataCurta(f.data), () => cancelarFreela(f)));
    w.appendChild(ln);
  });

  /* marcar como pago aqui mesmo, como na Eliana */
  if(abertos.length){
    const det = document.createElement("details"); det.className = "fr-pagar";
    det.open = !!FR_PAG_ABERTO[fp.chave];
    det.ontoggle = () => { FR_PAG_ABERTO[fp.chave] = det.open; };
    const sm = document.createElement("summary"); sm.textContent = "Marcar dias como pagos"; det.appendChild(sm);
    const esc = new Set(abertos.map(f => f.id));
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "pg-ok";
    const rot = () => {
      const v = abertos.filter(f => esc.has(f.id)).reduce((t, f) => t + Number(f.valor || 0), 0);
      btn.disabled = !esc.size;
      btn.textContent = esc.size ? "Marcar " + esc.size + (esc.size === 1 ? " dia como pago" : " dias como pagos") + " (R$ " + moeda(v) + ")" : "Escolha os dias pagos";
    };
    abertos.forEach(f => {
      const l = document.createElement("label"); l.className = "pg-ln";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      cb.onchange = () => { if(cb.checked) esc.add(f.id); else esc.delete(f.id); rot(); };
      const d = document.createElement("span"); d.className = "dia"; d.textContent = dataCurta(f.data);
      const i = document.createElement("span"); i.className = "info"; i.textContent = "R$ " + moeda(Number(f.valor));
      l.append(cb, d, i); det.appendChild(l);
    });
    const q = document.createElement("label"); q.className = "pg-quando";
    const qs = document.createElement("span"); qs.textContent = "Pago em";
    const qi = document.createElement("input"); qi.type = "date"; qi.value = hoje; qi.max = hoje;
    qi.className = "fr-pago-em";
    q.append(qs, qi); det.appendChild(q);
    rot();
    btn.onclick = travar(btn, () => pagarFreelas(abertos.filter(f => esc.has(f.id)), qi.value));
    det.appendChild(btn);
    w.appendChild(det);
  }
  return w;
}

/* freela que cobriu falta: o desconto de quem faltou volta para a bolsa e paga quem cobriu */
function origemDoDinheiro(f){
  if(!f.no_lugar_de) return "";
  const fa = f.falta_id ? FALTAS.find(x => x.id === f.falta_id) : null;
  const quem = eqNome(f.no_lugar_de);
  if(!fa) return "Cobriu " + quem + " (sem falta registrada): sai da bolsa de ajuda extra.";
  if(!fa.desconta) return "Cobriu a falta de " + quem + ", que não foi descontada: sai da bolsa de ajuda extra.";
  const desc = Number(fa.valor_desconto || 0), dif = Math.round((Number(f.valor) - desc) * 100) / 100;
  return "Cobriu a falta de " + quem + ": R$ " + moeda(desc) + " descontados da quinzena dela pagam esta diária"
    + (dif > 0 ? "; os R$ " + moeda(dif) + " que faltam saem da bolsa." : dif < 0 ? "; sobram R$ " + moeda(-dif) + " na bolsa." : ".");
}

function abrirFreelaNoDia(fp, iso){
  const ult = fp.dias.slice().sort((a, b) => a.data < b.data ? 1 : -1)[0];
  EQ_FORM = { tipo: "freela", data: iso, entrada: ult && ult.entrada ? eqHHMM(ult.entrada) : "", saida: ult && ult.saida ? eqHHMM(ult.saida) : "",
              nome: fp.nome, valor: ult ? moeda(Number(ult.valor)) : "", no_lugar_de: "", obs: "" };
  EQ_CANCELA = null; montarCalendarioDias();
  const f = $("eqFormFreela"); if(f && f.scrollIntoView) f.scrollIntoView({ block: "start" });
}

async function pagarFreelas(lista, quando){
  if(!lista.length) return;
  if(!quando || quando > hojeSP()){ aviso("diasMsg", "Escolha o dia em que pagou (não pode ser no futuro).", "warn"); return; }
  let ok = 0;
  for(const f of lista){
    if(!f.conta_id) continue;
    const { error } = await sb.from("jb_conta").update({ pago_em: quando, valor_pago: Number(f.valor), pago_por: "manual" }).eq("id", f.conta_id);
    if(!error) ok++;
  }
  if(ok < lista.length) aviso("diasMsg", "Não consegui marcar " + (lista.length - ok) + " dia(s). Tente de novo.", "err");
  else toast(ok === 1 ? "Dia marcado como pago." : ok + " dias marcados como pagos.");
  await recarregarEquipe();
}

/* nome da freela nos formulários: as da casa num seletor (o nome sai sempre igual), "Nova pessoa..." abre o campo.
   Sem lista da casa, fica o campo de texto. idInp é o id do campo de texto (o seletor ganha idInp + "Sel"). */
function campoNomeFreela(st, idInp, rotulo){
  const fixas = FREELAS_FIXAS || [];
  if(!fixas.length){
    const inp = entrada("text", st.nome, v => { st.nome = v; }, { id: idInp, maxlength: "60", autocomplete: "off" });
    return [campo(rotulo, inp)];
  }
  /* nome que veio de fora (o Pix diz "Markus"): se só uma da casa tem o mesmo primeiro nome, é ela */
  if(st.nome && !st.nova && !fixas.some(n => n.toLowerCase() === limpaNome(st.nome).toLowerCase())){
    const k = confChave(st.nome), mesmas = fixas.filter(n => confChave(n) === k);
    if(k && mesmas.length === 1) st.nome = mesmas[0];
  }
  const naLista = fixas.find(n => n.toLowerCase() === limpaNome(st.nome).toLowerCase());
  if(st.nome && !naLista) st.nova = true;
  const sel = document.createElement("select"); sel.id = idInp + "Sel";
  const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Escolha a freela"; sel.appendChild(o0);
  fixas.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
  const on = document.createElement("option"); on.value = "__nova"; on.textContent = "Nova pessoa..."; sel.appendChild(on);
  sel.value = st.nova ? "__nova" : (naLista || "");
  if(naLista) st.nome = naLista;
  sel.onchange = () => {
    st.nova = sel.value === "__nova";
    st.nome = st.nova ? "" : sel.value;
    montarCalendarioDias();
    if(st.nova){ const i = document.getElementById(idInp); if(i) i.focus(); }
  };
  const out = [campo(rotulo, sel)];
  if(st.nova) out.push(campo("Nome da pessoa nova", entrada("text", st.nome, v => { st.nome = v; }, { id: idInp, maxlength: "60", autocomplete: "off", placeholder: "Nome e sobrenome" })));
  return out;
}

/* diária da mesma pessoa no mesmo dia (mesmo primeiro nome: Bela e Bella são a mesma) */
function diariaRepetida(nome, data){
  const k = confChave(nome);
  return k ? FREELAS.find(f => f.data === data && confChave(f.nome) === k) || null : null;
}

function formFreela(){
  const st = EQ_FORM;
  const f = document.createElement("div"); f.className = "eq-form"; f.id = "eqFormFreela";
  const l1 = document.createElement("div"); l1.className = "eq-linha";
  l1.append(...campoNomeFreela(st, "eqFrNome", "Nome"),
    campo("Valor combinado (R$)", entrada("text", st.valor, v => { st.valor = v; }, { id: "eqFrValor", inputmode: "decimal" }))
  );
  const l2 = document.createElement("div"); l2.className = "eq-linha";
  l2.append(
    campo("Dia", entrada("date", st.data, v => { st.data = v; }, { id: "eqFrDia" })),
    campo("Das", entrada("time", st.entrada, v => { st.entrada = v; }, { id: "eqFrEnt" })),
    campo("Até", entrada("time", st.saida, v => { st.saida = v; }, { id: "eqFrSai" }))
  );
  const sel = document.createElement("select"); sel.id = "eqFrLugar";
  const op0 = document.createElement("option"); op0.value = ""; op0.textContent = "Ninguém, foi ajuda extra"; sel.appendChild(op0);
  const pessoas = [];
  ACORDOS.forEach(a => { if(!pessoas.includes(a.user_id)) pessoas.push(a.user_id); });
  pessoas.forEach(u => { const o = document.createElement("option"); o.value = u; o.textContent = eqNome(u); sel.appendChild(o); });
  sel.value = st.no_lugar_de || "";
  sel.onchange = () => { st.no_lugar_de = sel.value; };
  const B = bolsaCalcular(BOLSA_BASE, bolsaItens(ACORDOS, DIAS, FREELAS, FALTAS, bolsaNome));
  const nb = document.createElement("p"); nb.className = "eq-bolsa" + (B.disponivel < B.freela ? " alerta" : ""); nb.id = "eqFrBolsa";
  nb.textContent = "Na bolsa do mês: " + reais(B.disponivel) + (B.disponivel < B.freela ? ". Uma freela agora sai do lucro." : ", dá para " + B.noites + (B.noites === 1 ? " noite" : " noites") + " de R$ " + moeda(B.freela) + ".");
  f.appendChild(nb);
  f.append(l1, l2, campo("No lugar de", sel),
           campo("Observação (opcional)", entrada("text", st.obs, v => { st.obs = v; }, { id: "eqFrObs", maxlength: "200" })));

  const acs = document.createElement("div"); acs.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = "eqFrSalvar"; ok.textContent = "Salvar freela";
  ok.onclick = travar(ok, salvarFreela);
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Fechar";
  cx.onclick = () => { EQ_FORM = null; montarCalendarioDias(); };
  acs.append(ok, cx);
  f.appendChild(acs);
  return f;
}

async function salvarFreela(){
  const st = EQ_FORM;
  const valor = numBR(st.valor);
  if(!st.nome.trim()){ aviso("diasMsg", "Diga o nome da freela.", "warn"); return; }
  if(!st.data){ aviso("diasMsg", "Diga o dia.", "warn"); return; }
  if(valor == null || !(valor >= 0)){ aviso("diasMsg", "Diga o valor combinado.", "warn"); return; }
  const rep = diariaRepetida(st.nome, st.data);
  if(rep && st.confirmaDup !== st.nome + st.data){
    st.confirmaDup = st.nome + st.data;
    aviso("diasMsg", rep.nome + " já tem diária em " + diaCurto(st.data) + " (" + reais(rep.valor) + (rep.falta_id ? ", lançada pela falta" : "") + "). Se é um segundo turno no mesmo dia, toque em Salvar freela de novo.", "warn");
    return;
  }
  aviso("diasMsg", "", "");
  if(st.nova) await guardarFreelaFixa(st.nome).catch(() => null);
  const ok = await criarFreela({ nome: st.nome.trim(), data: st.data, entrada: st.entrada, saida: st.saida, valor,
                                 no_lugar_de: st.no_lugar_de || null, obs: st.obs.trim() || null });
  if(!ok){ aviso("diasMsg", "Não consegui salvar a freela agora.", "err"); return; }
  EQ_FORM = null;
  toast("Freela salva: R$ " + moeda(valor) + " em Contas a pagar.");
  await recarregarEquipe();
}

async function cancelarFreela(f){
  const c = f.conta_id ? FREELA_CONTAS[f.conta_id] : null;
  if(c && c.pago_em){ aviso("diasMsg", "Essa freela já foi paga. Desfaça o pagamento em Contas a pagar primeiro.", "warn"); return; }
  const { error } = await sb.from("jb_freela").update({ cancelada: true, cancelada_em: new Date().toISOString() }).eq("id", f.id);
  if(error){ aviso("diasMsg", "Não consegui cancelar a freela agora.", "err"); return; }
  if(f.conta_id) await sb.from("jb_conta").update({ arquivada: true }).eq("id", f.conta_id);
  EQ_CANCELA = null;
  toast("Freela de " + dataCurta(f.data) + " cancelada.");
  await recarregarEquipe();
}

/* ============================================================
   BANCO DE HORAS (quem ganha por semana)
   Entra: chegou antes, ficou depois. Sai: compensando uma falta.
   ============================================================ */
function blocoBanco(uid){
  const wrap = document.createElement("div");
  wrap.className = "eq-banco"; wrap.id = "eqBanco-" + uid;
  const meus = BANCO.filter(b => b.user_id === uid).sort((a, b) => a.data < b.data ? 1 : -1);
  const saldo = eqSaldo(BANCO, uid);

  const det = document.createElement("details");
  det.open = !!(BANCO_ABERTO[uid] || (EQ_FORM && EQ_FORM.tipo === "banco" && EQ_FORM.uid === uid));
  det.ontoggle = () => { BANCO_ABERTO[uid] = det.open; };
  const sm = document.createElement("summary");
  sm.textContent = "Banco de horas: " + (saldo > 0 ? "saldo de " + eqMinTx(saldo) : saldo < 0 ? "devendo " + eqMinTx(saldo) : "sem saldo");
  sm.className = saldo < 0 ? "neg" : saldo > 0 ? "pos" : "";
  if(saldo < 0){
    const n = document.createElement("small");
    n.textContent = " · ainda sem decisão: abone o atraso aqui ou compense com horas a mais";
    sm.appendChild(n);
  }
  det.appendChild(sm);

  meus.forEach(b => {
    const ln = document.createElement("div"); ln.className = "eq-ln"; ln.dataset.banco = b.id;
    const dia = document.createElement("span"); dia.className = "dia"; dia.textContent = dataCurta(b.data);
    const info = document.createElement("span"); info.className = "info";
    info.textContent = (b.minutos > 0 ? "+" : "−") + eqMinTx(b.minutos) + (b.motivo ? " · " + b.motivo : "");
    info.classList.add(b.minutos < 0 ? "neg" : "pos");
    ln.append(dia, info);
    if(b.origem !== "falta") ln.appendChild(botaoCancelar("banco:" + b.id, (b.minutos < 0 ? "Abonar o atraso de " : "Cancelar o lançamento de ") + dataCurta(b.data), () => cancelarBanco(b), b.minutos < 0 ? "abonar" : "cancelar"));
    det.appendChild(ln);
  });

  if(EQ_FORM && EQ_FORM.tipo === "banco" && EQ_FORM.uid === uid){
    det.appendChild(formBanco(uid));
  } else {
    const b = document.createElement("button"); b.type = "button"; b.className = "eq-abre"; b.textContent = "Lançar no banco";
    b.onclick = () => { EQ_FORM = { tipo: "banco", uid, data: hojeSP(), minutos: "", sinal: 1, motivo: "" }; EQ_CANCELA = null; montarCalendarioDias(); };
    det.appendChild(b);
  }
  wrap.appendChild(det);
  return wrap;
}

function formBanco(uid){
  const st = EQ_FORM;
  const f = document.createElement("div"); f.className = "eq-form"; f.id = "eqFormBanco";
  const l = document.createElement("div"); l.className = "eq-linha";
  l.append(campo("Dia", entrada("date", st.data, v => { st.data = v; }, { id: "eqBancoDia" })),
           campo("Minutos", entrada("text", st.minutos, v => { st.minutos = v; }, { id: "eqBancoMin", inputmode: "numeric" })));
  f.appendChild(l);
  const perg = document.createElement("div"); perg.className = "eq-opcoes";
  [[1, "A mais (chegou antes, ficou depois)", "eqBancoMais"], [-1, "A menos (saiu antes, folga combinada)", "eqBancoMenos"]].forEach(([v, t, id]) => {
    const lb = document.createElement("label");
    const r = document.createElement("input"); r.type = "radio"; r.name = "eqBancoSinal"; r.id = id; r.checked = st.sinal === v;
    r.onchange = () => { st.sinal = v; };
    lb.append(r, document.createTextNode(t));
    perg.appendChild(lb);
  });
  f.appendChild(perg);
  f.appendChild(campo("Motivo (opcional)", entrada("text", st.motivo, v => { st.motivo = v; }, { id: "eqBancoMotivo", maxlength: "200" })));
  const acs = document.createElement("div"); acs.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = "eqBancoSalvar"; ok.textContent = "Salvar no banco";
  ok.onclick = travar(ok, () => salvarBanco(uid, st.data, st.sinal * Math.round(Number(String(st.minutos).replace(",", "."))), st.motivo.trim() || null, "manual"));
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Fechar";
  cx.onclick = () => { EQ_FORM = null; montarCalendarioDias(); };
  acs.append(ok, cx);
  f.appendChild(acs);
  return f;
}

async function salvarBanco(uid, data, minutos, motivo, origem){
  if(!data){ aviso("diasMsg", "Diga o dia.", "warn"); return; }
  if(!minutos || isNaN(minutos) || Math.abs(minutos) > 1440){ aviso("diasMsg", "Diga quantos minutos (até 1440).", "warn"); return; }
  aviso("diasMsg", "", "");
  const { error } = await sb.from("jb_banco_horas").insert({ user_id: uid, data, minutos, motivo, origem, cancelado: false, criado_por: EU.user_id });
  if(error){ aviso("diasMsg", "Não consegui salvar no banco de horas agora.", "err"); return; }
  if(EQ_FORM && EQ_FORM.tipo === "banco") EQ_FORM = null;
  toast((minutos > 0 ? "+" : "−") + eqMinTx(minutos) + " no banco de horas.");
  await recarregarEquipe();
}

async function cancelarBanco(b){
  const { error } = await sb.from("jb_banco_horas").update({ cancelado: true, cancelado_em: new Date().toISOString() }).eq("id", b.id);
  if(error){ aviso("diasMsg", "Não consegui cancelar agora.", "err"); return; }
  EQ_CANCELA = null;
  toast("Lançamento cancelado.");
  await recarregarEquipe();
}

/* em Ver chegadas: o atraso que já virou minutos negativos no banco */
function etiquetaAtrasoNoBanco(d){
  const b = BANCO.find(x => x.dia_id === d.id && x.origem === "atraso");
  if(!b) return null;
  const el = document.createElement("span"); el.className = "ch-banco neg";
  el.textContent = "−" + eqMinTx(b.minutos) + " no banco";
  return el;
}

/* em Ver chegadas: quem chegou antes da escala pode levar os minutos para o banco */
function botaoChegouAntes(uid, d, antes){
  const ja = BANCO.some(b => b.user_id === uid && b.data === d.data && b.origem === "chegada");
  const el = document.createElement(ja ? "span" : "button");
  if(ja){ el.className = "ch-banco"; el.textContent = "no banco"; return el; }
  el.type = "button"; el.className = "ch-ed"; el.textContent = "pôr no banco";
  el.setAttribute("aria-label", "Pôr " + antes + " minutos de " + dataCurta(d.data) + " no banco de horas");
  el.onclick = travar(el, () => salvarBanco(uid, d.data, antes, "Chegou " + antes + " min antes da entrada", "chegada"));
  return el;
}

/* ============================================================
   RESUMO DO PAGAMENTO PARA ENVIAR (só gestor)
   Monta uma mensagem com o valor do período, as faltas descontadas (dia, horário,
   horas e valor) e, se quiser, o banco de horas. Nada é gravado: a mensagem nasce
   na tela de quem paga, a partir de tabelas que só o gestor lê (jb_conta, jb_falta,
   jb_banco_horas), e vai para a área de transferência para colar no WhatsApp.
   ============================================================ */
const REL_ABERTO = {};   // por pessoa: o resumo fica aberto entre uma ação e outra
const REL_ESTADO = {};   // por pessoa: período escolhido e opções

const DOW_LONGO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const relDia = iso => diaCurto(iso) + " (" + DOW_LONGO[diaDaSemana(iso)] + ")";
const relReais = v => "R$ " + moeda(v);

/* quinzena que contém o dia: 1 a 15 ou 16 ao fim do mês */
function relQuinzena(iso){
  const [a, m, d] = iso.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  return d <= 15 ? { ini: a + "-" + mm + "-01", fim: a + "-" + mm + "-15" }
                 : { ini: a + "-" + mm + "-16", fim: ultimoDia(a + "-" + mm + "-01") };
}

/* texto da mensagem, a partir dos dados já carregados (função pura, testável) */
function relMensagem(p){
  const linhas = [];
  linhas.push("Oi, " + p.nome + "! Segue o resumo do seu pagamento de " + diaCurto(p.ini) + " a " + diaCurto(p.fim) + ".");
  linhas.push("");
  if(p.dias) linhas.push("Dias trabalhados no período: " + p.dias + ".");
  if(p.valor != null) linhas.push("Valor do período: " + relReais(p.valor) + (p.semanas ? " (" + p.semanas + (p.semanas === 1 ? " semana" : " semanas") + ")" : "") + ".");
  const desc = p.faltas.filter(f => f.desconta && Number(f.valor_desconto) > 0);
  const total = Math.round(desc.reduce((s, f) => s + Number(f.valor_desconto), 0) * 100) / 100;
  linhas.push("");
  if(desc.length){
    linhas.push(desc.length === 1 ? "Desconto:" : "Descontos:");
    desc.forEach(f => {
      linhas.push("• Falta em " + relDia(f.data)
        + (f.entrada && f.saida ? ", " + eqHHMM(f.entrada) + " às " + eqHHMM(f.saida) : "")
        + ", " + eqHorasTx(Number(f.horas))
        + (Number(f.banco_min) ? " (" + eqMinTx(Number(f.banco_min)) + " compensadas com o banco de horas)" : "")
        + ": " + relReais(Number(f.valor_desconto)));
    });
    if(desc.length > 1) linhas.push("Total de descontos: " + relReais(total) + ".");
  } else {
    linhas.push("Sem descontos neste período.");
  }
  const compensadas = p.faltas.filter(f => !(f.desconta && Number(f.valor_desconto) > 0) && Number(f.banco_min) > 0);
  compensadas.forEach(f => linhas.push("• Falta em " + relDia(f.data) + " compensada com " + eqMinTx(Number(f.banco_min)) + " do banco de horas, sem desconto."));
  if(p.valor != null){
    linhas.push("");
    linhas.push("Valor a receber: " + relReais(Math.max(0, Math.round((p.valor - total) * 100) / 100)) + ".");
  }
  if(p.banco){
    linhas.push("");
    const s = p.banco.saldo;
    linhas.push("Banco de horas: " + (s > 0 ? "você tem " + eqMinTx(s) + " a seu favor." : s < 0 ? "faltam " + eqMinTx(s) + " para compensar (ainda não descontado)." : "zerado."));
    p.banco.itens.forEach(b => linhas.push("• " + relDia(b.data) + ": " + (b.minutos > 0 ? "+" : "−") + eqMinTx(Number(b.minutos)) + (b.motivo ? ", " + b.motivo : "")));
  }
  linhas.push("");
  linhas.push("Qualquer dúvida, é só falar com a gente.");
  return linhas.join("\n");
}

/* o período de pagamento que contém o dia: segue a cadência da última conta da equipe
   (ex.: de 14 em 14 dias a partir de 01/10); sem conta lançada, a quinzena do mês */
function relPeriodoDe(iso, contas){
  const base = (contas || []).filter(c => c.periodo_ini && c.periodo_fim).sort((a, b) => a.periodo_ini < b.periodo_ini ? 1 : -1)[0];
  if(!base) return relQuinzena(iso);
  const dia = 864e5, t0 = Date.parse(base.periodo_ini), L = Math.round((Date.parse(base.periodo_fim) - t0) / dia) + 1;
  const k = Math.floor((Date.parse(iso) - t0) / dia / L);
  const ini = new Date(t0 + k * L * dia).toISOString().slice(0, 10);
  const fim = new Date(t0 + ((k + 1) * L - 1) * dia).toISOString().slice(0, 10);
  return { ini, fim };
}

async function relCarregar(uid, ac){
  const st = REL_ESTADO[uid];
  const [ct, fa, dt] = await Promise.all([
    sb.from("jb_conta").select("id,descricao,valor,periodo_ini,periodo_fim,pago_em,arquivada").eq("equipe_user_id", uid)
      .order("periodo_ini", { ascending: false }).limit(12),
    sb.from("jb_falta").select("data,entrada,saida,horas,desconta,valor_desconto,banco_min").eq("user_id", uid).eq("cancelada", false)
      .gte("data", st.ini).lte("data", st.fim).order("data"),
    sb.from("jb_dia_trabalhado").select("data,status").eq("user_id", uid).eq("status", "confirmado").gte("data", st.ini).lte("data", st.fim)
  ]);
  st.contas = ((ct && !ct.error && ct.data) || []).filter(c => c.periodo_ini && c.periodo_fim && !c.arquivada);
  st.faltas = (fa && !fa.error && fa.data) || [];
  st.dias = (dt && !dt.error && dt.data) ? dt.data.length : null;
  st.erro = !!((ct && ct.error) || (fa && fa.error));
  // valor: a conta da equipe daquele período; sem conta, o combinado da semana vezes as semanas
  const conta = st.contas.find(c => c.periodo_ini === st.ini && c.periodo_fim === st.fim);
  const dias = Math.round((Date.parse(st.fim) - Date.parse(st.ini)) / 864e5) + 1;
  st.semanas = dias % 7 === 0 ? dias / 7 : null;
  st.valor = conta && conta.valor != null ? Number(conta.valor)
           : (ac && ac.regime === "semanal" && ac.valor != null && st.semanas ? Number(ac.valor) * st.semanas : null);
}

function blocoRelatorio(uid, ac){
  const wrap = document.createElement("div");
  wrap.className = "eq-rel"; wrap.id = "eqRel-" + uid;
  const det = document.createElement("details");
  det.open = !!REL_ABERTO[uid];
  const sm = document.createElement("summary");
  sm.textContent = "Resumo do pagamento para enviar";
  det.appendChild(sm);
  const corpo = document.createElement("div");
  corpo.className = "eq-form eq-rel-corpo";
  det.appendChild(corpo);
  wrap.appendChild(det);

  const desenhar = () => {
    const st = REL_ESTADO[uid];
    corpo.innerHTML = "";
    const nota = document.createElement("p"); nota.className = "eq-rel-nota";
    nota.textContent = "Só vocês veem isto. Escolha o período, confira o texto e copie para mandar no WhatsApp dela.";
    corpo.appendChild(nota);

    // período: as quinzenas que já viraram conta a pagar, mais a quinzena atual
    const sel = document.createElement("select"); sel.id = "eqRelPeriodo-" + uid; sel.setAttribute("aria-label", "Período do pagamento");
    const ops = [];
    (st.contas || []).forEach(c => ops.push({ ini: c.periodo_ini, fim: c.periodo_fim, rot: diaCurto(c.periodo_ini) + " a " + diaCurto(c.periodo_fim) + (c.pago_em ? " · pago" : " · a pagar") }));
    const q = relPeriodoDe(hojeSP(), st.contas);
    if(!ops.some(o => o.ini === q.ini && o.fim === q.fim)) ops.push({ ini: q.ini, fim: q.fim, rot: diaCurto(q.ini) + " a " + diaCurto(q.fim) + " · período atual" });
    if(!ops.some(o => o.ini === st.ini && o.fim === st.fim)) ops.unshift({ ini: st.ini, fim: st.fim, rot: diaCurto(st.ini) + " a " + diaCurto(st.fim) + " · escolhido" });
    ops.forEach(o => { const op = document.createElement("option"); op.value = o.ini + "|" + o.fim; op.textContent = o.rot; op.selected = o.ini === st.ini && o.fim === st.fim; sel.appendChild(op); });
    const mudar = async (i, f) => { if(!i || !f || f < i) return; st.ini = i; st.fim = f; await relCarregar(uid, ac); desenhar(); };
    sel.onchange = () => { const [i, f] = sel.value.split("|"); mudar(i, f); };
    corpo.appendChild(campo("Período", sel));

    // outras datas, para um acerto fora da cadência
    const de = document.createElement("input"); de.type = "date"; de.id = "eqRelDe-" + uid; de.value = st.ini;
    const ate = document.createElement("input"); ate.type = "date"; ate.id = "eqRelAte-" + uid; ate.value = st.fim;
    de.onchange = ate.onchange = () => mudar(de.value, ate.value);
    const datas = document.createElement("div"); datas.className = "eq-rel-datas";
    datas.append(campo("De", de), campo("Até", ate));
    corpo.appendChild(datas);
    if(st.valor == null){
      const av = document.createElement("p"); av.className = "eq-rel-nota";
      av.textContent = "Não há conta a pagar lançada para estas datas, então a mensagem mostra só os descontos, sem o valor a receber.";
      corpo.appendChild(av);
    }

    const lb = document.createElement("label"); lb.className = "eq-rel-op";
    const ck = document.createElement("input"); ck.type = "checkbox"; ck.id = "eqRelBanco-" + uid; ck.checked = !!st.comBanco;
    ck.onchange = () => { st.comBanco = ck.checked; desenhar(); };
    lb.append(ck, document.createTextNode(" Incluir o banco de horas"));
    corpo.appendChild(lb);

    if(st.erro){ const e = document.createElement("p"); e.className = "msg err"; e.textContent = "Não consegui ler as faltas agora. Tente de novo."; corpo.appendChild(e); return; }

    const meus = BANCO.filter(b => b.user_id === uid);
    const texto = relMensagem({
      nome: eqNome(uid), ini: st.ini, fim: st.fim, dias: st.dias, valor: st.valor, semanas: st.semanas, faltas: st.faltas || [],
      banco: st.comBanco ? { saldo: eqSaldo(BANCO, uid), itens: meus.filter(b => b.data >= st.ini && b.data <= st.fim).sort((a, b) => a.data < b.data ? -1 : 1) } : null
    });
    const ta = document.createElement("textarea");
    ta.id = "eqRelTexto-" + uid; ta.className = "eq-rel-texto"; ta.rows = Math.min(22, texto.split("\n").length + 3); ta.value = texto;
    ta.setAttribute("aria-label", "Mensagem para enviar");
    corpo.appendChild(ta);

    const bt = document.createElement("button"); bt.type = "button"; bt.className = "eq-rel-copiar"; bt.id = "eqRelCopiar-" + uid; bt.textContent = "Copiar mensagem";
    bt.onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(ta.value); ok = true; } catch(e){}
      if(!ok){ ta.focus(); ta.select(); try { ok = document.execCommand("copy"); } catch(e){} }
      toast(ok ? "Mensagem copiada. Cole no WhatsApp dela." : "Não deu para copiar sozinho: o texto ficou selecionado, copie e cole.");
    };
    corpo.appendChild(bt);
  };

  det.ontoggle = async () => {
    REL_ABERTO[uid] = det.open;
    if(!det.open) return;
    if(!REL_ESTADO[uid]){
      const q = relQuinzena(hojeSP());
      REL_ESTADO[uid] = { ini: q.ini, fim: q.fim, comBanco: false };
      await relCarregar(uid, ac);
      // começa na conta a pagar mais antiga em aberto; sem ela, no período atual
      const st = REL_ESTADO[uid];
      const abertas = st.contas.filter(c => !c.pago_em).sort((a, b) => a.periodo_ini < b.periodo_ini ? -1 : 1);
      const alvo = abertas[0] ? { ini: abertas[0].periodo_ini, fim: abertas[0].periodo_fim } : relPeriodoDe(hojeSP(), st.contas);
      if(alvo.ini !== st.ini || alvo.fim !== st.fim){ st.ini = alvo.ini; st.fim = alvo.fim; await relCarregar(uid, ac); }
    } else {
      await relCarregar(uid, ac);
    }
    desenhar();
  };
  if(det.open && REL_ESTADO[uid]) desenhar();
  return wrap;
}
