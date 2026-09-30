/* JB OS · dias no ateliê: presença, acordos e o card da equipe. */

/* ============================================================
   DIAS NO ATELIÊ
   A funcionária só enxerga os próprios dias e não mexe em nada.
   Quem confirma, corrige e apaga é o gestor.
   ============================================================ */
let DIAS_MES = null;     // primeiro dia do mês aberto na tela do gestor
let ACORDOS  = [];       // acordos de trabalho vigentes no mês
let DIAS     = [];       // linhas de jb_dia_trabalhado do mês
let DIAS_RES = [];       // resumo por pessoa vindo de jb_pessoal_mes
let ATRASOS  = [];       // linhas de jb_atraso_dia do mês: hora de chegada, entrada da escala, minutos
let LEMBRETES = [];      // jb_ocorrencia do mês ainda abertas: o que o gestor não pode esquecer (ex.: atraso sem data)

const DOW = ["dom","seg","ter","qua","qui","sex","sáb"];

function ultimoDia(iso){
  const [a,m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0,10);
}
function diaDaSemana(iso){
  const [a,m,d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m-1, d)).getUTCDay();
}
function diaCurto(iso){
  const [,m,d] = iso.split("-").map(Number);
  return String(d).padStart(2,"0") + "/" + String(m).padStart(2,"0");
}

// avisa que a pessoa esteve aqui hoje. Fica como sugestão até o gestor confirmar.
async function baterPonto(){
  try { await sb.rpc("jb_marcar_presenca"); } catch(e){}
}

// na home do gestor, o botão diz quantos dias estão esperando confirmação
async function avisarPendencias(){
  const b = $("btnDias");
  let n = 0;
  try {
    const mes = primeiroDia(hojeSP());
    const { data, error } = await sb.from("jb_dia_trabalhado")
      .select("user_id,data")
      .eq("status","sugerido")
      .gte("data", mes).lte("data", ultimoDia(mes));
    if(!error && data) n = data.length;
  } catch(e){}
  b.className = n > 0 ? "big" : "big ghost";
  b.querySelector(".s").textContent = n === 0
    ? "Os dias da Eliana e da Yasmin no mês"
    : (n === 1 ? "1 dia esperando você confirmar" : n + " dias esperando você confirmar");
}

/* ---------- o botão "Cheguei" da Eliana e da Yasmin ----------
   A hora quem grava é o banco (jb_cheguei), no primeiro toque do dia, e ela não
   muda mais pelo celular da funcionária. Quem corrige é o gestor, no Quem veio.
   De madrugada o botão some: é o fim do turno de ontem, não uma chegada. */
function horaCurta(ts){
  return new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}

async function montarCheguei(){
  const box = $("cardCheguei");
  box.innerHTML = "";
  if(!EU || EU.papel === "gestor") return;

  const hoje = hojeSP();
  let reg = null, entrada = null;
  try {
    const [d, e] = await Promise.all([
      sb.from("jb_dia_trabalhado").select("data,chegada").eq("data", hoje).maybeSingle(),
      sb.from("jb_escala").select("dia_semana,entrada,inicio,fim").eq("dia_semana", diaDaSemana(hoje))
    ]);
    if(d.error) return;
    reg = d.data;
    const vig = (e.data || []).filter(x => x.inicio <= hoje && (!x.fim || x.fim >= hoje))
                              .sort((a,b) => a.inicio < b.inicio ? 1 : -1)[0];
    if(vig) entrada = String(vig.entrada).slice(0,5);
  } catch(e){ return; }

  const chegou = reg && reg.chegada;
  if(!chegou && horaSPnum() < 6) return;

  const b = document.createElement("button");
  b.type = "button";
  b.id = "btnCheguei";
  const ic = document.createElement("span");
  ic.className = "ic"; ic.setAttribute("aria-hidden","true");
  ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 2"/></svg>';
  const tx = document.createElement("span"); tx.className = "tx";
  const t = document.createElement("span"); t.className = "t";
  const sub = document.createElement("span"); sub.className = "s";
  tx.appendChild(t); tx.appendChild(sub);
  b.appendChild(ic); b.appendChild(tx);

  if(chegou){
    b.className = "big done";
    b.setAttribute("aria-disabled","true");
    t.textContent = "Chegada às " + horaCurta(chegou);
    sub.textContent = "Registrada. Se estiver errada, fale com a Jessica.";
  } else {
    b.className = "big";
    t.textContent = "Cheguei";
    sub.textContent = entrada
      ? "Toque assim que chegar. Sua entrada hoje é às " + entrada + "."
      : "Toque assim que chegar no ateliê.";
    b.onclick = travar(b, async () => {
      const { data, error } = await sb.rpc("jb_cheguei");
      if(error || !data){ toast("Não consegui registrar agora. Tente de novo.", "err"); return; }
      toast("Chegada registrada às " + horaCurta(data));
      await montarCheguei();
    });
  }
  box.appendChild(b);
}

