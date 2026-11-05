/* JB OS · compra pela foto da nota (só gestor).

   1. Foto: a Jessica fotografa a nota (ou escolhe o PDF). A foto vai para o balde privado
      "contas", em notas/, e fica guardada junto da compra.
   2. Leitura: a Edge Function jb-nota manda a foto para a IA (a chave nunca vem para o
      celular) e devolve fornecedor, data, total e cada linha já ligada ao insumo.
      O que já foi comprado antes ganha da sugestão da IA: o mesmo código de barras ou a
      mesma descrição do mesmo fornecedor vai para o mesmo insumo, com a mesma conversão.
   3. Conferência: nada é gravado antes de ela tocar em "Gravar". A tela avisa:
      a soma das linhas que não fecha com o total, a nota fora do CNPJ da JB,
      a linha lida com pouca certeza e o preço que mudou mais de 15% (esse só
      atualiza o insumo se ela marcar).
   4. Gravar (jb_compra_foto_gravar, uma transação só): compra, linhas, preço dos insumos
      e histórico. As fichas, as margens e o estoque se recalculam no banco.
      Depois a Edge Function lança no Nosso Financeiro, sem duplicar: se o gasto já
      estiver lá (lançado à mão, pela Siri ou pela fatura), só liga e avisa.
   ============================================================ */

const CF_CNPJ_JB = "47010705000153";
const CF_LIMITE_VAR = 0.15;
const CF_FORMAS = [["cartao","Cartão de crédito"],["pix","Pix"],["debito","Débito"],["dinheiro","Dinheiro"],["boleto","Boleto"]];
const CF_CATEGORIAS = [[48,"Insumos e matéria-prima"],[49,"Embalagens"],[47,"Mercado (confeitaria)"]];
const CF_FOTO_MAX = 2000;   // lado maior da foto que sobe, em pixels: lê bem e sobe rápido

let CF = null;              // estado da tela

function cfNovo(){
  return { etapa: "foto", fotos: [], nota: null, ia: null, linhas: [], cab: {}, pag: { forma: null, cartao: null, parcelas: 1, categoria: 48 },
           insumos: [], cartoes: [], conferiuSoma: false, erro: null, res: null, fin: null };
}

/* ---------- funções puras (testadas sem rede) ---------- */
const cfDig = s => String(s == null ? "" : s).replace(/\D/g, "");
const cfR2 = v => Math.round(Number(v) * 100) / 100;

/* Número digitado em campo de quantidade: aqui o ponto é sempre decimal ("1.245" kg),
   a não ser que venha junto com vírgula ("1.245,50"). */
function cfNum(s){
  let v = String(s == null ? "" : s).trim().replace(/\s|R\$/g, "");
  if(v === "") return null;
  if(v.includes(",") && v.includes(".")){
    v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else v = v.replace(",", ".");
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
const cfDin = v => v == null || isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const cfFmt = (v, casas) => v == null || isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas == null ? 3 : casas, useGrouping: false });

/* Nome do fornecedor para comparar: sem acento, sem "S.A.", "LTDA" e pontuação. */
function cfChaveForn(nome, cnpj){
  const d = cfDig(cnpj);
  if(d.length === 14) return d.slice(0, 8);   // raiz do CNPJ: todas as lojas do mesmo grupo
  return String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(s\.?a\.?|ltda|me|eireli|epp)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 2).join(" ");
}
const cfChaveDesc = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* O que a JB já comprou antes vira regra: código de barras (vale em qualquer loja),
   ou fornecedor + descrição. Guarda o insumo e quanto cada unidade da nota rende. */
function cfAprendizado(compras, itens){
  const porId = {};
  (compras || []).forEach(c => { porId[c.id] = c; });
  const ord = (itens || []).slice().sort((a, b) => Number(a.id) - Number(b.id));   // o mais novo vence
  const m = {};
  ord.forEach(it => {
    const c = porId[it.compra_id];
    if(!c || it.insumo_id == null && it.destino === "insumo") return;
    const q = Number(it.qtd);
    const regra = { insumo_id: it.insumo_id == null ? null : Number(it.insumo_id), destino: it.destino || "insumo",
                    fator: q > 0 && it.qtd_base != null ? Number(it.qtd_base) / q : null };
    const cod = cfDig(it.codigo_forn);
    if(cod.length >= 8) m["cod:" + cod] = regra;
    const desc = cfChaveDesc(it.descricao);
    if(desc) m["desc:" + cfChaveForn(c.fornecedor, c.cnpj) + "|" + desc] = regra;
  });
  return m;
}

function cfRegraPara(apr, linha, forn){
  const cod = cfDig(linha.codigo);
  if(cod.length >= 8 && apr["cod:" + cod]) return apr["cod:" + cod];
  return apr["desc:" + cfChaveForn(forn.nome, forn.cnpj) + "|" + cfChaveDesc(linha.descricao)] || null;
}

