/* JB OS · parcerias e collabs que chegam pela página jballassa.github.io/parcerias.html.

   A marca ou o perfil conta a ideia no site, o banco confere (jb_parceria_criar) e o
   pedido cai aqui, só para o gestor. Nada é apagado: recusada fica no histórico.

       nova  →  conversando  →  fechada
                     ↘ recusada
   ============================================================ */

let PARC = null;            // lista
let PARC_ABERTA = null;     // id do cartão aberto

const PARC_STATUS = {
  nova:        { rot: "nova",        cls: "nova" },
  conversando: { rot: "conversando", cls: "conv" },
  fechada:     { rot: "fechada",     cls: "ok" },
  recusada:    { rot: "recusada",    cls: "fim" }
};
const PARC_TIPO = {
  collab: "Collab de produto", corporativo: "Kits corporativos", evento: "Evento ou ação", revenda: "Revenda",
  publi: "Publi ou conteúdo", presenca: "Presença em evento", aula: "Aula ou workshop", outro: "Outra ideia"
};
const PARC_FORMATO = { pago: "Pago", permuta: "Permuta", a_combinar: "A combinar" };

const parcEmail = c => /@/.test(String(c || ""));

/* Régua de parcerias (25/11/2026): a análise automática do Claude grava em avaliacao a nota
   de 0 a 12, o veredito, a nota de cada ponto e três mensagens prontas. Aqui a Jessica vê
   tudo e responde com um toque pelo e-mail de parcerias da JB (ou WhatsApp, se for telefone). */
const PARC_EMAIL_JB = "jbconfeitariaparcerias@gmail.com";
const PARC_VEREDITO = {
  sim:       { rot: "sim",                cls: "ok",   tx: "Vale a pena. Responder rápido." },
  condicoes: { rot: "sim com condições",  cls: "conv", tx: "Só vale ajustando o que puxa a nota para baixo." },
  nao_agora: { rot: "não agora",          cls: "nagora", tx: "Responder com gentileza e deixar a porta aberta." },
  nao:       { rot: "não",                cls: "nao",  tx: "Não vale a pena. Recusar com educação." }
};
const PARC_CRIT = [
  ["dinheiro", "Dinheiro para a JB",  "pago vale 2, permuta útil 1, nada 0"],
  ["alcance",  "Alcance para a JB",   "público maior que o da JB vale 2, de 1/5 até o mesmo tamanho 1, menor 0"],
  ["venda",    "Venda que pode gerar","pedido direto vale 2, indireta 1, nenhuma 0"],
  ["marca",    "Combina com a marca", "reforça a JB vale 2, neutro 1, diferente 0"],
  ["trabalho", "Trabalho da Jessica", "quase nada vale 2, algumas horas fora do pico 1, muito ou em dezembro 0"],
  ["custo",    "Custo e risco",       "custo zero vale 2, pequeno dentro do limite de permuta 1, alto 0"]
];
const PARC_LEGENDA = [
  ["9 a 12", "sim", "vale a pena, responder rápido"],
  ["6 a 8", "sim com condições", "aceitar só ajustando o que puxa a nota para baixo"],
  ["4 a 5", "não agora", "resposta gentil, porta aberta, sem compromisso"],
  ["0 a 3", "não", "recusar com educação"]
];
const PARC_VERSOES = [["curta", "Curta"], ["media", "Média"], ["emocional", "Emocional"]];

function parcLinkEmailJB(para, assunto, corpo){
  return "https://mail.google.com/mail/?authuser=" + encodeURIComponent(PARC_EMAIL_JB)
    + "&view=cm&fs=1&to=" + encodeURIComponent(para)
    + "&su=" + encodeURIComponent(assunto) + "&body=" + encodeURIComponent(corpo);
}

/* Home: o botão muda de cor quando chega pedido novo */
async function montarParceriasHome(gestor){
  const bt = $("btnParcerias");
  bt.classList.toggle("hide", !gestor);
  if(!gestor) return;
  const { data, error } = await sb.from("jb_parceria").select("id,status").eq("status", "nova");
  const n = error ? 0 : (data || []).length;
  $("parcSub").textContent = n
    ? n + (n === 1 ? " pedido de parceria esperando resposta" : " pedidos de parceria esperando resposta")
    : "Marcas e perfis que querem fazer algo com a JB";
  bt.classList.toggle("ghost", !n);
  bt.classList.toggle("enc-nova", !!n);
}

