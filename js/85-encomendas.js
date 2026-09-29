/* JB OS · encomendas de bolo que chegam pelo site.

   O cliente monta o bolo na página pública, o banco confere e recalcula o preço
   (função jb_encomenda_criar), e o pedido cai aqui ao mesmo tempo em que abre o
   WhatsApp da loja. Nada é digitado duas vezes.

   O caminho de uma encomenda:
       nova  →  confirmada (sinal no Pix)  →  pronta  →  entregue
                      ↘ cancelada
   ============================================================ */

let ENC = null;          // { lista, opcoes }
let ENC_ABA = "pedidos";
let ENC_ABERTA = null;   // id da encomenda com o detalhe aberto

const ENC_STATUS = {
  nova:       { rot: "nova",        cls: "nova" },
  confirmada: { rot: "confirmada",  cls: "ok" },
  pronta:     { rot: "pronta",      cls: "ok" },
  entregue:   { rot: "entregue",    cls: "fim" },
  cancelada:  { rot: "cancelada",   cls: "fim" }
};

const ENC_GRUPOS = [
  ["tamanho",    "Tamanhos",               "Só liga e desliga. O preço mora no modelo."],
  ["modelo",     "Modelos",                "Aqui é o preço do bolo inteiro, em cada tamanho."],
  ["massa",      "Massas",                 "Quanto soma. Zero é incluso."],
  ["recheio",    "Recheios",               "Quanto soma. Zero é incluso."],
  ["combinacao", "Combinações da casa",    "Quanto soma sobre o bolo."],
  ["adicional",  "Para completar",         "Quanto soma sobre o bolo."],
  ["decoracao",  "Decoração do chantininho","Quanto soma. Só aparece no chantininho."],
  ["acabamento", "Acabamento",             "Quanto soma. Só aparece no chantininho."]
];

/* ---------- datas no relógio de São Paulo ---------- */
function encQuando(ts){
  const d = new Date(ts);
  const dia = d.toLocaleDateString("en-CA", { timeZone: TZ });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return { dia, hora };
}
function encFone(n){
  const d = String(n || "").replace(/\D/g, "");
  if(d.length === 11) return "(" + d.slice(0,2) + ") " + d.slice(2,7) + "-" + d.slice(7);
  if(d.length === 10) return "(" + d.slice(0,2) + ") " + d.slice(2,6) + "-" + d.slice(6);
  return n || "";
}
const encReais = v => "R$ " + moeda(v);

/* ============================================================
   CARGA
   ============================================================ */
async function abrirEncomendas(){
  show("scEnc");
  aviso("encMsg","","");
  $("encLista").innerHTML = "";
  await carregarEncomendas();
  montarEncomendas();
}

async function carregarEncomendas(){
  ENC = { lista: [], opcoes: [] };
  const desde = new Date(Date.now() - 21 * 864e5).toISOString();
  const [e, o] = await Promise.all([
    sb.from("jb_encomenda").select("*").gte("retirada_em", desde).order("retirada_em"),
    sb.from("jb_bolo_opcao").select("*").order("ordem")
  ]);
  if(e.error || o.error){
    aviso("encMsg","Não consegui carregar as encomendas. Toque em atualizar.","err");
    return;
  }
  ENC.lista = e.data || [];
  ENC.opcoes = o.data || [];
}

function trocarAbaEnc(aba){
  ENC_ABA = aba;
  montarEncomendas();
  atualizarNav();
}

function montarEncomendas(){
  $("abaEncPedidos").setAttribute("aria-pressed", String(ENC_ABA === "pedidos"));
  $("abaEncCardapio").setAttribute("aria-pressed", String(ENC_ABA === "cardapio"));
  if(!ENC) return;
  if(ENC_ABA === "cardapio") montarCardapioBolos(); else montarPedidos();
}

/* ============================================================
   PEDIDOS
   ============================================================ */
