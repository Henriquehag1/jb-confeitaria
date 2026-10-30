/* JB OS · plano de produção e a receita multiplicada. */

/* ============================================================
   PRODUÇÃO
   A Jessica diz quanto quer de cada receita. Quem produz abre e vê
   a receita já multiplicada, com o passo a passo.
   ============================================================ */
let PROD_DIA = null;      // data escolhida
let PROD_ITENS = [];      // itens do dia
let PROD_TAREFAS = [];    // tarefas do dia que não são receita (jb_tarefa_equipe): dobrar pano, limpar a geladeira
let TAREFA_QUEM_ABERTO = null;
let RET_ABERTO = null;       // { k: "tarefa7" | "producao12", modo: "nao" | "nota" }: o bilhete aberto agora
const TAREFAS_SUGERIDAS = ["Dobrar os panos", "Limpar a geladeira expositora", "Lavar a louça", "Organizar o estoque", "Limpar o freezer", "Tirar o lixo"];
let RECEITAS = null;      // { fichas:[], subs:[] } para o seletor do gestor
let REC = null;           // receita aberta
/* quem faz o quê: o gestor escolhe o destino de cada item do dia */
let PESSOAS = null;       // { producao: "Eliana", equipe: "Yasmin" }
const PARA_PADRAO = tipo => tipo === "subreceita" ? "producao" : "todos";

