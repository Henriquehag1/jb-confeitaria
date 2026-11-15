/* JB OS · conferência da geladeira com o Saipos (só gestor).

   A contagem diz quanto saiu da geladeira; o Saipos diz quanto foi vendido. Os dois
   números vêm de lugares diferentes, então um confere o outro: o que saiu e não tem
   venda (nem perda registrada) é a diferença que precisa de explicação.

   A conta mora no banco (jb_conferencia_geladeira), a mesma que a checagem diária usa:
     saiu      = venda da contagem + acerto de contagem (acerto não explica saída)
     vendido   = doces vendidos no Saipos + sabores escolhidos nos combos
     sem sabor = doce de combo cujo sabor o Saipos não mostrou (fecha só na categoria)
   Ninguém do app grava venda: a leitura do Saipos chega pela checagem diária. */

const CONF_DIAS = 14;           // a lista mostra as duas últimas semanas
const CONF_CAT = { gelado: "Bolos gelados", pote: "Bolos de pote", nuvem: "Bolo Nuvem", outro: "Outros doces" };
let CONFG = null;               // { lista, aberto }

function confgMaisDias(dia, n){
  const d = new Date(dia + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* tolerância: até 2 doces ou 2% do que saiu, o que for maior */
function confgTolerancia(saiu){ return Math.max(2, Math.round(Number(saiu || 0) * 0.02)); }

/* situação do dia (função pura, testável) */
function confgStatus(d){
  if(!d) return { tom: "", rot: "" };
  if(!d.fechado) return { tom: "info", rot: "dia sem fechamento" };
  if(!d.lido) return { tom: "info", rot: "Saipos ainda não lido" };
  const dif = Number(d.diferenca || 0), tol = confgTolerancia(d.saiu);
  if(dif > tol) return { tom: "ruim", rot: dif + (dif === 1 ? " doce saiu" : " doces saíram") + " sem venda" };
  if(dif < -tol) return { tom: "atencao", rot: "vendeu " + (-dif) + " a mais do que saiu" };
  return { tom: "ok", rot: dif === 0 ? "bateu" : "bateu (diferença de " + Math.abs(dif) + ")" };
}

/* o que chama a atenção no dia, para a lista de alertas (pura) */
function confgAlertas(d){
  const a = [];
  if(!d || !d.lido || !d.fechado) return a;
  (d.perdas || []).filter(p => p.motivo === "contagem").forEach(p =>
    a.push("Acerto de contagem de " + p.qtd + " (" + (p.obs || "sem motivo") + "): conta como diferença, não como perda."));
  (d.perdas || []).filter(p => p.motivo !== "contagem" && Number(p.qtd) > 2 && !p.foto).forEach(p =>
    a.push("Perda de " + p.qtd + " sem foto."));
  if((d.nao_mapeados || []).length) a.push((d.nao_mapeados.length === 1 ? "1 nome do Saipos" : d.nao_mapeados.length + " nomes do Saipos")
    + " sem ligação com a geladeira: " + d.nao_mapeados.map(x => x.nome + " (" + Number(x.qtd) + ")").join(", ") + ". A conta pode estar incompleta.");
  return a;
}

async function confgCarregar(de, ate){
  const { data, error } = await sb.rpc("jb_conferencia_geladeira", { p_de: de, p_ate: ate });
  if(error) throw new Error("conferencia");
  return Array.isArray(data) ? data : [];
}

/* ---------- card da Home: ontem ---------- */
async function montarConferenciaHome(gestor){
  const box = $("cardConferencia");
  if(!box) return;
  box.innerHTML = "";
  if(!gestor) return;
  await confgCardOntem(box);
  await consumoCardMes(box);
}

async function confgCardOntem(box){
  const ontem = confgMaisDias(TURNO_DIA || hojeSP(), -1);
  let d = null;
  try { d = (await confgCarregar(ontem, ontem))[0] || null; } catch(e){ return; }
  if(!d) return;
  const st = confgStatus(d);
  const card = document.createElement("button");
  card.type = "button"; card.className = "freezer-card gd-card confg-card"; card.id = "confgCard";
  const h = document.createElement("h4"); h.textContent = "Geladeira x Saipos · ontem";
  const res = document.createElement("p"); res.className = "gd-res"; res.dataset.tom = st.tom === "ruim" ? "baixo" : st.tom === "atencao" ? "perto" : st.tom === "ok" ? "ok" : "";
  res.textContent = st.tom === "ok" || st.tom === "ruim" || st.tom === "atencao"
    ? "Saíram " + Number(d.saiu) + ", Saipos vendeu " + Number(d.vendido) + ": " + st.rot + "."
    : st.rot.charAt(0).toUpperCase() + st.rot.slice(1) + ".";
  const s = document.createElement("p"); s.className = "s"; s.textContent = "Toque para ver doce por doce e os últimos dias.";
  card.append(h, res, s);
  card.onclick = () => abrirConferenciaGeladeira(ontem);
  box.appendChild(card);
}

/* consumo da casa no mês, somado por quem levou (pura, testável).
   "jessica" e "Jessica " contam como a mesma pessoa. */
function consumoResumo(linhas){
  const por = {};
  let total = 0;
  (linhas || []).filter(x => !x.anulada && x.motivo === "consumo").forEach(x => {
    const q = Number(x.qtd || 0);
    const nome = String(x.obs || "").trim().replace(/\s+/g, " ") || "sem nome";
    const k = nome.toLowerCase();
    if(!por[k]) por[k] = { nome: nome.charAt(0).toUpperCase() + nome.slice(1), qtd: 0 };
    por[k].qtd += q; total += q;
  });
  const quem = Object.values(por).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  return { total, quem };
}

const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

async function consumoCardMes(box){
  const hoje = TURNO_DIA || hojeSP();
  const ini = hoje.slice(0, 8) + "01";
  let linhas = [];
  try {
    const { data, error } = await sb.from("jb_perda").select("qtd,obs,motivo,anulada,data")
      .eq("motivo", "consumo").gte("data", ini).lte("data", hoje);
    if(error) return;
    linhas = data || [];
  } catch(e){ return; }
  const r = consumoResumo(linhas);
  const card = document.createElement("div");
  card.className = "freezer-card gd-card consumo-card"; card.id = "consumoCard";
  const h = document.createElement("h4"); h.textContent = "Consumo da casa · " + MESES_PT[Number(hoje.slice(5, 7)) - 1];
  const res = document.createElement("p"); res.className = "gd-res";
  res.textContent = r.total ? r.total + (r.total === 1 ? " doce" : " doces") + " no mês." : "Nenhum doce registrado como consumo da casa neste mês.";
  card.append(h, res);
  if(r.quem.length){
    const s = document.createElement("p"); s.className = "s";
    s.textContent = r.quem.map(x => x.nome + " " + x.qtd).join(" · ");
    card.appendChild(s);
  }
  box.appendChild(card);
}

/* ---------- tela ---------- */
async function abrirConferenciaGeladeira(abrir){
  show("scConfg");
  const corpo = $("confgCorpo");
  corpo.innerHTML = '<p class="tip">Carregando a conferência...</p>';
  aviso("confgMsg", "", "");
  const ate = confgMaisDias(TURNO_DIA || hojeSP(), -1);
  try {
    const lista = await confgCarregar(confgMaisDias(ate, -(CONF_DIAS - 1)), ate);
    CONFG = { lista: lista.slice().reverse(), aberto: abrir || null };
  } catch(e){
    corpo.innerHTML = "";
    aviso("confgMsg", "Não consegui carregar a conferência agora. Toque em atualizar.", "err");
    return;
  }
  confgDesenhar();
}

function confgEl(tag, cls, txt){ const e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }

function confgDesenhar(){
  const corpo = $("confgCorpo");
  corpo.innerHTML = "";
  corpo.appendChild(confgEl("p", "tip",
    "Quanto saiu da geladeira pela contagem contra quanto o Saipos registrou de venda. Diferença positiva é doce que saiu sem venda nem perda registrada."));
  const comDados = CONFG.lista.filter(d => d.lido && d.fechado);
  if(comDados.length){
    const tot = comDados.reduce((s, d) => ({ saiu: s.saiu + Number(d.saiu), vendido: s.vendido + Number(d.vendido), dif: s.dif + Math.max(0, Number(d.diferenca)) }), { saiu: 0, vendido: 0, dif: 0 });
    const r = confgEl("div", "card confg-tot");
    r.append(confgEl("b", null, tot.dif + (tot.dif === 1 ? " doce" : " doces") + " sem venda em " + comDados.length + (comDados.length === 1 ? " dia" : " dias")),
             confgEl("small", null, "Saíram " + tot.saiu + ", Saipos vendeu " + tot.vendido
               + (tot.saiu ? " (" + (tot.dif / tot.saiu * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "% do que saiu)" : "") + "."));
    corpo.appendChild(r);
  }
  CONFG.lista.forEach(d => corpo.appendChild(confgDia(d)));
}

function confgDia(d){
  const st = confgStatus(d);
  const det = document.createElement("details");
  det.className = "card confg-dia"; det.dataset.data = d.data; det.dataset.tom = st.tom;
  det.open = CONFG.aberto === d.data;
  const sm = document.createElement("summary");
  const l1 = confgEl("span", "confg-l1");
  l1.append(confgEl("b", null, d.data === confgMaisDias(TURNO_DIA || hojeSP(), -1) ? "Ontem" : dataCurta(d.data)),
            confgEl("span", "confg-st", st.rot));
  sm.appendChild(l1);
  if(d.lido && d.fechado) sm.appendChild(confgEl("small", "confg-l2", "Saíram " + Number(d.saiu) + " · Saipos " + Number(d.vendido)));
  det.appendChild(sm);
  det.addEventListener("toggle", () => { if(det.open) CONFG.aberto = d.data; });

  const corpo = confgEl("div", "confg-corpo");
  if(!d.lido || !d.fechado){
    corpo.appendChild(confgEl("p", "tip", !d.fechado ? "Sem a contagem de fechamento deste dia não dá para conferir."
      : "A leitura do Saipos deste dia ainda não chegou. A checagem diária tenta de novo sozinha."));
    det.appendChild(corpo);
    return det;
  }
  const alertas = confgAlertas(d);
  if(alertas.length){ const al = confgEl("div", "msg warn confg-al"); alertas.forEach(t => al.appendChild(confgEl("p", null, t))); corpo.appendChild(al); }

  (d.categorias || []).forEach(c => {
    const sec = confgEl("div", "confg-cat"); sec.dataset.cat = c.cat;
    const dif = Number(c.diferenca);
    const cab = confgEl("p", "confg-cab");
    cab.append(confgEl("b", null, CONF_CAT[c.cat] || c.cat),
               confgEl("span", "confg-n" + (dif > confgTolerancia(c.saiu) ? " ruim" : dif < -confgTolerancia(c.saiu) ? " atencao" : ""),
                       "saíram " + Number(c.saiu) + " · vendidos " + Number(c.vendido) + (dif ? " · " + (dif > 0 ? "+" : "") + dif : "")));
    sec.appendChild(cab);
    const semSabor = Number(c.sem_sabor || 0);
    (d.produtos || []).filter(p => p.cat === c.cat).forEach(p => {
      const ln = confgEl("div", "confg-ln");
      const pd = Number(p.diferenca);
      ln.append(confgEl("span", "confg-nome", p.nome.replace(/^No Pote \| /, "Pote ")),
                confgEl("span", "confg-q", Number(p.saiu) + " / " + Number(p.vendido)),
                confgEl("span", "confg-d" + (!semSabor && pd > 2 ? " ruim" : ""), pd ? (pd > 0 ? "+" : "") + pd : "ok"));
      sec.appendChild(ln);
    });
    if(semSabor) sec.appendChild(confgEl("small", "confg-nota", semSabor + (semSabor === 1 ? " doce de combo veio" : " doces de combo vieram")
      + " sem o sabor no Saipos: nesta categoria a conferência vale pelo total, não doce por doce."));
    corpo.appendChild(sec);
  });
  corpo.appendChild(confgEl("small", "confg-nota", "Em cada doce: saiu da geladeira / vendido no Saipos."));
  det.appendChild(corpo);
  return det;
}