function montarPedidos(){
  const box = $("encLista");
  box.innerHTML = "";

  const novas   = ENC.lista.filter(x => x.status === "nova");
  const agenda  = ENC.lista.filter(x => x.status === "confirmada" || x.status === "pronta");
  const fim     = ENC.lista.filter(x => x.status === "entregue" || x.status === "cancelada").reverse();

  const cab = document.createElement("div"); cab.className = "enc-cab";
  const sinais = agenda.filter(x => !x.sinal_pago).length;
  cab.innerHTML = "";
  [
    [novas.length, novas.length === 1 ? "nova" : "novas"],
    [agenda.length, "na agenda"],
    [sinais, sinais === 1 ? "sinal a receber" : "sinais a receber"]
  ].forEach(([n, t]) => {
    const d = document.createElement("div");
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = t;
    d.append(b, s); cab.appendChild(d);
  });
  box.appendChild(cab);

  if(!ENC.lista.length){
    const p = document.createElement("p"); p.className = "tip";
    p.textContent = "Nenhuma encomenda ainda. Quando alguém montar um bolo no site, ele aparece aqui na hora, com a data de retirada e o valor já conferido.";
    box.appendChild(p);
    return;
  }

  if(novas.length){
    const h = document.createElement("div"); h.className = "grupotar urgente";
    h.textContent = "Esperando você confirmar";
    box.appendChild(h);
    novas.forEach(x => box.appendChild(cartaoEncomenda(x)));
  }

  if(agenda.length){
    let diaAtual = null;
    agenda.forEach(x => {
      const q = encQuando(x.retirada_em);
      if(q.dia !== diaAtual){
        diaAtual = q.dia;
        const h = document.createElement("div"); h.className = "grupotar";
        const hoje = hojeSP(), amanha = diaMais(1);
        h.textContent = q.dia === hoje ? "Hoje" : q.dia === amanha ? "Amanhã" : dataLonga(q.dia);
        if(q.dia === hoje || q.dia === amanha) h.classList.add("urgente");
        box.appendChild(h);
      }
      box.appendChild(cartaoEncomenda(x));
    });
  }

  if(fim.length){
    const det = document.createElement("details"); det.className = "enc-fim";
    const sm = document.createElement("summary");
    sm.textContent = "Entregues e canceladas, últimas 3 semanas (" + fim.length + ")";
    det.appendChild(sm);
    fim.forEach(x => det.appendChild(cartaoEncomenda(x)));
    box.appendChild(det);
  }
}

function resumoDoBolo(x){
  /* a linha curta do cartão fechado, a partir do que ficou gravado no pedido */
  const it = Array.isArray(x.itens) ? x.itens : [];
  const nome = g => (it.find(i => i.grupo === g) || {}).nome;
  const tam = nome("tamanho") ? nome("tamanho").replace(/^Tamanho /, "").split(",")[0] : "";
  return [tam, nome("modelo"), nome("massa"), nome("recheio") || nome("combinacao")]
    .filter(Boolean).join(" · ");
}

function cartaoEncomenda(x){
  const q = encQuando(x.retirada_em);
  const st = ENC_STATUS[x.status] || ENC_STATUS.nova;
  const c = document.createElement("div");
  c.className = "enc " + st.cls + (ENC_ABERTA === x.id ? " aberta" : "");
  c.dataset.id = x.id;

  const topo = document.createElement("button");
  topo.type = "button"; topo.className = "enc-topo";
  topo.setAttribute("aria-expanded", String(ENC_ABERTA === x.id));
  const hora = document.createElement("span"); hora.className = "enc-hora";
  hora.textContent = q.hora;
  if(x.status === "nova" || x.status === "entregue" || x.status === "cancelada"){
    const sd = document.createElement("small"); sd.textContent = dataCurta(q.dia).replace(".", "");
    hora.appendChild(sd);
  }
  const meio = document.createElement("span"); meio.className = "enc-meio";
  const nm = document.createElement("b"); nm.textContent = x.cliente_nome;
  const cod = document.createElement("small"); cod.textContent = " " + x.codigo;
  nm.appendChild(cod);
  const rs = document.createElement("span"); rs.textContent = resumoDoBolo(x);
  meio.append(nm, rs);
  const dir = document.createElement("span"); dir.className = "enc-dir";
  const tt = document.createElement("b"); tt.textContent = encReais(x.total);
  const chip = document.createElement("span"); chip.className = "enc-chip " + st.cls; chip.textContent = st.rot;
  dir.append(tt, chip);
  topo.append(hora, meio, dir);
  topo.onclick = () => { ENC_ABERTA = ENC_ABERTA === x.id ? null : x.id; montarPedidos(); };
  c.appendChild(topo);

  const sinal = document.createElement("div"); sinal.className = "enc-sinal" + (x.sinal_pago ? " pago" : "");
  sinal.textContent = x.status === "cancelada" ? "Cancelada"
    : x.sinal_pago ? "Sinal de " + encReais(x.sinal) + " recebido. Falta " + encReais(Number(x.total) - Number(x.sinal)) + " na retirada."
    : "Sinal de " + encReais(x.sinal) + " ainda não recebido";
  c.appendChild(sinal);

  if(ENC_ABERTA === x.id) c.appendChild(detalheEncomenda(x));
  return c;
}