function diaMais(n){
  const d = new Date(hojeSP() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

/* mostra 1500 g como 1,5 kg e 0,25 kg como 250 g */
function qtdBonita(q, un){
  let v = Number(q), u = (un || "un").toLowerCase();
  if(u === "g"  && v >= 1000){ v = v/1000; u = "kg"; }
  else if(u === "kg" && v <  1){ v = v*1000; u = "g"; }
  else if(u === "ml" && v >= 1000){ v = v/1000; u = "L"; }
  else if(u === "l"  && v <  1){ v = v*1000; u = "ml"; }
  let casas;
  if(u === "g" || u === "ml") casas = 0;
  else if(u === "un") casas = v >= 1 ? 0 : 1;   // ninguém separa meio ovo
  else casas = v < 10 ? 2 : 1;
  let txt = v.toLocaleString("pt-BR",{minimumFractionDigits:0, maximumFractionDigits:casas});
  if(u === "l") u = "L";
  return txt + " " + u;
}

async function abrirProducao(){
  aviso("prodMsg","","");
  if(!PROD_DIA) PROD_DIA = hojeSP();
  const gestor = EU.papel === "gestor";
  $("addProd").classList.toggle("hide", !gestor);
  if(gestor) await carregarPessoas();
  if(gestor && !RECEITAS){
    const [ff, ss] = await Promise.all([
      sb.from("jb_receita_ficha").select("ficha_id,nome,preparo_conferido").order("nome"),
      sb.from("jb_receita_sub").select("subreceita_id,nome,preparo_conferido,rendimento_kg").order("nome")
    ]);
    RECEITAS = { fichas: ff.data || [], subs: ss.data || [] };
    montarSeletorProd();
  }
  await carregarDia();
  show("scProd");
}

function montarSeletorProd(){
  const sel = $("addProd");
  sel.innerHTML = '<option value="">+ adicionar receita ao dia</option>';
  const g1 = document.createElement("optgroup"); g1.label = "Produtos";
  RECEITAS.fichas.forEach(f => {
    const o = document.createElement("option");
    o.value = "ficha:" + f.ficha_id; o.textContent = f.nome; g1.appendChild(o);
  });
  const g2 = document.createElement("optgroup"); g2.label = "Massas e recheios";
  RECEITAS.subs.forEach(s => {
    const o = document.createElement("option");
    o.value = "subreceita:" + s.subreceita_id; o.textContent = s.nome; g2.appendChild(o);
  });
  sel.append(g1, g2);
}

async function carregarDia(){
  const box = $("prodLista");
  box.innerHTML = "<p class='tip'>Carregando...</p>";
  montarDiasProducao();
  const { data, error } = await sb.from("jb_producao_dia").select("*").eq("data", PROD_DIA);
  if(error){ box.innerHTML=""; aviso("prodMsg","Não consegui carregar o dia agora.","err"); return; }
  PROD_ITENS = (data || []).sort((a,b) =>
    (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : (a.tipo === "subreceita" ? -1 : 1)));
  /* as outras tarefas do dia: se a tabela ainda não existir ou não der para ler, a produção segue igual */
  const t = await Promise.resolve(sb.from("jb_tarefa_equipe").select("*").eq("data", PROD_DIA)).catch(() => null);
  PROD_TAREFAS = ((t && !t.error && t.data) || []).sort((a, b) => (a.feito === b.feito ? a.id - b.id : a.feito ? 1 : -1));
  montarProdLista();
}

function montarDiasProducao(){
  const box = $("prodDias");
  box.innerHTML = "";
  const dias = EU.papel === "gestor"
    ? [[diaMais(-1),"Ontem"],[diaMais(0),"Hoje"],[diaMais(1),"Amanhã"],[diaMais(2),dataCurta(diaMais(2))]]
    : [[diaMais(0),"Hoje"]];
  dias.forEach(([iso, rot]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = rot;
    b.setAttribute("aria-pressed", String(iso === PROD_DIA));
    b.onclick = () => { PROD_DIA = iso; carregarDia(); };
    box.appendChild(b);
  });
}

/* Massa e recheio são pedidos do jeito que a cozinha fala: "3 massas", "2 panelas".
   O banco continua guardando em kg (qtd), para o estoque, o custo e os relatórios;
   a conversão é o rendimento de uma receita inteira. Produto pronto segue em unidades. */
function lotesDe(it){
  const r = Number(it.rendimento);
  if(it.tipo !== "subreceita" || !(r > 0)) return null;
  return Number(it.qtd) / r;
}
function numLote(n){
  return Number(n).toLocaleString("pt-BR",{minimumFractionDigits:0, maximumFractionDigits:2});
}
function nomeLote(n, un){
  const u = un || "receita";
  return Number(n) > 1 ? u + "s" : u;
}
function loteTx(n, un){
  if(Math.abs(Number(n) - 0.5) < 0.001) return "meia " + (un || "receita");
  return numLote(n) + " " + nomeLote(n, un);
}

function montarProdLista(){
  const box = $("prodLista");
  const gestor = EU.papel === "gestor";
  box.innerHTML = "";

  if(!PROD_ITENS.length && !PROD_TAREFAS.length && !gestor){
    const p = document.createElement("p");
    p.className = "tip";
    p.textContent = "Nada para fazer hoje. A Jessica ainda não montou a lista.";
    box.appendChild(p);
    return;
  }
  if(PROD_ITENS.length || gestor){
    const h = document.createElement("h3"); h.className = "prod-sec"; h.textContent = "Produção";
    box.appendChild(h);
  }
  if(!PROD_ITENS.length && gestor){
    const p = document.createElement("p");
    p.className = "tip";
    p.textContent = "Nenhuma receita para este dia ainda. Escolha uma receita abaixo e diga a quantidade.";
    box.appendChild(p);
  }

  PROD_ITENS.forEach(it => {
    const travado = !it.preparo_conferido;   // não bloqueia mais: abre com aviso
    const row = document.createElement("div");
    row.className = "prod" + (it.feito ? " feito" : "");

    const im = imgFoto(it.foto_url);
    if(im) row.appendChild(im);

    const n = document.createElement("button");
    n.type = "button"; n.className = "n";
    n.style.border = "none"; n.style.background = "none"; n.style.textAlign = "left"; n.style.padding = "0";
    n.textContent = it.nome;
    const s = document.createElement("small");
    s.textContent = textoItemPlano(it, gestor, travado);
    n.appendChild(s);
    const emLotes = lotesDe(it) !== null;
    n.onclick = () => abrirReceita(it);

    row.appendChild(n);

    if(gestor){
      const inp = document.createElement("input");
      inp.className = "q"; inp.type = "tel"; inp.inputMode = "decimal";
      const mostra = () => emLotes ? numLote(lotesDe(it)) : String(it.qtd).replace(".",",");
      inp.value = mostra();
      inp.setAttribute("aria-label", emLotes
        ? "Quantas " + nomeLote(2, it.unidade_producao) + " de " + it.nome
        : "Quantidade de " + it.nome);
      inp.onblur = async () => {
        const digitado = numBR(inp.value);
        const v = (digitado !== null && emLotes) ? Math.round(digitado * Number(it.rendimento) * 1000) / 1000 : digitado;
        if(v === null || v <= 0){
          if(!confirm("Tirar " + it.nome + " do dia?")){ inp.value = mostra(); return; }
          const { error } = await sb.from("jb_producao_item").delete().eq("id", it.id);
          if(error){ aviso("prodMsg","Não consegui tirar esse item.","err"); return; }
          carregarDia(); return;
        }
        if(v === Number(it.qtd)) return;
        const { error } = await sb.from("jb_producao_item").update({ qtd: v }).eq("id", it.id);
        if(error){ aviso("prodMsg","Não consegui salvar a quantidade.","err"); return; }
        it.qtd = v;
        if(emLotes){
          un.textContent = nomeLote(lotesDe(it), it.unidade_producao);
          if(!it.feito && !travado) s.textContent = "cerca de " + qtdBonita(v, "kg") + " no total";
          aviso("prodMsg", it.nome + ": " + loteTx(lotesDe(it), it.unidade_producao) + ", cerca de " + qtdBonita(v, "kg") + ".","ok");
        } else {
          aviso("prodMsg", it.nome + ": " + qtdBonita(v, it.unidade) + ".","ok");
        }
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
      const un = document.createElement("span"); un.className = "un";
      un.textContent = emLotes ? nomeLote(lotesDe(it), it.unidade_producao) : it.unidade;
      const tirar = document.createElement("button");
      tirar.type = "button"; tirar.className = "tirar";
      tirar.textContent = "tirar";
      tirar.setAttribute("aria-label","Tirar " + it.nome + " do dia");
      tirar.onclick = async () => {
        if(!confirm("Tirar " + it.nome + " do dia " + dataCurta(PROD_DIA) + "?")) return;
        const { error } = await sb.from("jb_producao_item").delete().eq("id", it.id);
        if(error){ aviso("prodMsg","Não consegui tirar esse item.","err"); return; }
        aviso("prodMsg", it.nome + " saiu do dia.","ok");
        carregarDia();
      };
      row.append(inp, un, botaoQuem(it), tirar, recadoPara(it));
      if(PROD_QUEM_ABERTO === it.id) row.appendChild(pickerQuem(quemDe(it), arr => gravarQuemItem(it, arr), "quemItem" + it.id));
    } else {
      const qt = document.createElement("span"); qt.className = "qt";
      qt.textContent = emLotes ? loteTx(lotesDe(it), it.unidade_producao) : qtdBonita(it.qtd, it.unidade);
      row.appendChild(qt);
      /* marcar feito numa receita é dizer quanto fez: o botão abre a receita já no "Quanto você fez?" */
      if(!it.feito && PROD_DIA === diaMais(0)){
        const fz = document.createElement("button"); fz.type = "button"; fz.className = "prod-fiz";
        fz.textContent = "✓ Marcar feito"; fz.setAttribute("aria-label", "Marcar feito: " + it.nome);
        fz.onclick = travar(fz, () => irParaQuantoFiz(it));
        row.appendChild(fz);
      }
      if(it.obs){
        const r = document.createElement("p"); r.className = "recado";
        r.textContent = "Recado: " + it.obs;
        row.appendChild(r);
      }
    }
    const ret = blocoRetorno(it, "producao", it.nome);
    if(ret) row.appendChild(ret);
    box.appendChild(row);
  });
  box.appendChild(blocoTarefasEquipe());
  /* o seletor de receita do gestor fica logo depois da produção */
  const add = $("addProd"); const sec = box.querySelector(".tarefas-eq");
  if(add && sec && gestor) box.insertBefore(add, sec);
}

/* ---------- outras tarefas: o que não é receita ----------
   Mesmo "para quem" do plano. Quem recebeu marca feito; o gestor cria, muda para quem e tira. */
function blocoTarefasEquipe(){
  const gestor = EU.papel === "gestor";
  const w = document.createElement("div"); w.className = "tarefas-eq"; w.id = "tarefasEq";
  if(!gestor && !PROD_TAREFAS.length) return w;
  const h = document.createElement("h3"); h.className = "prod-sec"; h.textContent = "Outras tarefas"; w.appendChild(h);
  if(!PROD_TAREFAS.length){
    const p = document.createElement("p"); p.className = "tip";
    p.textContent = "Dobrar pano, limpar a geladeira, organizar o estoque: escreva abaixo e escolha para quem.";
    w.appendChild(p);
  }
  PROD_TAREFAS.forEach(t => {
    const row = document.createElement("div"); row.className = "tarefa-eq" + (t.feito ? " feito" : ""); row.dataset.tarefa = t.id;
    const ck = document.createElement("button"); ck.type = "button"; ck.className = "tf-ck";
    ck.setAttribute("aria-pressed", String(!!t.feito));
    ck.setAttribute("aria-label", (t.feito ? "Desfazer: " : "Feito: ") + t.texto);
    ck.textContent = t.feito ? "✓" : "";
    ck.onclick = travar(ck, () => marcarTarefaEquipe(t, !t.feito));
    const tx = document.createElement("div"); tx.className = "tf-tx";
    const b = document.createElement("b"); b.textContent = t.texto;
    const sm = document.createElement("small");
    const quem = t.quem && t.quem.length ? t.quem : ["todos"];
    sm.textContent = t.feito ? "Feito" + (t.feito_em ? " às " + horaDe(t.feito_em) : "") + (t.feito_por ? " por " + t.feito_por : "")
                   : (gestor ? "" : (quem.filter(q => q !== "todos").length > 1 ? "junto com " + nomeQuem(quem) : ""));
    tx.append(b, sm);
    row.append(ck, tx);
    if(gestor){
      const pq = document.createElement("button"); pq.type = "button"; pq.className = "para-quem";
      pq.setAttribute("aria-label", "Para quem é " + t.texto);
      pq.textContent = "Para: " + nomeQuem(quem) + (TAREFA_QUEM_ABERTO === t.id ? "  ▴" : "  ▾");
      pq.onclick = () => { TAREFA_QUEM_ABERTO = TAREFA_QUEM_ABERTO === t.id ? null : t.id; montarProdLista(); };
      const tirar = document.createElement("button"); tirar.type = "button"; tirar.className = "tirar"; tirar.textContent = "tirar";
      tirar.setAttribute("aria-label", "Tirar a tarefa " + t.texto);
      tirar.onclick = travar(tirar, async () => {
        const { error } = await sb.from("jb_tarefa_equipe").delete().eq("id", t.id);
        if(error){ aviso("prodMsg", "Não consegui tirar essa tarefa.", "err"); return; }
        await carregarDia();
      });
      row.append(pq, tirar);
      if(TAREFA_QUEM_ABERTO === t.id) row.appendChild(pickerQuem(quem, async arr => {
        const { error } = await sb.from("jb_tarefa_equipe").update({ quem: arr }).eq("id", t.id);
        if(error){ aviso("prodMsg", "Não consegui mudar para quem é essa tarefa.", "err"); return; }
        t.quem = arr; pq.textContent = "Para: " + nomeQuem(arr) + "  ▴";
        aviso("prodMsg", "\"" + t.texto + "\" agora aparece para " + nomeQuem(arr) + ".", "ok");
      }, "quemTarefa" + t.id));
    }
    const ret = blocoRetorno(t, "tarefa", t.texto);
    if(ret) row.appendChild(ret);
    w.appendChild(row);
  });
  if(gestor){
    const f = document.createElement("form"); f.className = "tf-nova"; f.id = "tfNova";
    const inp = document.createElement("input"); inp.type = "text"; inp.maxLength = 160; inp.id = "tfTexto"; inp.className = "rec";
    inp.placeholder = "Nova tarefa (ex.: dobrar os panos)"; inp.setAttribute("aria-label", "Nova tarefa para a equipe");
    const ok = document.createElement("button"); ok.type = "submit"; ok.id = "tfAdd"; ok.textContent = "Adicionar";
    f.append(inp, ok);
    f.onsubmit = travarForm(ok, () => addTarefaEquipe(inp.value));
    w.appendChild(f);
    const sug = document.createElement("div"); sug.className = "chips tf-sug";
    TAREFAS_SUGERIDAS.filter(x => !PROD_TAREFAS.some(t => t.texto.toLowerCase() === x.toLowerCase())).slice(0, 4).forEach(x => {
      const c = document.createElement("button"); c.type = "button"; c.textContent = "+ " + x;
      c.onclick = travar(c, () => addTarefaEquipe(x));
      sug.appendChild(c);
    });
    w.appendChild(sug);
    const n = document.createElement("p"); n.className = "tip"; n.style.margin = "6px 2px 0";
    n.textContent = "A tarefa nasce para todos; toque em \"Para\" para escolher a pessoa. Quem recebe marca quando fizer.";
    w.appendChild(n);
  }
  return w;
}

async function addTarefaEquipe(texto){
  const tx = limpaNome(texto).slice(0, 160);
  if(!tx){ aviso("prodMsg", "Escreva a tarefa.", "warn"); return; }
  const { error } = await sb.from("jb_tarefa_equipe").insert({ data: PROD_DIA, texto: tx, quem: ["todos"] });
  if(error){ aviso("prodMsg", "Não consegui adicionar a tarefa agora.", "err"); return; }
  aviso("prodMsg", "Tarefa adicionada. Toque em \"Para\" para escolher quem faz.", "ok");
  await carregarDia();
}

async function marcarTarefaEquipe(t, feito){
  const { error } = await sb.rpc("jb_tarefa_marcar", { p_id: t.id, p_feito: feito });
  if(error){
    aviso("prodMsg", error.code === "conferencia" ? "Conferência: aqui nada é salvo." : error.code === "42501" ? "Essa tarefa não é sua hoje." : "Não consegui salvar agora. Tente de novo.", "err");
    return;
  }
  await carregarDia();
}

/* ---------- retorno de quem recebeu: "não deu" (com o motivo) e adendo ----------
   Vale para as receitas do plano e para as outras tarefas. Quem recebeu escreve; a Jessica lê
   na mesma linha. Não mexe em feito: custo, estoque e Quanto fazer seguem iguais. */
const RET_MAX = 200;
function retornoTx(x){
  if(!x || (!x.nao_deu && !x.nota)) return "";
  const quem = x.nota_por ? " (" + x.nota_por + (x.nota_em ? ", " + horaDe(x.nota_em) : "") + ")" : "";
  if(x.nao_deu) return "Não deu" + (x.nota ? ": " + x.nota : "") + quem;
  return "Adendo: " + x.nota + quem;
}
function blocoRetorno(x, tipo, nome){
  const gestor = EU.papel === "gestor";
  const tx = retornoTx(x);
  const podeEscrever = !gestor && PROD_DIA === diaMais(0);
  if(!tx && !podeEscrever) return null;
  const k = tipo + x.id;
  const w = document.createElement("div"); w.className = "retorno"; w.dataset.ret = k;
  if(tx){
    const p = document.createElement("p"); p.className = "ret-tx" + (x.nao_deu ? " nao" : "");
    p.textContent = tx; w.appendChild(p);
  }
  if(!podeEscrever) return w;
  const modo = RET_ABERTO && RET_ABERTO.k === k ? RET_ABERTO.modo : null;
  const abrir = m => () => { RET_ABERTO = { k, modo: m }; montarProdLista(); const ta = document.querySelector("[data-ret='" + k + "'] textarea"); if(ta) ta.focus(); };
  if(!modo){
    const bts = document.createElement("div"); bts.className = "ret-bts";
    const bt = (rot, cls, aria, acao) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "ret-b " + cls; b.textContent = rot;
      b.setAttribute("aria-label", aria + ": " + nome); b.onclick = travar(b, acao); bts.appendChild(b);
    };
    if(x.nao_deu){
      bt("Mudar o motivo", "nao", "Mudar o motivo", abrir("nao"));
      bt("Desfazer o não deu", "tirar-ret", "Desfazer o não deu", () => salvarRetorno(tipo, x, false, null));
    } else {
      if(!x.feito) bt("Não deu", "nao", "Não deu", abrir("nao"));
      bt(x.nota ? "Mudar o adendo" : "+ Adendo", "nota", x.nota ? "Mudar o adendo" : "Escrever um adendo", abrir("nota"));
    }
    w.appendChild(bts);
    return w;
  }
  const f = document.createElement("form"); f.className = "ret-form";
  const ta = document.createElement("textarea"); ta.className = "rec"; ta.rows = 2; ta.maxLength = RET_MAX;
  ta.placeholder = modo === "nao" ? "O que aconteceu? Ex.: faltou leite condensado" : "Bilhete para a Jessica. Ex.: fiz 3, a quarta fica para amanhã";
  ta.setAttribute("aria-label", (modo === "nao" ? "Por que não deu: " : "Adendo: ") + nome);
  ta.value = x.nota || "";
  const ok = document.createElement("button"); ok.type = "submit"; ok.className = "ret-ok"; ok.textContent = modo === "nao" ? "Avisar que não deu" : "Salvar adendo";
  const cancelar = document.createElement("button"); cancelar.type = "button"; cancelar.className = "ret-b tirar-ret"; cancelar.textContent = "Cancelar";
  cancelar.onclick = () => { RET_ABERTO = null; montarProdLista(); };
  f.append(ta, ok, cancelar);
  if(modo === "nota" && x.nota){
    const apagar = document.createElement("button"); apagar.type = "button"; apagar.className = "ret-b tirar-ret"; apagar.textContent = "Apagar o adendo";
    apagar.onclick = travar(apagar, () => salvarRetorno(tipo, x, false, null));
    f.appendChild(apagar);
  }
  f.onsubmit = travarForm(ok, async () => {
    const v = ta.value.trim().slice(0, RET_MAX);
    if(!v){ aviso("prodMsg", modo === "nao" ? "Escreva o motivo, mesmo curtinho." : "Escreva o adendo.", "warn"); return; }
    await salvarRetorno(tipo, x, modo === "nao", v);
  });
  w.appendChild(f);
  return w;
}
async function salvarRetorno(tipo, x, naoDeu, nota){
  const { error } = await sb.rpc("jb_tarefa_retorno", { p_tipo: tipo, p_id: x.id, p_nao_deu: !!naoDeu, p_nota: nota || null });
  if(error){
    aviso("prodMsg", error.code === "conferencia" ? "Conferência: aqui nada é salvo." : error.code === "42501" ? "Essa tarefa não é sua hoje." : "Não consegui salvar agora. Tente de novo.", "err");
    return;
  }
  RET_ABERTO = null;
  await carregarDia();
  aviso("prodMsg", naoDeu ? "Pronto, a Jessica vai ver que não deu." : nota ? "Adendo salvo. A Jessica vê na lista." : "Pronto, tirei.", "ok");
}
/* "Marcar feito" numa receita: abre a receita e leva direto para o "Quanto você fez?" */
async function irParaQuantoFiz(it){
  await abrirReceita(it);
  const bx = $("recFezBox");
  if(bx && bx.scrollIntoView) bx.scrollIntoView({ block: "center" });
  const inp = $("recFez"); if(inp) inp.focus();
}

/* Recado curto do gestor para quem vai fazer: o ponto do brigadeiro, um detalhe do dia.
   Panela ganha dois atalhos porque a mesma receita sai mais firme (menos creme de leite)
   ou mais cremosa, conforme o uso. O custo segue pela receita cadastrada. */
const RECADO_MAX = 80;
const RECADOS_PANELA = ["mais firme", "mais cremoso"];
function recadoPara(it){
  const box = document.createElement("div"); box.className = "recado-ed";
  const inp = document.createElement("input");
  inp.type = "text"; inp.className = "rec"; inp.maxLength = RECADO_MAX;
  inp.placeholder = "Recado para quem vai fazer (opcional)";
  inp.setAttribute("aria-label", "Recado para quem vai fazer " + it.nome);
  inp.value = it.obs || "";
  const salvar = async () => {
    const v = inp.value.trim().slice(0, RECADO_MAX) || null;
    if(v === (it.obs || null)){ inp.value = v || ""; return; }
    const { error } = await sb.from("jb_producao_item").update({ obs: v }).eq("id", it.id);
    if(error){ inp.value = it.obs || ""; aviso("prodMsg","Não consegui salvar o recado.","err"); return; }
    it.obs = v; inp.value = v || "";
    marcar();
    aviso("prodMsg", v ? it.nome + ": recado salvo." : it.nome + ": recado apagado.", "ok");
  };
  inp.onblur = salvar;
  inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); });
  box.appendChild(inp);
  const chips = [];
  const marcar = () => chips.forEach(c => c.setAttribute("aria-pressed", String((it.obs || "") === c.textContent)));
  if(it.unidade_producao === "panela"){
    RECADOS_PANELA.forEach(tx => {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip-rec"; c.textContent = tx;
      c.onclick = () => { inp.value = (it.obs === tx) ? "" : tx; salvar(); };
      chips.push(c); box.appendChild(c);
    });
    marcar();
  }
  return box;
}

