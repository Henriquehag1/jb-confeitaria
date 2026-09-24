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
  const [r, f] = await Promise.all([
    sb.from("jb_resultado_mes").select("*").eq("mes", MES).maybeSingle(),
    sb.from("jb_faturamento").select("canal_id,valor,manual").eq("mes", MES)
  ]);
  const porCanal = {}, manualCanal = {};
  (f.data || []).forEach(x => { porCanal[x.canal_id] = Number(x.valor); manualCanal[x.canal_id] = !!x.manual; });
  MES_DADOS = {
    saidas: r.data ? Number(r.data.saidas) : 0,
    saidasManual: r.data ? !!r.data.saidas_manual : false,
    sincronizadoEm: r.data ? r.data.atualizado_em : null,
    obs: r.data ? r.data.obs : null,
    fixoRef: r.data ? Number(r.data.custo_fixo_referencia) : null,
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
  });
  const tot = document.createElement("div"); tot.className = "linhaval total";
  const tn = document.createElement("span"); tn.className = "n"; tn.textContent = "Total que entrou";
  const tv = document.createElement("span"); tv.className = "v"; tv.id = "mesTotal"; tv.textContent = "R$ " + moeda(entradas);
  tot.append(tn, tv);
  ent.appendChild(tot);
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

  if(MES_DADOS.fixoRef){
    const caixaEsperado = MES_DADOS.fixoRef - (MES_DADOS.proLabore || 0);
    const ref = document.createElement("div"); ref.className = "linhaval leve";
    const rn = document.createElement("span"); rn.className = "n";
    rn.textContent = "Só de conta fixa e gente, o esperado é";
    const rv = document.createElement("span"); rv.className = "v";
    rv.textContent = "R$ " + moeda(caixaEsperado);
    ref.append(rn, rv);
    sai.appendChild(ref);
  }
  const nota2 = document.createElement("p"); nota2.className = "nota-taxa";
  nota2.textContent = "Contas fixas mais os gastos lançados no Nosso Financeiro, atualizado toda segunda. Se digitar por cima, o seu número passa a valer. A linha acima é só para conferir se não esqueceu nada.";
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
  falta.textContent = "Os cartões e os gráficos lá em cima se refazem sozinhos: saem dos preços, da contagem e do custo fixo. Mudou um preço na aba Preço, mudou aqui. O que ainda falta é o lucro separado por canal, que chega quando a contagem tiver mais semanas.";
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

