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

  /* responder já com o texto do jeito da Jessica */
  const primeiro = String(x.nome || "").split(" ")[0];
  const tipo = (PARC_TIPO[x.tipo] || "parceria").toLowerCase();
  const txt = "oi, " + primeiro + "! aqui é a Jessica, da JB :) recebi a sua ideia de " + tipo + " (" + x.codigo + ").. obrigada por pensar na gente! vamos conversar?";
  const fala = document.createElement("a");
  fala.className = "enc-wa"; fala.target = "_blank"; fala.rel = "noopener";
  if(parcEmail(x.contato)){
    fala.href = "mailto:" + x.contato + "?subject=" + encodeURIComponent("Parceria com a JB · " + x.codigo) + "&body=" + encodeURIComponent(txt);
    fala.textContent = "Responder " + primeiro + " por e-mail";
  } else {
    fala.href = "https://wa.me/55" + String(x.contato).replace(/\D/g, "") + "?text=" + encodeURIComponent(txt);
    fala.textContent = "Responder " + primeiro + " no WhatsApp";
  }
  d.appendChild(fala);

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