/* Para quem é este item. Massa e recheio nasce para a produção; produto pronto,
   para todo mundo. O gestor troca quando quiser.
   Destinos: "todos" (equipe, produção e freelas), "producao" (Eliana), "equipe" (Yasmin),
   "fr:*" (só as freelas do dia) e "fr:Nome" (só a freela liberada com esse nome).
   No banco: para + para_freela. Item com para_freela some para a Eliana e a Yasmin. */
/* As freelas da casa (jb_freela_pessoa, só gestor): é a lista do seletor e das sugestões
   na hora de liberar o acesso. Sem lista cadastrada, usa os nomes das liberações e diárias. */
let FREELAS_FIXAS = null;
const limpaNome = n => String(n || "").trim().replace(/\s+/g, " ");
async function carregarFreelasFixas(forcar){
  if(FREELAS_FIXAS && !forcar) return FREELAS_FIXAS;
  const r = await sb.from("jb_freela_pessoa").select("nome,ativo").eq("ativo", true).order("nome");
  FREELAS_FIXAS = (r && !r.error && r.data ? r.data : []).map(x => limpaNome(x.nome)).filter(Boolean);
  return FREELAS_FIXAS;
}
/* guarda um nome novo na lista (veio de "Outra freela...") */
async function guardarFreelaFixa(nome){
  const n = limpaNome(nome);
  if(!n || (FREELAS_FIXAS || []).some(x => x.toLowerCase() === n.toLowerCase())) return;
  const r = await sb.from("jb_freela_pessoa").insert({ nome: n });
  if(!r || !r.error){ FREELAS_FIXAS = [...(FREELAS_FIXAS || []), n].sort((x, y) => x.localeCompare(y, "pt-BR")); }
}