/* A leitura da IA vira as linhas da tela, já com o aprendizado aplicado. */
function cfMontarLinhas(nota, insumos, apr){
  const porId = {};
  (insumos || []).forEach(i => { porId[i.id] = i; });
  const forn = { nome: nota.fornecedor, cnpj: nota.cnpj_emitente };
  return (nota.itens || []).map((it, k) => {
    const regra = cfRegraPara(apr || {}, it, forn);
    let insumoId = it.insumo_id != null && porId[it.insumo_id] ? Number(it.insumo_id) : null;
    let destino = it.destino || (insumoId ? "insumo" : "consumo");
    let qb = it.qtd_base != null ? Number(it.qtd_base) : null;
    let origem = insumoId ? "ia" : null;
    if(regra && (regra.insumo_id == null || porId[regra.insumo_id])){
      const mesmaUnidade = insumoId && regra.insumo_id && porId[insumoId].unidade === porId[regra.insumo_id].unidade;
      if(regra.fator != null && it.qtd != null) qb = Math.round(Number(it.qtd) * regra.fator * 10000) / 10000;
      else if(regra.insumo_id !== insumoId && !mesmaUnidade) qb = null;   // a conta da IA era para outro insumo
      insumoId = regra.insumo_id; destino = regra.destino || destino; origem = "antes";
    }
    if(!insumoId){ qb = destino === "insumo" ? null : qb; if(destino === "insumo") destino = "consumo"; }
    return { k, codigo: it.codigo || null, descricao: it.descricao || "linha " + (k + 1), qtd: it.qtd, unidade: it.unidade,
             valor_unit: it.valor_unit, desconto: it.desconto, valor_total: it.valor_total, embalagem: it.embalagem || null,
             certeza: it.certeza == null ? 1 : Number(it.certeza), insumo_id: insumoId, destino, qtd_base: qb, origem,
             aplicar: null, confirmou: false };
  });
}

/* Custo por unidade do insumo e a variação contra o preço do cadastro. */
function cfCusto(linha, insumo){
  if(!insumo || !(linha.qtd_base > 0) || linha.valor_total == null) return null;
  const novo = Math.round(Number(linha.valor_total) / Number(linha.qtd_base) * 10000) / 10000;
  const antes = insumo.custo_unit == null ? null : Number(insumo.custo_unit);
  const variacao = antes > 0 ? novo / antes - 1 : null;
  return { novo, antes, variacao, grande: variacao != null && Math.abs(variacao) > CF_LIMITE_VAR };
}

/* A soma das linhas, menos o desconto, mais o frete, tem que dar o valor pago. */
function cfConfereSoma(linhas, cab){
  const soma = cfR2((linhas || []).reduce((s, l) => s + Number(l.valor_total || 0), 0));
  const esperado = cfR2(soma - Number(cab.desconto || 0) + Number(cab.frete || 0));
  const pago = cab.valor_pago == null ? null : cfR2(cab.valor_pago);
  return { soma, esperado, pago, fecha: pago != null && Math.abs(esperado - pago) <= 0.05, dif: pago == null ? null : cfR2(pago - esperado) };
}

/* De quem é a nota. */
function cfDestinatario(doc, nome){
  const d = cfDig(doc);
  if(d === CF_CNPJ_JB) return { tipo: "ok", texto: "Nota no CNPJ da JB." };
  if(d.length === 14) return { tipo: "err", texto: "Esta nota está no CNPJ " + d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    + (nome ? " (" + nome + ")" : "") + ", não no da JB. Para o contador ela não conta como compra da JB. Peça ao fornecedor para trocar o cadastro para o CNPJ 47.010.705/0001-53." };
  if(d.length === 11) return { tipo: "warn", texto: "Nota no CPF, não no CNPJ da JB. Na próxima compra, peça a nota no CNPJ 47.010.705/0001-53." };
  return { tipo: "warn", texto: "Nota sem o CNPJ da JB (consumidor não identificado). Na próxima compra, peça a nota no CNPJ 47.010.705/0001-53." };
}