/* ---------- o card que a Eliana e a Yasmin veem ---------- */
async function montarMeusDias(){
  const box = $("cardMeusDias");
  box.innerHTML = "";
  if(!EU || EU.papel === "gestor") return;

  const mes = primeiroDia(hojeSP());
  let linhas = [];
  try {
    const { data, error } = await sb.from("jb_dia_trabalhado")
      .select("data,status")
      .gte("data", mes).lte("data", ultimoDia(mes))
      .order("data");
    if(error) return;
    linhas = data || [];
  } catch(e){ return; }

  const firmes = linhas.filter(l => l.status === "confirmado").length;

  const card = document.createElement("div");
  card.className = "meusdias";

  const k = document.createElement("div");
  k.className = "k";
  k.textContent = "Seus dias em " + mesLongo(mes);
  card.appendChild(k);

  const n = document.createElement("div");
  n.className = "n";
  n.textContent = firmes === 0 ? "Nenhum dia ainda"
                : firmes === 1 ? "1 dia" : firmes + " dias";
  card.appendChild(n);

  if(linhas.length){
    const lst = document.createElement("div");
    lst.className = "lst";
    linhas.forEach(l => {
      const s = document.createElement("span");
      if(l.status === "sugerido") s.className = "pend";
      s.textContent = dataCurta(l.data) + (l.status === "sugerido" ? " · a confirmar" : "");
      lst.appendChild(s);
    });
    card.appendChild(lst);
  }

  const nota = document.createElement("p");
  nota.className = "nota";
  nota.textContent = linhas.some(l => l.status === "sugerido")
    ? "O que está em amarelo o app anotou sozinho e a Jessica ainda vai confirmar."
    : "Se estiver faltando algum dia, fale com a Jessica ou com o Henrique.";
  card.appendChild(nota);

  box.appendChild(card);
}

/* ---------- a tela do gestor ---------- */
async function abrirDias(){
  aviso("diasMsg","","");
  if(!DIAS_MES) DIAS_MES = primeiroDia(hojeSP());
  const ini = DIAS_MES, fim = ultimoDia(DIAS_MES);

  const [ac, dt, rs, at, oc] = await Promise.all([
    sb.from("jb_acordo").select("id,user_id,inicio,fim,regime,valor,dias_semana,turno,obs,a_confirmar")
      .lte("inicio", fim).or("fim.is.null,fim.gte." + ini),
    sb.from("jb_dia_trabalhado").select("id,user_id,data,turno,status").gte("data", ini).lte("data", fim),
    sb.from("jb_pessoal_mes").select("*").eq("mes", ini),
    sb.from("jb_atraso_dia").select("id,user_id,data,chegada,chegada_origem,hora_chegada,entrada_prevista,atraso_min")
      .gte("data", ini).lte("data", fim),
    sb.from("jb_ocorrencia").select("id,user_id,mes,texto,resolvida").eq("mes", ini).eq("resolvida", false)
  ]);
  if(ac.error || dt.error){
    aviso("diasMsg","Não consegui carregar os dias agora. Toque em atualizar.","err");
    show("scDias"); return;
  }
  ACORDOS  = ac.data || [];
  DIAS     = dt.data || [];
  DIAS_RES = rs.data || [];
  ATRASOS  = (at && !at.error && at.data) || [];
  LEMBRETES = (oc && !oc.error && oc.data) || [];
  montarCalendarioDias();
  show("scDias");
}

function acordoDoDia(userId, iso){
  return ACORDOS.find(a => a.user_id === userId
    && a.inicio <= iso && (!a.fim || a.fim >= iso)) || null;
}

