/* JB OS · contagem de turno, resultado do dia, turno fechado, adendo e histórico. */

/* ============================================================
   CONTAGEM
   ============================================================ */
async function abrirContagem(momento, modo){
  MOMENTO = momento;
  VALORES = {};
  BASE = {};
  MODO = "contar";

  if(!PRODUTOS_OK || !PRODUTOS.length){
    /* Sem a lista de itens a contagem abriria vazia e salvaria zeros. Melhor parar aqui. */
    await recarregarProdutos();
    if(!PRODUTOS_OK || !PRODUTOS.length){
      aviso("homeMsg","Não consegui carregar a lista da geladeira. Confira o sinal e toque em atualizar.","err");
      show("scHome");
      return;
    }
  }

  const existente = CONTAGEM_HOJE[momento];
  /* A Jessica abre a loja, conta o que deixou pronto e, durante o dia, vai repondo.
     Por isso reabrir a abertura cai no modo repor: ela digita só o que está colocando
     agora e o app soma com o que já estava. Corrigir a contagem é o outro botão. */
  if(existente && momento === "abertura") MODO = modo === "contar" ? "contar" : "repor";
  const rascunho = localStorage.getItem(rascunhoKey());
  if(existente){
    const { data, error } = await sb.from("jb_contagem_item").select("produto_id,qtd").eq("contagem_id", existente.id);
    if(error){
      /* Corrigir sem enxergar o que já foi salvo gravaria zeros por cima dos números reais. */
      aviso("homeMsg","Não consegui abrir a contagem salva agora. Tente de novo quando o sinal voltar.","err");
      show("scHome");
      return;
    }
    (data || []).forEach(i => BASE[i.produto_id] = i.qtd);
    if(MODO !== "repor") VALORES = { ...BASE };
    /* Se ficou um rascunho não enviado, ele vale mais que o banco. */
    if(rascunho){
      try {
        const r = JSON.parse(rascunho);
        if(r && Object.keys(r).length){ VALORES = r; }
      } catch(e){}
    }
  } else if(rascunho){
    try { VALORES = JSON.parse(rascunho); } catch(e){}
  }

  /* A lista desta contagem. No fechamento do gestor, um item tirado da geladeira
     no meio do dia continua aparecendo, senão a conta diria que ele saiu inteiro. */
  LISTA = PRODUTOS.slice();
  if(momento === "fechamento" && CONTAGEM_HOJE.abertura && EU.papel === "gestor"){
    try {
      const { data: ab } = await sb.from("jb_contagem_item").select("produto_id").eq("contagem_id", CONTAGEM_HOJE.abertura.id);
      const faltam = (ab || []).map(i => i.produto_id).filter(id => !PRODUTOS.some(p => p.id === id));
      if(faltam.length){
        const { data: ex } = await sb.from("jb_produto_app").select("id,nome,ordem,foto_url").in("id", faltam);
        (ex || []).forEach(p => LISTA.push({ ...p, nome: p.nome + " (saiu da lista hoje)" }));
      }
    } catch(e){}
  }

  $("countData").textContent = dataLonga(diaDoTurno());
  const recuperado = rascunho && Object.keys(VALORES).length;
  aviso("countMsg",
    MODO === "repor"
      ? (recuperado ? "Recuperei a reposição que você não tinha conseguido enviar."
                    : "Digite só o que você está colocando na geladeira agora. O app soma com o que já estava.")
    : existente ? (recuperado ? "Recuperei a correção que você não tinha conseguido enviar."
                              : "Você está corrigindo uma contagem já salva. O número é o total que fica na geladeira.")
    : (Object.keys(VALORES).length ? "Recuperei o que você já tinha digitado." : ""),
    MODO === "repor" ? "ok" : existente ? "warn" : "ok");

  EDIT_LISTA = false;
  await montarLista();
  show("scCount");
}