/* Forma de pagamento escrita na nota vira a sugestão da tela. */
function cfFormaDaNota(txt){
  const t = String(txt || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if(/credito|cartao de cred/.test(t)) return "cartao";
  if(/\bpix\b/.test(t)) return "pix";
  if(/debito/.test(t)) return "debito";
  if(/dinheiro|especie/.test(t)) return "dinheiro";
  if(/boleto|duplicata|deposito/.test(t)) return "boleto";
  return null;
}

/* Categoria do financeiro pelo que pesa mais na nota. */
function cfCategoria(linhas, insumos){
  const porId = {};
  (insumos || []).forEach(i => { porId[i.id] = i; });
  const v = { 48: 0, 49: 0, 47: 0 };
  (linhas || []).forEach(l => {
    const i = l.insumo_id ? porId[l.insumo_id] : null;
    const cat = i ? (i.categoria === "embalagem" ? 49 : 48) : 47;
    v[cat] += Number(l.valor_total || 0);
  });
  return Number(Object.keys(v).sort((a, b) => v[b] - v[a])[0]);
}

/* Separa o alerta de margem: o que cruzou a meta agora pesa mais do que o que já estava abaixo. */
function cfMargens(lista, alvo){
  const cruzou = [], piorou = [], prejuizo = [];
  (lista || []).forEach(m => {
    if(m.de >= 0 && m.para < 0) prejuizo.push(m);
    else if(m.de >= alvo && m.para < alvo) cruzou.push(m);
    else piorou.push(m);
  });
  return { cruzou, piorou, prejuizo };
}

/* O que vai para o banco. */
function cfPayload(st){
  const porId = {};
  (st.insumos || []).forEach(i => { porId[i.id] = i; });
  const sc = cfConfereSoma(st.linhas, st.cab);
  return {
    data: st.cab.data, fornecedor: st.cab.fornecedor, cnpj: st.cab.cnpj || null, documento: st.cab.numero || null,
    chave: st.cab.chave || null, cnpj_dest: st.cab.dest || null,
    valor_total: sc.soma, desconto: Number(st.cab.desconto || 0), valor_pago: st.cab.valor_pago,
    obs: Number(st.cab.frete || 0) ? "frete R$ " + moeda(st.cab.frete) : null,
    forma: st.pag.forma, cartao: st.pag.forma === "cartao" ? st.pag.cartao : null,
    parcelas: st.pag.forma === "cartao" ? st.pag.parcelas : 1, fin_categoria: st.pag.categoria,
    fotos: st.fotos.map(f => f.caminho), ia: st.ia,
    alertas: { destinatario: cfDestinatario(st.cab.dest, st.cab.destNome).tipo, soma_fecha: sc.fecha, dif: sc.dif },
    forcar: !!st.forcar,
    itens: st.linhas.map(l => {
      const ins = l.insumo_id ? porId[l.insumo_id] : null;
      const c = cfCusto(l, ins);
      const aplicar = !!(ins && c && (l.aplicar != null ? l.aplicar : !c.grande));
      return { codigo: l.codigo, descricao: l.descricao, embalagem: l.embalagem, qtd: l.qtd, unidade: l.unidade,
               valor_unit: l.valor_unit, desconto: l.desconto, valor_total: l.valor_total,
               insumo_id: ins ? ins.id : null, qtd_base: ins ? l.qtd_base : null, unidade_base: ins ? ins.unidade : null,
               destino: ins ? "insumo" : (l.destino === "revenda" ? "revenda" : "consumo"),
               aplicar, confirmou_variacao: !!(c && c.grande && aplicar),
               obs: l.certeza < 0.7 ? "leitura com pouca certeza, conferida" : null };
    })
  };
}

/* ---------- tela ---------- */
async function abrirCompraFoto(){
  CF = cfNovo();
  show("scCompra");
  cfDesenhar();
}

function cfEl(tag, cls, txt){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(txt != null) e.textContent = txt;
  return e;
}

function cfDesenhar(){
  const box = $("cfCorpo");
  box.innerHTML = "";
  aviso("cfMsg", CF.erro ? CF.erro : "", "err");
  if(CF.etapa === "foto") return cfTelaFoto(box);
  if(CF.etapa === "lendo") return cfTelaLendo(box, "Lendo a nota", "Leva uns 15 segundos. Pode deixar o celular parado.");
  if(CF.etapa === "gravando") return cfTelaLendo(box, "Gravando", "Compra, preços, fichas, estoque e financeiro.");
  if(CF.etapa === "conferir") return cfTelaConferir(box);
  if(CF.etapa === "feito") return cfTelaFeito(box);
}

function cfTelaLendo(box, t, s){
  const c = cfEl("div", "cf-lendo");
  c.append(cfEl("div", "cf-roda"), cfEl("b", null, t), cfEl("p", "tip", s));
  box.appendChild(c);
}

function cfTelaFoto(box){
  box.appendChild(cfEl("p", "tip", "Fotografe a nota inteira, de cima, com luz. Cupom comprido: tire em partes (até 4). PDF da nota também serve."));
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*,application/pdf"; inp.className = "hide"; inp.id = "cfArquivo";
  inp.setAttribute("aria-label", "Foto da nota");
  inp.onchange = () => { const f = inp.files && inp.files[0]; inp.value = ""; if(f) cfAdicionarFoto(f); };
  box.appendChild(inp);

  if(CF.fotos.length){
    const g = cfEl("div", "cf-fotos");
    CF.fotos.forEach((f, i) => {
      const d = cfEl("div", "cf-foto");
      if(f.previa){ const im = document.createElement("img"); im.src = f.previa; im.alt = "parte " + (i + 1); d.appendChild(im); }
      else d.appendChild(cfEl("span", null, "PDF"));
      const x = cfEl("button", "rm", "tirar"); x.type = "button";
      x.onclick = () => { CF.fotos.splice(i, 1); cfDesenhar(); };
      d.appendChild(x);
      g.appendChild(d);
    });
    box.appendChild(g);
  }

  const b = cfEl("button", "big" + (CF.fotos.length ? " ghost" : ""));
  b.type = "button"; b.id = "cfTirar";
  b.innerHTML = '<span class="tx"><span class="t"></span><span class="s"></span></span>';
  b.querySelector(".t").textContent = CF.fotos.length ? "Adicionar outra parte" : "Tirar foto da nota";
  b.querySelector(".s").textContent = CF.fotos.length ? "Só se o cupom não coube numa foto" : "Abre a câmera ou a galeria";
  b.disabled = CF.fotos.length >= 4 || !!CF.subindo;
  b.onclick = () => inp.click();
  box.appendChild(b);

  if(CF.fotos.length){
    const ler = cfEl("button", "big", null);
    ler.type = "button"; ler.id = "cfLer";
    ler.innerHTML = '<span class="tx"><span class="t">Ler a nota</span><span class="s">Você confere tudo antes de gravar</span></span>';
    ler.disabled = !!CF.subindo;
    ler.onclick = travar(ler, cfLer);
    box.appendChild(ler);
  }
  if(CF.subindo) box.appendChild(cfEl("p", "tip", "Guardando a foto..."));
}

/* Foto do celular sobe reduzida (lê igual e sobe em segundos); PDF sobe como veio. */
async function cfReduzir(file){
  if(!/^image\//i.test(file.type || "") || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, CF_FOTO_MAX / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.86));
    return blob ? new File([blob], "nota.jpg", { type: "image/jpeg" }) : file;
  } catch(e){ return file; }
}

async function cfAdicionarFoto(file){
  const pdf = /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || "");
  if(!pdf && !/^image\//i.test(file.type || "") && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name || "")){
    CF.erro = "Esse arquivo não é foto nem PDF."; cfDesenhar(); return;
  }
  CF.erro = null; CF.subindo = true; cfDesenhar();
  try {
    const f = pdf ? file : await cfReduzir(file);
    if(f.size > 4500000) throw new Error("grande");
    const caminho = "notas/" + hojeSP().replace(/-/g, "") + "-" + Date.now() + "-" + CF.fotos.length + (pdf ? ".pdf" : ".jpg");
    const r = await sb.storage.from("contas").upload(caminho, f, { contentType: pdf ? "application/pdf" : "image/jpeg", upsert: false });
    if(r.error) throw r.error;
    CF.fotos.push({ caminho, previa: pdf ? null : URL.createObjectURL(f) });
  } catch(e){
    CF.erro = /grande/.test(String(e && e.message)) ? "O arquivo ficou grande demais. Tire a foto de novo, um pouco mais longe."
      : "Não consegui guardar a foto. Confira a internet e tente de novo.";
  }
  CF.subindo = false;
  cfDesenhar();
}