/* um cartão de número, sem enfeite */
function kpiCard(rotulo, numero, sub, tom){
  const c = document.createElement("div"); c.className = "kpi";
  const r = document.createElement("div"); r.className = "rot"; r.textContent = rotulo;
  const n = document.createElement("div"); n.className = "num" + (tom ? " " + tom : ""); n.textContent = numero;
  c.append(r, n);
  if(sub){ const s = document.createElement("div"); s.className = "sub"; s.textContent = sub; c.appendChild(s); }
  return c;
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

function montarKPIs(box){
  const K = MES_KPI && MES_KPI.atual, D = MES_KPI && MES_KPI.destino;
  if(!K) return;

  /* ---- os quatro números ---- */
  const g = document.createElement("div"); g.className = "kpis";

  const porDia = K.unidades_dia == null ? null : Number(K.unidades_dia);
  const eq = K.equilibrio_dia == null ? null : Number(K.equilibrio_dia);
  const fora = Number(K.dias_fora || 0);

  g.appendChild(kpiCard(
    "Vendendo por dia",
    porDia == null ? "sem contagem" : porDia + " un",
    porDia == null ? "Ainda faltam dias de contagem fechada."
      : "Média de " + K.dias_contados + " dia" + (K.dias_contados === 1 ? "" : "s")
        + " de turno fechado" + (fora ? ", fora " + fora + " com contagem torta" : "") + "."
  ));

  if(eq != null){
    const folga = porDia == null ? null : porDia - eq;
    g.appendChild(kpiCard(
      "Precisa vender por dia",
      eq + " un",
      folga == null ? "Só para cobrir a conta fixa do mês."
        : folga >= 0 ? "Está vendendo " + folga + " a mais que isso. É essa a folga."
                     : "Faltam " + (-folga) + " por dia só para empatar.",
      folga == null ? "" : folga >= 0 ? "bom" : "alerta"
    ));
  }

  if(K.contrib_un != null){
    g.appendChild(kpiCard(
      "Cada doce deixa",
      "R$ " + moeda(K.contrib_un),
      "Do preço médio de R$ " + moeda(K.preco_medio) + ", é o que sobra depois do app, do imposto e do ingrediente. Dele saem as contas fixas."
    ));
  }

  if(D){
    const s = Number(D.sobra) * 100;
    const sAnt = MES_KPI.destAnt ? Number(MES_KPI.destAnt.sobra) * 100 : null;
    g.appendChild(kpiCard(
      "Sobra de cada R$ 100",
      "R$ " + moeda(s),
      sAnt == null ? "Depois de tudo, do preço que o cliente paga."
                   : "No mês passado era R$ " + moeda(sAnt) + ".",
      s <= 0 ? "alerta" : s < 5 ? "alerta" : "bom"
    ));
  }
  if(g.children.length) box.appendChild(g);

  /* ---- para onde vai cada R$ 100 ---- */
  if(D){
    const c = document.createElement("div"); c.className = "graf";
    const h = document.createElement("h3"); h.textContent = "Para onde vai cada R$ 100";
    const dica = document.createElement("p"); dica.className = "dica";
    dica.textContent = "Do preço de tabela que o cliente paga. Calculado com a mistura real deste mês: quanto veio de cada app e quanto cada produto girou.";
    c.append(h, dica);
    const bs = document.createElement("div"); bs.className = "barras";
    const sobra = Number(D.sobra);
    const linhas = [
      ["App e promoção",        Number(D.app),         "Comissão mais o desconto que você banca"],
      ["Imposto",               Number(D.imposto),     null],
      ["Ingrediente e embalagem", Number(D.ingrediente), "Já com a perda"],
      ["Conta fixa",            Number(D.custo_fixo),  "Aluguel, gente, pró-labore, tudo dividido pelas unidades"],
      [sobra >= 0 ? "Sobra" : "Falta", sobra,
       sobra >= 0 ? null : "A barra mostra o tamanho do buraco, não uma sobra"]
    ];
    const maior = Math.max(...linhas.map(l => Math.abs(l[1])), 0.01);
    linhas.forEach(([nome, v, nota], i) => {
      const ult = i === linhas.length - 1;
      barra(bs, nome, "R$ " + moeda(v * 100), Math.abs(v) / maior,
            { nota, destaque: ult, ruim: ult && v <= 0 });
    });
    c.appendChild(bs);
    const rod = document.createElement("p"); rod.className = "rodape";
    rod.textContent = "É um retrato do preço, não do extrato. O extrato do mês está logo abaixo.";
    c.appendChild(rod);
    box.appendChild(c);
  }

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
      barra(bs, l.nome, "R$ " + moeda(l.rep), l.rep / maiorB, {
        depois: (l.bruto - l.rep) / maiorB,
        nota: l.fatia > 0
          ? "O cliente pagou R$ " + moeda(l.bruto) + " e o app ficou com " + pct(l.fatia)
          : "Venda direta, sem comissão"
      });
    });
    c.appendChild(bs);
    box.appendChild(c);
  }

  /* ---- unidades por dia ---- */
  const dias = (MES_KPI.dias || []).slice(-21);
  if(dias.length >= 3){
    const c = document.createElement("div"); c.className = "graf";
    const h = document.createElement("h3"); h.textContent = "Unidades por dia";
    const dica = document.createElement("p"); dica.className = "dica";
    dica.textContent = "Cada coluna é um dia de contagem. As claras são dias com turno aberto ou contagem que não fecha: aparecem, mas não entram em nenhuma média.";
    c.append(h, dica);
    colunasPorDia(c, dias, eq);
    const foraN = dias.filter(d => !d.confiavel).length;
    if(foraN){
      const rod = document.createElement("p"); rod.className = "rodape";
      rod.textContent = foraN === 1 ? "Um dia está claro. Vale conferir a contagem dele."
        : foraN + " dias estão claros. Vale conferir a contagem deles.";
      c.appendChild(rod);
    }
    box.appendChild(c);
  }
}