async function alternarDia(userId, iso){
  const hoje = hojeSP();
  if(iso > hoje){ aviso("diasMsg","Esse dia ainda não chegou.","warn"); return; }
  const ac = acordoDoDia(userId, iso);
  if(!ac){ aviso("diasMsg","Não existe acordo de trabalho dessa pessoa nessa data.","warn"); return; }
  aviso("diasMsg","","");

  const atual = DIAS.find(d => d.user_id === userId && d.data === iso);
  let erro = null;

  if(!atual){
    const { data, error } = await sb.from("jb_dia_trabalhado")
      .insert({ user_id: userId, data: iso, turno: ac.turno, status: "confirmado",
                origem: "gestor", confirmado_por: EU.user_id,
                confirmado_em: new Date().toISOString() })
      .select("id,user_id,data,turno,status").single();
    erro = error;
    if(!error) DIAS.push(data);
  } else if(atual.status === "sugerido"){
    const { error } = await sb.from("jb_dia_trabalhado")
      .update({ status: "confirmado", confirmado_por: EU.user_id,
                confirmado_em: new Date().toISOString() })
      .eq("id", atual.id);
    erro = error;
    if(!error) atual.status = "confirmado";
  } else {
    const { error } = await sb.from("jb_dia_trabalhado").delete().eq("id", atual.id);
    erro = error;
    if(!error) DIAS = DIAS.filter(d => d.id !== atual.id);
  }

  if(erro){ aviso("diasMsg","Não consegui salvar esse dia agora.","err"); return; }

  // o resumo do mês vem do banco, então recarrega só ele
  const { data: rs } = await sb.from("jb_pessoal_mes").select("*").eq("mes", DIAS_MES);
  DIAS_RES = rs || [];
  await recarregarAtrasos();
  montarCalendarioDias();
}

async function recarregarAtrasos(){
  const { data, error } = await sb.from("jb_atraso_dia")
    .select("id,user_id,data,chegada,chegada_origem,hora_chegada,entrada_prevista,atraso_min")
    .gte("data", DIAS_MES).lte("data", ultimoDia(DIAS_MES));
  if(!error) ATRASOS = data || [];
}

/* "18:52" digitado pelo gestor vira a hora certa em São Paulo (sem horário de verão desde 2019). */
function chegadaISO(iso, hhmm){
  return iso + "T" + hhmm + ":00-03:00";
}

async function salvarChegada(diaId, iso, hhmm){
  const campos = hhmm
    ? { chegada: chegadaISO(iso, hhmm), chegada_origem: "gestor", chegada_por: EU.user_id }
    : { chegada: null, chegada_origem: null, chegada_por: null };
  const { error } = await sb.from("jb_dia_trabalhado").update(campos).eq("id", diaId);
  if(error){ aviso("diasMsg","Não consegui salvar a hora agora.","err"); return; }
  toast(hhmm ? "Chegada às " + hhmm + " salva" : "Hora apagada");
  await recarregarAtrasos();
  montarCalendarioDias();
}

async function resolverLembrete(id){
  const { error } = await sb.from("jb_ocorrencia")
    .update({ resolvida: true, resolvida_em: new Date().toISOString() }).eq("id", id);
  if(error){ aviso("diasMsg","Não consegui marcar o lembrete agora.","err"); return; }
  LEMBRETES = LEMBRETES.filter(l => l.id !== id);
  toast("Lembrete resolvido");
  montarCalendarioDias();
}

function minutosTx(n){
  if(n < 60) return n + " min";
  const h = Math.floor(n / 60), m = n % 60;
  return h + "h" + (m ? String(m).padStart(2,"0") : "");
}

