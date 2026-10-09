/* JB OS · contas a pagar: impostos, contas fixas da confeitaria e boletos de fornecedor.

   Só gestor vê (RLS em jb_conta e no balde privado "contas").
   O boleto e o comprovante ficam no balde privado; abrem por link assinado de 5 minutos.

   De onde vem cada coisa:
   - Contas fixas: a rotina diária copia do Nosso Financeiro (frente confeitaria) e,
     quando o pagamento é lançado lá, marca como paga aqui (pago_por = "financeiro").
     O Nosso Financeiro continua só leitura.
   - Impostos e fornecedores: lançados aqui. Ao anexar o boleto em PDF, o app lê o
     código de barras, o valor e o vencimento. Ao anexar o comprovante, lê a data,
     o valor e o código, confere com o boleto e propõe marcar como paga.
   ============================================================ */

let CONTAS = null;          // lista carregada
let CONTA_PAINEL = null;    // { id, modo: "pagar" | "editar", leitura }
let CONTA_NOVA = false;     // formulário de conta nova aberto

const CONTA_TIPO = { imposto: "Imposto", fixa: "Conta fixa", fornecedor: "Fornecedor", equipe: "Equipe" };
let CONTA_FALTAS = [];      // faltas com desconto (jb_falta): abatem da conta da pessoa que cobre aquele período
let CONTA_BANCO = {};      // por pessoa: saldo do banco de horas em minutos
let CONTA_DIARIAS = [];     // por pessoa que ganha por dia: { uid, nome, valor, dias: [iso...] } ainda não pagos
let CONTA_CARTOES = [];     // parte da confeitaria em cada fatura de cartão (jb_cartao_fatura), vinda do Nosso Financeiro
const CARTAO_ABERTO = {};   // fatura com as compras abertas na tela
const CONTA_BALDE = "contas";
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

/* ============================================================
   LEITURA DE BOLETO E COMPROVANTE (funções puras, testadas sem rede)
   ============================================================ */
const contaDigitos = s => String(s || "").replace(/\D/g, "");