async function abrirParcerias(){
  show("scParc");
  aviso("parcMsg","","");
  $("parcLista").innerHTML = "";
  PARC = [];
  const { data, error } = await sb.from("jb_parceria").select("*").order("criado_em", { ascending: false }).limit(200);
  if(error){ aviso("parcMsg","Não consegui carregar as parcerias. Toque em atualizar.","err"); return; }
  PARC = data || [];
  montarParcerias();
}

function montarParcerias(){
  const box = $("parcLista");
  box.innerHTML = "";
  const novas = PARC.filter(x => x.status === "nova");
  const conv  = PARC.filter(x => x.status === "conversando");
  const fim   = PARC.filter(x => x.status === "fechada" || x.status === "recusada");

  const cab = document.createElement("div"); cab.className = "enc-cab";
  [[novas.length, novas.length === 1 ? "nova" : "novas"],
   [conv.length, "conversando"],
   [PARC.filter(x => x.status === "fechada").length, PARC.filter(x => x.status === "fechada").length === 1 ? "fechada" : "fechadas"]
  ].forEach(([n, t]) => {
    const d = document.createElement("div");
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = t;
    d.append(b, s); cab.appendChild(d);
  });
  box.appendChild(cab);

  if(!PARC.length){
    const p = document.createElement("p"); p.className = "tip";
    p.textContent = "Nenhum pedido ainda. Quando uma marca ou perfil mandar uma ideia pela página de parcerias do site, ela aparece aqui na hora.";
    box.appendChild(p);
    return;
  }
  const grupo = (titulo, lista, urgente) => {
    if(!lista.length) return;
    const h = document.createElement("div"); h.className = "grupotar" + (urgente ? " urgente" : "");
    h.textContent = titulo; box.appendChild(h);
    lista.forEach(x => box.appendChild(cartaoParceria(x)));
  };
  grupo("Esperando resposta", novas, true);
  grupo("Conversando", conv, false);
  if(fim.length){
    const det = document.createElement("details"); det.className = "enc-fim";
    const sm = document.createElement("summary");
    sm.textContent = "Fechadas e recusadas (" + fim.length + ")";
    det.appendChild(sm);
    fim.forEach(x => det.appendChild(cartaoParceria(x)));
    box.appendChild(det);
  }
}

function cartaoParceria(x){
  const st = PARC_STATUS[x.status] || PARC_STATUS.nova;
  const c = document.createElement("div");
  c.className = "enc parc " + st.cls + (PARC_ABERTA === x.id ? " aberta" : "");
  c.dataset.id = x.id;

  const topo = document.createElement("button");
  topo.type = "button"; topo.className = "enc-topo";
  topo.setAttribute("aria-expanded", String(PARC_ABERTA === x.id));
  const q = encQuando(x.criado_em);
  const hora = document.createElement("span"); hora.className = "enc-hora";
  hora.textContent = dataCurta(q.dia).replace(".", "");
  const meio = document.createElement("span"); meio.className = "enc-meio";
  const nm = document.createElement("b"); nm.textContent = x.marca || x.nome;
  const cod = document.createElement("small"); cod.textContent = " " + x.codigo;
  nm.appendChild(cod);
  const rs = document.createElement("span");
  rs.textContent = (x.com_quem === "jessica" ? "Com a Jessica" : "Com a JB") + " · " + (PARC_TIPO[x.tipo] || x.tipo)
    + (x.formato ? " · " + PARC_FORMATO[x.formato] : "");
  meio.append(nm, rs);
  const dir = document.createElement("span"); dir.className = "enc-dir";
  const chip = document.createElement("span"); chip.className = "enc-chip " + st.cls; chip.textContent = st.rot;
  dir.appendChild(chip);
  topo.append(hora, meio, dir);
  topo.onclick = () => { PARC_ABERTA = PARC_ABERTA === x.id ? null : x.id; montarParcerias(); };
  c.appendChild(topo);
  if(PARC_ABERTA === x.id) c.appendChild(detalheParceria(x));
  return c;
}

