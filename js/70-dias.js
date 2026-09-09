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

  const [ac, dt, rs] = await Promise.all([
    sb.from("jb_acordo").select("id,user_id,inicio,fim,regime,valor,dias_semana,turno,obs,a_confirmar")
      .lte("inicio", fim).or("fim.is.null,fim.gte." + ini),
    sb.from("jb_dia_trabalhado").select("id,user_id,data,turno,status").gte("data", ini).lte("data", fim),
    sb.from("jb_pessoal_mes").select("*").eq("mes", ini)
  ]);
  if(ac.error || dt.error){
    aviso("diasMsg","Não consegui carregar os dias agora. Toque em atualizar.","err");
    show("scDias"); return;
  }
  ACORDOS  = ac.data || [];
  DIAS     = dt.data || [];
  DIAS_RES = rs.data || [];
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
  montarCalendarioDias();
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
      b.className = cls;
      b.setAttribute("aria-label", DOW[diaDaSemana(iso)] + " " + diaCurto(iso) + ", " +
        (reg && reg.status === "confirmado" ? "veio"
         : reg ? "esperando confirmação"
         : combinado ? "dia combinado, não marcado" : "não marcado"));
      b.onclick = travar(b, () => alternarDia(uid, iso));
      cal.appendChild(b);
    }
    bloco.appendChild(cal);
    box.appendChild(bloco);
  });
}
