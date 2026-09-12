/* JB OS · base: configuração, cliente do Supabase, navegação, utilitários e estado compartilhado.
   Os arquivos js/*.js são scripts clássicos carregados em ordem: todos compartilham o mesmo escopo. */

/* ============================================================
   CONFIGURAÇÃO
   ============================================================ */
const SUPABASE_URL = "https://yudtseanlkhxkmnranmg.supabase.co";
const SUPABASE_KEY = "sb_publishable_M77s2Y-DZGl0xLZYYGKniA_ZdkxBO8O";

const LOGINS = [
  { nome: "Jessica",  email: "jessica@jbconfeitaria.app"  },
  { nome: "Yasmin",   email: "delivery@jbconfeitaria.app" },
  { nome: "Eliana",   email: "producao@jbconfeitaria.app" },
  { nome: "Henrique", email: "henrique@jbconfeitaria.app" }
];

const TZ = "America/Sao_Paulo";
const VERSAO = "2026-09-12";   // aparece no login e no pé da Home, para saber qual versão cada celular tem
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
const $ = id => document.getElementById(id);
const SC = ["scLogin","scHome","scCount","scRes","scFeito","scAdendo","scHist","scCustos","scFicha","scProd","scReceita","scMes","scDias","scAfa"];
/* ============================================================
   NAVEGAÇÃO
   Uma barra só, em todas as telas: voltar, título e atualizar.
   O botão físico de voltar do celular usa o mesmo caminho.
   ============================================================ */
let TELA = "scLogin";

const NAV = {
  scCount:   { titulo: () => EDIT_LISTA ? "Editando a lista"
                             : MODO === "repor" ? "Repondo na geladeira"
                             : (MOMENTO === "abertura" ? "O que estou deixando" : "O que sobrou"),
               voltar: () => EDIT_LISTA ? alternarEdicaoLista() : carregarHome(),
               recarregar: () => abrirContagem(MOMENTO, MODO) },
  scRes:     { titulo: () => "Resultado do turno",
               voltar: () => carregarHome(),
               recarregar: () => RES_DIA ? mostrarResultado(RES_DIA) : carregarHome() },
  scFeito:   { titulo: () => "Turno fechado",
               voltar: () => carregarHome(),
               recarregar: () => mostrarFeito(FEITO_DIA) },
  scAdendo:  { titulo: () => "Saiu depois do fechamento",
               voltar: () => mostrarFeito(FEITO_DIA),
               recarregar: () => abrirAdendo(FEITO_DIA) },
  scHist:    { titulo: () => "Últimos dias",
               voltar: () => carregarHome(),
               recarregar: () => abrirHistorico() },
  scCustos:  { titulo: () => "Custos e preços",
               voltar: () => carregarHome(),
               recarregar: () => { CATALOGO = []; INSUMOS_CACHE = null; CANAIS = []; CANAL = null; FOTOS = {}; abrirCustos(); } },
  scFicha:   { titulo: () => (FICHA && FICHA.nome) ? FICHA.nome : "Receita nova",
               voltar: () => sairDaFicha(),
               recarregar: () => FICHA && FICHA.id ? abrirFicha(FICHA.id, TIPO) : null },
  scProd:    { titulo: () => EU && EU.papel === "gestor" ? "Plano de produção" : "O que fazer hoje",
               voltar: () => carregarHome(),
               recarregar: () => { RECEITAS = null; abrirProducao(); } },
  scMes:     { titulo: () => "Resultado do mês",
               voltar: () => carregarHome(),
               recarregar: () => abrirMes() },
  scDias:    { titulo: () => "Quem veio no ateliê",
               voltar: () => carregarHome(),
               recarregar: () => abrirDias() },
  scAfa:     { titulo: () => "Afazeres",
               voltar: () => carregarHome(),
               recarregar: () => abrirAfazeres() },
  scReceita: { titulo: () => (REC && REC.cab) ? REC.cab.nome : "Receita",
               voltar: () => voltarDaReceita(),
               recarregar: () => REC ? abrirReceita(REC.origemItem, REC.qtdAlvo, REC.voltaPara) : null }
};