/* Troca entre repor e corrigir sem sair da tela. Cada modo tem o seu rascunho,
   então o que foi digitado em um não vaza para o outro. */
function trocarModo(m){
  if(MODO === m) return;
  abrirContagem(MOMENTO, m);
}

/* A Jessica arruma a lista sem sair da contagem: mesmo editor da aba Geladeira,
   dentro da tela. Só gestor vê o botão, e o banco só aceita gestor de qualquer jeito. */
let EDIT_LISTA = false;

async function alternarEdicaoLista(){
  EDIT_LISTA = !EDIT_LISTA;
  aviso("countMsg","","");
  await montarLista();
  atualizarNav();
  window.scrollTo(0,0);
}

async function montarLista(){
  const gestor = EU && EU.papel === "gestor";
  const repor = MODO === "repor";
  const bt = $("btnEditarLista");
  bt.classList.toggle("hide", !gestor);
  bt.textContent = EDIT_LISTA ? "Pronto, voltar a contar" : "Faltou item? Editar a lista";
  bt.setAttribute("aria-pressed", String(EDIT_LISTA));
  $("countProg").classList.toggle("hide", EDIT_LISTA);
  $("countBarra").classList.toggle("hide", EDIT_LISTA || repor);
  /* Os dois modos só existem quando a contagem de abertura já foi salva. */
  const temModos = MOMENTO === "abertura" && !!(CONTAGEM_HOJE && CONTAGEM_HOJE.abertura) && !EDIT_LISTA;
  $("countModos").classList.toggle("hide", !temModos);
  $("btnModoRepor").setAttribute("aria-pressed", String(repor));
  $("btnModoContar").setAttribute("aria-pressed", String(!repor));
  document.querySelector("#scCount .foot").classList.toggle("hide", EDIT_LISTA);

  if(EDIT_LISTA){
    await editorDaLista($("countList"), "countMsg", () => montarLista());
    return;
  }

  const box = $("countList");
  box.innerHTML = "";
  LISTA.forEach(p => {
    const row = document.createElement("div");
    row.className = "item";
    row.dataset.pid = p.id;

    const im = imgFoto(p.foto_url);
    if(im) row.appendChild(im);

    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = p.nome;
    row.appendChild(nome);

    /* No modo repor, cada linha mostra o que já tem e no que vai ficar. */
    let base = null;
    const temNaGeladeira = BASE[p.id] || 0;
    if(repor){
      base = document.createElement("span");
      base.className = "base";
      nome.appendChild(base);
    }
    const pintarBase = () => {
      if(!base) return;
      const add = VALORES[p.id] || 0;
      base.textContent = add > 0
        ? "tem " + temNaGeladeira + ", fica " + (temNaGeladeira + add)
        : "tem " + temNaGeladeira + " na geladeira";
    };

    const step = document.createElement("div");
    step.className = "step";

    const menos = document.createElement("button");
    menos.type = "button"; menos.textContent = "−"; menos.setAttribute("aria-label","Menos um " + p.nome);

    const inp = document.createElement("input");
    inp.type = "tel"; inp.inputMode = "numeric"; inp.maxLength = 3;
    inp.setAttribute("aria-label", p.nome);
    if(VALORES[p.id] !== undefined) inp.value = VALORES[p.id];

    const mais = document.createElement("button");
    mais.type = "button"; mais.textContent = "+"; mais.setAttribute("aria-label","Mais um " + p.nome);

    const set = v => {
      v = Math.max(0, Math.min(999, v));
      inp.value = v; VALORES[p.id] = v; salvarRascunho(); pintarBase(); pintar();
    };
    menos.onclick = () => set((parseInt(inp.value,10) || 0) - 1);
    mais.onclick  = () => set((parseInt(inp.value,10) || 0) + 1);
    inp.oninput = () => {
      inp.value = inp.value.replace(/\D/g,"").slice(0,3);
      if(inp.value === "") delete VALORES[p.id];
      else VALORES[p.id] = parseInt(inp.value,10);
      salvarRascunho(); pintarBase(); pintar();
    };
    inp.onfocus = () => inp.select();
    inp.onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); proximoCampo(inp); } };

    step.append(menos, inp, mais);
    row.appendChild(step);
    box.appendChild(row);
    pintarBase();
  });
  pintar();
}