async function cfInvocar(corpo){
  const { data, error } = await sb.functions.invoke("jb-nota", { body: corpo });
  if(error){
    let msg = null;
    try { const j = error.context && typeof error.context.json === "function" ? await error.context.json() : null; msg = j && j.erro; } catch(e){}
    throw new Error(msg || "Sem conexão com o servidor. Tente de novo.");
  }
  if(data && data.erro) throw new Error(data.erro);
  return data;
}

async function cfLer(){
  CF.etapa = "lendo"; CF.erro = null; cfDesenhar();
  try {
    const [lido, ins, comp, itens, cart] = await Promise.all([
      cfInvocar({ acao: "ler", fotos: CF.fotos.map(f => f.caminho) }),
      sb.from("jb_insumo").select("id,nome,unidade,custo_unit,categoria,ativo").eq("ativo", true).order("nome"),
      sb.from("jb_compra").select("id,data,fornecedor,cnpj,forma,cartao").order("id", { ascending: false }).limit(300),
      sb.from("jb_compra_item").select("id,compra_id,codigo_forn,descricao,qtd,qtd_base,insumo_id,destino").order("id", { ascending: false }).limit(1500),
      cfInvocar({ acao: "cartoes" }).catch(() => ({ cartoes: [] }))
    ]);
    if(ins.error) throw new Error("Não consegui carregar os insumos.");
    const nota = lido.nota || {};
    if(!nota.itens || !nota.itens.length) throw new Error("Não achei nenhum item na foto. Tire de novo, mais perto e com luz.");
    CF.nota = nota; CF.ia = lido.ia || null;
    CF.insumos = ins.data || [];
    CF.cartoes = (cart && cart.cartoes) || [];
    const apr = cfAprendizado(comp.data || [], itens.data || []);
    CF.linhas = cfMontarLinhas(nota, CF.insumos, apr);
    CF.cab = { fornecedor: nota.fornecedor || "", cnpj: nota.cnpj_emitente || null, data: nota.data || hojeSP(),
               numero: nota.numero || null, chave: cfDig(nota.chave).length === 44 ? cfDig(nota.chave) : null,
               dest: nota.destinatario_doc || null, destNome: nota.destinatario_nome || null,
               desconto: nota.desconto || 0, frete: nota.frete || 0,
               valor_pago: nota.valor_pago != null ? nota.valor_pago : null, legivel: nota.legivel !== false, obs: nota.observacoes || null };
    /* forma: o que a nota diz; o cartão, o último usado */
    const ult = (comp.data || []).find(c => c.forma === "cartao" && c.cartao);
    CF.pag = { forma: cfFormaDaNota(nota.pagamento_na_nota), cartao: ult ? ult.cartao : (CF.cartoes.includes("Santander Unique Visa") ? "Santander Unique Visa" : null),
               parcelas: 1, categoria: cfCategoria(CF.linhas, CF.insumos) };
    CF.etapa = "conferir";
  } catch(e){
    CF.etapa = "foto"; CF.erro = e.message || "A leitura falhou. Tente de novo.";
  }
  cfDesenhar();
}