async function carregarPessoas(forcar){
  if(PESSOAS && !forcar) return PESSOAS;
  const [us, fixas] = await Promise.all([
    sb.from("jb_usuario").select("nome,papel,ativo"),
    carregarFreelasFixas(forcar)
  ]);
  const P = { producao: "Produção", equipe: "Noite", freelas: [] };
  (us.data || []).filter(u => u.ativo).forEach(u => {
    if(u.papel === "producao" || u.papel === "equipe") P[u.papel] = u.nome;
  });
  if(fixas.length){
    P.freelas = fixas.slice();
  } else {
    const [ac, fr] = await Promise.all([
      sb.from("jb_freela_acesso").select("nome,criado_em").order("criado_em", { ascending: false }).limit(60),
      sb.from("jb_freela").select("nome,data").gte("data", diaMais(-120)).order("data", { ascending: false }).limit(60)
    ]);
    const vistos = new Set();
    [...(ac.data || []), ...(fr.data || [])].forEach(x => {
      const n = limpaNome(x.nome);
      if(n && n.length <= 40 && !vistos.has(n.toLowerCase())){ vistos.add(n.toLowerCase()); P.freelas.push(n); }
    });
  }
  P.freelas.sort((x, y) => x.localeCompare(y, "pt-BR"));
  PESSOAS = P;
  return PESSOAS;
}