function salvarRascunho(){
  try { localStorage.setItem(rascunhoKey(), JSON.stringify(VALORES)); } catch(e){}
}

/* Enter no teclado numérico pula para o próximo item; no último, vai para o botão de salvar. */
function proximoCampo(inp){
  const todos = [...inp.closest("section").querySelectorAll(".item .step input")];
  const i = todos.indexOf(inp);
  if(i >= 0 && i < todos.length - 1){ todos[i+1].focus(); return; }
  inp.blur();
  const foot = inp.closest("section").querySelector(".foot button");
  if(foot) foot.scrollIntoView({ block: "center" });
}

function pintar(){
  const repor = MODO === "repor";
  let n = 0;
  document.querySelectorAll("#countList .item").forEach(row => {
    const pid = Number(row.dataset.pid);
    const ok = repor ? (VALORES[pid] > 0) : (VALORES[pid] !== undefined);
    row.classList.toggle("filled", ok);
    if(ok) n++;
  });
  const total = LISTA.length;
  if(repor){
    $("countProg").textContent = n ? (n === 1 ? "1 item reposto" : n + " itens repostos") : "nada ainda";
    $("btnSalvar").disabled = n === 0;
    $("btnSalvar").textContent = n === 0 ? "Digite o que você repôs" : "Somar à geladeira";
    return;
  }
  $("countProg").textContent = n + " de " + total;
  $("countBar").style.width = (total ? (n/total*100) : 0) + "%";
  $("btnSalvar").disabled = n === 0;
  $("btnSalvar").textContent = n < total ? "Salvar (" + (total-n) + " em branco)" : "Salvar contagem";
}

async function salvar(){
  const btn = $("btnSalvar");
  const rotulo = btn.textContent;
  const repor = MODO === "repor";
  btn.disabled = true; btn.textContent = "Salvando...";

  const faltam = repor ? [] : LISTA.filter(p => VALORES[p.id] === undefined);
  if(faltam.length){
    const ok = confirm(faltam.length + " produto(s) ficaram em branco e vão contar como zero. Salvar assim?");
    if(!ok){ btn.disabled = false; btn.textContent = rotulo; return; }
    faltam.forEach(p => VALORES[p.id] = 0);
  }

  try{
    /* Cabeçalho e itens vão juntos, numa transação no banco. Se a rede cair no meio,
       nada fica pela metade, e tentar de novo funciona. */
    /* Repondo: o que vai para o banco é o total, o que já estava mais o que entrou agora.
       Assim a conta do turno continua certa (deixei menos sobrou é o que saiu). */
    const itens = LISTA.map(p => ({
      produto_id: p.id,
      qtd: repor ? Math.min(999, (BASE[p.id] || 0) + (VALORES[p.id] || 0)) : (VALORES[p.id] || 0)
    }));
    const { data: id, error } = await sb.rpc("jb_salvar_contagem",
      { p_data: diaDoTurno(), p_momento: MOMENTO, p_itens: itens });
    if(error) throw error;
    CONTAGEM_HOJE[MOMENTO] = CONTAGEM_HOJE[MOMENTO] || { id, data: diaDoTurno(), momento: MOMENTO,
      registrado_por: EU.user_id, nome_responsavel: EU.nome, criado_em: new Date().toISOString() };

    localStorage.removeItem(rascunhoKey());

    if(MOMENTO === "fechamento"){
      /* A equipe vê só a confirmação. Os números do que saiu só existem
         porque comparam com a contagem da Jessica, e são coisa de gestor. */
      if(EU.papel === "gestor") await mostrarResultado(diaDoTurno());
      else await mostrarFeito(diaDoTurno());
    }
    else if(repor){
      const quantos = LISTA.filter(p => VALORES[p.id] > 0).length;
      const naGeladeira = itens.reduce((s,i) => s + i.qtd, 0);
      await carregarHome();
      aviso("homeMsg", "Reposição somada: " + quantos + (quantos === 1 ? " item" : " itens") +
        ". A geladeira agora tem " + naGeladeira + (naGeladeira === 1 ? " item." : " itens."), "ok");
    }
    else { await carregarHome(); aviso("homeMsg","Contagem de abertura salva.","ok"); }
  } catch(err){
    btn.disabled = false; btn.textContent = rotulo;
    const semPermissao = err && (err.code === "42501" || /permission|policy|sem acesso/i.test(err.message || ""));
    aviso("countMsg", semPermissao
      ? "Essa contagem não pode ser alterada por você agora. Se precisar, fale com a Jessica."
      : "Não consegui salvar agora. O que você digitou está guardado no celular, tente de novo em instantes.", "err");
    window.scrollTo(0,0);
    return;
  }
  btn.disabled = false; btn.textContent = "Salvar contagem";
}