function cfCampo(rotulo, valor, onInput, tipo, largo){
  const l = cfEl("label", largo ? "wide" : null);
  l.appendChild(document.createTextNode(rotulo));
  const i = document.createElement("input");
  i.type = tipo || "text";
  if(tipo === "tel"){ i.inputMode = "decimal"; }
  i.value = valor == null ? "" : valor;
  i.oninput = () => onInput(i.value, i);
  l.appendChild(i);
  return l;
}

function cfTelaConferir(box){
  const porId = {};
  CF.insumos.forEach(i => { porId[i.id] = i; });

  /* avisos do topo */
  const avisos = cfEl("div", "cf-avisos"); avisos.id = "cfAvisos";
  box.appendChild(avisos);

  /* cabeçalho */
  const cab = cfEl("div", "novoing cf-cab");
  cab.append(
    cfCampo("Fornecedor", CF.cab.fornecedor, v => { CF.cab.fornecedor = v; cfAtualizar(); }, "text", true),
    cfCampo("Data", CF.cab.data, v => { CF.cab.data = v; cfAtualizar(); }, "date"),
    cfCampo("Nota nº", CF.cab.numero, v => { CF.cab.numero = v || null; }),
    cfCampo("Desconto da nota", cfDin(CF.cab.desconto), v => { CF.cab.desconto = cfNum(v) || 0; cfAtualizar(); }, "tel"),
    cfCampo("Frete", cfDin(CF.cab.frete), v => { CF.cab.frete = cfNum(v) || 0; cfAtualizar(); }, "tel"),
    cfCampo("Valor pago (total da nota)", cfDin(CF.cab.valor_pago), v => { CF.cab.valor_pago = cfNum(v); cfAtualizar(); }, "tel", true)
  );
  box.appendChild(cab);

  /* linhas */
  box.appendChild(cfEl("h3", "cf-tit", CF.linhas.length + (CF.linhas.length === 1 ? " linha" : " linhas") + " da nota"));
  const lista = cfEl("div", "cf-linhas");
  CF.linhas.forEach(l => lista.appendChild(cfLinha(l, porId)));
  box.appendChild(lista);

  /* pagamento */
  box.appendChild(cfEl("h3", "cf-tit", "Como foi pago"));
  const pg = cfEl("div", "cf-pag"); pg.id = "cfPag";
  box.appendChild(pg);
  cfDesenharPag(pg);

  const foot = cfEl("div", "foot");
  const g = cfEl("button", null, "Gravar a compra"); g.type = "button"; g.id = "cfGravar";
  g.onclick = travar(g, cfGravar);
  foot.appendChild(g);
  box.appendChild(foot);
  cfAtualizar();
}

function cfLinha(l, porId){
  const d = cfEl("div", "cf-lin" + (l.certeza < 0.7 ? " duvida" : ""));
  d.dataset.k = l.k;
  const t = cfEl("div", "cf-l1");
  t.append(cfEl("b", null, l.descricao));
  const q = (l.qtd != null ? cfFmt(l.qtd) + " " + (l.unidade || "") : "") + (l.valor_unit != null ? " × " + moeda(l.valor_unit) : "");
  t.append(cfEl("small", null, (q ? q + " = " : "") + "R$ " + (l.valor_total == null ? "?" : moeda(l.valor_total))
    + (l.origem === "antes" ? " · como da última compra" : "")));
  d.appendChild(t);
  if(l.certeza < 0.7) d.appendChild(cfEl("p", "cf-nota", "Leitura com pouca certeza: confira na nota."));

  const fila = cfEl("div", "cf-l2");
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Insumo de " + l.descricao);
  [["c","Não entra em receita (mercado, limpeza)"],["r","Revenda (bebida)"]].forEach(([v, n]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = n; sel.appendChild(o);
  });
  CF.insumos.forEach(i => {
    const o = document.createElement("option"); o.value = String(i.id); o.textContent = i.nome + " (" + i.unidade + ")"; sel.appendChild(o);
  });
  sel.value = l.insumo_id ? String(l.insumo_id) : (l.destino === "revenda" ? "r" : "c");
  sel.onchange = () => {
    const v = sel.value;
    if(v === "c" || v === "r"){ l.insumo_id = null; l.destino = v === "r" ? "revenda" : "consumo"; }
    else { l.insumo_id = Number(v); l.destino = "insumo"; }
    l.aplicar = null; l.origem = "voce";
    cfRedesenharLinha(l);
  };
  fila.appendChild(sel);

  const ins = l.insumo_id ? porId[l.insumo_id] : null;
  const vt = cfCampo("Valor da linha", cfDin(l.valor_total), v => { l.valor_total = cfNum(v); cfRedesenharCusto(l); cfAtualizar(); }, "tel");
  vt.classList.add("cf-mini");
  fila.appendChild(vt);
  if(ins){
    const qb = cfCampo("Total em " + ins.unidade, cfFmt(l.qtd_base, 4), v => { l.qtd_base = cfNum(v); l.aplicar = null; cfRedesenharCusto(l); }, "tel");
    qb.classList.add("cf-mini");
    fila.appendChild(qb);
  }
  d.appendChild(fila);
  const custo = cfEl("div", "cf-custo"); custo.dataset.custo = l.k;
  d.appendChild(custo);
  cfPintarCusto(l, custo, ins);
  return d;
}