/* ---------- para quem: uma ou mais pessoas por item ----------
   quem: ["todos"], ["producao"], ["equipe"], ["freelas"] (as freelas do dia) e "fr:Nome", combináveis.
   Itens antigos sem quem seguem o para/para_freela. */
let PROD_QUEM_ABERTO = null;   // item do plano com o seletor de pessoas aberto
function quemDe(it){
  if(it.quem && it.quem.length) return it.quem.slice();
  if(it.para_freela === "*") return ["freelas"];
  if(it.para_freela) return ["fr:" + it.para_freela];
  return [it.para || "todos"];
}
function nomeQuemUm(q){
  const P = PESSOAS || { producao: "Produção", equipe: "Noite" };
  if(q === "todos") return "todo mundo";
  if(q === "producao") return P.producao;
  if(q === "equipe") return P.equipe;
  if(q === "freelas") return "as freelas do dia";
  if(q && q.startsWith("fr:")) return q.slice(3);
  return q;
}
function nomeQuem(arr){
  const n = (arr || []).map(nomeQuemUm);
  return n.length <= 1 ? (n[0] || "") : n.slice(0, -1).join(", ") + " e " + n[n.length - 1];
}
/* grava quem e, quando é uma pessoa ou grupo só, também o para antigo (celular com versão velha) */
function gravarQuem(arr){
  const um = arr.length === 1 ? arr[0] : null;
  return { quem: arr,
           para: um && ["todos", "producao", "equipe"].includes(um) ? um : "todos",
           para_freela: um === "freelas" ? "*" : (um && um.startsWith("fr:") ? um.slice(3) : null) };
}
function botaoQuem(it){
  const b = document.createElement("button");
  b.type = "button"; b.className = "para-quem";
  b.setAttribute("aria-label", "Para quem é " + it.nome);
  b.setAttribute("aria-expanded", String(PROD_QUEM_ABERTO === it.id));
  b.textContent = "Para: " + nomeQuem(quemDe(it)) + (PROD_QUEM_ABERTO === it.id ? "  ▴" : "  ▾");
  b.onclick = () => { PROD_QUEM_ABERTO = PROD_QUEM_ABERTO === it.id ? null : it.id; montarProdLista(); };
  return b;
}
async function gravarQuemItem(it, arr){
  const g = gravarQuem(arr);
  const { error } = await sb.from("jb_producao_item").update(g).eq("id", it.id);
  if(error){ aviso("prodMsg","Não consegui mudar para quem é esse item.","err"); return false; }
  Object.assign(it, g);
  const b = [...document.querySelectorAll("#prodLista .para-quem")].find(x => x.getAttribute("aria-label") === "Para quem é " + it.nome);
  if(b) b.textContent = "Para: " + nomeQuem(arr) + "  ▴";
  aviso("prodMsg", it.nome + " agora aparece para " + nomeQuem(arr) + ".", "ok");
  return true;
}