/* ============================================================
   RESULTADO
   ============================================================ */
let RES_DIA = null;
async function mostrarResultado(dia){
  RES_DIA = dia;
  const [{ data }, adendos] = await Promise.all([
    sb.from("jb_saidas").select("*").eq("data", dia).order("ordem"),
    listarAdendos(dia)
  ]);
  const linhas = data || [];
  /* O que ficou na geladeira agora: a sobra contada no fechamento menos o que
     saiu depois dele (os adendos). O app faz essa conta, ninguém digita. */
  /* Enquanto o turno não fecha ninguém sabe o que saiu: a tabela mostra "?" em vez de
     um número inventado (a view assume saída total quando não há fechamento). */
  const fechado = linhas.length ? linhas.every(l => l.fechado) : true;
  const ficouDe = l => (!fechado || l.sobrou === null || l.sobrou === undefined) ? null
                       : Math.max(0, l.sobrou - (l.depois || 0));
  const saiuDe = l => fechado ? l.saiu_total : null;
  const soma = (f) => linhas.reduce((s,l) => { const v = f(l); return s + (v > 0 ? v : 0); }, 0);
  const total   = soma(saiuDe);
  const ficaram = soma(ficouDe);
  const deixados = soma(l => l.deixou);
  const negativos = fechado ? linhas.filter(l => l.saiu_total < 0) : [];

  const box = $("resBox");
  box.innerHTML = "";
  const cx = document.createElement("div");
  cx.className = "res";
  cx.innerHTML =
    '<div class="hd">' +
      '<span class="script">' + (fechado ? "Um doce dia" : "Turno em andamento") + '</span>' +
      '<span class="v">' + (fechado ? total + " " + (total === 1 ? "item" : "itens") : deixados + " na geladeira") + '</span>' +
      '<span class="k">' + (fechado ? "saíram da geladeira em " : "deixados em ") + dataCurta(dia) + '</span>' +
    '</div>' +
    '<div class="resumo">' +
      '<div class="saiu"><b>' + (fechado ? total : "?") + '</b><span>saíram</span></div>' +
      '<div class="ficou"><b>' + (fechado ? ficaram : "?") + '</b><span>ficaram na geladeira</span></div>' +
    '</div>' +
    '<table class="tres"><thead><tr>' +
      '<th>Item</th><th>Deixei</th><th>Saiu</th><th>Ficou</th>' +
    '</tr></thead><tbody></tbody><tfoot><tr>' +
      '<th>Total</th><td>' + deixados + '</td><td class="q">' + (fechado ? total : "?") +
      '</td><td class="f">' + (fechado ? ficaram : "?") + '</td>' +
    '</tr></tfoot></table>';
  box.appendChild(cx);

  const corpo = cx.querySelector("tbody");
  const fotoDe = {};
  PRODUTOS.forEach(p => { if(p.foto_url) fotoDe[p.nome] = p.foto_url; });
  const num = v => (v === null || v === undefined) ? "?" : v;
  linhas.forEach(l => {
    const saiu = saiuDe(l);
    const naoContado = fechado && (saiu === null || saiu === undefined);
    const ficou = ficouDe(l);
    const tr = document.createElement("tr");
    tr.className = "ln" + (saiu === 0 || naoContado ? " zero" : "");

    const tdNome = document.createElement("td");
    const nm = document.createElement("div");
    nm.className = "nm";
    const im = imgFoto(fotoDe[l.produto]);
    if(im){ im.classList.add("mini"); nm.appendChild(im); }
    const txt = document.createElement("div");
    txt.className = "txt";
    txt.textContent = l.produto;
    if(naoContado){
      const dp = document.createElement("span");
      dp.className = "dp";
      dp.textContent = "não foi contado no fechamento";
      txt.appendChild(dp);
    }
    if(l.depois > 0){
      const dp = document.createElement("span");
      dp.className = "dp";
      dp.textContent = "sendo " + l.depois + " depois do fechamento";
      txt.appendChild(dp);
    }
    nm.appendChild(txt);
    tdNome.appendChild(nm);

    const tdD = document.createElement("td");
    tdD.textContent = num(l.deixou);
    const tdS = document.createElement("td");
    tdS.className = "q"; tdS.textContent = num(saiu);
    const tdF = document.createElement("td");
    tdF.className = "f"; tdF.textContent = num(ficou);

    tr.append(tdNome, tdD, tdS, tdF);
    corpo.appendChild(tr);
  });

  const leg = document.createElement("p");
  leg.className = "tip";
  leg.textContent = fechado
    ? "Deixei é o que entrou na geladeira no dia, contando as reposições. "
      + "Ficou é a sobra do fechamento menos o que saiu depois dele, calculada pelo app."
    : "O turno ainda não foi fechado. O que saiu e o que ficou aparecem aqui depois da contagem do fechamento.";
  box.appendChild(leg);

  /* Os adendos: o que saiu depois que a equipe já tinha fechado o turno. */
  if(adendos.length){
    const bloco = document.createElement("div");
    bloco.className = "adja";
    const h = document.createElement("h3");
    h.textContent = "Depois do fechamento";
    bloco.appendChild(h);
    adendos.forEach(a => bloco.appendChild(linhaAdendo(a)));
    box.appendChild(bloco);
  }

  if(negativos.length){
    const w = document.createElement("div");
    w.className = "msg warn";
    w.textContent = "Atenção: " + negativos.length + " produto(s) com sobra maior do que foi deixado. "
      + "Costuma ser reposição que não foi somada na geladeira: abra Deixado pronto e some o que você repôs. "
      + "Se não foi isso, foi erro de contagem.";
    box.prepend(w);
  }
  show("scRes");
}

