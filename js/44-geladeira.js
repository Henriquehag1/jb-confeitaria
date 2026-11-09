/* JB OS · Geladeira ideal: quanto deixar de cada doce na expositora para dar conta
   da venda do dia sem esgotar.
   Conta com as vendas reais dos dias fechados (jb_saidas): pega o que vendeu nos
   últimos 28 dias e escolhe um número que cobre 8 em cada 10 dias, ajustado pelo
   dia da semana (sexta e domingo vendem mais) e com um pouco a mais para o doce
   que já acabou na geladeira. Nada é gravado: o número se refaz sozinho todo dia. */

const GD_DIAS = 28;        // janela de vendas por doce
const GD_DIAS_SEMANA = 56; // janela para o peso do dia da semana
const GD_MIN = 2;          // nenhum doce do cardápio fica com menos de 2 na vitrine
const GD_POUCO = 7;        // menos de 7 dias de venda: ainda não dá para cravar

let IDEAL = {};            // produto_id -> { ideal, media, dias, zerou }
let IDEAL_DIA = null;

function gdMaisDias(dia, n){
  const d = new Date(dia + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function gdDiaSemana(dia){ return new Date(dia + "T12:00:00Z").getUTCDay(); }

/* percentil com interpolação, igual ao percentile_cont do banco */
function gdPercentil(vals, p){
  if(!vals.length) return 0;
  const v = vals.slice().sort((a, b) => a - b);
  const pos = (v.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/* linhas: jb_saidas (data, produto_id, vendeu, sobrou, fechado, saiu_total) dos dias antes de "dia" */
function gdCalcular(linhas, dia){
  const porDia = {};
  (linhas || []).forEach(l => {
    if(l.data >= dia) return;
    const d = porDia[l.data] || (porDia[l.data] = { ok: true, saiu: 0, linhas: [] });
    d.ok = d.ok && !!l.fechado;
    d.saiu += Number(l.saiu_total) || 0;
    d.linhas.push(l);
  });
  const dias = Object.keys(porDia).filter(d => porDia[d].ok && porDia[d].saiu >= 0);

  /* peso do dia da semana: a média desse dia sobre a média de todos */
  const desde56 = gdMaisDias(dia, -GD_DIAS_SEMANA);
  const totais = dias.filter(d => d >= desde56).map(d => ({
    d, v: porDia[d].linhas.reduce((s, l) => s + Math.max(0, Number(l.vendeu) || 0), 0)
  }));
  const media = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const ds = gdDiaSemana(dia);
  const doDia = totais.filter(t => gdDiaSemana(t.d) === ds).map(t => t.v);
  const geral = media(totais.map(t => t.v));
  let fator = (doDia.length >= 3 && geral > 0) ? media(doDia) / geral : 1;
  fator = Math.min(1.3, Math.max(0.85, fator));

  const desde28 = gdMaisDias(dia, -GD_DIAS);
  const porProduto = {};
  dias.filter(d => d >= desde28).forEach(d => porDia[d].linhas.forEach(l => {
    const p = porProduto[l.produto_id] || (porProduto[l.produto_id] = { vendas: [], zerou: 0 });
    p.vendas.push(Math.max(0, Number(l.vendeu) || 0));
    if(l.fechado && Number(l.sobrou) === 0) p.zerou++;
  }));

  const out = {};
  Object.keys(porProduto).forEach(pid => {
    const p = porProduto[pid], n = p.vendas.length;
    const med = media(p.vendas);
    if(n < GD_POUCO){ out[pid] = { ideal: null, media: med, dias: n, zerou: p.zerou }; return; }
    const extra = Math.min(0.25, 0.25 * p.zerou / n);
    const ideal = Math.max(GD_MIN, Math.ceil(gdPercentil(p.vendas, 0.8) * fator * (1 + extra) - 1e-9));
    out[pid] = { ideal, media: med, dias: n, zerou: p.zerou };
  });
  out.__fator = fator;
  return out;
}

async function carregarIdeal(dia){
  dia = dia || diaDoTurno();
  if(IDEAL_DIA === dia && Object.keys(IDEAL).length) return IDEAL;
  try {
    const { data, error } = await sb.from("jb_saidas")
      .select("data,produto_id,vendeu,sobrou,fechado,saiu_total")
      .gte("data", gdMaisDias(dia, -GD_DIAS_SEMANA)).lt("data", dia);
    if(error) return IDEAL = {};
    IDEAL = gdCalcular(data || [], dia);
    IDEAL_DIA = dia;
  } catch(e){ IDEAL = {}; }
  return IDEAL;
}

/* tom da barrinha: vermelho abaixo da metade, âmbar perto, verde completo */
function gdTom(tem, ideal){
  if(!ideal) return "";
  if(tem >= ideal) return "ok";
  if(tem >= ideal * 0.5) return "perto";
  return "baixo";
}

/* chip embaixo do nome do doce na contagem: "ideal 22 · faltam 13" com barrinha */
function gdChip(pid){
  const x = IDEAL[pid];
  if(!x || !x.ideal) return null;
  const el = document.createElement("span");
  el.className = "ideal";
  const txt = document.createElement("span"); txt.className = "ideal-t";
  const bar = document.createElement("i"); bar.className = "ideal-b";
  const fill = document.createElement("b"); bar.appendChild(fill);
  el.append(txt, bar);
  el.pintar = tem => {
    const falta = Math.max(0, x.ideal - tem);
    el.dataset.tom = gdTom(tem, x.ideal);
    txt.textContent = "ideal " + x.ideal + (falta ? " · faltam " + falta : " · completo");
    fill.style.width = Math.min(100, Math.round(tem / x.ideal * 100)) + "%";
  };
  return el;
}

/* Repondo: preenche com o que falta para chegar no ideal */
function gdPreencherFalta(){
  let n = 0;
  LISTA.forEach(p => {
    const x = IDEAL[p.id];
    if(!x || !x.ideal) return;
    const falta = x.ideal - (BASE[p.id] || 0);
    if(falta > 0){ VALORES[p.id] = falta; n++; }
    else delete VALORES[p.id];
  });
  salvarRascunho();
  montarLista();
  aviso("countMsg", n
    ? "Preenchi o que falta para o ideal de hoje em " + n + (n === 1 ? " doce" : " doces") + ". Ajuste o que não tiver pronto e toque em somar."
    : "A geladeira já está no ideal de hoje.", "ok");
}

/* Card da Home (só gestor): a geladeira de hoje contra o ideal */
async function montarGeladeiraHome(gestor){
  const box = $("cardGeladeira");
  if(!box) return;
  box.innerHTML = "";
  if(!gestor || !PRODUTOS.length) return;
  const dia = TURNO_DIA || hojeSP();
  await carregarIdeal(dia);
  const comIdeal = PRODUTOS.filter(p => IDEAL[p.id] && IDEAL[p.id].ideal);
  if(!comIdeal.length) return;

  /* o que tem: a abertura de hoje (com o que foi reposto) ou, antes de abrir, o que ficou ontem */
  const tem = {};
  let fonte = "";
  const ab = CONTAGEM_HOJE && CONTAGEM_HOJE.abertura;
  try {
    if(ab){
      const { data } = await sb.from("jb_contagem_item").select("produto_id,qtd").eq("contagem_id", ab.id);
      (data || []).forEach(i => { tem[i.produto_id] = i.qtd || 0; });
      fonte = "abertura";
    } else {
      const { data } = await sb.from("jb_saidas").select("produto_id,ficou,fechado").eq("data", gdMaisDias(dia, -1));
      (data || []).forEach(l => { if(l.fechado && l.ficou !== null) tem[l.produto_id] = l.ficou; });
      fonte = Object.keys(tem).length ? "ontem" : "";
    }
  } catch(e){}

  const linhas = comIdeal.map(p => {
    const t = tem[p.id] || 0, i = IDEAL[p.id].ideal;
    return { p, t, i, falta: Math.max(0, i - t), tom: gdTom(t, i) };
  }).sort((a, b) => (b.falta / b.i) - (a.falta / a.i) || b.falta - a.falta);
  const abaixo = linhas.filter(l => l.falta > 0);

  const card = document.createElement("div");
  card.className = "freezer-card gd-card"; card.id = "geladeiraCard";
  const h = document.createElement("h4");
  const nomeDia = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"][gdDiaSemana(dia)];
  h.textContent = "Geladeira ideal · " + nomeDia;
  const res = document.createElement("p"); res.className = "gd-res";
  res.dataset.tom = abaixo.length ? (abaixo.some(l => l.tom === "baixo") ? "baixo" : "perto") : "ok";
  res.textContent = !fonte
    ? "Quanto deixar de cada doce para dar conta da venda de hoje."
    : abaixo.length
      ? abaixo.length + (abaixo.length === 1 ? " doce abaixo do ideal" : " doces abaixo do ideal") + (fonte === "ontem" ? " para abrir" : " na abertura")
      : "Tudo no ideal" + (fonte === "ontem" ? " para abrir" : "") + ".";

  const lista = document.createElement("div"); lista.className = "gd-lista";
  (fonte ? linhas : linhas.slice()).forEach(l => {
    const ln = document.createElement("div"); ln.className = "gd-ln"; ln.dataset.tom = fonte ? l.tom : "";
    const n = document.createElement("span"); n.className = "gd-n"; n.textContent = l.p.nome.replace(/^No Pote \| /, "Pote ");
    const bar = document.createElement("i"); bar.className = "ideal-b";
    const fill = document.createElement("b"); fill.style.width = (fonte ? Math.min(100, Math.round(l.t / l.i * 100)) : 0) + "%";
    bar.appendChild(fill);
    const q = document.createElement("span"); q.className = "gd-q";
    q.textContent = fonte ? l.t + " de " + l.i : String(l.i);
    ln.append(n, bar, q);
    lista.appendChild(ln);
  });

  const s = document.createElement("p"); s.className = "s";
  s.textContent = "O ideal cobre a venda de 8 em cada 10 dias, com as vendas das últimas 4 semanas e o peso do dia da semana. Refaz sozinho todo dia.";
  card.append(h, res, lista, s);
  if(abaixo.length && ab){
    const bt = document.createElement("button"); bt.type = "button"; bt.className = "fz-bt"; bt.id = "btnGdRepor";
    bt.textContent = "Repor o que falta";
    bt.onclick = async () => { await abrirContagem("abertura", "repor"); gdPreencherFalta(); };
    card.appendChild(bt);
  }
  box.appendChild(card);
}
