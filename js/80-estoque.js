/* JB OS · estoque de insumo: contagem semanal e lista de compra.

   A ideia em uma frase: ninguém dá baixa de grama em grama. A pessoa conta o que
   vê na prateleira uma vez por semana, e o sistema tira o resto da diferença
   entre duas contagens.

       consumo do período = saldo anterior + o que foi comprado − saldo de agora

   Enquanto não existirem duas contagens fechadas, o consumo vem do campo
   consumo_semana_manual, que foi calculado a partir das fichas e do giro.
   ============================================================ */

let EST      = null;   // { linhas, contagem, itens }
let EST_ABA  = "contar";
let EST_SALVANDO = {}; // insumo_id -> timer do debounce

const LOCAIS = [
  { chave: "secos",          titulo: "Prateleira de secos" },
  { chave: "geladeira",      titulo: "Geladeira e freezer" },
  { chave: "embalagem",      titulo: "Armário de embalagem" },
  { chave: "limpeza",        titulo: "Limpeza e consumo" },
  { chave: "sem prateleira", titulo: "Sem prateleira definida" }
];

/* número curto: 3 vira "3", 3,5 vira "3,5", 0,975 vira "0,975" */
function nQtd(v){
  if(v == null || !isFinite(v)) return "";
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

/* ============================================================
   CARGA
   ============================================================ */
async function abrirEstoque(){
  show("scEstoque");
  aviso("estMsg","","");
  $("estLista").innerHTML = "";
  $("estCab").innerHTML = "";
  await carregarEstoque();
  montarEstoque();
}

async function carregarEstoque(){
  EST = { linhas: [], contagem: null, itens: {} };
  try {
    const [sug, abertas] = await Promise.all([
      sb.from("jb_estoque_sugestao").select("*"),
      sb.from("jb_estoque_contagem").select("*").eq("fechada", false).order("data", { ascending: false }).limit(1)
    ]);
    if(sug.error) throw sug.error;
    EST.linhas = sug.data || [];
    EST.contagem = (abertas.data && abertas.data[0]) || null;

    if(EST.contagem){
      const { data } = await sb.from("jb_estoque_item")
        .select("insumo_id,qtd_emb,qtd_base,validade,obs")
        .eq("contagem_id", EST.contagem.id);
      (data || []).forEach(it => { EST.itens[it.insumo_id] = it; });
    }
  } catch(e){
    aviso("estMsg","Não consegui carregar o estoque. Puxe para atualizar.","err");
  }
}

/* abre a contagem da semana quando a pessoa digita o primeiro número */
async function garantirContagem(){
  if(EST.contagem) return EST.contagem;
  const { data, error } = await sb.from("jb_estoque_contagem")
    .insert({ data: hojeSP(), fechada: false, nome_responsavel: EU ? EU.nome : null })
    .select().single();
  if(error){
    // já existe uma contagem nesta data: usa ela
    const { data: achada } = await sb.from("jb_estoque_contagem")
      .select("*").eq("data", hojeSP()).single();
    EST.contagem = achada || null;
  } else {
    EST.contagem = data;
  }
  return EST.contagem;
}

/* ============================================================
   MONTAGEM
   ============================================================ */
function montarEstoque(){
  $("abaEstContar").setAttribute("aria-pressed", EST_ABA === "contar");
  $("abaEstComprar").setAttribute("aria-pressed", EST_ABA === "comprar");
  if(EST_ABA === "contar") montarContagemEstoque();
  else montarCompras();
}

function trocarAbaEstoque(aba){
  EST_ABA = aba;
  aviso("estMsg","","");
  atualizarNav();
  montarEstoque();
}

/* ---------- aba contagem ---------- */
function montarContagemEstoque(){
  const cab = $("estCab");
  const box = $("estLista");
  cab.innerHTML = "";
  box.innerHTML = "";

  if(!EST.linhas.length){
    aviso("estMsg","Nenhum insumo está marcado para entrar na contagem ainda.","ok");
    $("estFoot").classList.add("hide");
    return;
  }

  const c = document.createElement("div");
  c.className = "placar";
  const g = document.createElement("div");
  g.className = "g";
  const feitos = EST.linhas.filter(l => EST.itens[l.insumo_id] != null).length;
  g.textContent = feitos + " de " + EST.linhas.length;
  const p = document.createElement("p");
  p.textContent = EST.contagem
    ? "Contagem de " + dataLonga(EST.contagem.data) + ", ainda aberta. Dá para parar e voltar depois."
    : "Conte o que está na prateleira. A contagem abre sozinha quando você digitar o primeiro número.";
  c.append(g, p);
  cab.appendChild(c);

  LOCAIS.forEach(loc => {
    const doLocal = EST.linhas.filter(l => (l.local || "sem prateleira") === loc.chave);
    if(!doLocal.length) return;

    const h = document.createElement("div");
    h.className = "grupotar";
    h.textContent = loc.titulo;
    box.appendChild(h);

    doLocal
      .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .forEach(l => box.appendChild(linhaEstoque(l)));
  });

  $("estFoot").classList.toggle("hide", !EST.contagem);
  $("btnEstFechar").textContent = "Fechar a contagem de " + (EST.contagem ? dataCurta(EST.contagem.data) : "hoje");
}

function linhaEstoque(l){
  const row = document.createElement("div");
  row.className = "item";
  const it = EST.itens[l.insumo_id];
  if(it) row.classList.add("filled");

  const im = imgFoto(l.foto_url);
  if(im) row.appendChild(im);

  const nome = document.createElement("div");
  nome.className = "nome";
  nome.textContent = l.nome;

  const base = document.createElement("span");
  base.className = "base";
  nome.appendChild(base);
  row.appendChild(nome);

  const porEmb = l.emb_qtd != null && Number(l.emb_qtd) > 0;
  const passo  = porEmb ? 0.5 : 1;

  const pintarBase = () => {
    const v = EST.itens[l.insumo_id] ? Number(EST.itens[l.insumo_id].qtd_base) : null;
    const partes = [];
    if(porEmb) partes.push(l.emb_nome || "embalagem");
    else partes.push("em " + (l.unidade || "un"));

    const esperado = esperadoHoje(l);
    if(esperado != null) partes.push("esperado " + nQtd(esperado) + " " + (l.unidade || "un"));
    if(v != null && porEmb) partes.push("dá " + nQtd(v) + " " + (l.unidade || "un"));
    base.textContent = partes.join(" · ");
    base.classList.toggle("falta", esperado != null && v != null && v < esperado * 0.6);
  };

  const step = document.createElement("div");
  step.className = "step";

  const menos = document.createElement("button");
  menos.type = "button"; menos.textContent = "−";
  menos.setAttribute("aria-label", "Menos em " + l.nome);

  const inp = document.createElement("input");
  inp.type = "text"; inp.inputMode = "decimal"; inp.maxLength = 6;
  inp.setAttribute("aria-label", l.nome);
  if(it && it.qtd_emb != null) inp.value = nQtd(it.qtd_emb);

  const mais = document.createElement("button");
  mais.type = "button"; mais.textContent = "+";
  mais.setAttribute("aria-label", "Mais em " + l.nome);

  const set = v => {
    if(v == null || !isFinite(v) || v < 0) v = 0;
    v = Math.round(v * 1000) / 1000;
    inp.value = nQtd(v);
    const base_un = porEmb ? Math.round(v * Number(l.emb_qtd) * 1000) / 1000 : v;
    EST.itens[l.insumo_id] = { insumo_id: l.insumo_id, qtd_emb: v, qtd_base: base_un };
    row.classList.add("filled");
    pintarBase();
    agendarSalvar(l.insumo_id, v, base_un);
    atualizarContadorEstoque();
  };

  const lido = () => {
    const t = String(inp.value || "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(t);
    return isFinite(n) ? n : null;
  };

  menos.onclick = () => set((lido() || 0) - passo);
  mais.onclick  = () => set((lido() || 0) + passo);
  inp.addEventListener("change", () => { const n = lido(); if(n != null) set(n); });

  step.append(menos, inp, mais);
  row.appendChild(step);
  pintarBase();
  return row;
}

/* Quanto deveria ter hoje: o saldo da última contagem menos o consumo do tempo
   que passou. Serve só para a pessoa desconfiar quando conta muito diferente. */
function esperadoHoje(l){
  if(l.saldo == null || l.consumo_semana == null) return null;
  if(!l.contado_em) return null;
  const d1 = new Date(l.contado_em + "T12:00:00Z").getTime();
  const d2 = new Date(hojeSP() + "T12:00:00Z").getTime();
  const dias = Math.max((d2 - d1) / 86400000, 0);
  const e = Number(l.saldo) - Number(l.consumo_semana) * dias / 7;
  return Math.max(Math.round(e * 100) / 100, 0);
}

function atualizarContadorEstoque(){
  const g = $("estCab").querySelector(".g");
  if(!g) return;
  const feitos = EST.linhas.filter(l => EST.itens[l.insumo_id] != null).length;
  g.textContent = feitos + " de " + EST.linhas.length;
  $("estFoot").classList.toggle("hide", !EST.contagem);
}

/* grava depois de meio segundo parado: não manda um insert a cada toque no + */
function agendarSalvar(insumo_id, qtd_emb, qtd_base){
  clearTimeout(EST_SALVANDO[insumo_id]);
  EST_SALVANDO[insumo_id] = setTimeout(() => salvarItemEstoque(insumo_id, qtd_emb, qtd_base), 500);
}

async function salvarItemEstoque(insumo_id, qtd_emb, qtd_base){
  try {
    const c = await garantirContagem();
    if(!c){ aviso("estMsg","Não consegui abrir a contagem.","err"); return; }
    const { error } = await sb.from("jb_estoque_item")
      .upsert({ contagem_id: c.id, insumo_id, qtd_emb, qtd_base }, { onConflict: "contagem_id,insumo_id" });
    if(error) throw error;
    aviso("estMsg","","");
    atualizarContadorEstoque();   // a contagem só existe depois da primeira gravação
  } catch(e){
    aviso("estMsg","Não consegui gravar esse item. Confira a internet e toque de novo.","err");
  }
}

async function fecharContagemEstoque(){
  if(!EST.contagem) return;
  const faltam = EST.linhas.filter(l => EST.itens[l.insumo_id] == null).length;
  if(faltam > 0){
    const ok = confirm("Faltam " + faltam + (faltam === 1 ? " item" : " itens") + " sem contar. Fechar assim mesmo?");
    if(!ok) return;
  }
  try {
    const { error } = await sb.from("jb_estoque_contagem")
      .update({ fechada: true, fechada_em: new Date().toISOString() })
      .eq("id", EST.contagem.id);
    if(error) throw error;
    toast("Contagem fechada");
    EST_ABA = "comprar";
    await carregarEstoque();
    atualizarNav();
    montarEstoque();
  } catch(e){
    aviso("estMsg","Não consegui fechar a contagem.","err");
  }
}

/* ---------- aba o que comprar ---------- */
function montarCompras(){
  const cab = $("estCab");
  const box = $("estLista");
  cab.innerHTML = "";
  box.innerHTML = "";
  $("estFoot").classList.add("hide");

  const linhas = EST.linhas.slice();
  const semContagem = linhas.every(l => l.contado_em == null);

  const parado = linhas.reduce((s,l) => s + Number(l.valor_parado || 0), 0);
  const aComprar = linhas.reduce((s,l) => s + Number(l.custo_da_compra || 0), 0);

  const c = document.createElement("div");
  c.className = "placar";
  const g = document.createElement("div");
  g.className = "g";
  g.textContent = "R$ " + moeda(parado);
  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = "parado na prateleira";
  const p = document.createElement("p");
  p.textContent = semContagem
    ? "Ainda não há contagem fechada, então o saldo é zero e tudo aparece como a comprar. O consumo por semana veio das fichas e do giro."
    : "Comprar tudo o que está na lista custa cerca de R$ " + moeda(aComprar) + ".";
  c.append(g, sub, p);
  cab.appendChild(c);

  /* urgente primeiro: quem dura menos */
  const ordem = l => (l.dura_semanas == null ? 999 : Number(l.dura_semanas));
  const comprar = linhas.filter(l => Number(l.comprar_emb || 0) > 0 || Number(l.falta || 0) > 0)
                        .sort((a,b) => ordem(a) - ordem(b));
  const ok = linhas.filter(l => !(Number(l.comprar_emb || 0) > 0 || Number(l.falta || 0) > 0))
                   .sort((a,b) => ordem(a) - ordem(b));

  if(comprar.length){
    const h = document.createElement("div");
    h.className = "grupotar urgente";
    h.textContent = "Comprar";
    box.appendChild(h);
    comprar.forEach(l => box.appendChild(linhaCompra(l)));

    const btn = document.createElement("button");
    btn.className = "verfeitas";
    btn.type = "button";
    btn.textContent = "Copiar a lista para mandar no WhatsApp";
    btn.onclick = () => copiarListaCompra(comprar);
    box.appendChild(btn);
  }

  if(ok.length){
    const h = document.createElement("div");
    h.className = "grupotar";
    h.textContent = "Tem o bastante";
    box.appendChild(h);
    ok.forEach(l => box.appendChild(linhaCompra(l)));
  }

  const pe = document.createElement("p");
  pe.className = "promo-pe";
  pe.textContent = "A conta é saldo contado, mais o que foi comprado depois, dividido pelo consumo por semana. "
    + "A meta de cobertura de cada item está em Custos e preços, na aba Insumos.";
  box.appendChild(pe);
}

function linhaCompra(l){
  const row = document.createElement("div");
  row.className = "promo-ln";
  const dura = l.dura_semanas == null ? null : Number(l.dura_semanas);
  if(dura != null){
    if(dura < 1) row.classList.add("fora");
    else if(dura < Number(l.cobertura_semanas || 2)) row.classList.add("limite");
    else row.classList.add("ok");
  }

  const im = imgFoto(l.foto_url);
  if(im) row.appendChild(im);

  const esq = document.createElement("div");
  esq.className = "tx";
  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = l.nome;

  const sb2 = document.createElement("span");
  sb2.className = "sub";
  const partes = [];
  partes.push("tem " + nQtd(l.saldo) + " " + (l.unidade || "un"));
  if(l.consumo_semana != null) partes.push("gasta " + nQtd(l.consumo_semana) + " por semana");
  if(l.origem_consumo === "estimado") partes.push("consumo estimado");
  if(l.origem_consumo === "sem base") partes.push("sem base de consumo");
  if(l.fornecedor) partes.push(l.fornecedor);
  sb2.textContent = partes.join(" · ");

  esq.append(nm, sb2);
  row.appendChild(esq);

  const vl = document.createElement("span");
  vl.className = "vl";
  if(Number(l.comprar_emb || 0) > 0){
    vl.textContent = nQtd(l.comprar_emb) + "×";
    vl.title = l.emb_nome || "";
  } else if(Number(l.falta || 0) > 0){
    vl.textContent = nQtd(l.falta) + " " + (l.unidade || "un");
  } else if(dura != null){
    vl.textContent = nQtd(dura) + " sem";
  } else {
    vl.textContent = "—";
  }
  row.appendChild(vl);
  return row;
}

function textoDaLista(linhas){
  const porForn = {};
  linhas.forEach(l => {
    const f = l.fornecedor || "Sem fornecedor";
    (porForn[f] = porForn[f] || []).push(l);
  });
  const out = ["Lista de compra da JB, " + dataCurta(hojeSP()), ""];
  Object.keys(porForn).sort((a,b) => a.localeCompare(b,"pt-BR")).forEach(f => {
    out.push(f.toUpperCase());
    porForn[f].forEach(l => {
      const q = Number(l.comprar_emb || 0) > 0
        ? nQtd(l.comprar_emb) + " " + (l.emb_nome || "un")
        : nQtd(l.falta) + " " + (l.unidade || "un");
      out.push("- " + l.nome + ": " + q);
    });
    out.push("");
  });
  return out.join("\n").trim();
}

async function copiarListaCompra(linhas){
  const txt = textoDaLista(linhas);
  try {
    await navigator.clipboard.writeText(txt);
    toast("Lista copiada");
  } catch(e){
    aviso("estMsg", txt, "ok");
  }
}
