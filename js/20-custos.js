/* JB OS · custos: fichas técnicas, insumos, preço e margem por canal, custo fixo calculado. */

/* ============================================================
   CUSTOS E FICHAS TÉCNICAS (só gestor)
   ============================================================ */
let ABA = "fichas";
let CATALOGO = [];   // insumos + sub-receitas, para o seletor
let FICHA = null;    // receita aberta
let FITENS = [];     // itens da receita aberta
let FICHA_SUJA = false;   // há alteração na ficha ainda não salva
let TIPO = "ficha";  // "ficha" (produto) ou "sub" (massa ou recheio)
let FOTOS = {};      // ficha_id -> url da foto
let INSUMOS_CACHE = null;   // insumos, usos e último preço pago, para a busca não ir ao banco a cada tecla

const dinheiro = v => (v === null || v === undefined || isNaN(v))
  ? "sem custo"
  : "R$ " + Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

async function abrirCustos(){
  aviso("custosMsg","","");
  INSUMOS_CACHE = null;   // a lista de insumos se refaz a cada entrada em Custos
  if(!CATALOGO.length){
    const [ins, sub] = await Promise.all([
      sb.from("jb_insumo").select("nome,unidade,custo_unit,equiv_g,categoria").order("nome"),
      sb.from("jb_subreceita_custo").select("nome,custo_kg_calculado,custo_kg_planilha").order("nome")
    ]);
    CATALOGO = [
      ...(sub.data || []).map(s => ({nome:s.nome, tipo:"sub-receita", unidade:"kg",
            custo:(s.custo_kg_calculado ?? s.custo_kg_planilha), equiv_g:null, categoria:"ingrediente"})),
      ...(ins.data || []).map(i => ({nome:i.nome, tipo:"insumo", unidade:i.unidade || "g",
            custo:i.custo_unit, equiv_g:i.equiv_g, categoria:i.categoria || "ingrediente"}))
    ];
  }
  trocarAba(ABA);
  show("scCustos");
}

function trocarAba(a){
  ABA = a;
  $("abaFichas").setAttribute("aria-pressed", String(a === "fichas"));
  $("abaInsumos").setAttribute("aria-pressed", String(a === "insumos"));
  $("abaPreco").setAttribute("aria-pressed", String(a === "preco"));
  $("abaGeladeira").setAttribute("aria-pressed", String(a === "geladeira"));
  $("buscaInsumo").classList.toggle("hide", a !== "insumos");
  $("precoCab").classList.toggle("hide", a !== "preco");
  $("formCustos").classList.add("hide");
  if(a === "fichas") listarFichas();
  else if(a === "insumos") listarInsumos();
  else if(a === "geladeira") listarGeladeira();
  else listarPrecos();
}

/* ---------- itens da geladeira, a lista que a equipe conta ----------
   O mesmo editor serve em dois lugares: dentro de Custos e preços e
   dentro da própria contagem, para a Jessica arrumar a lista na hora.  */
async function listarGeladeira(){
  await editorDaLista($("listaCustos"), "custosMsg", listarGeladeira);
}

async function editorDaLista(box, alvoMsg, aoMudar){
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  const { data, error } = await sb.from("jb_produto_app").select("id,nome,ordem,ativo,foto_url").order("ordem");
  if(error){ box.innerHTML=""; aviso(alvoMsg,"Não consegui carregar a lista agora.","err"); return; }
  const itens = data || [];
  box.innerHTML = "";

  const nota = document.createElement("p");
  nota.className = "tip"; nota.style.margin = "0 2px 12px";
  nota.textContent = "Esta é a lista que aparece na contagem, nesta ordem. Tirar um item não apaga as contagens antigas: ele só some das próximas.";
  box.appendChild(nota);

  itens.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "ing" + (p.ativo ? "" : " semq");

    const top = document.createElement("div"); top.className = "top";
    top.style.gap = "10px";
    const imP = imgFoto(p.foto_url);
    if(imP) top.appendChild(imP);
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = p.nome; inp.className = "q";
    inp.style.width = "100%"; inp.style.textAlign = "left";
    inp.style.padding = "0 10px"; inp.style.fontWeight = "400";
    inp.setAttribute("aria-label","Nome do item " + p.nome);
    inp.onblur = async () => {
      const novo = inp.value.trim();
      if(!novo || novo === p.nome){ inp.value = p.nome; return; }
      const { error } = await sb.from("jb_produto").update({ nome: novo }).eq("id", p.id);
      if(error){ inp.value = p.nome; aviso(alvoMsg,"Não consegui renomear.","err"); return; }
      p.nome = novo;
      await recarregarProdutos();
      aviso(alvoMsg,"Item renomeado para " + novo + ".","ok");
    };
    inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
    top.appendChild(inp);

    const bot = document.createElement("div"); bot.className = "bot";
    const mover = async (delta) => {
      const j = i + delta;
      if(j < 0 || j >= itens.length) return;
      const outro = itens[j];
      const a = p.ordem, b = outro.ordem;
      await sb.from("jb_produto").update({ ordem: b }).eq("id", p.id);
      await sb.from("jb_produto").update({ ordem: a }).eq("id", outro.id);
      aoMudar();
    };
    const bSobe = document.createElement("button");
    bSobe.type = "button"; bSobe.className = "rm"; bSobe.textContent = "↑ subir";
    bSobe.style.marginLeft = "0"; bSobe.onclick = () => mover(-1);
    const bDesce = document.createElement("button");
    bDesce.type = "button"; bDesce.className = "rm"; bDesce.textContent = "↓ descer";
    bDesce.style.marginLeft = "0"; bDesce.onclick = () => mover(1);

    const bAtivo = document.createElement("button");
    bAtivo.type = "button"; bAtivo.className = "rm";
    bAtivo.textContent = p.ativo ? "tirar da contagem" : "voltar para a contagem";
    bAtivo.onclick = travar(bAtivo, async () => {
      const { error } = await sb.from("jb_produto").update({ ativo: !p.ativo }).eq("id", p.id);
      if(error){ aviso(alvoMsg,"Não consegui mudar esse item.","err"); return; }
      aviso(alvoMsg, p.nome + (p.ativo ? " saiu da contagem." : " voltou para a contagem."), "ok");
      await recarregarProdutos();
      aoMudar();
    });
    bot.append(bSobe, bDesce, bAtivo);
    row.append(top, bot);
    box.appendChild(row);
  });

  const add = document.createElement("div");
  add.className = "ing";
  const t2 = document.createElement("div"); t2.className = "top";
  const novo = document.createElement("input");
  novo.type = "text"; novo.className = "q"; novo.placeholder = "Nome do item novo";
  novo.style.width = "100%"; novo.style.textAlign = "left";
  novo.style.padding = "0 10px"; novo.style.fontWeight = "400";
  novo.setAttribute("aria-label","Nome do item novo");
  t2.appendChild(novo);
  const b2 = document.createElement("div"); b2.className = "bot";
  const salvar = document.createElement("button");
  salvar.type = "button"; salvar.className = "rm"; salvar.style.marginLeft = "0";
  salvar.textContent = "+ adicionar à contagem";
  salvar.onclick = travar(salvar, async () => {
    const nome = novo.value.trim();
    if(!nome) return;
    const ordem = Math.max(0, ...itens.map(x => x.ordem || 0)) + 1;
    const { error } = await sb.from("jb_produto").insert({ nome, ordem, ativo: true });
    if(error){
      aviso(alvoMsg, /unique|duplicate/i.test(error.message || "") ? "Já existe um item com esse nome." : "Não consegui adicionar esse item.","err");
      return;
    }
    aviso(alvoMsg, nome + " entrou na contagem.","ok");
    await recarregarProdutos();
    aoMudar();
  });
  b2.appendChild(salvar);
  add.append(t2, b2);
  box.appendChild(add);
}

async function recarregarProdutos(){
  const { data, error } = await sb.from("jb_produto_app").select("id,nome,ordem,foto_url").eq("ativo", true).order("ordem");
  if(error){ PRODUTOS_OK = false; return; }
  PRODUTOS = data || [];
  PRODUTOS_OK = true;
}

/* As fotos do iFood vêm em 1300px. Numa lista de 18 itens no 4G isso é peso morto,
   então miniatura pede a versão leve e só a tela da receita pede a maior. */
function fotoTam(url, tam){
  if(!url) return url;
  const m = url.match(/^https:\/\/static-images\.ifood\.com\.br\/(pratos\/.+)$/);
  return m ? "https://static.ifood-static.com.br/image/upload/" + tam + "/" + m[1] : url;
}

function imgFoto(url, classe){
  if(!url) return null;
  const im = document.createElement("img");
  im.className = "foto" + (classe ? " " + classe : "");
  im.src = fotoTam(url, classe === "g" ? "t_medium" : "t_low");
  im.alt = ""; im.loading = "lazy"; im.decoding = "async";
  im.onerror = () => im.remove();
  return im;
}

