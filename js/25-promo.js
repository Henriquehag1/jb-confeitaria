/* JB OS · Promoção do dia.
   A 99Food escolhe os produtos do Top 3 e do Always-On; a loja só pode tirar.
   Esta tela diz, em cada desconto, quem se paga e quem não se paga. */

let PROMO = null;          // linhas de jb_promo_teto
let PROMO_CANAL = null;    // nome do canal escolhido
let PROMO_DESC = 25;       // desconto da campanha

async function abrirPromo(){
  show("scPromo");
  $("promoLista").innerHTML = "";
  aviso("promoMsg", "Carregando…", "");
  try {
    const { data, error } = await sb.from("jb_promo_teto")
      .select("produto,canal,canal_ordem,preco,cmv,custo_fixo_un,teto,lucro_20,lucro_25,lucro_30,lucro_40");
    if(error) throw error;
    PROMO = data || [];
  } catch(e){
    PROMO = null;
    aviso("promoMsg", "Não consegui carregar os preços. Toque em atualizar.", "erro");
    return;
  }
  if(!PROMO.length){
    aviso("promoMsg", "Nenhum produto com preço cadastrado.", "warn");
    return;
  }
  const canais = [];
  PROMO.forEach(l => { if(canais.every(c => c.nome !== l.canal)) canais.push({ nome: l.canal, ordem: l.canal_ordem }); });
  canais.sort((a,b) => (a.ordem || 0) - (b.ordem || 0));
  if(!PROMO_CANAL || canais.every(c => c.nome !== PROMO_CANAL)){
    const nn = canais.filter(c => /99/.test(c.nome));
    PROMO_CANAL = nn.length ? nn[0].nome : canais[0].nome;
  }
  montarBotoes("promoCanais", canais.map(c => c.nome), () => PROMO_CANAL, v => { PROMO_CANAL = v; pintarPromo(); });
  montarBotoes("promoDescs", [20, 25, 30, 40], () => PROMO_DESC, v => { PROMO_DESC = v; pintarPromo(); });
  pintarPromo();
}

/* uma fileira de botões que se comportam como escolha única */
function montarBotoes(alvo, valores, atual, aoEscolher){
  const box = $(alvo);
  box.innerHTML = "";
  valores.forEach(v => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = typeof v === "number" ? v + "%" : v;
    b.onclick = () => { aoEscolher(v); };
    box.appendChild(b);
  });
  pintarBotoes(alvo, valores, atual);
}
function pintarBotoes(alvo, valores, atual){
  const bs = $(alvo).querySelectorAll("button");
  for(let i = 0; i < bs.length; i++)
    bs[i].setAttribute("aria-pressed", valores[i] === atual() ? "true" : "false");
}

function faixaDe(lucro){
  if(lucro >= 1) return "ok";
  if(lucro >= 0) return "limite";
  return "fora";
}

function pintarPromo(){
  if(!PROMO) return;
  const campo = "lucro_" + PROMO_DESC;
  const linhas = PROMO.filter(l => l.canal === PROMO_CANAL)
                      .map(l => ({ nome: l.produto, preco: Number(l.preco),
                                   teto: Number(l.teto), lucro: Number(l[campo]) }))
                      .sort((a,b) => b.teto - a.teto);

  const canais = [];
  PROMO.forEach(l => { if(canais.every(c => c !== l.canal)) canais.push(l.canal); });
  pintarBotoes("promoCanais", canais.sort((a,b) => {
    const oa = PROMO.filter(l => l.canal === a)[0].canal_ordem || 0;
    const ob = PROMO.filter(l => l.canal === b)[0].canal_ordem || 0;
    return oa - ob;
  }), () => PROMO_CANAL);
  pintarBotoes("promoDescs", [20, 25, 30, 40], () => PROMO_DESC);

  const fora = linhas.filter(l => l.lucro < 0).length;
  aviso("promoMsg",
    fora === 0 ? "A −" + PROMO_DESC + "%, todos os produtos ainda se pagam no " + PROMO_CANAL + "."
    : "A −" + PROMO_DESC + "%, " + fora + (fora === 1 ? " produto dá" : " produtos dão")
      + " prejuízo no " + PROMO_CANAL + ". Tire da lista da promoção.",
    fora === 0 ? "ok" : "warn");

  const box = $("promoLista");
  box.innerHTML = "";
  const grupos = [
    ["ok", "Pode ficar"],
    ["limite", "No limite, ganha menos de R$ 1"],
    ["fora", "Tirar da lista"]
  ];
  grupos.forEach(g => {
    const doGrupo = linhas.filter(l => faixaDe(l.lucro) === g[0]);
    if(!doGrupo.length) return;
    const h = document.createElement("div");
    h.className = "promo-cab " + g[0];
    h.textContent = g[1] + " · " + doGrupo.length;
    box.appendChild(h);
    doGrupo.forEach(l => {
      const row = document.createElement("div");
      row.className = "promo-ln " + g[0];
      const esq = document.createElement("div");
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = l.nome;
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = dinheiro(l.preco) + " · aguenta até " + Math.max(0, Math.round(l.teto * 100)) + "%";
      esq.appendChild(nm); esq.appendChild(sub);
      const val = document.createElement("span");
      val.className = "vl";
      val.textContent = (l.lucro < 0 ? "−" : "+") + dinheiro(Math.abs(l.lucro));
      row.appendChild(esq); row.appendChild(val);
      box.appendChild(row);
    });
  });

  const pe = document.createElement("p");
  pe.className = "promo-pe";
  pe.textContent = "Por unidade, depois da fatia fixa da plataforma, da entrega bancada, "
    + "do desconto, do CMV da ficha e do custo fixo rateado por item. "
    + "Combo aguenta mais: o custo fixo do pedido se divide por dois itens.";
  box.appendChild(pe);
}