/* Escolher pessoas: toque para marcar ou desmarcar. "Todos" vale sozinho.
   "+ Pessoa nova" abre um campo; o nome entra na lista de freelas da casa. */
function pickerQuem(atual, aoMudar, id){
  const box = document.createElement("div"); box.className = "quem-picker"; if(id) box.id = id;
  let sel = new Set(atual || []);
  const P = PESSOAS || { producao: "Produção", equipe: "Noite", freelas: [] };
  const desenhar = () => {
    box.innerHTML = "";
    const ops = [["todos", "Todos"], ["producao", P.producao], ["equipe", P.equipe], ["freelas", "Freelas do dia"]];
    const nomes = (P.freelas || []).slice();
    [...sel].filter(q => q.startsWith("fr:")).forEach(q => { if(!nomes.some(n => n.toLowerCase() === q.slice(3).toLowerCase())) nomes.push(q.slice(3)); });
    nomes.forEach(n => ops.push(["fr:" + n, n]));
    ops.forEach(([v, rot]) => {
      const c = document.createElement("button"); c.type = "button"; c.className = "quem-chip"; c.dataset.q = v;
      const on = [...sel].some(x => x.toLowerCase() === v.toLowerCase());
      c.setAttribute("aria-pressed", String(on));
      c.textContent = rot;
      c.onclick = () => {
        const antes = new Set(sel);
        if(v === "todos") sel = new Set(["todos"]);
        else {
          sel.delete("todos");
          const ja = [...sel].find(x => x.toLowerCase() === v.toLowerCase());
          if(ja) sel.delete(ja); else sel.add(v);
        }
        if(!sel.size){ sel = antes; aviso(id && id.startsWith("quemItem") ? "prodMsg" : "qfMsg", "Escolha pelo menos uma pessoa.", "warn"); return; }
        desenhar();
        aoMudar([...sel]);
      };
      box.appendChild(c);
    });
    const nova = document.createElement("button"); nova.type = "button"; nova.className = "quem-chip nova"; nova.textContent = "+ Pessoa nova";
    nova.onclick = () => {
      nova.remove();
      const inp = document.createElement("input"); inp.type = "text"; inp.maxLength = 40; inp.className = "rec nomefreela";
      inp.placeholder = "Nome e sobrenome"; inp.setAttribute("aria-label", "Nome da pessoa nova");
      box.appendChild(inp); inp.focus();
      let feito = false;
      const fim = async () => {
        if(feito) return; feito = true;
        const n = limpaNome(inp.value).slice(0, 40);
        if(!n){ desenhar(); return; }
        await guardarFreelaFixa(n);
        if(PESSOAS && !PESSOAS.freelas.some(x => x.toLowerCase() === n.toLowerCase())){ PESSOAS.freelas.push(n); PESSOAS.freelas.sort((x, y) => x.localeCompare(y, "pt-BR")); }
        sel.delete("todos"); sel.add("fr:" + n);
        desenhar();
        aoMudar([...sel]);
      };
      inp.addEventListener("keydown", e => { if(e.key === "Enter") inp.blur(); if(e.key === "Escape"){ inp.value = ""; inp.blur(); } });
      inp.addEventListener("blur", fim);
    };
    box.appendChild(nova);
  };
  desenhar();
  return box;
}

/* ---------- quanto já foi feito ---------- */
function meuNome(){ return EU ? (EU.papel === "freela" ? EU.apelido : EU.nome) : ""; }
function qtdItemTx(it, q){
  if(it.tipo === "subreceita" && Number(it.rendimento) > 0) return loteTx(Number(q) / Number(it.rendimento), it.unidade_producao);
  return qtdBonita(q, it.unidade || "un");
}
function feitosTx(it){
  const fs = it.feitos || [];
  return fs.map(f => f.nome + " " + qtdItemTx(it, f.qtd)).join(", ");
}
/* quem mais está neste item além de quem está usando o app */
function outrosNoItem(it){
  const eu = EU.papel === "freela" ? ("fr:" + meuNome()).toLowerCase() : EU.papel;
  return quemDe(it).filter(x => x !== "todos" && x.toLowerCase() !== eu);
}
function textoItemPlano(it, gestor, travado){
  const partes = [];
  const total = it.feito_qtd == null ? null : Number(it.feito_qtd);
  if(total !== null){
    const dif = Math.round((total - Number(it.qtd)) * 1000) / 1000;
    let t = (it.feito ? "Feito: " : "Até agora: ") + qtdItemTx(it, total) + " de " + qtdItemTx(it, it.qtd);
    if(it.feito && dif > 0) t += " (" + qtdItemTx(it, dif) + " a mais)";
    if(it.feito && dif < 0) t += " (" + qtdItemTx(it, -dif) + " a menos)";
    partes.push(t);
    if(feitosTx(it)) partes.push(feitosTx(it));
  } else if(it.feito){
    partes.push("Feito às " + horaDe(it.feito_em) + (it.feito_por ? " por " + it.feito_por : ""));
  } else if(travado){
    partes.push(gestor ? "passo a passo ainda não conferido por você" : "passo a passo ainda não conferido pela Jessica");
  } else {
    partes.push(it.tipo === "subreceita"
      ? (lotesDe(it) !== null ? "cerca de " + qtdBonita(it.qtd, "kg") + " no total" : "massa ou recheio")
      : "produto pronto");
  }
  if(!gestor){
    const outros = outrosNoItem(it);
    if(outros.length) partes.push("junto com " + nomeQuem(outros));
  }
  return partes.filter(Boolean).join(" · ");
}