function linhaLista(titulo, sub, valor, classe, onclick, foto){
  const b = document.createElement("button");
  b.type = "button";
  b.className = "lin " + (classe || "");
  const im = imgFoto(foto);
  if(im) b.appendChild(im);
  const n = document.createElement("span"); n.className = "n";
  n.textContent = titulo;
  if(sub){ const s = document.createElement("small"); s.textContent = sub; n.appendChild(s); }
  const v = document.createElement("span");
  v.className = "v" + (classe === "falta" ? " vazio" : "");
  v.textContent = valor;
  b.append(n, v);
  b.onclick = onclick;
  return b;
}

async function listarFichas(){
  const box = $("listaCustos");
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  const [fc, sc, ft] = await Promise.all([
    sb.from("jb_ficha_custo").select("*").order("nome"),
    sb.from("jb_subreceita_custo").select("*").order("nome"),
    sb.from("jb_ficha").select("id,foto_url")
  ]);
  FOTOS = {};
  (ft.data || []).forEach(f => { if(f.foto_url) FOTOS[f.id] = f.foto_url; });
  if(fc.error){ box.innerHTML=""; aviso("custosMsg","Não consegui carregar as receitas agora.","err"); return; }
  box.innerHTML = "";

  const h1 = document.createElement("div"); h1.className = "grupo"; h1.textContent = "Produtos";
  box.appendChild(h1);
  box.appendChild(linhaLista("Nova ficha técnica",
    "Produto novo: nome, ingredientes, rendimento e passo a passo", "+", "", () => abrirFicha(null,"ficha")));

  (fc.data || []).forEach(f => {
    const incompleta = f.rascunho || f.itens_sem_quantidade > 0 || f.itens_sem_preco > 0 || !f.itens;
    const sub =
      f.itens_sem_quantidade > 0 ? f.itens_sem_quantidade + " ingrediente(s) sem quantidade"
    : f.itens_sem_preco > 0      ? f.itens_sem_preco + " ingrediente(s) sem preço"
    : f.rascunho                 ? "receita ainda não preenchida"
    : f.itens + " ingredientes · " + (f.tempo_mo_min || 0) + " min por unidade";
    const valor = f.rascunho && !f.itens_sem_quantidade ? "rascunho"
                : incompleta ? "incompleta" : dinheiro(f.custo_unit);
    box.appendChild(linhaLista(f.nome, sub, valor, incompleta ? "falta" : "ok",
      () => abrirFicha(f.id, "ficha"), FOTOS[f.id]));
  });

  const h2 = document.createElement("div"); h2.className = "grupo";
  h2.textContent = "Massas e recheios";
  box.appendChild(h2);
  box.appendChild(linhaLista("Nova massa ou recheio",
    "O que é feito em quilo e entra dentro dos produtos", "+", "", () => abrirFicha(null,"sub")));

  (sc.data || []).forEach(s => {
    const custo = s.custo_kg_calculado ?? s.custo_kg_planilha;
    box.appendChild(linhaLista(s.nome,
      "rende " + Number(s.rendimento_kg || 0).toLocaleString("pt-BR",{maximumFractionDigits:3}) + " kg",
      custo == null ? "sem custo" : dinheiro(custo) + " / kg",
      custo == null ? "falta" : "ok",
      () => abrirFicha(s.id, "sub")));
  });
}

async function listarInsumos(){
  const box = $("listaCustos");
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  /* Os dados ficam em memória: a busca filtra sem ir ao banco a cada tecla. */
  if(!INSUMOS_CACHE){
    const [ins, uso, pago] = await Promise.all([
      sb.from("jb_insumo").select("id,nome,unidade,custo_unit,fornecedor,categoria,equiv_g,ativo").order("nome"),
      sb.from("jb_uso_ingrediente").select("nome,em_fichas,em_subreceitas"),
      sb.from("jb_insumo_ultimo_pago").select("insumo_id,compra_item_id,data,fornecedor,custo_base,unidade_base")
    ]);
    if(ins.error){ box.innerHTML = ""; aviso("custosMsg","Não consegui carregar os insumos agora.","err"); return; }
    const USOS = {}, PAGO = {};
    (uso.data || []).forEach(u => USOS[u.nome] = Number(u.em_fichas) + Number(u.em_subreceitas));
    (pago.data || []).forEach(p => PAGO[p.insumo_id] = p);
    INSUMOS_CACHE = { data: ins.data || [], USOS, PAGO };
  }
  const { data, USOS, PAGO } = INSUMOS_CACHE;
  const termo = ($("buscaInsumo").value || "").toLowerCase().trim();
  box.innerHTML = "";

  box.appendChild(linhaLista("Novo ingrediente",
    "Nome, unidade de compra e preço", "+", "",
    () => miniForm("formCustos", "Ingrediente novo", [
      { chave:"nome", rotulo:"Nome", largo:true, dica:"Ex.: Pistache moído" },
      { chave:"unidade", rotulo:"Comprado por", opcoes:UNIDADES, valor:"kg" },
      { chave:"custo", rotulo:"Preço por essa unidade", numero:true, dica:"0,00" },
      { chave:"categoria", rotulo:"É o quê", opcoes:[["ingrediente","ingrediente"],["embalagem","embalagem"]], valor:"ingrediente" },
      { chave:"fornecedor", rotulo:"Fornecedor (opcional)", dica:"" }
    ], async v => {
      if(!v.nome){ aviso("custosMsg","Dê um nome ao ingrediente.","warn"); return false; }
      const { error } = await sb.from("jb_insumo").insert({
        nome:v.nome, unidade:v.unidade, custo_unit:numBR(v.custo),
        categoria:v.categoria, fornecedor:v.fornecedor || null, ativo:true });
      if(error){ aviso("custosMsg","Não consegui criar. Talvez já exista um com esse nome.","err"); return false; }
      CATALOGO = []; INSUMOS_CACHE = null;
      aviso("custosMsg", v.nome + " cadastrado.","ok");
      listarInsumos();
    }, { rotuloSalvar:"Criar" })));

  (data || []).filter(i => !termo || i.nome.toLowerCase().includes(termo)).forEach(i => {
    const row = document.createElement("div");
    row.className = "ing" + (i.custo_unit === null ? " semq" : "");
    const top = document.createElement("div"); top.className = "top";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = i.nome;
    const cs = document.createElement("span"); cs.className = "cst";
    cs.textContent = "por " + (i.unidade || "un") + (i.fornecedor ? " · " + i.fornecedor : "");
    top.append(nm, cs);
    const bot = document.createElement("div"); bot.className = "bot";
    const inp = document.createElement("input");
    inp.className = "q"; inp.type = "tel"; inp.inputMode = "decimal";
    inp.value = i.custo_unit === null ? "" : Number(i.custo_unit).toFixed(2).replace(".",",");
    inp.setAttribute("aria-label","Custo de " + i.nome);
    let salvando = false;
    const salvar = async () => {
      if(salvando) return;
      const v = String(numBR(inp.value) ?? "").trim();
      const num = v === "" ? null : parseFloat(v);
      if(v !== "" && isNaN(num)) return;
      if(num === (i.custo_unit == null ? null : Number(i.custo_unit))) return;
      salvando = true; inp.disabled = true;
      const { error } = await sb.from("jb_insumo").update({ custo_unit: num }).eq("id", i.id);
      inp.disabled = false; salvando = false;
      if(error){ aviso("custosMsg","Não consegui salvar o preço de " + i.nome + ".","err"); return; }
      i.custo_unit = num; CATALOGO = [];
      row.classList.toggle("semq", num === null);
      pintaPago();
      toast("Preço de " + i.nome + " atualizado. As fichas que usam esse item já recalcularam.");
    };
    inp.onblur = salvar;
    inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
    const un = document.createElement("span"); un.className = "cst";
    un.textContent = "reais por " + (i.unidade || "un");

    const editar = document.createElement("button");
    editar.type = "button"; editar.className = "rm"; editar.textContent = "editar";
    editar.onclick = () => formEditarInsumo(i, USOS[i.nome] || 0);

    bot.append(inp, un, editar);
    row.append(top, bot);

    /* A compra alimenta o custo: o último preço pago aparece ao lado, e um toque aplica. */
    const pg = PAGO[i.id];
    const pagoRow = document.createElement("div"); pagoRow.className = "pago";
    const pintaPago = () => {
      pagoRow.innerHTML = "";
      if(!pg || pg.custo_base == null) return;
      const dif = Number(pg.custo_base) - Number(i.custo_unit || 0);
      const igual = Math.abs(dif) < 0.005;
      const t = document.createElement("span");
      t.textContent = "último pago: R$ " + moeda(pg.custo_base) + " por " + (pg.unidade_base || i.unidade)
        + " em " + dataCurta(pg.data) + (pg.fornecedor ? ", " + pg.fornecedor : "")
        + (igual ? " (igual ao sistema)" : (i.custo_unit == null ? "" : (dif > 0 ? " (+" : " (") + pct(dif / Number(i.custo_unit)) + ")"));
      pagoRow.appendChild(t);
      if(!igual && String(pg.unidade_base || "").toLowerCase() === String(i.unidade || "").toLowerCase()){
        const usar = document.createElement("button");
        usar.type = "button"; usar.className = "rm"; usar.textContent = "usar esse preço";
        usar.onclick = travar(usar, async () => {
          const { data: novo, error } = await sb.rpc("jb_aplicar_preco_compra", { p_item_id: pg.compra_item_id });
          if(error){ aviso("custosMsg","Não consegui aplicar: " + (error.message || ""),"err"); return; }
          i.custo_unit = Number(novo); CATALOGO = [];
          inp.value = Number(novo).toFixed(2).replace(".",",");
          row.classList.remove("semq");
          pintaPago();
          toast(i.nome + " agora custa R$ " + moeda(novo) + ". As fichas já recalcularam.");
        });
        pagoRow.appendChild(usar);
      }
    };
    pintaPago();
    row.appendChild(pagoRow);
    box.appendChild(row);
  });
}

