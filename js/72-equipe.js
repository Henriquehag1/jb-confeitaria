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
      + (fr ? " · " + fr.nome + " cobriu" : "")
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
    lf.append(
      campo("Nome da freela", entrada("text", st.nome, v => { st.nome = v; }, { id: "eqFreelaNome", maxlength: "60" })),
      campo("Valor combinado (R$)", entrada("text", st.valor, v => { st.valor = v; }, { id: "eqFreelaValor", inputmode: "decimal" }))
    );
    f.appendChild(lf);
    const n = document.createElement("p"); n.className = "eq-nota";
    n.textContent = "A freela entra em Contas a pagar no mesmo dia, com o horário da falta.";
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
  let valorFreela = null;
  if(st.temFreela){
    if(!st.nome.trim()){ aviso("diasMsg", "Diga o nome da freela.", "warn"); return; }
    valorFreela = numBR(st.valor);
    if(valorFreela == null || !(valorFreela >= 0)){ aviso("diasMsg", "Diga o valor combinado com a freela.", "warn"); return; }
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

  if(st.temFreela){
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
    + (linha.desconta ? (comp && comp.usa ? " e " : ": ") + "desconta R$ " + moeda(linha.valor_desconto) : "") + ".");
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
    no_lugar_de: fr.no_lugar_de || null, falta_id: fr.falta_id || null, conta_id: c.id, obs: fr.obs || null, cancelada: false, criado_por: EU.user_id
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
  sub.textContent = FREELAS.length
    ? (FREELAS.length === 1 ? "1 diária de freela" : FREELAS.length + " diárias de freela") + " no mês, R$ " + moeda(tot)
    : "Nenhuma freela no mês.";
  bloco.appendChild(sub);

  FREELAS.forEach(f => {
    const ln = document.createElement("div"); ln.className = "eq-ln"; ln.dataset.freela = f.id;
    const dia = document.createElement("span"); dia.className = "dia"; dia.textContent = dataCurta(f.data);
    const c = f.conta_id ? FREELA_CONTAS[f.conta_id] : null;
    const info = document.createElement("span"); info.className = "info";
    info.textContent = f.nome + (f.entrada && f.saida ? ", " + eqHHMM(f.entrada) + " às " + eqHHMM(f.saida) : "")
      + " · R$ " + moeda(Number(f.valor))
      + (f.no_lugar_de ? " · no lugar de " + eqNome(f.no_lugar_de) : "")
      + (c && c.pago_em ? " · paga" : " · a pagar");
    ln.append(dia, info);
    if(!(c && c.pago_em)) ln.appendChild(botaoCancelar("freela:" + f.id, "Cancelar a freela de " + dataCurta(f.data), () => cancelarFreela(f)));
    bloco.appendChild(ln);
  });

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
  return bloco;
}

function formFreela(){
  const st = EQ_FORM;
  const f = document.createElement("div"); f.className = "eq-form"; f.id = "eqFormFreela";
  const l1 = document.createElement("div"); l1.className = "eq-linha";
  l1.append(
    campo("Nome", entrada("text", st.nome, v => { st.nome = v; }, { id: "eqFrNome", maxlength: "60" })),
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
  aviso("diasMsg", "", "");
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
    n.textContent = " · ainda não descontado nem compensado";
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