function contaMod10(s){
  let t = 0, p = 2;
  for(let i = s.length - 1; i >= 0; i--){
    let v = Number(s[i]) * p; t += Math.floor(v / 10) + (v % 10); p = p === 2 ? 1 : 2;
  }
  return (10 - (t % 10)) % 10;
}
function contaMod11Arrec(s){
  let t = 0, w = 2;
  for(let i = s.length - 1; i >= 0; i--){ t += Number(s[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = t % 11;
  return (r === 0 || r === 1) ? 0 : (r === 10 ? 1 : 11 - r);
}
function contaMod11Boleto(s){
  let t = 0, w = 2;
  for(let i = s.length - 1; i >= 0; i--){ t += Number(s[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = 11 - (t % 11);
  return (r === 0 || r === 10 || r === 11) ? 1 : r;
}

/* Linha digitável (47 ou 48) ou código de barras (44) → código de 44 dígitos, conferido.
   Devolve null se os dígitos verificadores não baterem. */
function contaCodigo44(linha){
  const d = contaDigitos(linha);
  if(d.length === 48 && d[0] === "8"){
    const mod = (d[2] === "6" || d[2] === "7") ? contaMod10 : contaMod11Arrec;
    const blocos = [0, 12, 24, 36].map(i => d.slice(i, i + 12));
    if(!blocos.every(b => mod(b.slice(0, 11)) === Number(b[11]))) return null;
    const c = blocos.map(b => b.slice(0, 11)).join("");
    if(mod(c.slice(0, 3) + c.slice(4)) !== Number(c[3])) return null;
    return c;
  }
  if(d.length === 47){
    const campos = [[0, 9, 9], [10, 20, 20], [21, 31, 31]];
    if(!campos.every(([a, b, dv]) => contaMod10(d.slice(a, b)) === Number(d[dv]))) return null;
    const c = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    if(contaMod11Boleto(c.slice(0, 4) + c.slice(5)) !== Number(c[4])) return null;
    return c;
  }
  if(d.length === 44){
    if(d[0] === "8"){
      const mod = (d[2] === "6" || d[2] === "7") ? contaMod10 : contaMod11Arrec;
      return mod(d.slice(0, 3) + d.slice(4)) === Number(d[3]) ? d : null;
    }
    return contaMod11Boleto(d.slice(0, 4) + d.slice(5)) === Number(d[4]) ? d : null;
  }
  return null;
}

/* O que o próprio código diz: valor e, no boleto bancário, o vencimento. */
function contaDoCodigo(linha){
  const c = contaCodigo44(linha);
  if(!c) return null;
  if(c[0] === "8"){
    const reais = c[2] === "6" || c[2] === "8";
    return { valor: reais ? Number(c.slice(4, 15)) / 100 : null, vencimento: null, arrecadacao: true };
  }
  const fator = Number(c.slice(5, 9));
  let venc = null;
  if(fator >= 1000){
    // o fator recomeçou em 1000 no dia 22/02/2025
    const antigo = Date.UTC(1997, 9, 7) + fator * 864e5;
    const novo = Date.UTC(2025, 1, 22) + (fator - 1000) * 864e5;
    venc = new Date(antigo < Date.UTC(2025, 1, 22) ? novo : antigo).toISOString().slice(0, 10);
  }
  return { valor: Number(c.slice(9, 19)) / 100, vencimento: venc, arrecadacao: false };
}

const CONTA_MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

/* Lê o texto de um boleto, DAS, DARF ou comprovante. Tudo é opcional no resultado. */
function contaLerTexto(txt){
  const t = String(txt || "").replace(/\s+/g, " ");
  const r = {};
  const num = s => Number(String(s).replace(/\./g, "").replace(",", "."));
  const dataApos = (rot) => {
    const m = t.match(new RegExp(rot + "[^0-9]{0,40}?(\\d{2})\\/(\\d{2})\\/(\\d{4})", "i"));
    return m ? m[3] + "-" + m[2] + "-" + m[1] : null;
  };
  // código: arrecadação (48) ou boleto (47), com ou sem pontos, traços e espaços
  const cand = [];
  const re48 = /8\d{10}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d[\s.-]+\d{11}[\s.-]*\d/g;
  const re47 = /\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14}/g;
  let m;
  while((m = re48.exec(t))) cand.push(contaDigitos(m[0]));
  while((m = re47.exec(t))) cand.push(contaDigitos(m[0]));
  const valido = cand.find(c => contaCodigo44(c));
  if(valido){ r.codigo = valido; }
  else if(cand.length){ r.codigoInvalido = true; }

  r.pagarAte = dataApos("Pagar (?:este documento )?at[ée]");
  r.vencimento = dataApos("(?:Data de )?Vencimento");
  r.pagoEm = dataApos("(?:Data (?:do|de) pagamento|Pago em|Data da transa[çc][ãa]o|Data do d[ée]bito|realizado em|efetuado (?:via [^0-9]{0,40}?)?em)");
  const v = t.match(/Valor (?:Total do Documento|total|do documento|pago|cobrado|a pagar)\s*:?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if(v) r.valor = num(v[1]);
  const doc = t.match(/N[úu]mero do Documento\s*:?\s*([\d][\d.\-]{7,})/i);
  if(doc) r.documento = doc[1];
  const pa = t.match(/Per[íi]odo de Apura[çc][ãa]o\s*:?\s*([a-zç]+)\/(\d{4})/i);
  if(pa){
    const i = CONTA_MESES.indexOf(pa[1].toLowerCase());
    if(i >= 0) r.competencia = pa[2] + "-" + String(i + 1).padStart(2, "0") + "-01";
  }
  // o código manda no valor: é o que o banco vai cobrar
  const doCod = r.codigo ? contaDoCodigo(r.codigo) : null;
  if(doCod && doCod.valor != null) r.valor = doCod.valor;
  if(doCod && doCod.vencimento && !r.vencimento) r.vencimento = doCod.vencimento;
  if(/Simples Nacional|Documento de Arrecada[çc][ãa]o|DARF|Receita Federal/i.test(t)) r.imposto = true;
  return r;
}

/* Confere um comprovante lido contra a conta. */
function contaConferir(conta, lido){
  const cod = conta.codigo_barras ? contaCodigo44(conta.codigo_barras) : null;
  const codLido = lido.codigo ? contaCodigo44(lido.codigo) : null;
  const codigoBate = !!(cod && codLido && cod === codLido);
  const codigoDiverge = !!(cod && codLido && cod !== codLido);
  const valorBate = conta.valor != null && lido.valor != null && Math.abs(Number(conta.valor) - lido.valor) < 0.005;
  return { codigoBate, codigoDiverge, valorBate };
}

/* pdf.js só carrega quando alguém anexa um PDF. Nos testes, window.__pdfTexto substitui. */
let PDFJS = null;
async function contaTextoDoArquivo(file){
  if(window.__pdfTexto) return window.__pdfTexto(file);
  if(!/pdf/i.test(file.type || "") && !/\.pdf$/i.test(file.name || "")) return "";
  if(!PDFJS){
    PDFJS = await import(PDFJS_URL);
    PDFJS.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  const doc = await PDFJS.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let txt = "";
  for(let i = 1; i <= Math.min(doc.numPages, 3); i++){
    const pg = await doc.getPage(i);
    const c = await pg.getTextContent();
    txt += c.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  return txt;
}

/* ============================================================
   DATAS E VALORES NA TELA
   ============================================================ */
function contaDias(iso){
  const [a, m, d] = iso.split("-").map(Number);
  const [ha, hm, hd] = hojeSP().split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 864e5);
}
function contaQuando(c){
  if(c.pago_em) return "pago em " + dataCurta(c.pago_em);
  const n = contaDias(c.vencimento);
  if(n < 0) return "venceu há " + (-n) + (n === -1 ? " dia" : " dias") + " (" + dataCurta(c.vencimento) + ")";
  if(n === 0) return "vence hoje";
  if(n === 1) return "vence amanhã";
  return "vence " + dataCurta(c.vencimento);
}
const contaReais = v => v == null ? "a definir" : "R$ " + moeda(v);
function contaMesRef(iso){
  if(!iso) return "";
  const [a, m] = iso.split("-").map(Number);
  return CONTA_MESES[m - 1] + "/" + a;
}

/* ============================================================
   CARGA
   ============================================================ */
async function abrirContas(){
  show("scContas");
  aviso("contasMsg", "", "");
  $("contasLista").innerHTML = "";
  await carregarContas();
  montarContas();
}

async function carregarContas(){
  const desde = diaMais(-90);
  const r = await sb.from("jb_conta").select("*").eq("arquivada", false)
    .or("pago_em.is.null,pago_em.gte." + desde).order("vencimento");
  if(r.error){
    CONTAS = null;
    aviso("contasMsg", "Não consegui carregar as contas. Toque em atualizar.", "err");
    return;
  }
  CONTAS = r.data || [];
  const cc = await sb.from("jb_cartao_fatura").select("*").eq("ativo", true).order("vencimento");
  CONTA_CARTOES = (cc && !cc.error && cc.data) || [];
  await carregarEquipeContas();
}

/* Equipe em Contas a pagar: faltas que abatem da quinzena e dias de diária ainda não pagos. */
async function carregarEquipeContas(){
  const desde = diaMais(-120);
  const [fa, ac, dt, pg, us, bh] = await Promise.all([
    sb.from("jb_falta").select("id,user_id,data,horas,desconta,valor_desconto").eq("cancelada", false).eq("desconta", true).gte("data", desde),
    sb.from("jb_acordo").select("user_id,regime,valor,inicio,fim").eq("regime", "diaria"),
    sb.from("jb_dia_trabalhado").select("id,user_id,data,status").eq("status", "confirmado").gte("data", desde),
    sb.from("jb_dia_pago").select("id").gte("data", desde),
    sb.from("jb_usuario").select("user_id,nome"),
    sb.from("jb_banco_horas").select("user_id,minutos").eq("cancelado", false)
  ]);
  CONTA_BANCO = {};
  ((bh && !bh.error && bh.data) || []).forEach(b => { CONTA_BANCO[b.user_id] = (CONTA_BANCO[b.user_id] || 0) + Number(b.minutos); });
  CONTA_FALTAS = (fa && !fa.error && fa.data) || [];
  CONTA_DIARIAS = [];
  if(ac && !ac.error && dt && !dt.error && pg && !pg.error){
    const pagos = new Set((pg.data || []).map(x => x.id));
    const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
    const hoje = hojeSP();
    (ac.data || []).filter(a => a.valor != null && (!a.fim || a.fim >= hoje)).forEach(a => {
      const dias = (dt.data || []).filter(d => d.user_id === a.user_id && !pagos.has(d.id) && d.data >= a.inicio && (!a.fim || d.data <= a.fim))
                                  .map(d => d.data).sort();
      CONTA_DIARIAS.push({ uid: a.user_id, nome: nomes[a.user_id] || "Diarista", valor: Number(a.valor), dias });
    });
  }
}
/* faltas descontadas que caem no período desta conta */
function contaFaltasDe(c){
  if(!c.equipe_user_id || !c.periodo_ini || !c.periodo_fim) return [];
  return CONTA_FALTAS.filter(f => f.user_id === c.equipe_user_id && f.data >= c.periodo_ini && f.data <= c.periodo_fim)
                     .sort((a, b) => a.data < b.data ? -1 : 1);
}
/* quanto pagar de fato: o valor menos as faltas descontadas do período */
function contaAPagar(c){
  if(c.valor == null) return null;
  const d = contaFaltasDe(c).reduce((s, f) => s + Number(f.valor_desconto || 0), 0);
  return Math.max(0, Math.round((Number(c.valor) - d) * 100) / 100);
}

/* ============================================================
   LISTA
   ============================================================ */
let CONTA_ABA = "apagar";   // "apagar" | "pagas" | "todas"
const CONTA_MES_CURTO = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
/* situação da conta para cor e etiqueta */
function contaEstado(c){
  if(c.pago_em) return "paga";
  const n = contaDias(c.vencimento);
  if(n < 0) return "atrasada";
  if(n <= 7) return "logo";
  return "depois";
}
const porVenc = (a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.id - b.id;

function montarContas(){
  const box = $("contasLista");
  box.innerHTML = "";
  if(!CONTAS) return;

  const abertas = CONTAS.filter(c => !c.pago_em).sort(porVenc);
  const atrasadas = abertas.filter(c => contaDias(c.vencimento) < 0);
  const semana = abertas.filter(c => { const n = contaDias(c.vencimento); return n >= 0 && n <= 7; });
  const depois = abertas.filter(c => contaDias(c.vencimento) > 7);
  const pagas = CONTAS.filter(c => c.pago_em).sort((a, b) => -porVenc(a, b));
  const soma = l => l.reduce((s, c) => s + Number(contaAPagar(c) || 0), 0);
  const diarias = CONTA_DIARIAS.reduce((s, p) => s + p.dias.length * p.valor, 0);
  const pago = pagas.reduce((s, c) => s + Number(c.valor_pago != null ? c.valor_pago : c.valor || 0), 0);

  const cab = document.createElement("div"); cab.className = "enc-cab conta-cab";
  [
    [atrasadas.length, atrasadas.length === 1 ? "atrasada" : "atrasadas", atrasadas.length ? "alerta" : ""],
    ["R$ " + moeda(soma(semana)), "em 7 dias", ""],
    ["R$ " + moeda(soma(abertas) + diarias), "em aberto", ""]
  ].forEach(([n, t, cls]) => {
    const d = document.createElement("div"); if(cls) d.className = cls;
    const b = document.createElement("b"); b.textContent = n;
    const s = document.createElement("span"); s.textContent = t;
    d.append(b, s); cab.appendChild(d);
  });
  box.appendChild(cab);

  /* abas: a pagar, pagas, todas */
  const abas = document.createElement("div"); abas.className = "conta-abas"; abas.setAttribute("role", "tablist");
  [["apagar", "A pagar", abertas.length + (CONTA_DIARIAS.some(p => p.dias.length) ? 1 : 0)],
   ["pagas", "Pagas", pagas.length],
   ["todas", "Todas", abertas.length + pagas.length]].forEach(([k, t, n]) => {
    const b = document.createElement("button"); b.type = "button"; b.dataset.aba = k; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(CONTA_ABA === k));
    b.className = "aba-" + k;
    const tt = document.createElement("span"); tt.textContent = t;
    const nn = document.createElement("b"); nn.textContent = n;
    b.append(tt, nn);
    b.onclick = () => { CONTA_ABA = k; CONTA_PAINEL = null; montarContas(); };
    abas.appendChild(b);
  });
  box.appendChild(abas);

  const nova = document.createElement("button");
  nova.type = "button"; nova.className = "conta-nova-bt"; nova.id = "contaNovaBt";
  nova.textContent = CONTA_NOVA ? "Fechar conta nova" : "+ Conta nova (anexe o boleto e o app preenche)";
  nova.onclick = () => { CONTA_NOVA = !CONTA_NOVA; CONTA_PAINEL = null; montarContas(); };
  box.appendChild(nova);
  if(CONTA_NOVA) box.appendChild(formConta(null));

  const secao = (titulo, lista, cls) => {
    if(!lista.length) return;
    const h = document.createElement("h3"); h.className = "conta-sec " + (cls || ""); h.textContent = titulo;
    box.appendChild(h);
    lista.forEach(c => box.appendChild(cartaoConta(c)));
  };

  if(CONTA_ABA === "apagar"){
    if(CONTA_DIARIAS.length) box.appendChild(blocoDiarias());
    secao("Atrasadas", atrasadas, "alerta");
    secao("Nos próximos 7 dias", semana, "logo");
    secao("Mais para frente", depois);
    const fatAbertas = CONTA_CARTOES.filter(f => !f.pago);
    if(fatAbertas.length) box.appendChild(blocoCartoes(fatAbertas));
    if(!abertas.length){
      const p = document.createElement("p"); p.className = "tip conta-vazio";
      p.textContent = "Nenhuma conta em aberto. As contas fixas chegam sozinhas do Nosso Financeiro; impostos e boletos de fornecedor você lança aqui.";
      box.appendChild(p);
    }
  } else if(CONTA_ABA === "pagas"){
    const r = document.createElement("p"); r.className = "conta-resumo-pagas";
    r.textContent = pagas.length ? pagas.length + (pagas.length === 1 ? " conta paga" : " contas pagas") + " nos últimos 90 dias, R$ " + moeda(pago) : "Nenhuma conta paga nos últimos 90 dias.";
    box.appendChild(r);
    pagas.forEach(c => box.appendChild(cartaoConta(c)));
    const fatPagas = CONTA_CARTOES.filter(f => f.pago);
    if(fatPagas.length) box.appendChild(blocoCartoes(fatPagas));
  } else {
    if(CONTA_DIARIAS.length) box.appendChild(blocoDiarias());
    const h = document.createElement("h3"); h.className = "conta-sec"; h.textContent = "Por data de vencimento";
    box.appendChild(h);
    CONTAS.slice().sort(porVenc).forEach(c => box.appendChild(cartaoConta(c)));
    if(CONTA_CARTOES.length) box.appendChild(blocoCartoes(CONTA_CARTOES));
  }
}

/* Cartões: a parte da confeitaria em cada fatura. Uma linha por cartão e vencimento;
   tocar mostra cada compra (data, parcela, valor) e a parcela da dívida antiga. */
function blocoCartoes(lista){
  const wrap = document.createElement("div"); wrap.className = "conta-cartoes"; wrap.id = "contaCartoes";
  const h = document.createElement("h3"); h.className = "conta-sec"; h.textContent = "Cartões · parte da confeitaria";
  wrap.appendChild(h);
  const dica = document.createElement("p"); dica.className = "conta-info"; dica.textContent = "Compras da confeitaria lançadas no Nosso Financeiro, na fatura em que caem. Toque para ver cada compra.";
  wrap.appendChild(dica);
  lista.slice().sort((a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.cartao.localeCompare(b.cartao)).forEach(f => {
    const chave = f.cartao + "|" + f.vencimento;
    const total = Number(f.compras || 0) + Number(f.divida || 0);
    const itens = Array.isArray(f.itens) ? f.itens : [];
    const est = f.pago ? "paga" : contaDias(f.vencimento) <= 7 ? "logo" : "depois";
    const el = document.createElement("div"); el.className = "enc conta conta-fatura est-" + est; el.dataset.cartao = chave;
    const topo = document.createElement("button"); topo.type = "button"; topo.className = "enc-topo conta-fat-topo";
    topo.setAttribute("aria-expanded", String(!!CARTAO_ABERTO[chave]));
    const [, mm, dd] = f.vencimento.split("-");
    const data = document.createElement("div"); data.className = "conta-data";
    const d1 = document.createElement("b"); d1.textContent = dd;
    const d2 = document.createElement("span"); d2.textContent = CONTA_MES_CURTO[Number(mm) - 1];
    data.append(d1, d2);
    const meio = document.createElement("div"); meio.className = "enc-meio";
    const b = document.createElement("b"); b.textContent = "Fatura " + f.cartao;
    const sub = document.createElement("span"); sub.className = "conta-quando";
    sub.textContent = [itens.length ? itens.length + (itens.length === 1 ? " compra" : " compras") + " R$ " + moeda(f.compras) : null,
                       Number(f.divida) > 0 ? "dívida antiga R$ " + moeda(f.divida) : null].filter(Boolean).join(" · ");
    meio.append(b, sub);
    const dir = document.createElement("div"); dir.className = "enc-dir";
    const v = document.createElement("b"); v.textContent = "R$ " + moeda(total);
    const chip = document.createElement("span"); chip.className = "enc-chip conta-chip-" + est; chip.textContent = f.pago ? "✓ PAGA" : "CARTÃO";
    dir.append(v, chip);
    topo.append(data, meio, dir);
    el.appendChild(topo);
    const det = document.createElement("div"); det.className = "conta-fat-itens" + (CARTAO_ABERTO[chave] ? "" : " hide");
    itens.forEach(x => {
      const l = document.createElement("div"); l.className = "cx-item";
      const d = document.createElement("span"); d.className = "d"; d.textContent = String(x.data || "").slice(8, 10) + "/" + String(x.data || "").slice(5, 7);
      const t = document.createElement("span"); t.className = "t"; t.textContent = x.desc || "Compra";
      if(x.parcela){ const sm = document.createElement("small"); sm.textContent = "parcela " + x.parcela; t.appendChild(sm); }
      const vv = document.createElement("b"); vv.textContent = "R$ " + moeda(x.valor);
      l.append(d, t, vv); det.appendChild(l);
    });
    if(Number(f.divida) > 0){
      const l = document.createElement("div"); l.className = "cx-item";
      const d = document.createElement("span"); d.className = "d"; d.textContent = dd + "/" + mm;
      const t = document.createElement("span"); t.className = "t"; t.textContent = "Dívida antiga no cartão";
      const sm = document.createElement("small"); sm.textContent = "parcela do mês do parcelamento antigo"; t.appendChild(sm);
      const vv = document.createElement("b"); vv.textContent = "R$ " + moeda(f.divida);
      l.append(d, t, vv); det.appendChild(l);
    }
    const tot = document.createElement("div"); tot.className = "cx-item conta-fat-total";
    const tl = document.createElement("span"); tl.className = "t"; tl.textContent = "Parte da confeitaria nesta fatura";
    const tv = document.createElement("b"); tv.textContent = "R$ " + moeda(total);
    tot.append(document.createElement("span"), tl, tv); det.appendChild(tot);
    el.appendChild(det);
    topo.onclick = () => { CARTAO_ABERTO[chave] = !CARTAO_ABERTO[chave]; det.classList.toggle("hide", !CARTAO_ABERTO[chave]); topo.setAttribute("aria-expanded", String(!!CARTAO_ABERTO[chave])); };
    wrap.appendChild(el);
  });
  return wrap;
}

function cartaoConta(c){
  const el = document.createElement("div");
  const est = contaEstado(c);
  el.className = "enc conta est-" + est;
  el.dataset.id = c.id;

  const topo = document.createElement("div"); topo.className = "enc-topo";
  /* data de vencimento grande à esquerda, na cor da situação */
  const [, mm, dd] = c.vencimento.split("-");
  const data = document.createElement("div"); data.className = "conta-data";
  const d1 = document.createElement("b"); d1.textContent = dd;
  const d2 = document.createElement("span"); d2.textContent = CONTA_MES_CURTO[Number(mm) - 1];
  data.append(d1, d2);
  const meio = document.createElement("div"); meio.className = "enc-meio";
  const b = document.createElement("b"); b.textContent = c.descricao;
  const s = document.createElement("span"); s.className = "conta-quando"; s.textContent = contaQuando(c);
  meio.append(b, s);
  const dir = document.createElement("div"); dir.className = "enc-dir";
  const v = document.createElement("b");
  v.textContent = contaReais(c.pago_em && c.valor_pago != null ? c.valor_pago : contaAPagar(c));
  const chip = document.createElement("span"); chip.className = "enc-chip conta-chip-" + est;
  chip.textContent = { paga: "✓ PAGA", atrasada: "ATRASADA", logo: "A PAGAR", depois: "A PAGAR" }[est];
  const tipo = document.createElement("small"); tipo.className = "conta-tipo"; tipo.textContent = CONTA_TIPO[c.tipo] || "";
  dir.append(v, chip, tipo);
  topo.append(data, meio, dir);
  el.appendChild(topo);

  /* boleto e comprovante num toque, sem abrir nada antes */
  if(c.boleto_path || c.comprovante_path){
    const arq = document.createElement("div"); arq.className = "conta-arqs";
    if(c.boleto_path){
      const x = document.createElement("button"); x.type = "button"; x.className = "conta-arq"; x.textContent = "📄 Abrir boleto";
      x.onclick = () => abrirArquivo(c.boleto_path); arq.appendChild(x);
    }
    if(c.comprovante_path){
      const x = document.createElement("button"); x.type = "button"; x.className = "conta-arq ok"; x.textContent = "🧾 Comprovante";
      x.onclick = () => abrirArquivo(c.comprovante_path); arq.appendChild(x);
    }
    el.appendChild(arq);
  }

  const det = document.createElement("div"); det.className = "conta-det";
  const info = [];
  if(c.competencia) info.push("Referente a " + contaMesRef(c.competencia));
  if(c.documento) info.push(c.documento);
  if(c.pago_em){
    const origem = { manual: "marcado à mão", comprovante: "pelo comprovante", financeiro: "lançado no Nosso Financeiro" }[c.pago_por] || "";
    info.push("Pago em " + dataCurta(c.pago_em) + (origem ? ", " + origem : ""));
  }
  if(info.length){ const p = document.createElement("p"); p.className = "conta-info"; p.textContent = info.join(" · "); det.appendChild(p); }
  const faltas = c.pago_em ? [] : contaFaltasDe(c);
  if(faltas.length){
    const p = document.createElement("p"); p.className = "conta-falta";
    p.textContent = "R$ " + moeda(Number(c.valor)) + " menos " + faltas.map(f => "falta de " + dataCurta(f.data) + " (" + eqHorasTx(Number(f.horas)) + ", R$ " + moeda(Number(f.valor_desconto)) + ")").join(" e ")
      + " = R$ " + moeda(contaAPagar(c));
    det.appendChild(p);
  }
  const banco = !c.pago_em && c.equipe_user_id ? (CONTA_BANCO[c.equipe_user_id] || 0) : 0;
  if(banco < 0){
    const p = document.createElement("p"); p.className = "conta-banco";
    p.textContent = "Banco de horas: devendo " + eqMinTx(banco) + ". Não sai sozinho deste pagamento; veja em Quem veio no ateliê.";
    det.appendChild(p);
  }
  if(c.obs){ const p = document.createElement("p"); p.className = "conta-obs"; p.textContent = c.obs; det.appendChild(p); }

  const ac = document.createElement("div"); ac.className = "enc-acoes";
  const bt = (txt, fn, cls) => { const x = document.createElement("button"); x.type = "button"; x.textContent = txt; if(cls) x.className = cls; x.onclick = fn; ac.appendChild(x); return x; };
  if(!c.pago_em){
    bt("Paguei", () => { CONTA_PAINEL = { id: c.id, modo: "pagar" }; CONTA_NOVA = false; montarContas(); });
  }
  if(c.codigo_barras && !c.pago_em) bt("Copiar código", () => copiarCodigo(c), "sec");
  bt("Editar", () => { CONTA_PAINEL = { id: c.id, modo: "editar" }; CONTA_NOVA = false; montarContas(); }, "sec");
  det.appendChild(ac);

  if(CONTA_PAINEL && CONTA_PAINEL.id === c.id){
    det.appendChild(CONTA_PAINEL.modo === "pagar" ? painelPagar(c) : formConta(c));
  }
  el.appendChild(det);
  return el;
}
async function copiarCodigo(c){
  try {
    await navigator.clipboard.writeText(c.codigo_barras);
    toast("Código copiado. Cole no app do banco, em pagar boleto.");
  } catch(e){
    // sem permissão de área de transferência: mostra para copiar à mão
    aviso("contasMsg", "Código: " + c.codigo_barras, "ok");
  }
}

async function abrirArquivo(caminho){
  const jan = window.open("", "_blank");
  const r = await sb.storage.from(CONTA_BALDE).createSignedUrl(caminho, 300);
  if(r.error || !r.data){
    if(jan) jan.close();
    aviso("contasMsg", "Não consegui abrir o arquivo agora.", "err");
    return;
  }
  if(jan) jan.location = r.data.signedUrl; else location.href = r.data.signedUrl;
}

async function subirArquivo(contaId, file, nome){
  const ext = ((file.name || "").match(/\.([a-z0-9]{2,4})$/i) || [, (/pdf/.test(file.type) ? "pdf" : "jpg")])[1].toLowerCase();
  const caminho = contaId + "/" + nome + "-" + Date.now() + "." + ext;
  const r = await sb.storage.from(CONTA_BALDE).upload(caminho, file, { contentType: file.type || "application/pdf", upsert: false });
  if(r.error) throw new Error(r.error.message);
  return caminho;
}

/* ============================================================
   PAGAR: comprovante (lido sozinho) ou data à mão
   ============================================================ */
function painelPagar(c){
  const p = document.createElement("div"); p.className = "conta-painel"; p.id = "contaPainel";
  const st = CONTA_PAINEL;

  const h = document.createElement("p"); h.className = "conta-p-tit";
  h.textContent = "Anexe o comprovante: o app lê a data e o valor e confere com o boleto.";
  p.appendChild(h);

  const lab = document.createElement("label"); lab.className = "conta-arquivo";
  lab.textContent = st.file ? "Comprovante: " + st.file.name : "Escolher comprovante (PDF ou foto)";
  const inp = document.createElement("input"); inp.type = "file"; inp.id = "contaComprovante";
  inp.accept = "application/pdf,image/*";
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if(!f) return;
    st.file = f; st.leitura = null;
    try {
      const txt = await contaTextoDoArquivo(f);
      st.leitura = txt ? contaLerTexto(txt) : {};
    } catch(e){ st.leitura = {}; }
    if(st.leitura.pagoEm) st.data = st.leitura.pagoEm;
    if(st.leitura.valor != null) st.valor = st.leitura.valor;
    montarContas();
  };
  lab.appendChild(inp);
  p.appendChild(lab);

  if(st.file){
    const l = st.leitura || {};
    const conf = contaConferir({ ...c, valor: contaAPagar(c) }, l);
    const msg = document.createElement("p"); msg.className = "conta-leitura"; msg.id = "contaLeitura";
    const partes = [];
    if(l.pagoEm) partes.push("pago em " + dataCurta(l.pagoEm));
    if(l.valor != null) partes.push("R$ " + moeda(l.valor));
    if(conf.codigoBate) partes.push("código igual ao do boleto ✓");
    let tipo = "ok";
    if(conf.codigoDiverge){ partes.push("o código é de OUTRO boleto"); tipo = "alerta"; }
    else if(c.valor != null && l.valor != null && !conf.valorBate){ partes.push("valor diferente do previsto (R$ " + moeda(contaAPagar(c)) + ")"); tipo = "alerta"; }
    msg.textContent = partes.length ? "Li no comprovante: " + partes.join(", ") + "."
                                    : "Não consegui ler esse arquivo. Confira a data e o valor abaixo.";
    msg.classList.add(tipo);
    p.appendChild(msg);
  }

  const lin = document.createElement("div"); lin.className = "conta-linha";
  const ld = document.createElement("label"); ld.textContent = "Pago em";
  const id_ = document.createElement("input"); id_.type = "date"; id_.id = "contaPagoEm"; id_.max = hojeSP();
  id_.value = st.data || hojeSP();
  id_.onchange = () => { st.data = id_.value; };
  ld.appendChild(id_);
  const lv = document.createElement("label"); lv.textContent = "Valor pago";
  const iv = document.createElement("input"); iv.type = "text"; iv.inputMode = "decimal"; iv.id = "contaValorPago";
  const vp = st.valor != null ? st.valor : contaAPagar(c);
  iv.value = vp != null ? String(Number(vp).toFixed(2)).replace(".", ",") : "";
  iv.onchange = () => { st.valor = numBR(iv.value); };
  lv.appendChild(iv);
  lin.append(ld, lv);
  p.appendChild(lin);

  const ac = document.createElement("div"); ac.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = "contaConfirmaPago";
  ok.textContent = "Confirmar pagamento";
  ok.onclick = travar(ok, () => confirmarPagamento(c, id_.value, numBR(iv.value)));
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Cancelar";
  cx.onclick = () => { CONTA_PAINEL = null; montarContas(); };
  ac.append(ok, cx);
  p.appendChild(ac);
  return p;
}

async function confirmarPagamento(c, data, valor){
  const st = CONTA_PAINEL || {};
  if(!data){ aviso("contasMsg", "Diga a data do pagamento.", "warn"); return; }
  if(data > hojeSP()){ aviso("contasMsg", "A data do pagamento não pode ser no futuro.", "warn"); return; }
  if(valor == null || !(valor >= 0)){ aviso("contasMsg", "Diga quanto foi pago.", "warn"); return; }
  const conf = st.file ? contaConferir(c, st.leitura || {}) : null;
  if(conf && conf.codigoDiverge && !confirm("O código de barras desse comprovante é de outro boleto. Marcar como paga mesmo assim?")) return;
  const upd = { pago_em: data, valor_pago: valor, pago_por: st.file ? "comprovante" : "manual" };
  try {
    if(st.file) upd.comprovante_path = await subirArquivo(c.id, st.file, "comprovante");
  } catch(e){
    aviso("contasMsg", "Não consegui guardar o comprovante. Tente de novo.", "err");
    return;
  }
  const { error } = await sb.from("jb_conta").update(upd).eq("id", c.id);
  if(error){ aviso("contasMsg", "Não consegui marcar como paga.", "err"); return; }
  Object.assign(c, upd);
  CONTA_PAINEL = null;
  aviso("contasMsg", c.descricao + ": paga em " + dataCurta(data) + ", R$ " + moeda(valor) + ".", "ok");
  montarContas();
}

/* ============================================================
   CONTA NOVA E EDIÇÃO
   ============================================================ */
function formConta(c){
  const novo = !c;
  if(novo) CONTA_PAINEL_NOVO = CONTA_PAINEL_NOVO || { campos: {} };
  else CONTA_PAINEL.campos = CONTA_PAINEL.campos || {};
  const st = novo ? CONTA_PAINEL_NOVO : CONTA_PAINEL;
  const campos = st.campos;
  const val = (k, def) => (k in campos) ? campos[k] : def;

  const f = document.createElement("div"); f.className = "conta-painel"; f.id = novo ? "contaForm" : "contaEdita";

  const lab = document.createElement("label"); lab.className = "conta-arquivo";
  const arq = st.file;
  lab.textContent = arq ? "Boleto: " + arq.name : (c && c.boleto_path ? "Trocar o boleto (PDF ou foto)" : "Anexar o boleto (PDF ou foto)");
  const inp = document.createElement("input"); inp.type = "file"; inp.id = novo ? "contaBoleto" : "contaBoletoEdita";
  inp.accept = "application/pdf,image/*";
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if(!file) return;
    st.file = file;
    let l = {};
    try { const txt = await contaTextoDoArquivo(file); l = txt ? contaLerTexto(txt) : {}; } catch(e){}
    if(l.codigo) campos.codigo_barras = l.codigo;
    if(l.valor != null) campos.valor = l.valor;
    if(l.pagarAte || l.vencimento) campos.vencimento = l.pagarAte || l.vencimento;
    if(l.documento) campos.documento = l.documento;
    if(l.competencia) campos.competencia = l.competencia;
    if(l.imposto && novo && !("tipo" in campos)) campos.tipo = "imposto";
    if(l.imposto && novo && !campos.descricao && l.competencia) campos.descricao = "DAS do Simples, " + contaMesRef(l.competencia);
    campos._lido = !!(l.codigo || l.valor != null);
    montarContas();
  };
  lab.appendChild(inp);
  f.appendChild(lab);
  if(campos._lido){
    const m = document.createElement("p"); m.className = "conta-leitura ok"; m.id = "contaBoletoLido";
    m.textContent = "Li o boleto e preenchi o que deu. Confira antes de salvar.";
    f.appendChild(m);
  }

  const grid = document.createElement("div"); grid.className = "conta-grid";
  const campo = (rot, k, el) => { const l = document.createElement("label"); l.textContent = rot; el.dataset.k = k; l.appendChild(el); grid.appendChild(l); return el; };

  const tipo = document.createElement("select"); tipo.id = "contaTipo";
  Object.entries(CONTA_TIPO).forEach(([k, t]) => { const o = document.createElement("option"); o.value = k; o.textContent = t; tipo.appendChild(o); });
  tipo.value = val("tipo", c ? c.tipo : "imposto");
  tipo.disabled = !!(c && c.nf_conta_fixa_id);
  campo("Tipo", "tipo", tipo);

  const desc = document.createElement("input"); desc.type = "text"; desc.id = "contaDescricao"; desc.maxLength = 140;
  desc.value = val("descricao", c ? c.descricao : ""); desc.placeholder = "Ex.: DAS de outubro, boleto do atacadão";
  campo("Descrição", "descricao", desc).parentElement.classList.add("largo");

  const venc = document.createElement("input"); venc.type = "date"; venc.id = "contaVencimento";
  venc.value = val("vencimento", c ? c.vencimento : "");
  campo("Vence em", "vencimento", venc);

  const valor = document.createElement("input"); valor.type = "text"; valor.inputMode = "decimal"; valor.id = "contaValor";
  const vv = val("valor", c ? c.valor : null);
  valor.value = vv != null && vv !== "" ? String(Number(vv).toFixed(2)).replace(".", ",") : "";
  valor.placeholder = "0,00";
  campo("Valor", "valor", valor);

  const comp = document.createElement("input"); comp.type = "month"; comp.id = "contaCompetencia";
  const cv = val("competencia", c ? c.competencia : null);
  comp.value = cv ? cv.slice(0, 7) : "";
  campo("Referente ao mês", "competencia", comp);

  const docu = document.createElement("input"); docu.type = "text"; docu.id = "contaDocumento"; docu.maxLength = 60;
  docu.value = val("documento", c ? (c.documento || "") : "");
  campo("Nº do documento", "documento", docu);

  const cod = document.createElement("input"); cod.type = "text"; cod.inputMode = "numeric"; cod.id = "contaCodigo";
  cod.value = val("codigo_barras", c ? (c.codigo_barras || "") : "");
  cod.placeholder = "Linha digitável, só números";
  campo("Código de barras", "codigo_barras", cod).parentElement.classList.add("largo");

  const obs = document.createElement("textarea"); obs.id = "contaObs"; obs.maxLength = 400; obs.rows = 2;
  obs.value = val("obs", c ? (c.obs || "") : "");
  campo("Observação", "obs", obs).parentElement.classList.add("largo");

  [tipo, desc, venc, valor, comp, docu, cod, obs].forEach(el => {
    el.addEventListener("change", () => {
      const k = el.dataset.k;
      campos[k] = k === "valor" ? numBR(el.value) : (k === "competencia" && el.value ? el.value + "-01" : el.value);
    });
  });
  f.appendChild(grid);

  const ac = document.createElement("div"); ac.className = "enc-acoes";
  const ok = document.createElement("button"); ok.type = "button"; ok.id = novo ? "contaSalvar" : "contaSalvarEdicao";
  ok.textContent = novo ? "Salvar conta" : "Salvar alterações";
  ok.onclick = travar(ok, () => salvarConta(c, {
    tipo: tipo.value, descricao: desc.value.trim(), vencimento: venc.value,
    valor: valor.value.trim() ? numBR(valor.value) : null,
    competencia: comp.value ? comp.value + "-01" : null,
    documento: docu.value.trim() || null,
    codigo_barras: contaDigitos(cod.value) || null,
    obs: obs.value.trim() || null
  }, st.file));
  ac.appendChild(ok);
  if(!novo){
    if(c.pago_em){
      const des = document.createElement("button"); des.type = "button"; des.className = "sec"; des.id = "contaDesfazPago";
      des.textContent = "Não foi paga";
      des.onclick = travar(des, () => desfazerPagamento(c));
      ac.appendChild(des);
    }
    const arqv = document.createElement("button"); arqv.type = "button"; arqv.className = "perigo"; arqv.id = "contaArquivar";
    arqv.textContent = "Tirar da lista";
    arqv.onclick = travar(arqv, () => arquivarConta(c));
    ac.appendChild(arqv);
  }
  const cx = document.createElement("button"); cx.type = "button"; cx.className = "sec"; cx.textContent = "Cancelar";
  cx.onclick = () => { if(novo){ CONTA_NOVA = false; CONTA_PAINEL_NOVO = null; } else CONTA_PAINEL = null; montarContas(); };
  ac.appendChild(cx);
  f.appendChild(ac);
  return f;
}
let CONTA_PAINEL_NOVO = null;

async function salvarConta(c, d, file){
  if(!d.descricao){ aviso("contasMsg", "Diga o que é a conta.", "warn"); return; }
  if(!d.vencimento){ aviso("contasMsg", "Diga quando vence.", "warn"); return; }
  if(d.valor != null && !(d.valor >= 0)){ aviso("contasMsg", "O valor não está certo.", "warn"); return; }
  if(d.codigo_barras && !contaCodigo44(d.codigo_barras)){
    aviso("contasMsg", "Esse código de barras não confere (algum número trocado). Confira ou deixe em branco.", "warn"); return;
  }
  if(c && c.nf_conta_fixa_id) delete d.tipo;   // conta fixa continua fixa: é a ligação com o Nosso Financeiro
  let id = c ? c.id : null;
  if(c){
    const { error } = await sb.from("jb_conta").update(d).eq("id", id);
    if(error){ aviso("contasMsg", "Não consegui salvar.", "err"); return; }
    Object.assign(c, d);
  } else {
    const { data, error } = await sb.from("jb_conta").insert(d).select().single();
    if(error || !data){ aviso("contasMsg", "Não consegui salvar a conta.", "err"); return; }
    id = data.id;
    (CONTAS = CONTAS || []).push(data);
  }
  if(file){
    try {
      const caminho = await subirArquivo(id, file, "boleto");
      await sb.from("jb_conta").update({ boleto_path: caminho }).eq("id", id);
      const alvo = CONTAS.find(x => x.id === id); if(alvo) alvo.boleto_path = caminho;
    } catch(e){
      aviso("contasMsg", "A conta foi salva, mas o boleto não subiu. Abra a conta e anexe de novo.", "warn");
      CONTA_NOVA = false; CONTA_PAINEL_NOVO = null; CONTA_PAINEL = null;
      CONTAS.sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
      montarContas();
      return;
    }
  }
  CONTA_NOVA = false; CONTA_PAINEL_NOVO = null; CONTA_PAINEL = null;
  CONTAS.sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
  aviso("contasMsg", d.descricao + ": salva, vence " + dataCurta(d.vencimento) + ".", "ok");
  montarContas();
}

async function desfazerPagamento(c){
  if(c.pago_por === "financeiro" && !confirm("Esse pagamento veio do Nosso Financeiro. Se o lançamento continuar lá, a rotina marca de novo. Desfazer mesmo assim?")) return;
  const upd = { pago_em: null, valor_pago: null, pago_por: null };
  const { error } = await sb.from("jb_conta").update(upd).eq("id", c.id);
  if(error){ aviso("contasMsg", "Não consegui desfazer.", "err"); return; }
  Object.assign(c, upd);
  CONTA_PAINEL = null;
  aviso("contasMsg", c.descricao + ": voltou para em aberto.", "ok");
  montarContas();
}

async function arquivarConta(c){
  if(!confirm("Tirar \"" + c.descricao + "\" da lista? Ela fica guardada, só não aparece mais.")) return;
  const { error } = await sb.from("jb_conta").update({ arquivada: true }).eq("id", c.id);
  if(error){ aviso("contasMsg", "Não consegui tirar da lista.", "err"); return; }
  CONTAS = CONTAS.filter(x => x.id !== c.id);
  CONTA_PAINEL = null;
  aviso("contasMsg", c.descricao + " saiu da lista.", "ok");
  montarContas();
}

/* Quem ganha por dia: soma sozinha os dias confirmados em Quem veio no ateliê que ainda não foram pagos. */
function blocoDiarias(){
  const wrap = document.createElement("div"); wrap.className = "conta-diarias"; wrap.id = "contaDiarias";
  const h = document.createElement("h3"); h.className = "conta-sec"; h.textContent = "Equipe por dia";
  wrap.appendChild(h);
  CONTA_DIARIAS.forEach(p => {
    const el = document.createElement("div"); el.className = "enc conta conta-diaria " + (p.dias.length ? "est-logo" : "est-paga"); el.dataset.diaria = p.uid;
    const topo = document.createElement("div"); topo.className = "enc-topo";
    const meio = document.createElement("div"); meio.className = "enc-meio";
    const b = document.createElement("b"); b.textContent = p.nome + ", diária de R$ " + moeda(p.valor);
    const s = document.createElement("span"); s.className = "conta-quando";
    s.textContent = p.dias.length
      ? (p.dias.length === 1 ? "1 dia em aberto: " : p.dias.length + " dias em aberto: ") + p.dias.map(dataCurta).join(", ")
      : "Nada em aberto. Cada dia marcado como veio soma aqui.";
    meio.append(b, s);
    const dir = document.createElement("div"); dir.className = "enc-dir";
    const v = document.createElement("b"); v.textContent = "R$ " + moeda(p.dias.length * p.valor);
    const chip = document.createElement("span"); chip.className = "enc-chip" + (p.dias.length ? "" : " ok"); chip.textContent = p.dias.length ? "a pagar" : "em dia";
    dir.append(v, chip);
    topo.append(meio, dir);
    el.appendChild(topo);
    if(p.dias.length){
      const det = document.createElement("div"); det.className = "conta-det";
      const ac = document.createElement("div"); ac.className = "enc-acoes";
      const x = document.createElement("button"); x.type = "button"; x.textContent = "Marcar como pagos";
      x.onclick = () => { DIAS_MES = primeiroDia(p.dias[0]); PAG_ABERTO[p.uid] = true; abrirDias(); };
      ac.appendChild(x); det.appendChild(ac); el.appendChild(det);
    }
    wrap.appendChild(el);
  });
  return wrap;
}

/* Resumo para a Home do gestor: o que vence logo. */
async function resumoContasHome(){
  const r = await sb.from("jb_conta").select("id,vencimento,valor").eq("arquivada", false).is("pago_em", null).lte("vencimento", diaMais(3));
  if(r.error) return null;
  const l = r.data || [];
  const atrasadas = l.filter(c => contaDias(c.vencimento) < 0).length;
  return { atrasadas, logo: l.length - atrasadas };
}