function formEditarInsumo(i, usos){
  const campos = [
    { chave:"nome", rotulo:"Nome", largo:true, valor:i.nome },
    { chave:"unidade", rotulo:"Comprado por", opcoes:UNIDADES, valor:i.unidade || "kg" },
    { chave:"custo", rotulo:"Preço por essa unidade", numero:true,
      valor: i.custo_unit == null ? "" : Number(i.custo_unit).toFixed(2) },
    { chave:"categoria", rotulo:"É o quê",
      opcoes:[["ingrediente","ingrediente"],["embalagem","embalagem"]], valor:i.categoria || "ingrediente" },
    { chave:"equiv_g", rotulo:"Peso do pacote em g", numero:true,
      valor: i.equiv_g == null ? "" : String(i.equiv_g) },
    { chave:"fornecedor", rotulo:"Fornecedor", valor:i.fornecedor || "", largo:true }
  ];
  miniForm("formCustos", i.nome, campos, async v => {
    if(!v.nome){ aviso("custosMsg","O nome não pode ficar vazio.","warn"); return false; }
    if(v.nome !== i.nome){
      const { error } = await sb.rpc("jb_renomear_ingrediente", { p_antigo: i.nome, p_novo: v.nome });
      if(error){
        aviso("custosMsg", String(error.message||"").includes("ja existe")
          ? "Já existe outro item com esse nome." : "Não consegui renomear.","err");
        return false;
      }
    }
    const { error } = await sb.from("jb_insumo").update({
      unidade: v.unidade, custo_unit: numBR(v.custo), categoria: v.categoria,
      equiv_g: numBR(v.equiv_g), fornecedor: v.fornecedor || null
    }).eq("id", i.id);
    if(error){ aviso("custosMsg","Não consegui salvar.","err"); return false; }
    CATALOGO = []; INSUMOS_CACHE = null;
    aviso("custosMsg", v.nome + " atualizado. As receitas que usam já recalcularam.","ok");
    listarInsumos();
  }, {
    nota: "Peso do pacote só importa quando você compra por unidade e usa por grama, como o Kinder e o Oreo."
        + (usos ? " Este item está em " + usos + " receita(s)." : " Não está em nenhuma receita."),
    aoApagar: async () => {
      if(usos > 0){
        aviso("custosMsg","Não dá para apagar: " + i.nome + " está em " + usos +
              " receita(s). Tire das receitas primeiro.","warn");
        return;
      }
      if(!confirm("Apagar " + i.nome + " de vez?")) return;
      const { error } = await sb.from("jb_insumo").delete().eq("id", i.id);
      if(error){ aviso("custosMsg","Não consegui apagar.","err"); return; }
      CATALOGO = []; INSUMOS_CACHE = null;
      $("formCustos").classList.add("hide");
      aviso("custosMsg", i.nome + " apagado.","ok");
      listarInsumos();
    },
    rotuloApagar: "apagar ingrediente"
  });
}

/* ============================================================
   PREÇO E MARGEM POR CANAL (só gestor)
   ============================================================ */
let CANAIS = [];
let CANAL = null;      // canal selecionado
let CFG = {};          // jb_config
let LINHAS = [];       // uma linha por produto no canal selecionado
let ajustesAbertos = false;
let CANAL_ATUALIZADO = false;

const pct = v => (Number(v) * 100).toLocaleString("pt-BR",{maximumFractionDigits:1}) + "%";
/* Um parser de número só, para o app inteiro. Aceita o que o teclado do celular manda:
   "18,90", "18.90", "1.250,50", "1,250.50", "1250". Regra: quando há vírgula e ponto,
   o último dos dois é o decimal; quando há só ponto, ele é decimal se tiver 1 ou 2
   dígitos depois ("18.90"), e milhar se tiver 3 ("1.250"). */
const numBR = s => {
  let v = String(s == null ? "" : s).trim().replace(/\s|R\$/g, "");
  if(v === "") return null;
  const temV = v.includes(","), temP = v.includes(".");
  if(temV && temP){
    if(v.lastIndexOf(",") > v.lastIndexOf(".")) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if(temV){
    v = v.replace(/,/g, ".");
  } else if(temP){
    const partes = v.split(".");
    const ultima = partes[partes.length - 1];
    if(partes.length > 2 || ultima.length === 3) v = partes.join("");   // 1.250 ou 1.250.000
    // 18.90, 1.5, 3.125 com 1 ou 2 casas: ponto é decimal e fica como está
  }
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};
const moeda = v => Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

function contaLinha(l){
  const fatia = CANAL.taxa_efetiva != null
    ? Number(CANAL.taxa_efetiva) : Number(CANAL.taxa) + Number(CANAL.promo);
  const sobra = 1 - fatia;                     // quanto do preço sobra depois das taxas
  const alvo  = Number(CFG.margem_alvo || 0);
  const custo = Number(l.custo_total || 0);
  const out = { custo, sobra, empata: sobra > 0 ? custo / sobra : null,
                minimo: (sobra - alvo) > 0 ? custo / (sobra - alvo) : null };
  if(l.preco == null){ out.preco = null; return out; }
  out.preco  = Number(l.preco);
  out.lucro  = out.preco * sobra - custo;
  out.margem = out.preco > 0 ? out.lucro / out.preco : 0;
  return out;
}

async function listarPrecos(){
  const box = $("listaCustos");
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  if(!CANAIS.length){
    const [c, cfg] = await Promise.all([
      sb.from("jb_canal").select("*").order("ordem"),
      sb.from("jb_config").select("chave,valor")
    ]);
    CANAIS = c.data || [];
    (cfg.data || []).forEach(r => CFG[r.chave] = Number(r.valor));
    CANAL = CANAIS[0] || null;
  }
  if(!CANAL){ box.innerHTML = ""; aviso("custosMsg","Nenhum canal cadastrado ainda.","warn"); return; }
  if(!Object.keys(FOTOS).length){
    const { data: ft } = await sb.from("jb_ficha").select("id,foto_url");
    (ft || []).forEach(f => { if(f.foto_url) FOTOS[f.id] = f.foto_url; });
  }
  const { data, error } = await sb.from("jb_margem")
    .select("ficha_id,produto,rascunho,preco,custo_total,cmv")
    .eq("canal_id", CANAL.id);
  if(error){ box.innerHTML = ""; aviso("custosMsg","Não consegui carregar os preços agora.","err"); return; }
  LINHAS = (data || []).filter(l => l.custo_total != null);
  desenharPrecos();
}

function desenharPrecos(){
  montarChips();
  montarPlacar();
  montarListaPrecos();
}

function montarChips(){
  const box = $("precoCanais");
  box.innerHTML = "";
  CANAIS.forEach(c => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c.nome;
    b.setAttribute("aria-pressed", String(c.id === CANAL.id));
    b.onclick = () => { CANAL = c; ajustesAbertos = false; listarPrecos(); };
    box.appendChild(b);
  });
  const mais = document.createElement("button");
  mais.type = "button"; mais.textContent = "+ canal";
  mais.setAttribute("aria-pressed","false");
  mais.onclick = () => formCanal(null);
  box.appendChild(mais);
}

