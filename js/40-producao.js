/* JB OS · plano de produção e a receita multiplicada. */

/* ============================================================
   PRODUÇÃO
   A Jessica diz quanto quer de cada receita. Quem produz abre e vê
   a receita já multiplicada, com o passo a passo.
   ============================================================ */
let PROD_DIA = null;      // data escolhida
let PROD_ITENS = [];      // itens do dia
let RECEITAS = null;      // { fichas:[], subs:[] } para o seletor do gestor
let REC = null;           // receita aberta

function diaMais(n){
  const d = new Date(hojeSP() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

/* mostra 1500 g como 1,5 kg e 0,25 kg como 250 g */
function qtdBonita(q, un){
  let v = Number(q), u = (un || "un").toLowerCase();
  if(u === "g"  && v >= 1000){ v = v/1000; u = "kg"; }
  else if(u === "kg" && v <  1){ v = v*1000; u = "g"; }
  else if(u === "ml" && v >= 1000){ v = v/1000; u = "L"; }
  else if(u === "l"  && v <  1){ v = v*1000; u = "ml"; }
  let casas;
  if(u === "g" || u === "ml") casas = 0;
  else if(u === "un") casas = v >= 1 ? 0 : 1;   // ninguém separa meio ovo
  else casas = v < 10 ? 2 : 1;
  let txt = v.toLocaleString("pt-BR",{minimumFractionDigits:0, maximumFractionDigits:casas});
  if(u === "l") u = "L";
  return txt + " " + u;
}

async function abrirProducao(){
  aviso("prodMsg","","");
  if(!PROD_DIA) PROD_DIA = hojeSP();
  const gestor = EU.papel === "gestor";
  $("addProd").classList.toggle("hide", !gestor);
  if(gestor && !RECEITAS){
    const [ff, ss] = await Promise.all([
      sb.from("jb_receita_ficha").select("ficha_id,nome,preparo_conferido").order("nome"),
      sb.from("jb_receita_sub").select("subreceita_id,nome,preparo_conferido").order("nome")
    ]);
    RECEITAS = { fichas: ff.data || [], subs: ss.data || [] };
    montarSeletorProd();
  }
  await carregarDia();
  show("scProd");
}

function montarSeletorProd(){
  const sel = $("addProd");
  sel.innerHTML = '<option value="">+ adicionar receita ao dia</option>';
  const g1 = document.createElement("optgroup"); g1.label = "Produtos";
  RECEITAS.fichas.forEach(f => {
    const o = document.createElement("option");
    o.value = "ficha:" + f.ficha_id; o.textContent = f.nome; g1.appendChild(o);
  });
  const g2 = document.createElement("optgroup"); g2.label = "Massas e recheios";
  RECEITAS.subs.forEach(s => {
    const o = document.createElement("option");
    o.value = "subreceita:" + s.subreceita_id; o.textContent = s.nome; g2.appendChild(o);
  });
  sel.append(g1, g2);
}

async function carregarDia(){
  const box = $("prodLista");
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  montarDiasProducao();
  const { data, error } = await sb.from("jb_producao_dia").select("*").eq("data", PROD_DIA);
  if(error){ box.innerHTML=""; aviso("prodMsg","Não consegui carregar o dia agora.","err"); return; }
  PROD_ITENS = (data || []).sort((a,b) =>
    (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : (a.tipo === "subreceita" ? -1 : 1)));
  montarProdLista();
}

function montarDiasProducao(){
  const box = $("prodDias");
  box.innerHTML = "";
  const dias = EU.papel === "gestor"
    ? [[diaMais(-1),"Ontem"],[diaMais(0),"Hoje"],[diaMais(1),"Amanhã"],[diaMais(2),dataCurta(diaMais(2))]]
    : [[diaMais(0),"Hoje"]];
  dias.forEach(([iso, rot]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = rot;
    b.setAttribute("aria-pressed", String(iso === PROD_DIA));
    b.onclick = () => { PROD_DIA = iso; carregarDia(); };
    box.appendChild(b);
  });
}

function montarProdLista(){
  const box = $("prodLista");
  const gestor = EU.papel === "gestor";
  box.innerHTML = "";

  if(!PROD_ITENS.length){
    const p = document.createElement("p");
    p.className = "tip";
    p.textContent = gestor
      ? "Nada planejado para este dia ainda. Escolha uma receita abaixo e diga a quantidade."
      : "Nada para fazer hoje. A Jessica ainda não montou a lista.";
    box.appendChild(p);
    return;
  }

  PROD_ITENS.forEach(it => {
    const travado = !it.preparo_conferido;   // não bloqueia mais: abre com aviso
    const row = document.createElement("div");
    row.className = "prod" + (it.feito ? " feito" : "");

    const im = imgFoto(it.foto_url);
    if(im) row.appendChild(im);

    const n = document.createElement("button");
    n.type = "button"; n.className = "n";
    n.style.border = "none"; n.style.background = "none"; n.style.textAlign = "left"; n.style.padding = "0";
    n.textContent = it.nome;
    const s = document.createElement("small");
    s.textContent = it.feito ? "Feito às " + horaDe(it.feito_em)
      : travado ? (gestor ? "passo a passo ainda não conferido por você" : "passo a passo ainda não conferido pela Jessica")
      : (it.tipo === "subreceita" ? "massa ou recheio" : "produto pronto");
    n.appendChild(s);
    n.onclick = () => abrirReceita(it);

    row.appendChild(n);

    if(gestor){
      const inp = document.createElement("input");
      inp.className = "q"; inp.type = "tel"; inp.inputMode = "decimal";
      inp.value = String(it.qtd).replace(".",",");
      inp.setAttribute("aria-label","Quantidade de " + it.nome);
      inp.onblur = async () => {
        const v = numBR(inp.value);
        if(v === null || v <= 0){
          if(!confirm("Tirar " + it.nome + " do dia?")){ inp.value = String(it.qtd).replace(".",","); return; }
          const { error } = await sb.from("jb_producao_item").delete().eq("id", it.id);
          if(error){ aviso("prodMsg","Não consegui tirar esse item.","err"); return; }
          carregarDia(); return;
        }
        if(v === Number(it.qtd)) return;
        const { error } = await sb.from("jb_producao_item").update({ qtd: v }).eq("id", it.id);
        if(error){ aviso("prodMsg","Não consegui salvar a quantidade.","err"); return; }
        it.qtd = v;
        aviso("prodMsg", it.nome + ": " + qtdBonita(v, it.unidade) + ".","ok");
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
      const un = document.createElement("span"); un.className = "un"; un.textContent = it.unidade;
      const tirar = document.createElement("button");
      tirar.type = "button"; tirar.className = "tirar";
      tirar.textContent = "tirar";
      tirar.setAttribute("aria-label","Tirar " + it.nome + " do dia");
      tirar.onclick = async () => {
        if(!confirm("Tirar " + it.nome + " do dia " + dataCurta(PROD_DIA) + "?")) return;
        const { error } = await sb.from("jb_producao_item").delete().eq("id", it.id);
        if(error){ aviso("prodMsg","Não consegui tirar esse item.","err"); return; }
        aviso("prodMsg", it.nome + " saiu do dia.","ok");
        carregarDia();
      };
      row.append(inp, un, tirar);
    } else {
      const qt = document.createElement("span"); qt.className = "qt";
      qt.textContent = qtdBonita(it.qtd, it.unidade);
      row.appendChild(qt);
    }
    box.appendChild(row);
  });
}

async function addReceitaAoDia(valor){
  if(!valor) return;
  const [tipo, id] = valor.split(":");
  const { error } = await sb.from("jb_producao_item")
    .insert({ data: PROD_DIA, tipo, ref_id: Number(id), qtd: 1 });
  $("addProd").value = "";
  if(error){
    aviso("prodMsg", String(error.message || "").includes("duplicate")
      ? "Essa receita já está na lista deste dia."
      : "Não consegui adicionar agora.", "warn");
    return;
  }
  await carregarDia();
}

/* ---------- a receita já multiplicada ---------- */
async function abrirReceita(item, escala, voltaPara){
  aviso("recMsg","","");
  const gestor = EU.papel === "gestor";
  let cab, itens, qtdAlvo, rendimento, unidade, tipo, refId;

  if(item.tipo){    // veio do plano do dia
    tipo = item.tipo; refId = item.ref_id; qtdAlvo = Number(item.qtd);
  } else {          // veio de um link de sub-receita dentro de outra receita
    tipo = "subreceita"; refId = item.subreceita_id; qtdAlvo = escala;
  }

  if(tipo === "ficha"){
    const [f, its] = await Promise.all([
      sb.from("jb_receita_ficha").select("*").eq("ficha_id", refId).maybeSingle(),
      sb.from("jb_receita_ficha_item").select("*").eq("ficha_id", refId).order("ordem")
    ]);
    if(!f.data){ aviso("prodMsg","Não consegui abrir essa receita.","err"); return; }
    cab = f.data; itens = its.data || [];
    rendimento = Number(cab.rendimento_un) || 1; unidade = "un";
  } else {
    const [s, its] = await Promise.all([
      sb.from("jb_receita_sub").select("*").eq("subreceita_id", refId).maybeSingle(),
      sb.from("jb_receita_sub_item").select("*").eq("subreceita_id", refId).order("ordem")
    ]);
    if(!s.data){ aviso("prodMsg","Não consegui abrir essa receita.","err"); return; }
    cab = s.data; itens = its.data || [];
    rendimento = Number(cab.rendimento_kg) || 1; unidade = "kg";
  }

  /* Receita não conferida abre mesmo assim, com a faixa de aviso: bloquear a Eliana
     em 100% das receitas era pior do que avisar. */
  REC = { item: item.id ? item : null, tipo, refId, cab, itens, rendimento, unidade, qtdAlvo,
          origemItem: item, voltaPara: voltaPara || null };
  montarReceita();
  show("scReceita");
}

function montarReceita(){
  const { cab, itens, rendimento, unidade, qtdAlvo } = REC;
  const fator = qtdAlvo / rendimento;

  $("recSub").textContent = "a receita original rende " + qtdBonita(rendimento, unidade)
    + (fator !== 1 ? ", as quantidades abaixo já estão ajustadas" : "");

  const box = $("recCorpo");
  box.innerHTML = "";

  const foto = imgFoto(cab.foto_url, "g");
  if(foto) box.appendChild(foto);

  const alvo = document.createElement("div");
  alvo.className = "rendebox";
  const k = document.createElement("span"); k.className = "k"; k.textContent = "Fazer hoje";
  const v = document.createElement("span"); v.className = "v";
  v.textContent = qtdBonita(qtdAlvo, unidade);
  alvo.append(k, v);
  box.appendChild(alvo);

  const bIng = document.createElement("div"); bIng.className = "recbloco";
  const h1 = document.createElement("h3"); h1.textContent = "Separe";
  bIng.appendChild(h1);
  itens.forEach(it => {
    const l = document.createElement("div"); l.className = "recing";
    if(it.e_subreceita){
      const b = document.createElement("button");
      b.type = "button"; b.textContent = it.ingrediente;
      b.onclick = () => abrirReceita({ subreceita_id: it.subreceita_id },
                                     Number(it.qtd) * fator * (String(it.unidade).toLowerCase() === "g" ? 0.001 : 1),
                                     { origemItem: REC.origemItem, qtdAlvo: REC.qtdAlvo, voltaPara: REC.voltaPara });
      l.appendChild(b);
    } else {
      const n = document.createElement("span"); n.textContent = it.ingrediente;
      l.appendChild(n);
    }
    const q = document.createElement("span"); q.className = "q";
    q.textContent = it.qtd === null ? "sem quantidade" : qtdBonita(Number(it.qtd) * fator, it.unidade);
    l.appendChild(q);
    bIng.appendChild(l);
  });
  box.appendChild(bIng);

  const bPas = document.createElement("div"); bPas.className = "recbloco";
  const h2 = document.createElement("h3"); h2.textContent = "Passo a passo";
  bPas.appendChild(h2);
  const passos = (cab.modo_preparo || "").split("\n").map(s => s.trim()).filter(Boolean);
  if(!passos.length){
    const p = document.createElement("p"); p.className = "tip"; p.style.margin = "0";
    p.textContent = "Esta receita ainda não tem passo a passo escrito.";
    bPas.appendChild(p);
  } else {
    passos.forEach((t, i) => {
      const l = document.createElement("div"); l.className = "passo";
      const n = document.createElement("span"); n.className = "n"; n.textContent = String(i+1);
      const s = document.createElement("span"); s.textContent = t.replace(/^\d+[).\-\s]+/,"");
      l.append(n, s);
      bPas.appendChild(l);
    });
  }
  box.appendChild(bPas);

  if(!cab.preparo_conferido){
    const av = document.createElement("div");
    av.className = "msg warn"; av.style.margin = "0 0 14px";
    av.textContent = EU.papel === "gestor"
      ? "Passo a passo ainda não conferido. Abra a ficha em Custos e marque Conferi quando revisar."
      : "Passo a passo ainda não conferido pela Jessica. Os ingredientes e quantidades valem; se algo parecer estranho no preparo, confirme com ela.";
    box.appendChild(av);
  }

  const btn = $("btnRecFeito");
  btn.classList.toggle("hide", !REC.item);
  btn.disabled = false;
  btn.textContent = REC.item && REC.item.feito ? "Desmarcar, ainda não fiz" : "Marcar como feito";
  btn.classList.toggle("desfazer", !!(REC.item && REC.item.feito));
}

async function marcarFeito(){
  if(!REC || !REC.item) return;
  const btn = $("btnRecFeito");
  const desmarcando = !!REC.item.feito;
  const rotulo = desmarcando ? "Desmarcar, ainda não fiz" : "Marcar como feito";
  btn.disabled = true; btn.textContent = "Salvando...";
  const { error } = await sb.rpc("jb_marcar_producao",
    { p_id: REC.item.id, p_feito: !desmarcando });
  if(error){
    aviso("recMsg","Não consegui salvar agora. Tente de novo.","err");
    btn.disabled = false; btn.textContent = rotulo;
    return;
  }
  await carregarDia();
  aviso("prodMsg", REC.cab.nome + (desmarcando ? " voltou para a lista." : " marcado como feito."),"ok");
  show("scProd");
}

function horaDe(ts){
  return new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}