function atualizarNav(){
  const cfg = NAV[TELA];
  $("nav").classList.toggle("hide", !cfg);
  if(!cfg) return;
  $("navTitulo").textContent = cfg.titulo();
}

let POR_POP = false;   // a troca de tela veio do botão voltar do celular: não empilha de novo

function show(id){
  SC.forEach(s => $(s).classList.toggle("hide", s !== id));
  window.scrollTo(0,0);
  const mudou = id !== TELA;
  TELA = id;
  atualizarNav();
  // deixa o voltar do celular andar junto com o voltar da tela
  if(mudou && id !== "scLogin" && !POR_POP){
    try { history.pushState({ tela: id }, ""); } catch(e){}
  }
  POR_POP = false;
}

async function recarregarTela(){
  const cfg = NAV[TELA];
  const btn = TELA === "scHome" ? $("homeRecarregar") : $("navRecarregar");
  btn.classList.add("girando");
  btn.disabled = true;
  try {
    if(TELA === "scHome"){ await recarregarProdutos(); await carregarHome(); }
    else if(cfg) await cfg.recarregar();
  } catch(e){}
  btn.classList.remove("girando");
  btn.disabled = false;
}

function voltarDaReceita(){
  aviso("recMsg","","");
  if(REC && REC.voltaPara){
    const p = REC.voltaPara;
    abrirReceita(p.origemItem, p.qtdAlvo, p.voltaPara);
  } else {
    show("scProd");
  }
}

/* "Agora" passa por um lugar só, para os testes poderem fingir meia-noite. */
function agora(){ return window.__AGORA ? new Date(window.__AGORA) : new Date(); }
function hojeSP(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(agora());
}
function horaSP(){
  return new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(agora());
}
function dataLonga(iso){
  const [a,m,d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a,m-1,d,12));
  const s = new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",weekday:"long",day:"numeric",month:"long"}).format(dt);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dataCurta(iso){
  const [a,m,d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a,m-1,d,12));
  return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC",weekday:"short",day:"2-digit",month:"2-digit"}).format(dt);
}
function aviso(alvo, texto, tipo){
  const el = $(alvo);
  if(!texto){ el.innerHTML = ""; return; }
  el.innerHTML = '<div class="msg ' + tipo + '"></div>';
  el.firstChild.textContent = texto;
}

let TOAST_T = null;
function toast(texto, tipo){
  const el = $("toast");
  el.textContent = texto;
  el.className = "toast on" + (tipo === "err" ? " err" : "");
  clearTimeout(TOAST_T);
  TOAST_T = setTimeout(() => { el.className = "toast"; }, 2600);
}

/* Desativa o botão enquanto a chamada não termina: dois toques rápidos não viram dois inserts. */
function travar(btn, fn){
  return async (...args) => {
    if(btn.disabled) return;
    btn.disabled = true;
    try { return await fn(...args); }
    finally { btn.disabled = false; }
  };
}

/* ============================================================
   ESTADO
   ============================================================ */
let EU = null;
let PRODUTOS = [];
let PRODUTOS_OK = true;   // falso quando a lista não carregou: a contagem avisa em vez de abrir vazia
let MOMENTO = null;
let MODO = "contar";      // "contar" = o número total na geladeira · "repor" = só o que está entrando agora
let VALORES = {};
let BASE = {};            // no modo repor, o que já estava contado em cada item
let ONTEM = {};           // na abertura, o que ficou na geladeira no fechamento de ontem
let LISTA = [];           // os itens desta contagem (quase sempre PRODUTOS)
let CONTAGEM_HOJE = {};
let TURNO_DIA = null;   // o dia do turno em que o app está, quase sempre hoje
let HOME_DIA  = null;   // o dia em que a Home foi montada: se mudou, ela se refaz ao voltar
let FEITO_DIA = null;   // o dia mostrado na tela de turno fechado e no adendo

const diaDoTurno = () => TURNO_DIA || hojeSP();
const rascunhoKey = () => "jb_rascunho_" + diaDoTurno() + "_" + MOMENTO + (MODO === "repor" ? "_repor" : "");