function formCanal(canal){
  const novo = !canal;
  miniForm("formCustos", novo ? "Canal novo" : canal.nome, [
    { chave:"nome", rotulo:"Nome do canal", largo:true, valor: novo ? "" : canal.nome, dica:"Ex.: Rappi" },
    { chave:"taxa", rotulo:"Taxa do app (%)", numero:true, valor: novo ? "" : (Number(canal.taxa)*100).toFixed(2) },
    { chave:"promo", rotulo:"Promoção (%)", numero:true, valor: novo ? "" : (Number(canal.promo)*100).toFixed(2) }
  ], async v => {
    if(!v.nome){ aviso("custosMsg","Dê um nome ao canal.","warn"); return false; }
    const taxa  = (numBR(v.taxa)  || 0) / 100;
    const promo = (numBR(v.promo) || 0) / 100;
    if(taxa + promo >= 1){ aviso("custosMsg","Taxa mais promoção não pode chegar a 100%.","warn"); return false; }
    if(novo){
      const ordem = Math.max(0, ...CANAIS.map(c => c.ordem || 0)) + 1;
      const { data, error } = await sb.from("jb_canal")
        .insert({ nome:v.nome, taxa, promo, ordem, ativo:true }).select("id").single();
      if(error){ aviso("custosMsg","Não consegui criar o canal.","err"); return false; }
      CANAIS = []; CANAL = null;
      await listarPrecos();
      const novoCanal = CANAIS.find(c => c.id === data.id);
      if(novoCanal){ CANAL = novoCanal; await listarPrecos(); }
      aviso("custosMsg", v.nome + " criado. Agora coloque os preços.","ok");
    } else {
      const { error } = await sb.from("jb_canal")
        .update({ nome:v.nome, taxa, promo }).eq("id", canal.id);
      if(error){ aviso("custosMsg","Não consegui salvar o canal.","err"); return false; }
      CANAIS = []; CANAL = null;
      await listarPrecos();
      aviso("custosMsg","Canal atualizado.","ok");
    }
  }, {
    rotuloSalvar: novo ? "Criar canal" : "Salvar",
    nota: novo ? "Depois de criar, os preços deste canal começam vazios."
               : "Mudar a taxa aqui muda a margem de todos os produtos deste canal.",
    aoApagar: novo ? null : async () => {
      if(!confirm("Apagar o canal " + canal.nome + "?\n\nIsso apaga junto todos os preços cadastrados nele.\n\nNão dá para desfazer.")) return;
      const { error } = await sb.from("jb_canal").delete().eq("id", canal.id);
      if(error){ aviso("custosMsg","Não consegui apagar o canal.","err"); return; }
      $("formCustos").classList.add("hide");
      CANAIS = []; CANAL = null;
      await listarPrecos();
      aviso("custosMsg","Canal apagado.","ok");
    },
    rotuloApagar: "apagar canal"
  });
}