/* ============================================================
   TURNO FECHADO E ADENDO
   O que a equipe vê no fim do turno: a confirmação, sem número nenhum,
   e um lugar para anotar um pedido que saiu depois de fechar.
   O adendo nunca mexe na contagem já salva: entra linha nova.
   ============================================================ */
let AD = {};   // produto_id -> quantidade que saiu depois

async function listarAdendos(dia){
  try{
    const { data } = await sb.from("jb_adendo")
      .select("id,produto_id,qtd,texto,nome_responsavel,criado_em")
      .eq("data", dia).order("criado_em");
    return data || [];
  } catch(e){ return []; }
}

function linhaAdendo(a){
  const nomeDe = {};
  PRODUTOS.forEach(p => nomeDe[p.id] = p.nome);
  const l = document.createElement("div");
  l.className = "l";
  const esq = document.createElement("span");
  esq.textContent = a.produto_id ? (nomeDe[a.produto_id] || "Item") : (a.texto || "");
  if(a.produto_id && a.texto){
    const t = document.createElement("span");
    t.className = "hora"; t.textContent = a.texto;
    esq.appendChild(t);
  }
  const h = document.createElement("span");
  h.className = "hora";
  h.textContent = (a.nome_responsavel || "") + " às " + horaDe(a.criado_em);
  esq.appendChild(h);
  l.appendChild(esq);
  if(a.produto_id){
    const q = document.createElement("span");
    q.className = "q"; q.textContent = a.qtd;
    l.appendChild(q);
  }
  return l;
}