function cfRedesenharLinha(l){
  const porId = {}; CF.insumos.forEach(i => { porId[i.id] = i; });
  const velho = document.querySelector('.cf-lin[data-k="' + l.k + '"]');
  if(velho) velho.replaceWith(cfLinha(l, porId));
  CF.pag.categoria = CF.pagCatManual ? CF.pag.categoria : cfCategoria(CF.linhas, CF.insumos);
  cfDesenharPag($("cfPag"));
  cfAtualizar();
}
function cfRedesenharCusto(l){
  const el = document.querySelector('[data-custo="' + l.k + '"]');
  const ins = CF.insumos.find(i => i.id === l.insumo_id);
  if(el) cfPintarCusto(l, el, ins);
}

function cfPintarCusto(l, el, ins){
  el.innerHTML = "";
  el.className = "cf-custo";
  if(!ins){ return; }
  const c = cfCusto(l, ins);
  if(!c){
    el.classList.add("warn");
    el.textContent = "Falta o total em " + ins.unidade + " para calcular o custo. Ex.: 5 pacotes de 1 kg = 5.";
    return;
  }
  const marcado = l.aplicar != null ? l.aplicar : !c.grande;
  const txt = "R$ " + moeda(c.novo) + " por " + ins.unidade
    + (c.antes == null ? " (o insumo estava sem preço)" : " · no sistema R$ " + moeda(c.antes)
       + (c.variacao == null ? "" : " (" + (c.variacao > 0 ? "+" : "") + pct(c.variacao) + ")"));
  el.appendChild(cfEl("span", null, txt));
  if(c.grande){
    el.classList.add("warn");
    el.appendChild(cfEl("small", null, "Mudou mais de 15%. Confira a quantidade: se estiver certa, marque para atualizar."));
  }
  if(c.antes == null || Math.abs(c.novo - c.antes) >= 0.00005){
    const lb = cfEl("label", "cf-check");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = marcado;
    cb.onchange = () => { l.aplicar = cb.checked; };
    lb.append(cb, document.createTextNode(" Atualizar o preço de " + ins.nome));
    el.appendChild(lb);
  } else el.appendChild(cfEl("small", null, "Mesmo preço do sistema."));
}

function cfDesenharPag(pg){
  if(!pg) return;
  pg.innerHTML = "";
  const ch = cfEl("div", "chips");
  CF_FORMAS.forEach(([v, n]) => {
    const b = cfEl("button", null, n); b.type = "button";
    b.setAttribute("aria-pressed", String(CF.pag.forma === v));
    b.onclick = () => { CF.pag.forma = v; cfDesenharPag(pg); cfAtualizar(); };
    ch.appendChild(b);
  });
  pg.appendChild(ch);
  const f = cfEl("div", "novoing");
  if(CF.pag.forma === "cartao"){
    const l1 = cfEl("label", "wide", "Cartão");
    const s1 = document.createElement("select"); s1.id = "cfCartao";
    const lista = CF.cartoes.length ? CF.cartoes : (CF.pag.cartao ? [CF.pag.cartao] : []);
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = lista.length ? "escolha o cartão" : "não consegui carregar os cartões"; s1.appendChild(o0);
    lista.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; s1.appendChild(o); });
    s1.value = CF.pag.cartao || "";
    s1.onchange = () => { CF.pag.cartao = s1.value || null; cfAtualizar(); };
    l1.appendChild(s1); f.appendChild(l1);
    const l2 = cfEl("label", null, "Parcelas");
    const s2 = document.createElement("select"); s2.id = "cfParcelas";
    for(let i = 1; i <= 12; i++){ const o = document.createElement("option"); o.value = i; o.textContent = i === 1 ? "à vista" : i + "x"; s2.appendChild(o); }
    s2.value = String(CF.pag.parcelas || 1);
    s2.onchange = () => { CF.pag.parcelas = Number(s2.value); };
    l2.appendChild(s2); f.appendChild(l2);
  }
  const l3 = cfEl("label", CF.pag.forma === "cartao" ? null : "wide", "Categoria no Nosso Financeiro");
  const s3 = document.createElement("select"); s3.id = "cfCategoria";
  CF_CATEGORIAS.forEach(([v, n]) => { const o = document.createElement("option"); o.value = v; o.textContent = n; s3.appendChild(o); });
  s3.value = String(CF.pag.categoria);
  s3.onchange = () => { CF.pag.categoria = Number(s3.value); CF.pagCatManual = true; };
  l3.appendChild(s3); f.appendChild(l3);
  pg.appendChild(f);
}