function detalheParceria(x){
  const d = document.createElement("div"); d.className = "enc-det";
  const ideia = document.createElement("p"); ideia.className = "parc-ideia";
  ideia.textContent = x.ideia;
  d.appendChild(ideia);

  const info = [
    ["Quem", x.nome + (x.marca ? ", " + x.marca : "")],
    x.instagram ? ["Instagram", "@" + x.instagram] : null,
    ["Contato", parcEmail(x.contato) ? x.contato : encFone(x.contato)],
    x.quando ? ["Para quando", x.quando] : null,
    x.formato ? ["Formato", PARC_FORMATO[x.formato]] : null,
    ["Chegou", dataLonga(encQuando(x.criado_em).dia) + " às " + encQuando(x.criado_em).hora]
  ].filter(Boolean);
  const dl = document.createElement("dl"); dl.className = "enc-info";
  info.forEach(([a, b]) => {
    const dt = document.createElement("dt"); dt.textContent = a;
    const dd = document.createElement("dd");
    if(a === "Instagram"){
      const l = document.createElement("a"); l.href = "https://www.instagram.com/" + encodeURIComponent(x.instagram) + "/";
      l.target = "_blank"; l.rel = "noopener"; l.textContent = b; dd.appendChild(l);
    } else dd.textContent = b;
    dl.append(dt, dd);
  });
  d.appendChild(dl);

  const primeiro = String(x.nome || "").split(" ")[0];
  d.appendChild(reguaParceria(x));
  d.appendChild(respostaParceria(x));

  if(x.status === "fechada"){
    const dica = document.createElement("p"); dica.className = "parc-dica";
    dica.textContent = "Se saírem doces da geladeira para esta parceria, registre em Perda › Cortesia ou degustação, escrevendo \"permuta @" + (x.instagram || primeiro) + "\". Assim a conferência fecha e o custo da permuta aparece no mês.";
    d.appendChild(dica);
  }

  const ac = document.createElement("div"); ac.className = "enc-acoes";
  const bt = (rot, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = rot;
    if(cls) b.className = cls;
    b.onclick = travar(b, fn);
    ac.appendChild(b);
  };
  if(x.status === "nova"){
    bt("Respondi, conversando", "", () => mudarParceria(x, "conversando", "Marcada como conversando."));
    bt("Recusar", "sec", () => mudarParceria(x, "recusada", "Recusada. Fica no histórico."));
  }
  if(x.status === "conversando"){
    bt("Fechou", "", () => mudarParceria(x, "fechada", "Parceria fechada :)"));
    bt("Não rolou", "sec", () => mudarParceria(x, "recusada", "Marcada como não rolou."));
  }
  if(x.status === "fechada" || x.status === "recusada"){
    bt("Reabrir", "sec", () => mudarParceria(x, "conversando", "Reaberta."));
  }
  d.appendChild(ac);

  const lb = document.createElement("label"); lb.className = "enc-nota";
  lb.appendChild(document.createTextNode("Anotação interna"));
  const ta = document.createElement("textarea"); ta.rows = 2; ta.value = x.nota_interna || "";
  ta.placeholder = "Só vocês veem. Ex.: combinado 20 potes em permuta por 1 reels e 3 stories";
  ta.onblur = async () => {
    const v = ta.value.trim();
    if(v === (x.nota_interna || "")) return;
    const { error } = await sb.from("jb_parceria").update({ nota_interna: v || null, atualizado_em: new Date().toISOString() }).eq("id", x.id);
    if(error){ toast("Não consegui salvar a anotação.", "err"); return; }
    x.nota_interna = v || null;
    toast("Anotação salva.");
  };
  lb.appendChild(ta);
  d.appendChild(lb);
  return d;
}

async function mudarParceria(x, status, recado){
  const { error } = await sb.from("jb_parceria")
    .update({ status, atualizado_em: new Date().toISOString() }).eq("id", x.id);
  if(error){ aviso("parcMsg","Não consegui salvar agora. Tente de novo.","err"); return; }
  x.status = status;
  toast(recado);
  montarParcerias();
}