function detalheEncomenda(x){
  const q = encQuando(x.retirada_em);
  const d = document.createElement("div"); d.className = "enc-det";

  const linha = (a, b, cls) => {
    const l = document.createElement("div"); l.className = "linhaval" + (cls ? " " + cls : "");
    const n = document.createElement("span"); n.className = "n"; n.textContent = a;
    const v = document.createElement("span"); v.className = "v"; v.textContent = b;
    l.append(n, v); d.appendChild(l);
  };
  (x.itens || []).forEach(i => linha(i.nome, i.grupo === "tamanho" ? "" : (Number(i.valor) ? encReais(i.valor) : "incluso")));
  linha("Total", encReais(x.total), "total");

  const info = [
    ["Retirada", dataLonga(q.dia) + " às " + q.hora],
    ["Como", x.forma === "uber" ? "O cliente manda um Uber Flash (carro)" : "Retira no ateliê"],
    ["WhatsApp", encFone(x.cliente_whats)],
    x.cor ? ["Cor", x.cor] : null,
    x.escrita ? ["Escrita", "“" + x.escrita + "”"] : null,
    x.ocasiao ? ["Ocasião", x.ocasiao] : null,
    x.obs ? ["Observações", x.obs] : null,
    x.orcamento ? ["Atenção", "Pediu algo fora da lista. Confirme o valor final com o cliente."] : null
  ].filter(Boolean);
  const dl = document.createElement("dl"); dl.className = "enc-info";
  info.forEach(([a, b]) => {
    const dt = document.createElement("dt"); dt.textContent = a;
    const dd = document.createElement("dd"); dd.textContent = b;
    if(a === "Atenção") dd.className = "alerta";
    dl.append(dt, dd);
  });
  d.appendChild(dl);

  /* falar com o cliente, já com o texto do jeito da Jessica */
  const primeiro = String(x.cliente_nome || "").split(" ")[0];
  const txt = x.status === "nova"
    ? "oi, " + primeiro + "! aqui é a Jessica :) recebi seu pedido " + x.codigo + " p " + dataLonga(q.dia).toLowerCase()
      + " às " + q.hora + ".. total de " + encReais(x.total) + ". p reservar a data, o sinal é de " + encReais(x.sinal) + " no Pix."
    : x.status === "pronta"
      ? "oi, " + primeiro + "! seu bolo " + x.codigo + " está prontinho te esperando :)"
      : "oi, " + primeiro + "! aqui é a Jessica, sobre o seu pedido " + x.codigo + " :)";
  const wa = document.createElement("a");
  wa.className = "enc-wa"; wa.target = "_blank"; wa.rel = "noopener";
  wa.href = "https://wa.me/55" + String(x.cliente_whats).replace(/\D/g, "") + "?text=" + encodeURIComponent(txt);
  wa.textContent = "Falar com " + primeiro + " no WhatsApp";
  d.appendChild(wa);

  /* os próximos passos, só os que fazem sentido agora */
  const ac = document.createElement("div"); ac.className = "enc-acoes";
  const bt = (rot, cls, fn) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = rot;
    if(cls) b.className = cls;
    b.onclick = travar(b, fn);
    ac.appendChild(b);
  };
  if(x.status === "nova"){
    bt("Sinal recebido, confirmar", "", () => mudarEncomenda(x, { status: "confirmada", sinal_pago: true }, "Confirmada. A data está reservada."));
    bt("Confirmar sem sinal", "sec", () => mudarEncomenda(x, { status: "confirmada" }, "Confirmada, com o sinal ainda a receber."));
  }
  if(x.status === "confirmada"){
    if(!x.sinal_pago) bt("Sinal recebido", "", () => mudarEncomenda(x, { sinal_pago: true }, "Sinal marcado como recebido."));
    bt("Bolo pronto", x.sinal_pago ? "" : "sec", () => mudarEncomenda(x, { status: "pronta" }, "Marcado como pronto."));
  }
  if(x.status === "pronta"){
    bt("Entregue", "", () => mudarEncomenda(x, { status: "entregue" }, "Entregue. Bom trabalho :)"));
  }
  if(x.status === "entregue" || x.status === "cancelada"){
    bt("Reabrir", "sec", () => mudarEncomenda(x, { status: "confirmada" }, "Reaberta."));
  }
  if(x.status !== "cancelada" && x.status !== "entregue"){
    bt("Cancelar", "perigo", async () => {
      if(!confirm("Cancelar a encomenda " + x.codigo + " de " + x.cliente_nome + "?")) return;
      await mudarEncomenda(x, { status: "cancelada" }, "Encomenda cancelada.");
    });
  }
  d.appendChild(ac);

  const lb = document.createElement("label"); lb.className = "enc-nota";
  lb.appendChild(document.createTextNode("Anotação interna"));
  const ta = document.createElement("textarea"); ta.rows = 2; ta.value = x.nota_interna || "";
  ta.placeholder = "Só vocês veem. Ex.: cliente pediu vela, trazer caixa maior";
  ta.onblur = async () => {
    const v = ta.value.trim();
    if(v === (x.nota_interna || "")) return;
    const { error } = await sb.from("jb_encomenda").update({ nota_interna: v || null, atualizado_em: new Date().toISOString() }).eq("id", x.id);
    if(error){ toast("Não consegui salvar a anotação.", "err"); return; }
    x.nota_interna = v || null;
    toast("Anotação salva.");
  };
  lb.appendChild(ta);
  d.appendChild(lb);
  return d;
}