/* Avisos do topo e o botão: tudo que impede gravar aparece aqui. */
function cfAtualizar(){
  const av = $("cfAvisos");
  if(!av) return;
  av.innerHTML = "";
  const msg = (tipo, texto) => { const m = cfEl("div", "msg " + tipo, texto); av.appendChild(m); return m; };
  if(!CF.cab.legivel) msg("err", "A foto não ficou boa para ler. Confira linha por linha ou tire a foto de novo.");
  const dst = cfDestinatario(CF.cab.dest, CF.cab.destNome);
  msg(dst.tipo, dst.texto);
  const sc = cfConfereSoma(CF.linhas, CF.cab);
  if(sc.pago != null && !sc.fecha){
    const m = msg(CF.conferiuSoma ? "warn" : "err", "A soma das linhas (R$ " + moeda(sc.soma) + ")"
      + (Number(CF.cab.desconto) ? " menos o desconto" : "") + (Number(CF.cab.frete) ? " mais o frete" : "")
      + " dá R$ " + moeda(sc.esperado) + ", e a nota diz R$ " + moeda(sc.pago) + ". Confira as linhas antes de gravar.");
    const lb = cfEl("label", "cf-check");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = CF.conferiuSoma; cb.id = "cfConferi";
    cb.onchange = () => { CF.conferiuSoma = cb.checked; cfAtualizar(); };
    lb.append(cb, document.createTextNode(" Conferi, a diferença está certa"));
    m.appendChild(lb);
  } else if(sc.fecha) msg("ok", "A soma das linhas fecha com o total da nota: R$ " + moeda(sc.pago) + ".");
  const duvidas = CF.linhas.filter(l => l.certeza < 0.7).length;
  if(duvidas) msg("warn", duvidas + (duvidas === 1 ? " linha foi lida" : " linhas foram lidas") + " com pouca certeza. Estão marcadas em amarelo.");
  if(CF.cab.obs) msg("warn", "Da leitura: " + CF.cab.obs);

  const falta = [];
  if(!String(CF.cab.fornecedor || "").trim()) falta.push("o fornecedor");
  if(!CF.cab.data) falta.push("a data");
  if(!(CF.cab.valor_pago > 0)) falta.push("o valor pago");
  if(CF.linhas.some(l => l.valor_total == null)) falta.push("o valor de alguma linha");
  if(!CF.pag.forma) falta.push("como foi pago");
  if(CF.pag.forma === "cartao" && !CF.pag.cartao) falta.push("o cartão");
  if(sc.pago != null && !sc.fecha && !CF.conferiuSoma) falta.push("conferir a soma");
  const g = $("cfGravar");
  if(g){
    g.disabled = falta.length > 0;
    g.textContent = falta.length ? "Falta " + falta.join(", ") : "Gravar a compra";
  }
}

async function cfGravar(){
  const payload = cfPayload(CF);
  CF.etapa = "gravando"; CF.erro = null; cfDesenhar();
  const { data, error } = await sb.rpc("jb_compra_foto_gravar", { p: payload });
  if(error || !data){
    CF.etapa = "conferir"; CF.erro = "Não consegui gravar: " + ((error && error.message) || "sem resposta") + ". Nada foi gravado.";
    cfDesenhar(); return;
  }
  if(data.duplicada){
    CF.etapa = "conferir"; CF.duplicada = data.duplicada;
    CF.erro = "Essa nota já foi lançada (compra " + data.duplicada + "). Não gravei de novo.";
    cfDesenhar();
    const b = cfEl("button", "big ghost"); b.type = "button"; b.id = "cfForcar";
    b.innerHTML = '<span class="tx"><span class="t">É outra compra, gravar mesmo assim</span><span class="s">Mesmo fornecedor, dia e valor</span></span>';
    b.onclick = travar(b, async () => { CF.forcar = true; await cfGravar(); });
    $("cfCorpo").prepend(b);
    return;
  }
  CF.res = data;
  INSUMOS_CACHE = null; CATALOGO = [];
  await cfFinanceiro(false);
  CF.etapa = "feito";
  cfDesenhar();
}

async function cfFinanceiro(forcar){
  try { CF.fin = await cfInvocar({ acao: "financeiro", compra_id: CF.res.compra_id, forcar: !!forcar }); }
  catch(e){ CF.fin = { status: "erro", erro: e.message }; }
}