async function mostrarFeito(dia){
  FEITO_DIA = dia;
  const fe = CONTAGEM_HOJE && CONTAGEM_HOJE.fechamento;
  const box = $("feitoBox");
  box.innerHTML = "";
  const s1 = document.createElement("span");
  s1.className = "script"; s1.textContent = "Turno fechado";
  const s2 = document.createElement("span");
  s2.className = "v"; s2.textContent = fe ? horaDe(fe.criado_em) : horaSP();
  const s3 = document.createElement("span");
  s3.className = "k"; s3.textContent = dataCurta(dia);
  const p = document.createElement("p");
  p.textContent = "Prontinho, " + (EU ? EU.nome : "") +
    ". A contagem foi salva e já chegou para a Jessica. Pode ir tranquila.";
  box.append(s1, s2, s3, p);

  aviso("feitoMsg","","");
  const lista = $("feitoLista");
  lista.innerHTML = "";
  const adendos = await listarAdendos(dia);
  if(adendos.length){
    const h = document.createElement("h3");
    h.textContent = "Você anotou depois do fechamento";
    lista.appendChild(h);
    adendos.forEach(a => lista.appendChild(linhaAdendo(a)));
  }
  show("scFeito");
}

async function abrirAdendo(dia){
  FEITO_DIA = dia;
  AD = {};
  $("adData").textContent = dataLonga(dia);
  $("adTexto").value = "";
  aviso("adMsg","","");

  const box = $("adList");
  box.innerHTML = "";
  PRODUTOS.forEach(p => {
    const row = document.createElement("div");
    row.className = "item";
    row.dataset.pid = p.id;

    const im = imgFoto(p.foto_url);
    if(im) row.appendChild(im);

    const nome = document.createElement("div");
    nome.className = "nome"; nome.textContent = p.nome;
    row.appendChild(nome);

    const step = document.createElement("div");
    step.className = "step";
    const menos = document.createElement("button");
    menos.type = "button"; menos.textContent = "−"; menos.setAttribute("aria-label","Menos um " + p.nome);
    const inp = document.createElement("input");
    inp.type = "tel"; inp.inputMode = "numeric"; inp.maxLength = 3;
    inp.setAttribute("aria-label", p.nome);
    const mais = document.createElement("button");
    mais.type = "button"; mais.textContent = "+"; mais.setAttribute("aria-label","Mais um " + p.nome);

    const set = v => {
      v = Math.max(0, Math.min(999, v));
      if(v === 0){ inp.value = ""; delete AD[p.id]; }
      else { inp.value = v; AD[p.id] = v; }
      pintarAdendo();
    };
    menos.onclick = () => set((parseInt(inp.value,10) || 0) - 1);
    mais.onclick  = () => set((parseInt(inp.value,10) || 0) + 1);
    inp.oninput = () => {
      inp.value = inp.value.replace(/\D/g,"").slice(0,3);
      const v = parseInt(inp.value,10);
      if(!v) delete AD[p.id]; else AD[p.id] = v;
      pintarAdendo();
    };
    inp.onfocus = () => inp.select();
    inp.onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); proximoCampo(inp); } };

    step.append(menos, inp, mais);
    row.appendChild(step);
    box.appendChild(row);
  });

  const adendos = await listarAdendos(dia);
  const antigo = $("adJa");
  antigo.innerHTML = "";
  if(adendos.length){
    const h = document.createElement("h3");
    h.textContent = "Já anotado hoje";
    antigo.appendChild(h);
    adendos.forEach(a => antigo.appendChild(linhaAdendo(a)));
  }

  pintarAdendo();
  show("scAdendo");
  window.scrollTo(0,0);
}