async function mudarEncomenda(x, campos, recado){
  const { error } = await sb.from("jb_encomenda")
    .update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", x.id);
  if(error){ aviso("encMsg","Não consegui salvar agora. Tente de novo.","err"); return; }
  Object.assign(x, campos);
  toast(recado);
  montarPedidos();
}

/* ============================================================
   CARDÁPIO E PREÇOS
   O que muda aqui vale na hora para o site.
   ============================================================ */
function montarCardapioBolos(){
  const box = $("encLista");
  box.innerHTML = "";
  const nota = document.createElement("p"); nota.className = "tip";
  nota.textContent = "O que você muda aqui vale na hora para o site. Desligar uma opção tira ela da página sem apagar nada. Os preços são por tamanho: PP e P costumam ser iguais, M e G também.";
  box.appendChild(nota);

  ENC_GRUPOS.forEach(([g, titulo, dica]) => {
    const ops = ENC.opcoes.filter(o => o.grupo === g);
    if(!ops.length) return;
    const h = document.createElement("div"); h.className = "grupotar"; h.textContent = titulo;
    box.appendChild(h);
    const dd = document.createElement("p"); dd.className = "enc-dica"; dd.textContent = dica;
    box.appendChild(dd);
    ops.forEach(o => box.appendChild(linhaOpcao(o, g !== "tamanho")));
  });
}

function linhaOpcao(o, comPreco){
  const r = document.createElement("div");
  r.className = "enc-op" + (o.ativo ? "" : " off");
  const cab = document.createElement("div"); cab.className = "enc-op-cab";
  const nm = document.createElement("b"); nm.textContent = o.nome + (o.descricao && o.grupo === "tamanho" ? " · " + o.descricao : "");
  const lig = document.createElement("label"); lig.className = "enc-lig";
  const ck = document.createElement("input"); ck.type = "checkbox"; ck.checked = !!o.ativo;
  ck.setAttribute("aria-label", "Mostrar " + o.nome + " no site");
  lig.append(ck, document.createTextNode(" no site"));
  ck.onchange = async () => {
    const { error } = await sb.from("jb_bolo_opcao").update({ ativo: ck.checked, atualizado_em: new Date().toISOString() }).eq("id", o.id);
    if(error){ ck.checked = !ck.checked; toast("Não consegui salvar.", "err"); return; }
    o.ativo = ck.checked;
    r.classList.toggle("off", !o.ativo);
    toast(o.nome + (o.ativo ? " voltou para o site." : " saiu do site."));
  };
  cab.append(nm, lig);
  r.appendChild(cab);

  if(comPreco){
    const g = document.createElement("div"); g.className = "enc-precos";
    [["pp","PP"],["p","P"],["m","M"],["g","G"]].forEach(([k, rot]) => {
      const lb = document.createElement("label");
      lb.appendChild(document.createTextNode(rot));
      const inp = document.createElement("input");
      inp.type = "tel"; inp.inputMode = "decimal";
      inp.value = moeda(o["preco_" + k] || 0);
      inp.setAttribute("aria-label", o.nome + ", tamanho " + rot);
      inp.onblur = async () => {
        const n = numBR(inp.value);
        if(n == null || n < 0){ inp.value = moeda(o["preco_" + k] || 0); return; }
        if(Number(o["preco_" + k]) === n){ inp.value = moeda(n); return; }
        const { error } = await sb.from("jb_bolo_opcao")
          .update({ ["preco_" + k]: n, atualizado_em: new Date().toISOString() }).eq("id", o.id);
        if(error){ inp.value = moeda(o["preco_" + k] || 0); toast("Não consegui salvar o preço.", "err"); return; }
        o["preco_" + k] = n;
        inp.value = moeda(n);
        toast(o.nome + " " + rot + ": R$ " + moeda(n) + ". Já vale no site.");
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
      lb.appendChild(inp);
      g.appendChild(lb);
    });
    r.appendChild(g);
  }
  return r;
}