function cfTelaFeito(box){
  const r = CF.res || {};
  const sc = cfConfereSoma(CF.linhas, CF.cab);
  const ok = cfEl("div", "msg ok", "Compra gravada: " + CF.cab.fornecedor + ", " + CF.linhas.length + (CF.linhas.length === 1 ? " linha" : " linhas")
    + ", R$ " + moeda(sc.pago != null ? sc.pago : sc.esperado) + ". Já entrou no estoque.");
  box.appendChild(ok);

  const sec = (t) => { box.appendChild(cfEl("h3", "cf-tit", t)); const c = cfEl("div", "card cf-res"); box.appendChild(c); return c; };

  const p = sec("Preços dos insumos");
  if((r.aplicados || []).length){
    r.aplicados.forEach(a => p.appendChild(cfEl("p", null, a.insumo + ": " + (a.de == null ? "sem preço" : "R$ " + moeda(a.de)) + " → R$ " + moeda(a.para)
      + " por " + a.unidade + (a.var == null ? "" : " (" + (a.var > 0 ? "+" : "") + pct(a.var) + ")"))));
    p.appendChild(cfEl("small", null, "As fichas e as margens que usam esses insumos já recalcularam."));
  } else p.appendChild(cfEl("p", null, "Nenhum preço mudou."));
  (r.nao_aplicados || []).forEach(n => p.appendChild(cfEl("p", "cf-nao", "Não atualizei " + (n.insumo || n.descricao) + ": " + n.motivo + ".")));

  const mg = cfMargens(r.margem_abaixo || [], Number(r.alvo || 0));
  const m = sec("Margem");
  const fmt = x => x.produto + " no " + x.canal + ": " + pct(x.de) + " → " + pct(x.para);
  if(mg.prejuizo.length){ m.appendChild(cfEl("p", "cf-ruim", "Passaram a dar prejuízo:")); mg.prejuizo.forEach(x => m.appendChild(cfEl("p", null, fmt(x)))); }
  if(mg.cruzou.length){ m.appendChild(cfEl("p", "cf-ruim", "Ficaram abaixo da meta de " + pct(r.alvo) + " agora:")); mg.cruzou.forEach(x => m.appendChild(cfEl("p", null, fmt(x)))); }
  if(mg.piorou.length){
    const det = document.createElement("details");
    det.appendChild(cfEl("summary", null, mg.piorou.length + (mg.piorou.length === 1 ? " produto já estava" : " produtos já estavam") + " abaixo da meta e piorou um pouco"));
    mg.piorou.forEach(x => det.appendChild(cfEl("p", null, fmt(x))));
    m.appendChild(det);
  }
  if(!mg.prejuizo.length && !mg.cruzou.length && !mg.piorou.length) m.appendChild(cfEl("p", null, "Nenhum produto caiu abaixo da meta por causa desta compra."));

  const f = sec("Nosso Financeiro");
  const fin = CF.fin || {};
  if(fin.status === "lancado"){
    const n = fin.parcelas || 1;
    f.appendChild(cfEl("p", null, "Lançado: R$ " + moeda(fin.valor) + (n > 1 ? " em " + n + "x" : "")
      + (CF.pag.forma === "cartao" ? " no " + CF.pag.cartao + ", aguardando a fatura. A fatura casa com este lançamento." : " em " + (CF_FORMAS.find(x => x[0] === CF.pag.forma) || [, ""])[1] + ".")));
  } else if(fin.status === "ja_existia" || fin.status === "ja_lancado"){
    const e = fin.evento || {};
    f.appendChild(cfEl("p", null, "Já estava no Nosso Financeiro: " + (e.descricao || "") + (e.data ? " de " + dataCurta(e.data) : "")
      + (e.valor != null ? ", R$ " + moeda(e.valor) : "") + ". Não lancei de novo."));
    if(fin.status === "ja_existia"){
      const b = cfEl("button", "rm", "não é a mesma compra: lançar"); b.type = "button"; b.id = "cfFinForcar";
      b.onclick = travar(b, async () => { await cfFinanceiro(true); cfDesenhar(); });
      f.appendChild(b);
    }
  } else {
    f.appendChild(cfEl("p", "cf-ruim", "Não consegui lançar no Nosso Financeiro" + (fin.erro ? ": " + fin.erro : "") + ". A compra está gravada aqui."));
    const b = cfEl("button", "rm", "tentar de novo"); b.type = "button"; b.id = "cfFinDeNovo";
    b.onclick = travar(b, async () => { await cfFinanceiro(false); cfDesenhar(); });
    f.appendChild(b);
  }

  if(CF.ia && CF.ia.custo_usd != null) box.appendChild(cfEl("p", "tip", "Leitura da nota: US$ " + CF.ia.custo_usd.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + "."));
  const outra = cfEl("button", "big"); outra.type = "button"; outra.id = "cfOutra";
  outra.innerHTML = '<span class="tx"><span class="t">Lançar outra nota</span></span>';
  outra.onclick = abrirCompraFoto;
  box.appendChild(outra);
}