async function addReceitaAoDia(valor){
  if(!valor) return;
  const [tipo, id] = valor.split(":");
  /* massa e recheio entram como uma receita inteira (uma massa, uma panela), não como 1 kg */
  const sub = tipo === "subreceita" ? ((RECEITAS && RECEITAS.subs) || []).find(x => String(x.subreceita_id) === id) : null;
  const qtd = sub && Number(sub.rendimento_kg) > 0 ? Number(sub.rendimento_kg) : 1;
  const { error } = await sb.from("jb_producao_item")
    .insert({ data: PROD_DIA, tipo, ref_id: Number(id), qtd, para: PARA_PADRAO(tipo) });
  $("addProd").value = "";
  if(error){
    aviso("prodMsg", String(error.message || "").includes("duplicate")
      ? "Essa receita já está na lista deste dia."
      : "Não consegui adicionar agora.", "warn");
    return;
  }
  await carregarDia();
}

/* ---------- a receita já multiplicada ---------- */
async function abrirReceita(item, escala, voltaPara){
  aviso("recMsg","","");
  const gestor = EU.papel === "gestor";
  let cab, itens, qtdAlvo, rendimento, unidade, tipo, refId;

  if(item.tipo){    // veio do plano do dia
    tipo = item.tipo; refId = item.ref_id; qtdAlvo = Number(item.qtd);
  } else {          // veio de um link de sub-receita dentro de outra receita
    tipo = "subreceita"; refId = item.subreceita_id; qtdAlvo = escala;
  }

  if(tipo === "ficha"){
    const [f, its] = await Promise.all([
      sb.from("jb_receita_ficha").select("*").eq("ficha_id", refId).maybeSingle(),
      sb.from("jb_receita_ficha_item").select("*").eq("ficha_id", refId).order("ordem")
    ]);
    if(!f.data){ aviso("prodMsg","Não consegui abrir essa receita.","err"); return; }
    cab = f.data; itens = its.data || [];
    rendimento = Number(cab.rendimento_un) || 1; unidade = "un";
  } else {
    const [s, its] = await Promise.all([
      sb.from("jb_receita_sub").select("*").eq("subreceita_id", refId).maybeSingle(),
      sb.from("jb_receita_sub_item").select("*").eq("subreceita_id", refId).order("ordem")
    ]);
    if(!s.data){ aviso("prodMsg","Não consegui abrir essa receita.","err"); return; }
    cab = s.data; itens = its.data || [];
    rendimento = Number(cab.rendimento_kg) || 1; unidade = "kg";
  }

  /* Receita não conferida abre mesmo assim, com a faixa de aviso: bloquear a Eliana
     em 100% das receitas era pior do que avisar. */
  /* só fala em massas e panelas quando veio do plano do dia; aberta de dentro de outra
     receita, a quantidade é o que aquela receita pede, em kg */
  const emLotes = !!item.tipo && tipo === "subreceita" && rendimento > 0;
  REC = { item: item.id ? item : null, tipo, refId, cab, itens, rendimento, unidade, qtdAlvo, emLotes,
          origemItem: item, voltaPara: voltaPara || null };
  montarReceita();
  show("scReceita");
}