function montarPlacar(){
  const box = $("precoPlacar");
  const contas = LINHAS.filter(l => !l.rascunho).map(contaLinha);
  const comPreco = contas.filter(c => c.preco != null);
  const ruins = comPreco.filter(c => c.lucro < 0);
  const media = comPreco.length
    ? comPreco.reduce((s,c) => s + c.lucro, 0) / comPreco.length : 0;

  box.innerHTML = "";
  const g = document.createElement("div");
  g.className = "g " + (ruins.length ? "alerta" : "bom");
  g.textContent = ruins.length
    ? ruins.length + " de " + comPreco.length + " no prejuízo"
    : (comPreco.length ? "Todos no azul" : "Sem preços aqui ainda");
  const p = document.createElement("p");
  const fatia = CANAL.taxa_efetiva != null
    ? Number(CANAL.taxa_efetiva) : Number(CANAL.taxa) + Number(CANAL.promo);
  const taxaTxt = "O app fica com " + pct(fatia) + " do preço" +
    (CANAL.taxa_efetiva != null ? ", medido" : ", estimado");
  p.textContent = comPreco.length
    ? taxaTxt + ". Cada venda deixa em média " +
      (media < 0 ? "um prejuízo de R$ " + moeda(-media) : "R$ " + moeda(media)) + "."
    : taxaTxt + ". Coloque os preços abaixo para ver a margem.";
  box.append(g, p);

  const taxas = document.createElement("div");
  taxas.className = "taxas";
  const campos = [
    ["taxa","Taxa do app","estimativa"],
    ["promo","Desconto médio","estimativa"],
    ["taxa_efetiva","Fatia real do app","medido, manda nos outros dois"]
  ];
  campos.forEach(([campo,rot,dica]) => {
    const lb = document.createElement("label");
    if(campo === "taxa_efetiva") lb.className = "wide";
    lb.textContent = rot + " (%)";
    const inp = document.createElement("input");
    inp.type = "tel"; inp.inputMode = "decimal";
    inp.placeholder = campo === "taxa_efetiva" ? "deixe vazio se ainda não mediu" : "";
    inp.value = CANAL[campo] == null ? ""
      : (Number(CANAL[campo]) * 100).toLocaleString("pt-BR",{maximumFractionDigits:2});
    inp.title = dica;
    inp.onblur = async () => {
      const vazio = inp.value.trim() === "";
      const n = vazio ? null : numBR(inp.value);
      if(!vazio && (n == null || n < 0 || n > 95)){
        inp.value = CANAL[campo] == null ? "" : (Number(CANAL[campo])*100).toLocaleString("pt-BR",{maximumFractionDigits:2});
        return;
      }
      if(campo !== "taxa_efetiva" && n == null) { inp.value = (Number(CANAL[campo])*100).toLocaleString("pt-BR",{maximumFractionDigits:2}); return; }
      const novo = n == null ? null : n / 100;
      if(novo === (CANAL[campo] == null ? null : Number(CANAL[campo]))) return;
      const patch = { [campo]: novo };
      if(campo === "taxa_efetiva") patch.taxa_efetiva_em = novo == null ? null : hojeSP();
      const { error } = await sb.from("jb_canal").update(patch).eq("id", CANAL.id);
      if(error){ aviso("custosMsg","Não consegui salvar.","err"); return; }
      Object.assign(CANAL, patch);
      const ref = CANAIS.find(c => c.id === CANAL.id); if(ref) Object.assign(ref, patch);
      aviso("custosMsg", CANAL.nome + " atualizado.","ok");
      listarPrecos();
    };
    inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
    lb.appendChild(inp);
    taxas.appendChild(lb);
  });
  box.appendChild(taxas);

  const expl = document.createElement("p");
  expl.className = "nota-taxa";
  if(CANAL.taxa_efetiva != null){
    const dias = CANAL.taxa_efetiva_em ? Math.round((new Date(hojeSP()) - new Date(CANAL.taxa_efetiva_em)) / 86400000) : null;
    expl.textContent = "Usando a fatia real medida de " + pct(CANAL.taxa_efetiva)
      + (CANAL.taxa_efetiva_em ? " em " + dataCurta(CANAL.taxa_efetiva_em) : "")
      + (dias != null && dias > 60 ? ". Já faz " + dias + " dias: vale medir de novo com um repasse recente." : ". A taxa e o desconto acima estão só de referência.");
    if(dias != null && dias > 60) expl.style.color = "#8A6412";
  } else {
    expl.textContent = "Sem a fatia real, a conta soma taxa mais desconto e assume que todo pedido pegou o desconto cheio, o que quase nunca é verdade. Para medir: pegue o relatório de repasse do mês, divida o que caiu na conta pela venda bruta, e a fatia real é o que sobra de 100%.";
  }
  box.appendChild(expl);

  /* Medir a fatia real com dois números do extrato de repasse, sem conta de cabeça. */
  if(Number(CANAL.taxa) > 0){
    const medir = document.createElement("button");
    medir.type = "button"; medir.className = "abrir";
    medir.textContent = CANAL.taxa_efetiva == null ? "medir a fatia real com um repasse" : "medir de novo com um repasse recente";
    medir.onclick = () => miniForm("formCustos", "Fatia real do " + CANAL.nome, [
      { chave:"bruto",   rotulo:"Total vendido no período (bruto, no extrato)", numero:true, largo:true, dica:"0,00" },
      { chave:"liquido", rotulo:"O que caiu na conta no mesmo período",         numero:true, largo:true, dica:"0,00" }
    ], async v => {
      const b = numBR(v.bruto), l = numBR(v.liquido);
      if(b == null || l == null || b <= 0 || l < 0 || l > b){ aviso("custosMsg","Confira os dois números: o bruto tem que ser maior que o líquido.","warn"); return false; }
      const fatia = Math.round((1 - l / b) * 10000) / 10000;
      const { error } = await sb.from("jb_canal").update({ taxa_efetiva: fatia, taxa_efetiva_em: hojeSP(),
        taxa_efetiva_obs: "Medido com bruto R$ " + moeda(b) + " e líquido R$ " + moeda(l) }).eq("id", CANAL.id);
      if(error){ aviso("custosMsg","Não consegui salvar a medição.","err"); return false; }
      CANAL.taxa_efetiva = fatia; CANAL.taxa_efetiva_em = hojeSP();
      const ref = CANAIS.find(c => c.id === CANAL.id); if(ref){ ref.taxa_efetiva = fatia; ref.taxa_efetiva_em = CANAL.taxa_efetiva_em; }
      aviso("custosMsg", CANAL.nome + " fica com " + pct(fatia) + " do preço. Todas as margens deste canal já recalcularam.","ok");
      listarPrecos();
    }, { rotuloSalvar: "Salvar medição", nota: "Pegue um período fechado no painel do app (uma semana ou um mês). A fatia real é o que sobra de 100% depois de dividir o líquido pelo bruto." });
    box.appendChild(medir);
  }

  const editar = document.createElement("button");
  editar.type = "button"; editar.className = "abrir";
  editar.textContent = "editar ou apagar o canal " + CANAL.nome;
  editar.onclick = () => formCanal(CANAL);
  box.appendChild(editar);

  const link = document.createElement("button");
  link.type = "button"; link.className = "abrir";
  link.textContent = ajustesAbertos ? "esconder os custos da casa" : "custos da casa e meta de margem";
  link.onclick = () => { ajustesAbertos = !ajustesAbertos; montarPlacar(); };
  box.appendChild(link);

  if(ajustesAbertos){
    const grid = document.createElement("div");
    grid.className = "taxas";
    grid.style.flexWrap = "wrap";
    const campos = [
      ["custo_hora","Custo da hora (R$)",1],
      ["perdas_pct","Perdas (%)",100],
      ["margem_alvo","Margem que você quer (%)",100]
    ];
    campos.forEach(([chave,rot,mult]) => {
      const lb = document.createElement("label");
      lb.style.flex = "1 1 46%";
      lb.textContent = rot;
      const inp = document.createElement("input");
      inp.type = "tel"; inp.inputMode = "decimal";
      inp.value = (Number(CFG[chave] || 0) * mult).toLocaleString("pt-BR",{maximumFractionDigits:2});
      inp.onblur = async () => {
        const n = numBR(inp.value);
        if(n == null || n < 0){ inp.value = (Number(CFG[chave]||0)*mult).toLocaleString("pt-BR",{maximumFractionDigits:2}); return; }
        const novo = n / mult;
        if(novo === Number(CFG[chave])) return;
        const { error } = await sb.from("jb_config").update({ valor: novo }).eq("chave", chave);
        if(error){ aviso("custosMsg","Não consegui salvar esse ajuste.","err"); return; }
        CFG[chave] = novo;
        aviso("custosMsg","Ajuste salvo. Todos os produtos já recalcularam.","ok");
        listarPrecos();
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
      lb.appendChild(inp);
      grid.appendChild(lb);
    });
    box.appendChild(grid);
    const casa = document.createElement("div");
    casa.className = "casa"; casa.id = "custosCasa";
    casa.innerHTML = "<p class='tip'>Carregando o custo fixo...</p>";
    box.appendChild(casa);
    montarCustosDaCasa(casa);
  }
}

/* ---------- o custo fixo calculado, linha a linha ----------
   Contas do ateliê (editáveis), folha (vem dos acordos em Quem veio no ateliê)
   e pró-labore. Ninguém digita o total: ele é a soma do que está aqui. */
async function montarCustosDaCasa(casa){
  const [cf, vol] = await Promise.all([
    sb.from("jb_custo_fixo_calculado").select("*").order("ordem"),
    sb.from("jb_volume_calculado").select("*").maybeSingle()
  ]);
  casa.innerHTML = "";
  if(cf.error){ casa.innerHTML = "<p class='tip'>Não consegui carregar o custo fixo.</p>"; return; }
  const linhas = cf.data || [];
  const total = linhas.reduce((s,l) => s + Number(l.valor || 0), 0);
  const v = vol.data || {};

  const h = document.createElement("div"); h.className = "cabe";
  h.innerHTML = "<span>Custo fixo do mês</span><b>R$ " + moeda(total) + "</b>";
  casa.appendChild(h);

  linhas.forEach(l => {
    const row = document.createElement("div"); row.className = "cl " + l.origem;
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = l.nome;
    if(l.obs){ const o = document.createElement("small"); o.textContent = l.obs; nm.appendChild(o); }
    row.appendChild(nm);
    if(l.origem === "item"){
      const inp = document.createElement("input");
      inp.type = "tel"; inp.inputMode = "decimal"; inp.className = "q";
      inp.value = moeda(l.valor);
      inp.setAttribute("aria-label", l.nome);
      let salvando = false;
      inp.onblur = async () => {
        if(salvando) return;
        const n = numBR(inp.value);
        if(n == null || n < 0){ inp.value = moeda(l.valor); return; }
        if(n === Number(l.valor)) return;
        salvando = true; inp.disabled = true;
        const { error } = await sb.from("jb_custo_fixo_item").update({ valor: n }).eq("id", l.item_id);
        inp.disabled = false; salvando = false;
        if(error){ aviso("custosMsg","Não consegui salvar " + l.nome + ".","err"); inp.value = moeda(l.valor); return; }
        l.valor = n;
        aviso("custosMsg", l.nome + " atualizado. As margens já recalcularam.","ok");
        listarPrecos();
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
      row.appendChild(inp);
    } else {
      const b = document.createElement("b"); b.textContent = "R$ " + moeda(l.valor);
      row.appendChild(b);
    }
    casa.appendChild(row);
  });

  const add = document.createElement("button");
  add.type = "button"; add.className = "abrir";
  add.textContent = "+ conta fixa";
  add.onclick = () => {
    miniForm("formCustos", "Conta fixa nova", [
      { chave:"nome", rotulo:"Nome", largo:true, valor:"", dica:"Ex.: Seguro do ateliê" },
      { chave:"valor", rotulo:"Valor por mês (R$)", numero:true, valor:"" }
    ], async f => {
      const n = numBR(f.valor);
      if(!f.nome || n == null || n < 0){ aviso("custosMsg","Preencha nome e valor.","warn"); return false; }
      const { error } = await sb.from("jb_custo_fixo_item").insert({ nome: f.nome, valor: n });
      if(error){ aviso("custosMsg","Não consegui criar a conta.","err"); return false; }
      aviso("custosMsg", f.nome + " entrou no custo fixo.","ok");
      listarPrecos();
    }, { rotuloSalvar: "Adicionar" });
  };
  casa.appendChild(add);

  const volRow = document.createElement("div"); volRow.className = "cl volume";
  const vn = document.createElement("span"); vn.className = "nm";
  vn.textContent = "Unidades vendidas por mês";
  const vo = document.createElement("small");
  vo.textContent = v.origem === "contagem"
    ? "média real da contagem: " + v.media_dia + " por dia em " + v.dias_de_contagem + " dias fechados"
    : "do cadastro. Vira a média real quando houver 14 dias de contagem fechados" + (v.dias_de_contagem ? " (" + v.dias_de_contagem + " até agora)" : "");
  vn.appendChild(vo);
  volRow.appendChild(vn);
  const vi = document.createElement("input");
  vi.type = "tel"; vi.inputMode = "numeric"; vi.className = "q";
  vi.value = Number(CFG.volume_mes || 0).toLocaleString("pt-BR");
  vi.disabled = v.origem === "contagem";
  vi.onblur = async () => {
    const n = numBR(vi.value);
    if(n == null || n <= 0){ vi.value = Number(CFG.volume_mes||0).toLocaleString("pt-BR"); return; }
    if(n === Number(CFG.volume_mes)) return;
    const { error } = await sb.from("jb_config").update({ valor: n }).eq("chave", "volume_mes");
    if(error){ aviso("custosMsg","Não consegui salvar.","err"); return; }
    CFG.volume_mes = n;
    aviso("custosMsg","Volume atualizado. Todos os produtos já recalcularam.","ok");
    listarPrecos();
  };
  vi.addEventListener("keydown", e => { if(e.key === "Enter") vi.blur(); });
  volRow.appendChild(vi);
  casa.appendChild(volRow);

  const nota = document.createElement("p");
  nota.className = "tip"; nota.style.margin = "10px 2px 0";
  nota.textContent = "Custo fixo por unidade: R$ " + moeda(total / Number(v.volume || CFG.volume_mes || 1))
    + ". A folha vem dos acordos em Quem veio no ateliê e o pró-labore fica fora do caixa.";
  casa.appendChild(nota);
}

function textoResPreco(l, c){
  return l.rascunho ? "ficha incompleta"
    : c.preco == null ? "sem preço"
    : (c.lucro < 0 ? "perde R$ " + moeda(-c.lucro) : "sobra R$ " + moeda(c.lucro));
}
function textoMiniPreco(l, c){
  if(l.rascunho) return "a receita ainda não está preenchida, então o custo aqui não vale. Complete a ficha para ver a margem.";
  const alvo = Number(CFG.margem_alvo || 0);
  let dica;
  if(c.preco != null && c.margem >= alvo) dica = "acima da meta de " + pct(alvo);
  else if(c.minimo == null || c.minimo > 2 * c.empata) dica = "com essa taxa a meta de " + pct(alvo) + " não fecha";
  else dica = "para " + pct(alvo) + " cobrar R$ " + moeda(c.minimo);
  return (c.preco != null ? "margem <b>" + pct(c.margem) + "</b> · " : "")
    + (l.cmv != null ? "CMV <b>R$ " + moeda(l.cmv) + "</b> · " : "")
    + "custo cheio <b>R$ " + moeda(c.custo) + "</b> · "
    + (c.empata != null ? "empata em <b>R$ " + moeda(c.empata) + "</b> · " : "")
    + dica;
}

function montarListaPrecos(){
  const box = $("listaCustos");
  box.innerHTML = "";
  const ord = LINHAS.map(l => ({ l, c: contaLinha(l) })).sort((a,b) => {
    if(!!a.l.rascunho !== !!b.l.rascunho) return a.l.rascunho ? 1 : -1;
    if(a.c.preco == null && b.c.preco == null) return a.l.produto.localeCompare(b.l.produto);
    if(a.c.preco == null) return 1;
    if(b.c.preco == null) return -1;
    if(a.l.rascunho) return a.l.produto.localeCompare(b.l.produto);
    return a.c.lucro - b.c.lucro;
  });

  ord.forEach(({l,c}) => {
    const row = document.createElement("div");
    row.className = "pm " + (l.rascunho || c.preco == null ? "vazio" : c.lucro < 0 ? "perde" : "");

    const top = document.createElement("div"); top.className = "top";
    top.style.gap = "10px";
    const imL = imgFoto(FOTOS[l.ficha_id]);
    if(imL){ imL.classList.add("mini"); top.appendChild(imL); }
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = l.produto;
    const res = document.createElement("span"); res.className = "res";
    res.textContent = textoResPreco(l, c);
    top.append(nm, res);

    const bot = document.createElement("div"); bot.className = "bot";
    const inp = document.createElement("input");
    inp.className = "q"; inp.type = "tel"; inp.inputMode = "decimal";
    inp.setAttribute("aria-label","Preço de " + l.produto + " no " + CANAL.nome);
    inp.value = c.preco == null ? "" : moeda(c.preco);
    let salvando = false;   // desativar o campo dispara blur de novo: não pode salvar duas vezes
    inp.onblur = async () => {
      if(salvando) return;
      const n = numBR(inp.value);
      if(inp.value.trim() !== "" && n == null) return;
      if(n === (l.preco == null ? null : Number(l.preco))) return;
      salvando = true;
      inp.disabled = true;
      let error;
      if(n == null){
        ({ error } = await sb.from("jb_preco").delete().eq("ficha_id", l.ficha_id).eq("canal_id", CANAL.id));
      } else {
        ({ error } = await sb.from("jb_preco")
            .upsert({ ficha_id: l.ficha_id, canal_id: CANAL.id, preco: n },
                    { onConflict: "ficha_id,canal_id" }));
      }
      inp.disabled = false; salvando = false;
      if(error){ aviso("custosMsg","Não consegui salvar o preço de " + l.produto + ".","err"); return; }
      l.preco = n;
      /* Atualiza só esta linha e o placar. Redesenhar a lista inteira jogava a
         página para o topo a cada preço digitado. */
      const c2 = contaLinha(l);
      row.className = "pm " + (l.rascunho || c2.preco == null ? "vazio" : c2.lucro < 0 ? "perde" : "");
      res.textContent = textoResPreco(l, c2);
      mini.innerHTML = textoMiniPreco(l, c2);
      inp.value = c2.preco == null ? "" : moeda(c2.preco);
      montarPlacar();
      toast("Preço de " + l.produto + " no " + CANAL.nome + " salvo.");
    };
    inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
    const rot = document.createElement("span"); rot.className = "mini";
    rot.textContent = "preço no " + CANAL.nome;
    bot.append(inp, rot);

    const mini = document.createElement("div"); mini.className = "mini";
    mini.style.marginTop = "8px";
    mini.innerHTML = textoMiniPreco(l, c);

    row.append(top, bot, mini);
    box.appendChild(row);
  });

  if(!ord.length) box.innerHTML = "<p class='tip'>Nenhuma ficha com custo fechado ainda. Complete as fichas para ver a margem.</p>";
}

async function abrirFicha(id, tipo){
  aviso("fichaMsg","","");
  TIPO = tipo || "ficha";
  const sub = TIPO === "sub";
  $("novoIng").classList.add("hide");
  FICHA_SUJA = false;

  if(id === null){
    FICHA = { id:null, nome:"", rendimento:1, tempo_mo_min:null,
              modo_preparo:"", preparo_conferido:false, nome_original:null };
    FICHA.nome = sub ? "Massa ou recheio novo" : "Ficha nova";
    FITENS = [];
  } else if(sub){
    const [s, itens] = await Promise.all([
      sb.from("jb_subreceita").select("*").eq("id", id).single(),
      sb.from("jb_subreceita_item").select("*").eq("subreceita_id", id).order("ordem")
    ]);
    if(s.error){ aviso("custosMsg","Não consegui abrir essa receita.","err"); return; }
    FICHA = { ...s.data, rendimento: s.data.rendimento_kg, nome_original: s.data.nome };
    FITENS = (itens.data || []).map(i => ({ ingrediente:i.ingrediente, unidade:i.unidade, qtd:i.qtd }));
  } else {
    const [f, itens] = await Promise.all([
      sb.from("jb_ficha").select("*").eq("id", id).single(),
      sb.from("jb_ficha_item_custo").select("*").eq("ficha_id", id).order("ordem")
    ]);
    if(f.error){ aviso("custosMsg","Não consegui abrir essa ficha.","err"); return; }
    FICHA = { ...f.data, rendimento: f.data.rendimento_un, nome_original: f.data.nome };
    FITENS = (itens.data || []).map(i => ({
      ingrediente: i.ingrediente, unidade: i.unidade, qtd: i.qtd,
      custo_referencia: i.custo_referencia, origem: i.origem
    }));
  }

  $("lbRend").childNodes[0].nodeValue = sub ? "Rende (kg)" : "Rende (unidades)";
  $("lbTempo").classList.toggle("hide", sub);
  $("lbFoto").classList.toggle("hide", sub);
  $("fFoto").value = FICHA.foto_url || "";
  mostrarFoto();
  $("fNome").value  = (FICHA.id === null) ? "" : (FICHA.nome || "");
  $("fNome").placeholder = sub ? "Ex.: Brigadeiro Cremoso de Pistache" : "Ex.: Bolo de Pote de Ninho";
  $("fRend").value  = FICHA.rendimento ?? 1;
  $("fTempo").value = FICHA.tempo_mo_min ?? "";
  $("fPreparo").value = FICHA.modo_preparo || "";
  $("fConferido").checked = !!FICHA.preparo_conferido;
  $("btnFichaSalvar").textContent = sub ? "Salvar receita" : "Salvar ficha";
  $("btnFichaApagar").classList.toggle("hide", FICHA.id === null);
  avisoPreparo();
  montarSeletor();
  montarItens();
  show("scFicha");
}

/* ---------- apagar uma receita, com aviso do que se perde ---------- */
async function apagarFicha(){
  if(!FICHA || FICHA.id === null) return;
  aviso("fichaMsg","","");
  const sub = TIPO === "sub";

  if(sub){
    const { data: uso } = await sb.from("jb_uso_ingrediente")
      .select("em_fichas,em_subreceitas").eq("nome", FICHA.nome).maybeSingle();
    const usos = (uso ? Number(uso.em_fichas) + Number(uso.em_subreceitas) : 0);
    if(usos > 0){
      aviso("fichaMsg","Não dá para apagar: " + FICHA.nome + " é usada em " + usos +
            " receita(s). Tire ela dessas receitas primeiro.","warn");
      window.scrollTo(0,0);
      return;
    }
  }

  const [prec, prod] = await Promise.all([
    sub ? Promise.resolve({ data: [] })
        : sb.from("jb_preco").select("canal_id").eq("ficha_id", FICHA.id),
    sb.from("jb_producao_item").select("id").eq("tipo", sub ? "subreceita" : "ficha").eq("ref_id", FICHA.id)
  ]);
  const nPrecos = (prec.data || []).length;
  const nProd   = (prod.data || []).length;

  const perde = [];
  if(nPrecos) perde.push(nPrecos + " preço(s) de canal");
  if(nProd)   perde.push(nProd + " dia(s) de produção");
  const texto = "Apagar " + FICHA.nome + " de vez?" +
    (perde.length ? "\n\nIsso apaga junto: " + perde.join(" e ") + "." : "") +
    "\n\nNão dá para desfazer.";
  if(!confirm(texto)) return;

  const btn = $("btnFichaApagar");
  btn.disabled = true; btn.textContent = "Apagando...";
  try{
    if(nProd){
      const { error } = await sb.from("jb_producao_item")
        .delete().eq("tipo", sub ? "subreceita" : "ficha").eq("ref_id", FICHA.id);
      if(error) throw error;
    }
    const tab = sub ? "jb_subreceita" : "jb_ficha";
    const { error } = await sb.from(tab).delete().eq("id", FICHA.id);
    if(error) throw error;
    CATALOGO = [];
    await abrirCustos();
    aviso("custosMsg", FICHA.nome + " foi apagada.","ok");
  } catch(err){
    aviso("fichaMsg","Não consegui apagar agora. Tente de novo.","err");
    window.scrollTo(0,0);
  }
  btn.disabled = false; btn.textContent = "Apagar esta receita";
}

function mostrarFoto(){
  const box = $("fFotoPrev");
  box.innerHTML = "";
  if(TIPO === "sub") return;
  const im = imgFoto($("fFoto").value.trim(), "g");
  if(im) box.appendChild(im);
}

function avisoPreparo(){
  const tem = ($("fPreparo").value || "").trim().length > 0;
  const ok  = $("fConferido").checked;
  $("preparoAviso").textContent =
    !tem ? "Escreva um passo por linha. É isso que a pessoa da produção vai ler."
    : ok  ? "Conferido. Esta receita já aparece pronta para quem produz."
          : "Ainda não conferido. Quem produz vê a receita marcada como rascunho até você conferir.";
}

/* ---------- formulário curto, reaproveitado em vários lugares ---------- */
function miniForm(alvo, titulo, campos, aoSalvar, opcoes){
  const box = $(alvo);
  box.classList.remove("hide");
  box.innerHTML = "";
  const h = document.createElement("h4"); h.textContent = titulo;
  box.appendChild(h);

  const lin = document.createElement("div"); lin.className = "lin2";
  const refs = {};
  campos.forEach(c => {
    const lb = document.createElement("label");
    if(c.largo) lb.className = "wide";
    lb.appendChild(document.createTextNode(c.rotulo));
    let el;
    if(c.opcoes){
      el = document.createElement("select");
      c.opcoes.forEach(([v,t]) => {
        const o = document.createElement("option"); o.value = v; o.textContent = t;
        if(String(c.valor) === String(v)) o.selected = true;
        el.appendChild(o);
      });
    } else {
      el = document.createElement("input");
      el.type = c.numero ? "tel" : "text";
      if(c.numero) el.inputMode = "decimal";
      el.value = c.valor == null ? "" : String(c.valor).replace(".",",");
      if(c.dica) el.placeholder = c.dica;
    }
    lb.appendChild(el);
    refs[c.chave] = el;
    lin.appendChild(lb);
  });
  box.appendChild(lin);

  if(opcoes && opcoes.nota){
    const p = document.createElement("p"); p.className = "nota"; p.textContent = opcoes.nota;
    box.appendChild(p);
  }

  const acoes = document.createElement("div"); acoes.className = "acoes";
  const ok = document.createElement("button");
  ok.type = "button"; ok.textContent = (opcoes && opcoes.rotuloSalvar) || "Salvar";
  ok.onclick = async () => {
    const vals = {};
    campos.forEach(c => vals[c.chave] = refs[c.chave].value.trim());
    ok.disabled = true; ok.textContent = "Salvando...";
    const fechou = await aoSalvar(vals);
    ok.disabled = false; ok.textContent = (opcoes && opcoes.rotuloSalvar) || "Salvar";
    if(fechou !== false) box.classList.add("hide");
  };
  const cancelar = document.createElement("button");
  cancelar.type = "button"; cancelar.className = "sec"; cancelar.textContent = "cancelar";
  cancelar.onclick = () => box.classList.add("hide");
  acoes.append(ok, cancelar);

  if(opcoes && opcoes.aoApagar){
    const del = document.createElement("button");
    del.type = "button"; del.className = "perigo";
    del.textContent = opcoes.rotuloApagar || "apagar";
    del.onclick = () => opcoes.aoApagar();
    acoes.appendChild(del);
  }
  box.appendChild(acoes);
  box.scrollIntoView({ block:"center", behavior:"smooth" });
  return refs;
}

const UNIDADES = [["kg","kg"],["g","g"],["L","L"],["ml","ml"],["un","un"],["m","m"]];

function formNovoInsumo(){
  miniForm("novoIng", "Ingrediente novo", [
    { chave:"nome", rotulo:"Nome", largo:true, dica:"Ex.: Pistache moído" },
    { chave:"unidade", rotulo:"Comprado por", opcoes:UNIDADES, valor:"kg" },
    { chave:"custo", rotulo:"Preço por essa unidade", numero:true, dica:"0,00" },
    { chave:"categoria", rotulo:"É o quê", opcoes:[["ingrediente","ingrediente"],["embalagem","embalagem"]], valor:"ingrediente", largo:true }
  ], async v => {
    if(!v.nome){ aviso("fichaMsg","Dê um nome ao ingrediente.","warn"); return false; }
    if(CATALOGO.some(c => c.nome.toLowerCase() === v.nome.toLowerCase())){
      aviso("fichaMsg","Já existe um ingrediente com esse nome.","warn"); return false;
    }
    const custo = numBR(v.custo);
    const { error } = await sb.from("jb_insumo").insert({
      nome: v.nome, unidade: v.unidade, custo_unit: custo,
      categoria: v.categoria, ativo: true
    });
    if(error){ aviso("fichaMsg","Não consegui criar esse ingrediente.","err"); return false; }
    CATALOGO.push({ nome:v.nome, tipo:"insumo", unidade:v.unidade, custo:custo,
                    equiv_g:null, categoria:v.categoria });
    CATALOGO.sort((a,b) => a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : (a.tipo === "sub-receita" ? -1 : 1));
    FITENS.push({ ingrediente:v.nome, unidade:v.unidade, qtd:null,
                  custo_referencia:custo, origem:"insumo" });
    montarSeletor();
    montarItens();
    aviso("fichaMsg", v.nome + " criado e já colocado na receita. Falta a quantidade.","ok");
  }, { rotuloSalvar:"Criar e usar",
       nota:"Se você comprar por pacote e usar por grama, cadastre por pacote e depois ajuste o peso do pacote na aba Insumos." });
}

function montarSeletor(){
  const sel = $("addIng");
  sel.innerHTML = '<option value="">+ adicionar ingrediente</option>';
  const oNovo = document.createElement("option");
  oNovo.value = "__novo__"; oNovo.textContent = "+ criar um ingrediente que não está na lista";
  sel.appendChild(oNovo);
  CATALOGO.forEach(c => {
    if(TIPO === "sub" && c.nome === FICHA.nome) return;   // uma receita não entra nela mesma
    const o = document.createElement("option");
    o.value = c.nome;
    o.textContent = c.nome + "  (" + c.tipo + ")";
    sel.appendChild(o);
  });
  sel.onchange = () => {
    const nome = sel.value; if(!nome) return;
    if(nome === "__novo__"){ sel.value = ""; formNovoInsumo(); return; }
    const cat = CATALOGO.find(c => c.nome === nome);
    if(FITENS.some(i => i.ingrediente === nome)){
      aviso("fichaMsg","Esse ingrediente já está na ficha.","warn");
    } else {
      FITENS.push({ ingrediente:nome, unidade:(cat && cat.tipo === "insumo" ? cat.unidade : "g"),
                    qtd:null, custo_referencia:null, origem:cat ? cat.tipo : "sem cadastro" });
      montarItens();
    }
    sel.value = "";
  };
}

function montarItens(){
  const box = $("fichaItens");
  box.innerHTML = "";
  FITENS.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "ing" + (it.qtd === null || it.qtd === "" ? " semq" : "");

    const top = document.createElement("div"); top.className = "top";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = it.ingrediente;
    const cs = document.createElement("span"); cs.className = "cst";
    const catIt = CATALOGO.find(c => c.nome === it.ingrediente);
    const org = catIt ? catIt.tipo : (it.origem || "sem cadastro");
    cs.textContent = (org === "sem cadastro" || (catIt && catIt.custo == null))
      ? "sem preço cadastrado" : org;
    top.append(nm, cs);

    const bot = document.createElement("div"); bot.className = "bot";
    const q = document.createElement("input");
    q.className = "q"; q.type = "tel"; q.inputMode = "decimal";
    q.value = (it.qtd === null || it.qtd === undefined) ? "" : String(it.qtd).replace(".",",");
    q.placeholder = "qtd";
    q.setAttribute("aria-label","Quantidade de " + it.ingrediente);
    q.oninput = () => {
      const v = String(numBR(q.value) ?? "").trim();
      it.qtd = v === "" ? null : (isNaN(parseFloat(v)) ? null : parseFloat(v));
      row.classList.toggle("semq", it.qtd === null);
      calcular();
    };

    const u = document.createElement("select"); u.className = "u";
    ["g","kg","ml","L","un","m"].forEach(x => {
      const o = document.createElement("option"); o.value = x; o.textContent = x;
      if((it.unidade || "g").toLowerCase() === x.toLowerCase()) o.selected = true;
      u.appendChild(o);
    });
    u.onchange = () => { it.unidade = u.value; calcular(); };

    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "rm"; rm.textContent = "remover";
    rm.onclick = () => { FITENS.splice(idx,1); FICHA_SUJA = true; montarItens(); };

    bot.append(q, u, rm);
    row.append(top, bot);
    box.appendChild(row);
  });
  calcular();
}

