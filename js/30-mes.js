/* JB OS · resultado do mês, sincronizado com o Nosso Financeiro. */

/* ============================================================
   RESULTADO DO MÊS
   Entradas por canal e saídas do mês, batidos contra o Nosso Financeiro.
   O custo por produto entra aqui quando a contagem tiver rodado.
   ============================================================ */
let MES = null;        // 'aaaa-mm-01'
let MES_DADOS = null;

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
  if(!CANAIS.length){
    const { data } = await sb.from("jb_canal").select("*").order("ordem");
    CANAIS = data || [];
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
  montarMes();
  show("scMes");
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
  const entradas = CANAIS.reduce((s,c) => s + (MES_DADOS.porCanal[c.id] || 0), 0);
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

  const entradas = CANAIS.reduce((s,c) => s + (MES_DADOS.porCanal[c.id] || 0), 0);
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

  // entradas por canal
  const ent = document.createElement("div");
  ent.className = "razaobox";
  const h1 = document.createElement("h3"); h1.textContent = "Entrou, por canal";
  ent.appendChild(h1);
  CANAIS.forEach(c => {
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
  falta.textContent = "Ainda não entra aqui o custo do que foi produzido, produto a produto. Isso chega quando a contagem tiver algumas semanas, e aí dá para dizer qual canal deu lucro, não só o mês inteiro.";
  box.appendChild(falta);
}