function montarReceita(){
  const { cab, itens, rendimento, unidade, qtdAlvo, emLotes } = REC;
  const fator = qtdAlvo / rendimento;
  const un = cab.unidade_producao || "receita";

  $("recSub").textContent = (emLotes
      ? "uma " + un + " rende " + qtdBonita(rendimento, unidade)
      : "a receita original rende " + qtdBonita(rendimento, unidade))
    + (fator !== 1 ? ", as quantidades abaixo já estão ajustadas" : "");

  const box = $("recCorpo");
  box.innerHTML = "";

  const foto = imgFoto(cab.foto_url, "g");
  if(foto) box.appendChild(foto);

  const alvo = document.createElement("div");
  alvo.className = "rendebox";
  const k = document.createElement("span"); k.className = "k"; k.textContent = "Fazer hoje";
  const v = document.createElement("span"); v.className = "v";
  v.textContent = emLotes ? loteTx(fator, un) : qtdBonita(qtdAlvo, unidade);
  alvo.append(k, v);
  if(emLotes){
    const ap = document.createElement("span"); ap.className = "aprox";
    ap.textContent = "cerca de " + qtdBonita(qtdAlvo, unidade) + " no total";
    alvo.appendChild(ap);
  }
  box.appendChild(alvo);

  if(REC.item && REC.item.obs){
    const r = document.createElement("p"); r.className = "recado";
    r.textContent = "Recado: " + REC.item.obs;
    box.appendChild(r);
  }

  const bIng = document.createElement("div"); bIng.className = "recbloco";
  const h1 = document.createElement("h3"); h1.textContent = "Separe";
  bIng.appendChild(h1);
  itens.forEach(it => {
    const l = document.createElement("div"); l.className = "recing";
    if(it.e_subreceita){
      const b = document.createElement("button");
      b.type = "button"; b.textContent = it.ingrediente;
      b.onclick = () => abrirReceita({ subreceita_id: it.subreceita_id },
                                     Number(it.qtd) * fator * (String(it.unidade).toLowerCase() === "g" ? 0.001 : 1),
                                     { origemItem: REC.origemItem, qtdAlvo: REC.qtdAlvo, voltaPara: REC.voltaPara });
      l.appendChild(b);
    } else {
      const n = document.createElement("span"); n.textContent = it.ingrediente;
      l.appendChild(n);
    }
    const q = document.createElement("span"); q.className = "q";
    q.textContent = it.qtd === null ? "sem quantidade" : qtdBonita(Number(it.qtd) * fator, it.unidade);
    l.appendChild(q);
    bIng.appendChild(l);
  });
  box.appendChild(bIng);

  const bPas = document.createElement("div"); bPas.className = "recbloco";
  const h2 = document.createElement("h3"); h2.textContent = "Passo a passo";
  bPas.appendChild(h2);
  const passos = (cab.modo_preparo || "").split("\n").map(s => s.trim()).filter(Boolean);
  if(!passos.length){
    const p = document.createElement("p"); p.className = "tip"; p.style.margin = "0";
    p.textContent = "Esta receita ainda não tem passo a passo escrito.";
    bPas.appendChild(p);
  } else {
    passos.forEach((t, i) => {
      const l = document.createElement("div"); l.className = "passo";
      const n = document.createElement("span"); n.className = "n"; n.textContent = String(i+1);
      const s = document.createElement("span"); s.textContent = t.replace(/^\d+[).\-\s]+/,"");
      l.append(n, s);
      bPas.appendChild(l);
    });
  }
  box.appendChild(bPas);

  if(!cab.preparo_conferido){
    const av = document.createElement("div");
    av.className = "msg warn"; av.style.margin = "0 0 14px";
    av.textContent = EU.papel === "gestor"
      ? "Passo a passo ainda não conferido. Abra a ficha em Custos e marque Conferi quando revisar."
      : "Passo a passo ainda não conferido pela Jessica. Os ingredientes e quantidades valem; se algo parecer estranho no preparo, confirme com ela.";
    box.appendChild(av);
  }

  /* Quanto você fez: cada pessoa registra o que fez (pode ser mais ou menos que o pedido).
     Registrar de novo corrige o número dela. Massa e recheio em massas/panelas; doce em unidades. */
  const btn = $("btnRecFeito");
  btn.classList.toggle("hide", !REC.item);
  btn.disabled = false;
  btn.classList.remove("desfazer");
  if(REC.item){
    const it = REC.item;
    const emLotesIt = it.tipo === "subreceita" && Number(it.rendimento) > 0;
    const paraTela = q => emLotesIt ? Math.round(Number(q) / Number(it.rendimento) * 100) / 100 : Number(q);
    const meu = (it.feitos || []).find(f => String(f.nome).trim().toLowerCase() === String(meuNome()).trim().toLowerCase());
    const total = Number(it.feito_qtd || 0);
    const sugestao = meu ? Number(meu.qtd) : Math.max(Number(it.qtd) - total, 0) || Number(it.qtd);

    const bx = document.createElement("div"); bx.className = "recbloco rec-fez"; bx.id = "recFezBox";
    const h = document.createElement("h3"); h.textContent = meu ? "Você registrou" : "Quanto você fez?";
    bx.appendChild(h);
    const pr = document.createElement("p"); pr.className = "rec-progresso"; pr.id = "recProgresso";
    pr.textContent = "Pedido: " + qtdItemTx(it, it.qtd)
      + (it.feito_qtd != null ? " · feito até agora: " + qtdItemTx(it, total) + (feitosTx(it) ? " (" + feitosTx(it) + ")" : "") : "")
      + (EU.papel === "gestor"
          ? (quemDe(it).length > 1 ? " · para " + nomeQuem(quemDe(it)) : "")
          : (outrosNoItem(it).length ? " · junto com " + nomeQuem(outrosNoItem(it)) : ""));
    bx.appendChild(pr);
    const linha = document.createElement("label"); linha.className = "rec-fez-linha";
    const inp = document.createElement("input"); inp.type = "tel"; inp.inputMode = "decimal"; inp.id = "recFez"; inp.className = "q";
    inp.value = String(paraTela(sugestao)).replace(".", ",");
    inp.setAttribute("aria-label", "Quanto você fez de " + cab.nome);
    const un = document.createElement("span"); un.className = "un";
    un.textContent = emLotesIt ? nomeLote(2, it.unidade_producao) : "unidades";
    linha.append(inp, un);
    bx.appendChild(linha);
    const dica = document.createElement("p"); dica.className = "tip"; dica.style.margin = "6px 0 0";
    dica.textContent = "Fez mais ou menos que o pedido? Coloque o número de verdade. Se errar, é só registrar de novo.";
    bx.appendChild(dica);
    if(EU.papel === "gestor"){
      const mk = document.createElement("button"); mk.type = "button"; mk.className = "qf-link"; mk.id = "recMarcar";
      mk.textContent = it.feito ? "Reabrir este item" : "Marcar como feito sem número";
      mk.onclick = travar(mk, marcarFeitoSemNumero);
      bx.appendChild(mk);
    }
    box.appendChild(bx);
    btn.textContent = meu ? "Corrigir o que fiz" : "Registrar o que fiz";
  }
}

async function marcarFeito(){
  if(!REC || !REC.item) return;
  const it = REC.item;
  const btn = $("btnRecFeito");
  const v = numBR(($("recFez") || {}).value);
  if(v === null || v < 0 || v > 100000){ aviso("recMsg","Coloque quanto você fez (pode ser 0).","warn"); return; }
  const emLotesIt = it.tipo === "subreceita" && Number(it.rendimento) > 0;
  const qtd = emLotesIt ? Math.round(v * Number(it.rendimento) * 1000) / 1000 : v;
  const rotulo = btn.textContent;
  btn.disabled = true; btn.textContent = "Salvando...";
  const { data, error } = await sb.rpc("jb_producao_registrar", { p_id: it.id, p_qtd: qtd });
  if(error){
    aviso("recMsg", error.code === "42501" ? "Esse item não é seu hoje. Fale com a Jessica." : "Não consegui salvar agora. Tente de novo.","err");
    btn.disabled = false; btn.textContent = rotulo;
    return;
  }
  await carregarDia();
  const r = data || {};
  const falta = Number(r.pedido) - Number(r.total);
  aviso("prodMsg", REC.cab.nome + ": registrei " + qtdItemTx(it, qtd) + "."
    + (r.feito ? (falta > 0 ? " Item fechado com " + qtdItemTx(it, falta) + " a menos que o pedido." : falta < 0 ? " Item fechado com " + qtdItemTx(it, -falta) + " a mais." : " Item completo.")
               : " Ainda faltam " + qtdItemTx(it, Math.max(falta, 0)) + " para o pedido."), "ok");
  show("scProd");
}

/* gestor: fechar ou reabrir sem número (o jeito antigo) */
async function marcarFeitoSemNumero(){
  if(!REC || !REC.item) return;
  const reabrir = !!REC.item.feito;
  const { error } = await sb.rpc("jb_marcar_producao", { p_id: REC.item.id, p_feito: !reabrir });
  if(error){ aviso("recMsg","Não consegui salvar agora. Tente de novo.","err"); return; }
  await carregarDia();
  aviso("prodMsg", REC.cab.nome + (reabrir ? " voltou para a lista." : " marcado como feito."),"ok");
  show("scProd");
}

function horaDe(ts){
  return new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}