function fator(uso, custo, equiv_g){
  const a = (uso||"").toLowerCase(), b = (custo||"").toLowerCase();
  if(!a || !b || a === b) return 1;
  if(a === "g"  && b === "kg") return 0.001;
  if(a === "kg" && b === "g")  return 1000;
  if(a === "ml" && b === "l")  return 0.001;
  if(a === "l"  && b === "ml") return 1000;
  if(a === "g"  && b === "un" && equiv_g > 0) return 1/equiv_g;
  if(a === "kg" && b === "un" && equiv_g > 0) return 1000/equiv_g;
  return null;   // não converte: a ficha avisa em vez de multiplicar por 1 em silêncio
}

function calcular(){
  const rend = numBR($("fRend").value) || 1;
  let total = 0, emb = 0, faltando = 0, semPreco = 0, naoConverte = 0;
  FITENS.forEach((it, idx) => {
    const cat = CATALOGO.find(c => c.nome === it.ingrediente);
    const custo = (cat && cat.custo !== null && cat.custo !== undefined)
                  ? cat.custo : it.custo_referencia;
    it.alerta = null;
    if(it.qtd === null || it.qtd === undefined){ faltando++; return; }
    if(custo === null || custo === undefined){ semPreco++; return; }
    const f = fator(it.unidade, cat ? cat.unidade : "kg", cat ? cat.equiv_g : null);
    if(f === null){
      naoConverte++;
      it.alerta = "unidade " + it.unidade + " não converte para " + (cat ? cat.unidade : "kg") + " sem o peso da unidade";
      return;
    }
    const linha = it.qtd * f * Number(custo);
    total += linha;
    if(cat && cat.categoria === "embalagem") emb += linha;
  });
  /* marca as linhas com problema de unidade na lista */
  [...document.querySelectorAll("#fichaItens .ing")].forEach((row, i) => {
    const it = FITENS[i]; if(!it) return;
    row.classList.toggle("alerta", !!it.alerta);
    let tag = row.querySelector(".alertatxt");
    if(it.alerta){
      if(!tag){ tag = document.createElement("div"); tag.className = "alertatxt"; row.appendChild(tag); }
      tag.textContent = it.alerta;
    } else if(tag){ tag.remove(); }
  });
  const box = $("fichaResumo");
  box.innerHTML = "";
  const linha = (rot, val, big) => {
    const d = document.createElement("div"); d.className = "r" + (big ? " big" : "");
    const a = document.createElement("span"); a.textContent = rot;
    const b = document.createElement("b"); b.textContent = val;
    d.append(a,b); box.appendChild(d);
  };
  const sub = TIPO === "sub";
  linha("Itens na receita", FITENS.length + "");
  linha("Rende", sub ? rend.toLocaleString("pt-BR",{maximumFractionDigits:3}) + " kg"
                     : rend + (rend === 1 ? " unidade" : " unidades"));
  if(faltando)     linha("Sem quantidade", faltando + " item(ns)");
  if(semPreco)     linha("Sem preço cadastrado", semPreco + " item(ns)");
  if(naoConverte)  linha("Unidade que não converte", naoConverte + " item(ns)");
  linha("Custo da receita inteira", dinheiro(total));
  if(!sub){
    linha("Ingredientes por unidade", dinheiro((total - emb) / rend));
    linha("Embalagem por unidade", dinheiro(emb / rend));
  }
  linha(sub ? "Custo por kg" : "CMV por unidade", dinheiro(total / rend), true);
  if(faltando || semPreco || naoConverte){
    const p = document.createElement("p");
    p.className = "tip"; p.style.margin = "8px 0 0";
    p.textContent = faltando
      ? "O custo acima ignora os itens sem quantidade, então ainda está incompleto."
      : (naoConverte
        ? "Um item está em peso e o insumo é comprado por unidade sem o peso cadastrado. Cadastre o peso da unidade no insumo (equivalência em gramas) ou troque a unidade da linha."
        : "Há ingrediente sem preço no cadastro de insumos, então o custo está por baixo.");
    box.appendChild(p);
  }
}