/* Resumo e lista de chegadas de uma pessoa no mês. Só registro: não mexe no valor a pagar. */
function blocoChegadas(uid){
  const wrap = document.createElement("div");
  wrap.className = "chegadas";

  const dias = DIAS.filter(d => d.user_id === uid).sort((a,b) => a.data < b.data ? 1 : -1);
  const at = ATRASOS.filter(a => a.user_id === uid);
  const comHora = at.filter(a => a.chegada);
  const atrasados = at.filter(a => a.atraso_min > 0);
  const total = atrasados.reduce((s,a) => s + a.atraso_min, 0);

  const res = document.createElement("div");
  res.className = "res-atraso" + (atrasados.length ? " tem" : "");
  if(!comHora.length){
    res.textContent = "Nenhuma chegada registrada neste mês.";
  } else if(!atrasados.length){
    res.textContent = "Chegou no horário em todos os " + comHora.length + (comHora.length === 1 ? " dia registrado." : " dias registrados.");
  } else {
    const b = document.createElement("b");
    b.textContent = atrasados.length + (atrasados.length === 1 ? " atraso" : " atrasos");
    res.appendChild(b);
    res.appendChild(document.createTextNode(" no mês, " + minutosTx(total) + " no total, de " +
      comHora.length + (comHora.length === 1 ? " dia com hora registrada." : " dias com hora registrada.")));
  }
  wrap.appendChild(res);

  // lembretes do gestor (ex.: atraso sem data), logo abaixo do resumo
  LEMBRETES.filter(l => l.user_id === uid).forEach(l => {
    const box = document.createElement("div");
    box.className = "lembrete";
    const t = document.createElement("p");
    const b = document.createElement("b");
    b.textContent = "Não esquecer: ";
    t.appendChild(b);
    t.appendChild(document.createTextNode(l.texto));
    box.appendChild(t);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "lembrete-ok";
    ok.textContent = "Resolvido";
    ok.setAttribute("aria-label", "Marcar o lembrete como resolvido");
    ok.onclick = () => resolverLembrete(l.id);
    box.appendChild(ok);
    wrap.appendChild(box);
  });

  if(!dias.length) return wrap;

  const det = document.createElement("details");
  const sm = document.createElement("summary");
  sm.textContent = "Ver chegadas dia a dia";
  det.appendChild(sm);

  dias.forEach(d => {
    const a = at.find(x => x.id === d.id) || {};
    const ln = document.createElement("div");
    ln.className = "ch-ln" + (a.atraso_min > 0 ? " atrasou" : "");

    const dia = document.createElement("span");
    dia.className = "dia";
    dia.textContent = dataCurta(d.data);
    ln.appendChild(dia);

    const info = document.createElement("span");
    info.className = "info";
    if(a.chegada){
      info.textContent = "chegou " + a.hora_chegada +
        (a.entrada_prevista ? " · entrada " + a.entrada_prevista : " · sem escala") +
        (a.chegada_origem === "gestor" ? " · anotado por vocês" : "");
    } else {
      info.textContent = "sem hora de chegada";
    }
    ln.appendChild(info);

    const min = document.createElement("span");
    min.className = "min";
    min.textContent = a.atraso_min > 0 ? "+" + minutosTx(a.atraso_min) : (a.chegada && a.entrada_prevista ? "no horário" : "");
    ln.appendChild(min);

    const ed = document.createElement("button");
    ed.type = "button";
    ed.className = "ch-ed";
    ed.textContent = a.chegada ? "corrigir" : "anotar";
    ed.setAttribute("aria-label", (a.chegada ? "Corrigir" : "Anotar") + " a hora de chegada de " + dataCurta(d.data));
    ed.onclick = () => {
      if(ln.querySelector("form")) return;
      const f = document.createElement("form");
      f.className = "ch-form";
      const inp = document.createElement("input");
      inp.type = "time"; inp.value = a.hora_chegada || ""; inp.required = false;
      inp.setAttribute("aria-label", "Hora de chegada");
      const ok = document.createElement("button");
      ok.type = "submit"; ok.textContent = "Salvar";
      f.appendChild(inp); f.appendChild(ok);
      f.onsubmit = travarForm(ok, async ev => { await salvarChegada(d.id, d.data, inp.value); });
      ln.appendChild(f);
      inp.focus();
    };
    ln.appendChild(ed);
    det.appendChild(ln);
  });
  wrap.appendChild(det);
  return wrap;
}

function travarForm(btn, fn){
  const t = travar(btn, fn);
  return ev => { ev.preventDefault(); t(ev); };
}