function pintarAdendo(){
  let n = 0, itens = 0;
  document.querySelectorAll("#adList .item").forEach(row => {
    const pid = Number(row.dataset.pid);
    const ok = AD[pid] > 0;
    row.classList.toggle("filled", ok);
    if(ok){ n++; itens += AD[pid]; }
  });
  $("adProg").textContent = n ? (itens + (itens === 1 ? " item" : " itens")) : "";
  const texto = ($("adTexto").value || "").trim();
  $("btnAdSalvar").disabled = !n && !texto;
  $("btnAdSalvar").textContent = n ? "Salvar adendo" : (texto ? "Salvar recado" : "Salvar adendo");
}

async function salvarAdendo(){
  const btn = $("btnAdSalvar");
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = "Salvando...";

  const texto = ($("adTexto").value || "").trim();
  const linhas = Object.keys(AD).filter(k => AD[k] > 0).map(k => ({
    data: FEITO_DIA, produto_id: Number(k), qtd: AD[k], texto: null,
    registrado_por: EU.user_id, nome_responsavel: EU.nome
  }));
  if(texto){
    linhas.push({ data: FEITO_DIA, produto_id: null, qtd: 0, texto: texto,
                  registrado_por: EU.user_id, nome_responsavel: EU.nome });
  }
  if(!linhas.length){ btn.disabled = false; btn.textContent = rotulo; return; }

  const { error } = await sb.from("jb_adendo").insert(linhas);
  btn.disabled = false; btn.textContent = rotulo;
  if(error){
    aviso("adMsg","Não consegui salvar agora. Tente de novo em instantes.","err");
    window.scrollTo(0,0);
    return;
  }
  await mostrarFeito(FEITO_DIA);
  aviso("feitoMsg","Anotado. A contagem que você salvou continua igual.","ok");
  window.scrollTo(0,0);
}

/* ============================================================
   HISTÓRICO
   ============================================================ */
async function abrirHistorico(){
  const { data } = await sb.from("jb_contagem")
    .select("data,momento").order("data",{ascending:false}).limit(40);
  const porDia = {};
  (data || []).forEach(c => { (porDia[c.data] = porDia[c.data] || {})[c.momento] = true; });
  const dias = Object.keys(porDia).sort().reverse().slice(0,14);

  const box = $("histList");
  box.innerHTML = "";
  if(!dias.length){
    const p = document.createElement("p");
    p.className = "tip"; p.style.margin = "10px 0";
    p.textContent = "Ainda não há contagem registrada.";
    box.appendChild(p);
  }
  dias.forEach(d => {
    const row = document.createElement("div"); row.className = "h";
    const dt = document.createElement("span"); dt.className = "dt"; dt.textContent = dataCurta(d);
    const st = document.createElement("span");
    const completo = porDia[d].abertura && porDia[d].fechamento;
    st.className = "st" + (completo ? " ok" : "");
    st.textContent = completo ? "fechado ✓" : (porDia[d].abertura ? "sem fechamento" : "só fechamento");
    row.append(dt, st);
    /* Só gestor abre o resultado do dia: o número do que saiu nasce da
       contagem da abertura, que a equipe não vê. */
    if(completo && EU && EU.papel === "gestor"){
      row.style.cursor = "pointer";
      row.onclick = () => mostrarResultado(d);
    }
    box.appendChild(row);
  });
  show("scHist");
}
