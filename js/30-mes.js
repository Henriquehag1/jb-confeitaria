/* JB OS · resultado do mês, sincronizado com o Nosso Financeiro. */

/* ============================================================
   RESULTADO DO MÊS
   Entradas por canal e saídas do mês, batidos contra o Nosso Financeiro.
   O custo por produto entra aqui quando a contagem tiver rodado.
   ============================================================ */
let MES = null;        // 'aaaa-mm-01'
let MES_DADOS = null;
let CANAIS_MES = [];   // todos os canais, ligados e desligados, só para o resultado do mês

function primeiroDia(d){ return d.slice(0,7) + "-01"; }
function mesAnterior(iso){
  const [a,m] = iso.split("-").map(Number);
  return (m === 1 ? (a-1) + "-12" : a + "-" + String(m-1).padStart(2,"0")) + "-01";
}
function mesLongo(iso){
  const [a,m] = iso.split("-").map(Number);
  const s = new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",month:"long",year:"numeric"})
              .format(new Date(Date.UTC(a,m-1,15)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function mesCurto(iso){
  const [a,m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",month:"short"})
           .format(new Date(Date.UTC(a,m-1,15))).replace(".","");
}

async function abrirMes(){
  aviso("mesMsg","","");
  if(!MES) MES = primeiroDia(hojeSP());
  /* Aqui entram todos os canais, inclusive os desligados: a linha do vale-refeição não
     tem preço nem promoção, mas recebe dinheiro e precisa aparecer no que entrou. */
  if(!CANAIS_MES.length){
    const { data } = await sb.from("jb_canal").select("*").order("ordem");
    CANAIS_MES = data || [];
  }
  const [r, f, jm] = await Promise.all([
    sb.from("jb_resultado_mes").select("*").eq("mes", MES).maybeSingle(),
    sb.from("jb_faturamento").select("canal_id,valor,manual").eq("mes", MES),
    sb.from("jb_mes").select("detalhe").eq("mes", MES).maybeSingle()
  ]);
  const porCanal = {}, manualCanal = {};
  (f.data || []).forEach(x => { porCanal[x.canal_id] = Number(x.valor); manualCanal[x.canal_id] = !!x.manual; });
  MES_DADOS = {
    saidas: r.data ? Number(r.data.saidas) : 0,
    saidasManual: r.data ? !!r.data.saidas_manual : false,
    sincronizadoEm: r.data ? r.data.atualizado_em : null,
    obs: r.data ? r.data.obs : null,
    fixoRef: r.data ? Number(r.data.custo_fixo_referencia) : null,
    detalhe: (jm && !jm.error && jm.data && jm.data.detalhe) || null,
    porCanal, manualCanal
  };
  if(!r.data){
    const { data: cf } = await sb.from("jb_custo_fixo_total").select("total").maybeSingle();
    MES_DADOS.fixoRef = cf ? Number(cf.total) : null;
  }
  const { data: pl } = await sb.from("jb_config").select("valor").eq("chave","pro_labore_mes").maybeSingle();
  MES_DADOS.proLabore = pl ? Number(pl.valor) : 0;
  await carregarKPIs();
  montarMes();
  show("scMes");
  ligarRelogioDoMes();
}

async function salvarMes(campos){
  /* atualizado_em fica para a sincronização: é ele que diz quando o Nosso Financeiro
     empurrou por último. Digitar à mão não pode fingir que sincronizou. */
  const { error } = await sb.from("jb_mes")
    .upsert({ mes: MES, ...campos }, { onConflict: "mes" });
  if(error){ aviso("mesMsg","Não consegui salvar agora.","err"); return false; }
  return true;
}

/* O número que decide o mês, recalculado sem redesenhar a tela inteira. */
function atualizarPlacarMes(){
  const g = $("mesG"), p = $("mesP"), tv = $("mesTotal");
  if(!g || !p) return;
  const entradas = CANAIS_MES.reduce((s,c) => s + (MES_DADOS.porCanal[c.id] || 0), 0);
  const resultado = entradas - MES_DADOS.saidas;
  g.className = "g " + (resultado >= 0 ? "bom" : "alerta");
  g.textContent = (resultado < 0 ? "Faltou R$ " + moeda(-resultado) : "Sobrou R$ " + moeda(resultado));
  p.textContent = entradas > 0
    ? mesLongo(MES) + ": entrou R$ " + moeda(entradas) + " e saiu R$ " + moeda(MES_DADOS.saidas)
      + ", o que deixa " + pct(resultado/entradas) + " do que entrou."
    : mesLongo(MES) + " ainda sem faturamento lançado.";
  if(tv) tv.textContent = "R$ " + moeda(entradas);
}

function montarMes(){
  const chips = $("mesChips");
  chips.innerHTML = "";
  const atual = primeiroDia(hojeSP());
  [mesAnterior(mesAnterior(atual)), mesAnterior(atual), atual].forEach(iso => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = iso === atual ? "Este mês" : mesCurto(iso);
    b.setAttribute("aria-pressed", String(iso === MES));
    b.onclick = () => { MES = iso; abrirMes(); };
    chips.appendChild(b);
  });

  const box = $("mesCorpo");
  box.innerHTML = "";

  const entradas = CANAIS_MES.reduce((s,c) => s + (MES_DADOS.porCanal[c.id] || 0), 0);
  const resultado = entradas - MES_DADOS.saidas;

  // o número que decide o mês, primeiro
  const cap = document.createElement("div");
  cap.className = "placar";
  const g = document.createElement("div"); g.id = "mesG";
  const p = document.createElement("p"); p.id = "mesP";
  cap.append(g, p);
  box.appendChild(cap);
  atualizarPlacarMes();
  explicarPlacar(cap, entradas, resultado);

  /* quando foi a última vez que o Nosso Financeiro empurrou este mês */
  if(MES_DADOS.sincronizadoEm){
    const dias = Math.floor((Date.now() - new Date(MES_DADOS.sincronizadoEm).getTime()) / 86400000);
    const s = document.createElement("p");
    s.className = "sync" + (dias > 7 && MES === primeiroDia(hojeSP()) ? " velho" : "");
    s.textContent = "Sincronizado com o Nosso Financeiro em " + dataCurta(new Date(MES_DADOS.sincronizadoEm).toLocaleDateString("en-CA",{timeZone:TZ}))
      + " às " + horaDe(MES_DADOS.sincronizadoEm)
      + (dias > 7 && MES === primeiroDia(hojeSP()) ? ". Já faz " + dias + " dias: confira se o gatilho está de pé." : ".");
    cap.appendChild(s);
  }

  montarKPIs(box);

  // entradas por canal
  const ent = document.createElement("div");
  ent.className = "razaobox";
  const h1 = document.createElement("h3"); h1.textContent = "Entrou, por canal";
  ent.appendChild(h1);
  CANAIS_MES.forEach(c => {
    const l = document.createElement("div"); l.className = "linhaval";
    const n = document.createElement("span"); n.className = "n"; n.textContent = c.nome;
    const inp = document.createElement("input");
    inp.className = "q"; inp.type = "tel"; inp.inputMode = "decimal";
    inp.setAttribute("aria-label","Entrou do " + c.nome);
    const v = MES_DADOS.porCanal[c.id];
    inp.value = v ? moeda(v) : "";
    inp.placeholder = "0,00";
    const tag = document.createElement("small"); tag.className = "manual";
    const pintaTag = () => { tag.textContent = MES_DADOS.manualCanal[c.id] ? "digitado à mão" : ""; };
    pintaTag();
    n.appendChild(tag);
    inp.onblur = async () => {
      const vazio = inp.value.trim() === "";
      const n2 = numBR(inp.value);
      if(!vazio && n2 == null){ inp.value = v ? moeda(v) : ""; return; }
      /* Campo apagado: volta a vir do Nosso Financeiro. Antes isso gravava zero
         e desligava a sincronização daquele canal para sempre. */
      if(vazio){
        if(!MES_DADOS.manualCanal[c.id]){ inp.value = MES_DADOS.porCanal[c.id] ? moeda(MES_DADOS.porCanal[c.id]) : ""; return; }
        const { error } = await sb.from("jb_faturamento")
          .update({ manual: false }).eq("mes", MES).eq("canal_id", c.id);
        if(error){ aviso("mesMsg","Não consegui salvar o " + c.nome + ".","err"); return; }
        MES_DADOS.manualCanal[c.id] = false;
        inp.value = MES_DADOS.porCanal[c.id] ? moeda(MES_DADOS.porCanal[c.id]) : "";
        pintaTag();
        toast(c.nome + " voltou a vir do Nosso Financeiro. O valor atualiza na próxima sincronização.");
        return;
      }
      if(n2 === (MES_DADOS.porCanal[c.id] || 0) && MES_DADOS.manualCanal[c.id]) return;
      const { error } = await sb.from("jb_faturamento")
        .upsert({ mes: MES, canal_id: c.id, valor: n2, manual: true }, { onConflict: "mes,canal_id" });
      if(error){ aviso("mesMsg","Não consegui salvar o " + c.nome + ".","err"); return; }
      MES_DADOS.porCanal[c.id] = n2;
      MES_DADOS.manualCanal[c.id] = true;
      pintaTag();
      atualizarPlacarMes();
      toast(c.nome + " em " + mesLongo(MES) + ": R$ " + moeda(n2) + ".");
    };
    inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
    l.append(n, inp);
    ent.appendChild(l);
    const fatia = c.taxa_efetiva != null ? Number(c.taxa_efetiva)
                : Number(c.taxa || 0) + Number(c.promo || 0);
    explicar(l, c.nome, [
      fatia > 0
        ? "É o repasse do " + c.nome + ": o que caiu na conta, já sem a comissão. Não é o que o cliente pagou."
        : "É o que entrou por esse canal. Sem comissão de aplicativo no meio.",
      "Vem sozinho do Nosso Financeiro, em segundos, da frente confeitaria.",
      "Se você digitar por cima, o seu número passa a valer e a sincronização não mexe mais nele. Para voltar ao automático, apague o campo."
    ], { conta: fatia > 0 && v
          ? "Com a fatia de " + pct(fatia) + ", o cliente pagou por volta de R$ " + moeda(v / (1 - fatia))
          : null });
  });
  const tot = document.createElement("div"); tot.className = "linhaval total";
  const tn = document.createElement("span"); tn.className = "n"; tn.textContent = "Total que entrou";
  const tv = document.createElement("span"); tv.className = "v"; tv.id = "mesTotal"; tv.textContent = "R$ " + moeda(entradas);
  tot.append(tn, tv);
  ent.appendChild(tot);
  explicar(tot, "Total que entrou", [
    "A soma de todos os canais do mês, do jeito que estão acima.",
    "É esse número que entra no placar lá em cima e no cálculo da margem do mês."
  ]);
  const nota1 = document.createElement("p"); nota1.className = "nota-taxa";
  nota1.textContent = "Vem sozinho do Nosso Financeiro em segundos, da frente confeitaria. É o repasse já sem a comissão do app. Se você digitar por cima, o seu número fica e a sincronização não mexe mais nele. Para voltar ao automático, apague o campo.";
  ent.appendChild(nota1);
  box.appendChild(ent);

  // saídas
  const sai = document.createElement("div");
  sai.className = "razaobox";
  const h2 = document.createElement("h3"); h2.textContent = "Saiu no mês";
  sai.appendChild(h2);
  const ls = document.createElement("div"); ls.className = "linhaval";
  const sn = document.createElement("span"); sn.className = "n";
  sn.textContent = "Tudo que saiu";
  const si = document.createElement("input");
  si.className = "q"; si.type = "tel"; si.inputMode = "decimal";
  si.setAttribute("aria-label","Tudo que saiu no mês");
  si.value = MES_DADOS.saidas ? moeda(MES_DADOS.saidas) : "";
  si.placeholder = "0,00";
  si.onblur = async () => {
    const vazio = si.value.trim() === "";
    const n2 = numBR(si.value);
    if(!vazio && n2 == null){ si.value = MES_DADOS.saidas ? moeda(MES_DADOS.saidas) : ""; return; }
    if(vazio){
      if(!MES_DADOS.saidasManual){ si.value = MES_DADOS.saidas ? moeda(MES_DADOS.saidas) : ""; return; }
      if(await salvarMes({ saidas_manual: false })){
        MES_DADOS.saidasManual = false;
        si.value = MES_DADOS.saidas ? moeda(MES_DADOS.saidas) : "";
        toast("As saídas voltaram a vir do Nosso Financeiro.");
      }
      return;
    }
    if(n2 === MES_DADOS.saidas && MES_DADOS.saidasManual) return;
    if(await salvarMes({ saidas: n2, saidas_manual: true })){
      MES_DADOS.saidas = n2; MES_DADOS.saidasManual = true;
      atualizarPlacarMes();
      toast("Saídas de " + mesLongo(MES) + " salvas.");
    }
  };
  si.addEventListener("keydown", e => { if(e.key === "Enter") si.blur(); });
  ls.append(sn, si);
  sai.appendChild(ls);
  const grupos = (MES_DADOS.detalhe && MES_DADOS.detalhe.grupos) || [];
  explicar(ls, "Tudo que saiu", [
    "Todo dinheiro que saiu no mês: os gastos lançados (insumo, mercado, embalagem, gente) e as contas fixas pagas.",
    "Vem do Nosso Financeiro na hora do lançamento. Os grupos logo abaixo mostram cada lançamento.",
    "Não confunda com o custo do produto: aqui é caixa, dinheiro que saiu na data em que saiu. O lucro está na Saúde do negócio."
  ], { conta: grupos.length ? grupos.map(g => g.nome + " " + moeda(g.total)).join(" + ") + " = R$ " + moeda(grupos.reduce((x, g) => x + Number(g.total), 0)) : null });

  /* de onde vem o que saiu: cada grupo abre os lançamentos que formam o número */
  if(grupos.length) sai.appendChild(blocoGruposSaida(grupos));
  const nota2 = document.createElement("p"); nota2.className = "nota-taxa";
  nota2.textContent = "Vem sozinho do Nosso Financeiro: os gastos do mês e as contas fixas pagas" + (MES >= primeiroDia(hojeSP()) ? ", e as que ainda vão vencer neste mês (marcadas como previstas)" : "") + ". Compra no cartão entra pela parcela do mês. Se digitar por cima, o seu número passa a valer.";
  if(MES_DADOS.proLabore){
    const pl2 = document.createElement("p"); pl2.className = "nota-taxa";
    pl2.textContent = "O pró-labore da Jessica, R$ " + moeda(MES_DADOS.proLabore)
      + ", não entra aqui porque não sai da conta. Ele está no custo de cada produto, na aba Preço, porque o trabalho dela tem valor. Aqui é caixa, lá é custo.";
    sai.appendChild(pl2);
  }
  sai.appendChild(nota2);

  if(MES_DADOS.obs){
    const o = document.createElement("p"); o.className = "nota-taxa";
    o.style.borderTop = "1px solid var(--linha)";
    o.style.paddingTop = "10px";
    o.textContent = MES_DADOS.obs;
    sai.appendChild(o);
  }
  box.appendChild(sai);

  const falta = document.createElement("p");
  falta.className = "tip";
  falta.textContent = "Aqui é só o dinheiro de verdade. Se dá lucro, para onde vai cada R$ 100 e quanto precisa vender por dia estão na Saúde do negócio.";
  box.appendChild(falta);
}

/* ============================================================
   OS NÚMEROS QUE SE FAZEM SOZINHOS
   Nada aqui é digitado. Tudo sai das views: giro, contagem, preços,
   custo fixo e o que o Nosso Financeiro empurrou. Se um preço muda na
   aba Preço, esta tela muda junto na próxima abertura.
   ============================================================ */
let MES_KPI = null;    // { atual, anterior, destino, dias }
let MES_TIMER = null;  // enquanto a tela está aberta, ela se recarrega sozinha

function pararRelogioDoMes(){
  if(MES_TIMER){ clearInterval(MES_TIMER); MES_TIMER = null; }
}
function ligarRelogioDoMes(){
  pararRelogioDoMes();
  /* de cinco em cinco minutos, e sempre que o celular volta para a tela:
     é isso que faz o número ficar "vivo" sem ninguém apertar atualizar. */
  MES_TIMER = setInterval(() => {
    if(TELA !== "scMes" || document.hidden) return;
    abrirMes();
  }, 300000);
}
function mesVoltouAoFoco(){
  if(TELA === "scMes" && !document.hidden) abrirMes();
}
document.addEventListener("visibilitychange", mesVoltouAoFoco);

async function carregarKPIs(){
  const ant = mesAnterior(MES);
  const [k, d, dv] = await Promise.all([
    sb.from("jb_kpi_mes").select("*").in("mes",[MES, ant]),
    sb.from("jb_kpi_destino").select("*").in("mes",[MES, ant]),
    sb.from("jb_dia_vendas").select("*").order("data")
  ]);
  const acha = (arr, m) => (arr || []).find(x => x.mes === m) || null;
  MES_KPI = {
    atual:     acha(k.data, MES),
    anterior:  acha(k.data, ant),
    destino:   acha(d.data, MES),
    destAnt:   acha(d.data, ant),
    dias:      dv.data || []
  };
}

/* uma barra deitada: o comprimento é o número, o rótulo fica em cima e sempre aparece */
function barra(alvo, rotulo, valorTexto, fracao, opcoes){
  const o = opcoes || {};
  const b = document.createElement("div");
  b.className = "barra" + (o.destaque ? " destaque" : "") + (o.ruim ? " ruim" : "");
  const cab = document.createElement("div"); cab.className = "cab";
  const esq = document.createElement("span");
  esq.textContent = rotulo;
  if(o.nota){ const sm = document.createElement("small"); sm.textContent = o.nota; esq.appendChild(sm); }
  const dir = document.createElement("b"); dir.textContent = valorTexto;
  cab.append(esq, dir);
  const tr = document.createElement("div"); tr.className = "trilho";
  const p = document.createElement("div"); p.className = "preenche";
  p.style.width = Math.max(0, Math.min(100, fracao * 100)) + "%";
  tr.appendChild(p);
  if(o.depois > 0){
    const d = document.createElement("div"); d.className = "depois";
    d.style.width = Math.max(0, Math.min(100, o.depois * 100)) + "%";
    tr.appendChild(d);
  }
  b.append(cab, tr);
  alvo.appendChild(b);
  return b;
}

/* o gráfico de colunas: uma coluna por dia, e a linha tracejada do que precisa vender */
function colunasPorDia(alvo, dias, meta){
  const L = 34, R = 8, T = 16, B = 18, W = 320, H = 128;
  const larg = W - L - R, alt = H - T - B;
  /* a escala olha só para os dias que valem: um turno ainda aberto mostra a geladeira
     inteira e, se entrasse na conta, achataria todos os outros dias. */
  const bons = dias.filter(d => d.confiavel).map(d => Math.max(0, d.vendeu));
  const maxV = Math.max(meta || 0, ...(bons.length ? bons : dias.map(d => Math.max(0, d.vendeu))), 1);
  const topo = Math.ceil(maxV / 20) * 20;
  const y = v => T + alt - (Math.max(0, v) / topo) * alt;
  const passo = larg / dias.length;
  const lg = Math.min(14, passo * 0.68);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "colunas");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Unidades vendidas por dia nos últimos " + dias.length + " dias.");

  const el = (tag, at) => { const e = document.createElementNS(ns, tag); for(const k in at) e.setAttribute(k, at[k]); return e; };

  // escala: só o topo e o zero, discretos
  [0, topo].forEach(v => {
    const t = el("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end" });
    t.textContent = String(v);
    svg.appendChild(t);
  });
  svg.appendChild(el("line", { class:"base", x1:L, y1:y(0), x2:L+larg, y2:y(0) }));

  dias.forEach((d, i) => {
    const x = L + i * passo + (passo - lg) / 2;
    const v = Math.max(0, d.vendeu);
    const estourou = v > topo;
    const h = Math.max(1, y(0) - y(Math.min(v, topo)));
    const r = el("rect", {
      class: "col" + (d.confiavel ? "" : " fora"),
      x: x.toFixed(1), y: (y(0) - h).toFixed(1),
      width: lg.toFixed(1), height: h.toFixed(1), rx: estourou ? 0 : 2
    });
    const tt = el("title");
    tt.textContent = dataCurta(d.data) + ": " + (d.confiavel ? d.vendeu + " unidades"
      : (d.fechado ? d.vendeu + " na conta, contagem torta, fica fora da média"
                   : "turno ainda aberto, o número ainda não quer dizer nada"));
    r.appendChild(tt);
    svg.appendChild(r);
    /* coluna cortada no topo: um traço para ninguém ler a altura como se fosse o número */
    if(estourou){
      const c = el("path", { class:"corte",
        d: "M" + x.toFixed(1) + " " + (T + 3) + " l" + (lg/3).toFixed(1) + " -3 l" +
            (lg/3).toFixed(1) + " 3 l" + (lg/3).toFixed(1) + " -3" });
      svg.appendChild(c);
    }
  });

  // primeiro e último dia, nas pontas
  if(dias.length){
    const pri = el("text", { x: L, y: H - 5 });
    pri.textContent = dias[0].data.slice(8) + "/" + dias[0].data.slice(5,7);
    const ult = el("text", { x: L + larg, y: H - 5, "text-anchor": "end" });
    ult.textContent = dias[dias.length-1].data.slice(8) + "/" + dias[dias.length-1].data.slice(5,7);
    svg.append(pri, ult);
  }

  if(meta > 0 && meta <= topo){
    svg.appendChild(el("line", { class:"meta", x1:L, y1:y(meta), x2:L+larg, y2:y(meta) }));
    const t = el("text", { class:"metaTx", x: L + 2, y: y(meta) - 4 });
    t.textContent = meta + " para pagar as contas";
    svg.appendChild(t);
  }
  alvo.appendChild(svg);
}

/* ============================================================
   DE ONDE VEM ESSE NÚMERO
   Cada valor da tela ganha um ponto de interrogação. Tocar abre três linhas
   curtas: o que é, de onde sai, e a conta com os números deste mês.
   Uma de cada vez, para a tela não virar um paredão de texto.
   ============================================================ */
let EXP_ABERTA = null;   // { caixa, botao, alvo }

function fecharExplicacao(){
  if(!EXP_ABERTA) return;
  EXP_ABERTA.caixa.classList.add("hide");
  EXP_ABERTA.botao.setAttribute("aria-expanded", "false");
  EXP_ABERTA.alvo.classList.remove("aberta");
  EXP_ABERTA = null;
}

/* alvo: o cartão, a barra ou a linha. opcoes.dentro: onde encostar o "?",
   quando ele não vai direto no alvo. opcoes.conta: a linha da conta, em números. */
function explicar(alvo, titulo, linhas, opcoes){
  const o = opcoes || {};
  const bt = document.createElement("button");
  bt.type = "button"; bt.className = "porque"; bt.textContent = "?";
  bt.setAttribute("aria-label", "De onde vem: " + titulo);
  bt.setAttribute("aria-expanded", "false");

  const cx = document.createElement("div");
  cx.className = "explica hide";
  const h = document.createElement("strong"); h.textContent = titulo;
  cx.appendChild(h);
  (linhas || []).filter(Boolean).forEach(t => {
    const p = document.createElement("p"); p.textContent = t; cx.appendChild(p);
  });
  if(o.conta){
    const c = document.createElement("p"); c.className = "conta"; c.textContent = o.conta;
    cx.appendChild(c);
  }

  const alternar = () => {
    const abrindo = cx.classList.contains("hide");
    fecharExplicacao();
    if(!abrindo) return;
    cx.classList.remove("hide");
    bt.setAttribute("aria-expanded", "true");
    alvo.classList.add("aberta");
    EXP_ABERTA = { caixa: cx, botao: bt, alvo };
  };
  bt.onclick = e => { e.stopPropagation(); alternar(); };

  alvo.classList.add("temexp");
  (o.dentro || alvo).appendChild(bt);
  (o.depois || alvo).insertAdjacentElement("afterend", cx);
  /* Cartão e barra não têm campo para digitar: o toque em qualquer lugar abre. */
  if(o.tudoClicavel) alvo.addEventListener("click", alternar);
  return cx;
}

/* ---- os textos, com os números deste mês dentro ---- */
const rs = v => "R$ " + moeda(v);

function explicarPlacar(cap, entradas, resultado){
  const K = MES_KPI && MES_KPI.atual;
  const ehEste = MES === primeiroDia(hojeSP());
  explicar(cap, resultado >= 0 ? "Sobrou no mês" : "Faltou no mês", [
    "Dinheiro de verdade: o que entrou na conta menos o que saiu dela.",
    "O que entrou vem do Nosso Financeiro, canal por canal, já sem a comissão do app. O que saiu são os gastos e as contas fixas pagas, lançados lá.",
    ehEste ? "O mês ainda não fechou, então esse número ainda vai mudar." : null,
    K && K.pro_labore ? "O pró-labore da Jessica não está aqui porque não sai da conta. Ele está no custo de cada produto." : null
  ], { conta: rs(entradas) + " que entrou − " + rs(MES_DADOS.saidas) + " que saiu = "
             + (resultado < 0 ? "−" : "") + rs(Math.abs(resultado)) });
}

function numeroBR(v){ return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }

function montarKPIs(box){
  /* ---- de onde vem o dinheiro ---- */
  const comDinheiro = CANAIS_MES.filter(c => (MES_DADOS.porCanal[c.id] || 0) > 0);
  if(comDinheiro.length){
    const c = document.createElement("div"); c.className = "graf";
    const h = document.createElement("h3"); h.textContent = "De onde vem o dinheiro";
    const dica = document.createElement("p"); dica.className = "dica";
    dica.textContent = "A barra inteira é o que o cliente pagou. A parte escura é o que caiu na sua conta; o resto ficou com o app.";
    c.append(h, dica);
    const bs = document.createElement("div"); bs.className = "barras";
    const linha = comDinheiro.map(cn => {
      const rep = MES_DADOS.porCanal[cn.id] || 0;
      const fatia = cn.taxa_efetiva != null ? Number(cn.taxa_efetiva)
                  : Number(cn.taxa || 0) + Number(cn.promo || 0);
      const bruto = fatia > 0 && fatia < 1 ? rep / (1 - fatia) : rep;
      return { nome: cn.nome, rep, fatia, bruto };
    }).sort((a,b) => b.bruto - a.bruto);
    const maiorB = Math.max(...linha.map(l => l.bruto), 1);
    linha.forEach(l => {
      const b = barra(bs, l.nome, "R$ " + moeda(l.rep), l.rep / maiorB, {
        depois: (l.bruto - l.rep) / maiorB,
        nota: l.fatia > 0
          ? "O cliente pagou R$ " + moeda(l.bruto) + " e o app ficou com " + pct(l.fatia)
          : "Venda direta, sem comissão"
      });
      const cn = CANAIS_MES.find(c => c.nome === l.nome) || {};
      explicar(b, l.nome, [
        l.fatia > 0
          ? "O valor grande é o repasse: o que caiu na conta depois que o " + l.nome + " tirou a parte dele."
          : "Venda direta, sem comissão de aplicativo. O que o cliente pagou é o que entrou.",
        l.fatia <= 0 ? null
          : cn.taxa_efetiva != null
            ? "A fatia de " + pct(l.fatia) + " foi medida num repasse de verdade, não é a taxa de tabela."
            : "A fatia de " + pct(l.fatia) + " é a de tabela, taxa mais promoção. Ainda não foi conferida num repasse real, então pode estar otimista.",
        "O número vem sozinho do Nosso Financeiro. Para mudar, use o campo em Entrou, por canal, logo abaixo."
      ], {
        dentro: b.querySelector(".cab"), tudoClicavel: true,
        conta: l.fatia > 0
          ? "Cliente pagou " + moeda(l.bruto) + " · app ficou com " + moeda(l.bruto - l.rep) + " · chegou " + moeda(l.rep)
          : null
      });
    });
    c.appendChild(bs);
    box.appendChild(c);
  }

}

/* grupos do que saiu no mês, cada um abre a lista de lançamentos */
function blocoGruposSaida(grupos){
  const box = document.createElement("div"); box.className = "cx-grupos"; box.id = "cxGrupos";
  const h = document.createElement("p"); h.className = "cx-tit"; h.textContent = "Toque num grupo para ver cada lançamento";
  box.appendChild(h);
  grupos.forEach((g, i) => {
    const prev = (g.itens || []).filter(x => x.previsto);
    const linha = document.createElement("button"); linha.type = "button"; linha.className = "cx-grupo"; linha.dataset.grupo = g.nome;
    linha.setAttribute("aria-expanded", "false");
    const n = document.createElement("span"); n.className = "n";
    n.textContent = g.nome;
    const sm = document.createElement("small");
    sm.textContent = (g.itens || []).length + ((g.itens || []).length === 1 ? " lançamento" : " lançamentos") + (prev.length ? ", " + prev.length + " previsto" + (prev.length === 1 ? "" : "s") : "");
    n.appendChild(sm);
    const v = document.createElement("b"); v.textContent = "R$ " + moeda(g.total);
    linha.append(n, v);
    const lista = document.createElement("div"); lista.className = "cx-itens hide";
    (g.itens || []).forEach(x => {
      const l = document.createElement("div"); l.className = "cx-item" + (x.previsto ? " prev" : "");
      const d = document.createElement("span"); d.className = "d"; d.textContent = String(x.data || "").slice(8, 10) + "/" + String(x.data || "").slice(5, 7);
      const t = document.createElement("span"); t.className = "t";
      t.textContent = x.desc || "Sem descrição";
      const det = [x.parcela ? "parcela " + x.parcela : null, x.cartao ? "cartão " + x.cartao : (x.forma && x.forma !== "conta" ? x.forma : null), x.previsto ? "previsto, ainda não pago" : null].filter(Boolean).join(" · ");
      if(det){ const s2 = document.createElement("small"); s2.textContent = det; t.appendChild(s2); }
      const vv = document.createElement("b"); vv.textContent = "R$ " + moeda(x.valor);
      l.append(d, t, vv); lista.appendChild(l);
    });
    linha.onclick = () => { const ab = lista.classList.toggle("hide"); linha.setAttribute("aria-expanded", String(!ab)); };
    box.append(linha, lista);
  });
  return box;
}