/* A nota da régua, cada ponto com o motivo, e a legenda do que a nota quer dizer */
function reguaParceria(x){
  const box = document.createElement("div"); box.className = "parc-regua";
  const av = x.avaliacao;
  if(!av || av.nota == null){
    const p = document.createElement("p"); p.className = "pr-sem";
    p.textContent = "Ainda sem nota. A análise da régua roda sozinha toda manhã e aparece aqui; se tiver pressa, peça ao Claude.";
    box.appendChild(p);
    box.appendChild(legendaParceria());
    return box;
  }
  const v = PARC_VEREDITO[av.veredito] || PARC_VEREDITO.nao_agora;
  const topo = document.createElement("div"); topo.className = "pr-topo";
  const nota = document.createElement("b"); nota.className = "pr-nota " + v.cls;
  nota.textContent = String(av.nota);
  const de = document.createElement("small"); de.textContent = "/12"; nota.appendChild(de);
  const lado = document.createElement("div");
  const chip = document.createElement("span"); chip.className = "enc-chip " + v.cls; chip.textContent = v.rot;
  const tx = document.createElement("p"); tx.className = "pr-resumo"; tx.textContent = av.resumo || v.tx;
  lado.append(chip, tx);
  topo.append(nota, lado);
  box.appendChild(topo);
  if(av.corte){
    const c = document.createElement("p"); c.className = "pr-corte";
    c.textContent = "Corte automático: " + av.corte;
    box.appendChild(c);
  }
  const ul = document.createElement("ul"); ul.className = "pr-crit";
  PARC_CRIT.forEach(([k, nome]) => {
    const it = (av.criterios || {})[k] || {};
    const n = Math.max(0, Math.min(2, Number(it.n) || 0));
    const li = document.createElement("li");
    const nm = document.createElement("span"); nm.className = "pr-nome"; nm.textContent = nome;
    const pts = document.createElement("span"); pts.className = "pr-pts";
    for(let i = 0; i < 2; i++){ const b = document.createElement("i"); if(i < n) b.className = "on"; pts.appendChild(b); }
    const num = document.createElement("em"); num.textContent = n + "/2";
    li.append(nm, pts, num);
    if(it.porque){ const pq = document.createElement("small"); pq.textContent = it.porque; li.appendChild(pq); }
    ul.appendChild(li);
  });
  box.appendChild(ul);
  box.appendChild(legendaParceria());
  return box;
}

function legendaParceria(){
  const det = document.createElement("details"); det.className = "pr-legenda";
  const sm = document.createElement("summary"); sm.textContent = "O que a nota significa";
  det.appendChild(sm);
  const ul = document.createElement("ul");
  PARC_LEGENDA.forEach(([faixa, rot, tx]) => {
    const li = document.createElement("li");
    const b = document.createElement("b"); b.textContent = faixa + ": " + rot;
    li.append(b, document.createTextNode(", " + tx + "."));
    ul.appendChild(li);
  });
  det.appendChild(ul);
  const p = document.createElement("p");
  p.textContent = "Cada um dos seis pontos vale de 0 a 2: " + PARC_CRIT.map(([, nome, como]) => nome.charAt(0).toLowerCase() + nome.slice(1) + " (" + como + ")").join("; ") + ".";
  det.appendChild(p);
  const p2 = document.createElement("p");
  p2.textContent = "É não na hora quando pede dinheiro da JB, exclusividade, receita ou fornecedor, usa a marca JB sem aprovação, pede doces em permuta sem público comprovado ou vai contra as regras dos apps. Permuta até R$ 300 por mês e nada novo em dezembro que não seja pago.";
  det.appendChild(p2);
  return det;
}

/* Resposta pronta: três versões, a recomendada já escolhida, editável, e um toque abre
   o e-mail de parcerias da JB (ou o WhatsApp) com tudo preenchido. A Jessica só confere e envia. */