function montarCalendarioDias(){
  const chips = $("diasChips");
  chips.innerHTML = "";
  const atual = primeiroDia(hojeSP());
  [mesAnterior(mesAnterior(atual)), mesAnterior(atual), atual].forEach(iso => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = iso === atual ? "Este mês" : mesCurto(iso);
    b.setAttribute("aria-pressed", String(iso === DIAS_MES));
    b.onclick = () => { DIAS_MES = iso; abrirDias(); };
    chips.appendChild(b);
  });

  const box = $("diasCorpo");
  box.innerHTML = "";

  const pessoas = [];
  ACORDOS.forEach(a => { if(!pessoas.includes(a.user_id)) pessoas.push(a.user_id); });

  if(!pessoas.length){
    const p = document.createElement("p");
    p.className = "tip";
    p.textContent = "Ninguém com acordo de trabalho neste mês.";
    box.appendChild(p);
    return;
  }

  const hoje = hojeSP();
  const ini  = DIAS_MES, fim = ultimoDia(DIAS_MES);
  const nDias = Number(fim.slice(8));

  pessoas.forEach(uid => {
    const res = DIAS_RES.find(r => r.user_id === uid);
    const ac  = ACORDOS.filter(a => a.user_id === uid).slice(-1)[0];
    const nome = res ? res.nome : "Pessoa";

    const bloco = document.createElement("div");
    bloco.className = "pessoa";

    const h = document.createElement("h3");
    h.textContent = nome;
    bloco.appendChild(h);

    const sub = document.createElement("div");
    sub.className = "sub";
    const veio = res ? res.dias_veio : 0;
    const comb = res ? res.dias_combinados : 0;
    sub.innerHTML = "";
    const s1 = document.createElement("b");
    s1.textContent = veio + " de " + comb;
    sub.appendChild(s1);
    sub.appendChild(document.createTextNode(" dias combinados no mês"));
    if(res && res.dias_pendentes > 0){
      sub.appendChild(document.createElement("br"));
      const s2 = document.createElement("span");
      s2.textContent = res.dias_pendentes + (res.dias_pendentes === 1
        ? " dia esperando você confirmar" : " dias esperando você confirmar");
      sub.appendChild(s2);
    }
    if(res && res.custo != null){
      sub.appendChild(document.createElement("br"));
      const s3 = document.createElement("span");
      s3.textContent = (ac && ac.regime === "diaria")
        ? "A pagar pelos dias que veio: R$ " + moeda(res.custo)
        : "A pagar pelo combinado do mês: R$ " + moeda(res.custo);
      sub.appendChild(s3);
    }
    if(ac && ac.a_confirmar){
      sub.appendChild(document.createElement("br"));
      const s4 = document.createElement("span");
      s4.textContent = "Atenção: o valor deste acordo ainda não foi confirmado.";
      sub.appendChild(s4);
    }
    bloco.appendChild(sub);

    const cal = document.createElement("div");
    cal.className = "cal";
    ["D","S","T","Q","Q","S","S"].forEach(d => {
      const c = document.createElement("div");
      c.className = "dow";
      c.textContent = d;
      cal.appendChild(c);
    });
    for(let i = 0; i < diaDaSemana(ini); i++){
      const v = document.createElement("div");
      v.className = "vazio";
      cal.appendChild(v);
    }
    for(let d = 1; d <= nDias; d++){
      const iso = ini.slice(0,8) + String(d).padStart(2,"0");
      const reg = DIAS.find(x => x.user_id === uid && x.data === iso);
      const acd = acordoDoDia(uid, iso);
      const combinado = !!(acd && acd.dias_semana.includes(diaDaSemana(iso)));

      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(d);
      let cls = "";
      if(reg && reg.status === "confirmado") cls = "veio";
      else if(reg) cls = "pend";
      else if(combinado) cls = "combinado";
      if(iso > hoje) cls += " futuro";
      const atr = reg ? ATRASOS.find(x => x.id === reg.id) : null;
      if(atr && atr.atraso_min > 0) cls += " atraso";
      b.className = cls;
      b.setAttribute("aria-label", DOW[diaDaSemana(iso)] + " " + diaCurto(iso) + ", " +
        (reg && reg.status === "confirmado" ? "veio"
         : reg ? "esperando confirmação"
         : combinado ? "dia combinado, não marcado" : "não marcado") +
        (atr && atr.chegada ? ", chegou " + atr.hora_chegada +
          (atr.atraso_min > 0 ? ", " + minutosTx(atr.atraso_min) + " de atraso" : "") : ""));
      b.onclick = travar(b, () => alternarDia(uid, iso));
      cal.appendChild(b);
    }
    bloco.appendChild(cal);
    bloco.appendChild(blocoChegadas(uid));
    box.appendChild(bloco);
  });
}