/* Sair da ficha com alteração pendente pergunta antes. Vinte minutos de digitação
   não podem sumir num toque errado no voltar. */
function sairDaFicha(){
  if(FICHA_SUJA && !confirm("Há alterações nesta receita que não foram salvas.\n\nSair mesmo assim e perder o que mudou?")){
    // o botão físico já consumiu um passo do histórico: devolve, para o próximo voltar funcionar
    if(POR_POP){ try { history.pushState({ tela: TELA }, ""); } catch(e){} POR_POP = false; }
    return;
  }
  FICHA_SUJA = false;
  abrirCustos();
}

async function salvarFicha(){
  const btn = $("btnFichaSalvar");
  const sub = TIPO === "sub";
  const rotulo = sub ? "Salvar receita" : "Salvar ficha";
  btn.disabled = true; btn.textContent = "Salvando...";
  try{
    const nome  = $("fNome").value.trim();
    if(!nome){
      aviso("fichaMsg", sub ? "Dê um nome a esta massa ou recheio." : "Dê um nome ao produto antes de salvar.","warn");
      window.scrollTo(0,0);
      btn.disabled = false; btn.textContent = rotulo;
      return;
    }
    const rend  = numBR($("fRend").value) || 1;
    const tempo = $("fTempo").value.trim() === "" ? null
                : (numBR($("fTempo").value) || null);
    const preparo = $("fPreparo").value.trim() || null;
    const conferido = $("fConferido").checked && !!preparo;
    const completa = FITENS.length > 0 && FITENS.every(i => i.qtd !== null && i.qtd !== undefined);

    // sub-receita é ligada às fichas pelo nome: renomear arrasta as referências junto
    if(sub && FICHA.id !== null && FICHA.nome_original && FICHA.nome_original !== nome){
      const { error } = await sb.rpc("jb_renomear_ingrediente",
        { p_antigo: FICHA.nome_original, p_novo: nome });
      if(error){
        aviso("fichaMsg", String(error.message||"").includes("ja existe")
          ? "Já existe outro ingrediente ou receita com esse nome."
          : "Não consegui renomear essa receita.","err");
        window.scrollTo(0,0);
        btn.disabled = false; btn.textContent = rotulo;
        return;
      }
      FICHA.nome_original = nome;
    }

    /* Cabeçalho e itens vão numa transação só no banco. Se qualquer parte falhar,
       a receita continua exatamente como estava, sem ficar sem ingredientes. */
    const campos = sub
      ? { nome, rendimento_kg: rend, modo_preparo: preparo, preparo_conferido: conferido }
      : { nome, rendimento_un: rend, tempo_mo_min: tempo, rascunho: !completa,
          modo_preparo: preparo, preparo_conferido: conferido,
          foto_url: $("fFoto").value.trim() || null };
    const itens = FITENS.map(it => ({ ingrediente: it.ingrediente, unidade: it.unidade,
                                      qtd: (it.qtd === null || it.qtd === undefined || it.qtd === "") ? null : it.qtd }));
    const { data: novoId, error } = await sb.rpc("jb_salvar_ficha",
      { p_tipo: sub ? "sub" : "ficha", p_id: FICHA.id, p_campos: campos, p_itens: itens });
    if(error) throw error;
    FICHA.id = novoId;
    FICHA_SUJA = false;

    FICHA.nome = nome;
    CATALOGO = [];            // custos e nomes mudaram, recarrega o catálogo
    RECEITAS = null;          // e as listas da produção
    await abrirCustos();
    aviso("custosMsg", (sub ? "Receita de " : "Ficha de ") + nome + " salva.","ok");
  } catch(err){
    aviso("fichaMsg","Não consegui salvar agora. Tente de novo em instantes.","err");
    window.scrollTo(0,0);
  }
  btn.disabled = false; btn.textContent = rotulo;
}