function respostaParceria(x){
  const box = document.createElement("div"); box.className = "parc-resp";
  const av = x.avaliacao || {};
  const primeiro = String(x.nome || "").split(" ")[0];
  const tipo = (PARC_TIPO[x.tipo] || "parceria").toLowerCase();
  const padrao = "oi, " + primeiro + "! aqui é a Jessica, da JB :) recebi a sua ideia de " + tipo + " (" + x.codigo + ").. obrigada por pensar na gente! vamos conversar?";
  const msgs = Object.assign({}, av.mensagens || {});
  const temVersoes = PARC_VERSOES.some(([k]) => msgs[k]);
  if(!temVersoes) msgs.curta = padrao;
  let versao = (av.recomendada && msgs[av.recomendada]) ? av.recomendada : (PARC_VERSOES.find(([k]) => msgs[k]) || ["curta"])[0];
  const assunto = av.assunto || ("Parceria com a JB · " + x.codigo);
  const email = parcEmail(x.contato);

  const tit = document.createElement("p"); tit.className = "pr-tit";
  tit.textContent = temVersoes ? "Resposta recomendada" : "Resposta";
  box.appendChild(tit);

  const ta = document.createElement("textarea"); ta.className = "pr-texto"; ta.rows = 7;
  if(temVersoes){
    const grupo = document.createElement("div"); grupo.className = "pr-versoes"; grupo.setAttribute("role", "group");
    PARC_VERSOES.forEach(([k, rot]) => {
      if(!msgs[k]) return;
      const b = document.createElement("button"); b.type = "button"; b.dataset.v = k;
      b.textContent = rot + (k === av.recomendada ? " ★" : "");
      b.setAttribute("aria-pressed", String(k === versao));
      b.onclick = () => {
        versao = k; ta.value = msgs[k];
        grupo.querySelectorAll("button").forEach(o => o.setAttribute("aria-pressed", String(o.dataset.v === k)));
        ligar();
      };
      grupo.appendChild(b);
    });
    box.appendChild(grupo);
  }
  ta.value = msgs[versao] || padrao;
  box.appendChild(ta);

  const ir = document.createElement("a"); ir.className = "enc-wa"; ir.target = "_blank"; ir.rel = "noopener";
  const mais = document.createElement("p"); mais.className = "pr-mais";
  const app = document.createElement("a"); app.className = "pr-app";
  const copiar = document.createElement("button"); copiar.type = "button"; copiar.className = "pr-copiar"; copiar.textContent = "copiar o texto";
  function ligar(){
    const corpo = ta.value.trim();
    if(email){
      ir.href = parcLinkEmailJB(x.contato, assunto, corpo);
      ir.textContent = "Responder " + primeiro + " pelo e-mail da JB";
      app.href = "mailto:" + x.contato + "?subject=" + encodeURIComponent(assunto) + "&body=" + encodeURIComponent(corpo);
      app.textContent = "usar o app de e-mail";
    } else {
      ir.href = "https://wa.me/55" + String(x.contato).replace(/\D/g, "") + "?text=" + encodeURIComponent(corpo);
      ir.textContent = "Responder " + primeiro + " no WhatsApp";
    }
  }
  ta.addEventListener("input", ligar);
  ligar();
  ir.addEventListener("click", () => marcarRespondida(x, email ? "email" : "whatsapp", versao));
  app.addEventListener("click", () => marcarRespondida(x, "app_email", versao));
  copiar.onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value.trim()); toast("Texto copiado."); }
    catch(e){ ta.select(); toast("Selecionei o texto: é só copiar."); }
  };
  box.appendChild(ir);
  if(email) mais.append(app, document.createTextNode(" · "));
  mais.appendChild(copiar);
  box.appendChild(mais);
  if(email){
    const ob = document.createElement("p"); ob.className = "pr-obs";
    ob.textContent = "Abre o Gmail na conta " + PARC_EMAIL_JB + " com tudo preenchido. É só conferir e tocar em Enviar.";
    box.appendChild(ob);
  }
  if(x.respondido_em){
    const q = encQuando(x.respondido_em);
    const r = document.createElement("p"); r.className = "pr-respondido";
    r.textContent = "Resposta aberta em " + dataCurta(q.dia).replace(".", "") + " às " + q.hora
      + ({ email: " pelo e-mail da JB", whatsapp: " no WhatsApp", app_email: " pelo app de e-mail" }[x.resposta_canal] || "") + ".";
    box.appendChild(r);
  }
  return box;
}

async function marcarRespondida(x, canal, versao){
  const agora = new Date().toISOString();
  const { error } = await sb.from("jb_parceria")
    .update({ respondido_em: agora, resposta_canal: canal, resposta_versao: versao, atualizado_em: agora }).eq("id", x.id);
  if(error) return;
  x.respondido_em = agora; x.resposta_canal = canal; x.resposta_versao = versao;
  toast("Depois de enviar, marque o status aqui embaixo.");
}

