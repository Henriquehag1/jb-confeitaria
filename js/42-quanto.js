/* JB OS · Quanto fazer: a conta da produção da semana. Só os donos (o banco recusa os outros).

   A conta mora no banco (jb_quanto_fazer):
     venda média por dia nos últimos 28 dias fechados
     x dias que a produção precisa cobrir (ou a validade, se for menor)
     x (1 + folga + um extra quando o doce acabou na geladeira)
     menos o que já tem na expositora e no freezer.
   Doce com assadeira (gelado, cenoura) arredonda para assadeira inteira.
   Doce novo, com menos de 7 dias de venda, usa a meta da semana que a Jessica digitar.
   Como ela é refeita a cada vez que abre, vendeu mais sobe, geladeira cheia desce. */

let QF = null;             // resposta do banco
let QF_ABERTO = null;      // produto com o editor de meta aberto
/* Mandar para o plano: a Jessica marca os itens, escolhe o dia e uma ou mais pessoas, e manda.
   Depois marca outros para outro dia ou outra pessoa. */
let QF_SEL = new Map();    // "ficha:4" ou "subreceita:8" -> quantidade escolhida (un ou massas/panelas)
let QF_DIA = null;         // dia do envio
let QF_QUEM = [];          // para quem vai o envio
let QF_PLANO = [];         // o que já está no plano de hoje em diante (para não pedir duas vezes)
const QF_OPC_DIAS  = [3, 4, 5, 7, 10, 14];
const QF_OPC_FOLGA = [0, 10, 15, 25];

const qfNum = n => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

function qfNomeDia(iso){
  if(iso === hojeSP()) return "Hoje";
  if(iso === diaMais(1)) return "Amanhã";
  return dataCurta(iso);
}

async function qfConta(args){
  const { data, error } = await sb.rpc("jb_quanto_fazer", args || {});
  if(error) throw error;
  return data;
}

/* subtítulo do cartão da Home: a conta resumida */
async function resumoQuantoHome(){
  const r = await qfConta();
  if(!r) return null;
  return Number(r.total_fazer) > 0
    ? "Faltam " + r.total_fazer + " doces para os próximos " + r.dias + " dias"
    : "Geladeira e freezer cobrem os próximos " + r.dias + " dias";
}

async function abrirQuanto(){
  aviso("qfMsg", "", "");
  $("qfCorpo").innerHTML = "<p class='tip'>Fazendo a conta...</p>";
  show("scQuanto");
  if(!QF_DIA || QF_DIA < hojeSP()) QF_DIA = diaMais(1);
  try { QF = await qfConta(); await Promise.all([carregarPessoas().catch(() => null), qfCarregarPlano()]); }
  catch(e){
    $("qfCorpo").innerHTML = "";
    aviso("qfMsg", e && e.code === "42501"
      ? "Essa conta é só para a Jessica e o Henrique."
      : "Não consegui fazer a conta agora. Toque em atualizar quando o sinal voltar.", "err");
    return;
  }
  montarQuanto();
}

function qfChips(rotulo, opcoes, atual, fmt, aoEscolher, id){
  const g = document.createElement("div"); g.className = "qf-op";
  const r = document.createElement("span"); r.className = "qf-rot"; r.textContent = rotulo;
  const box = document.createElement("div"); box.className = "chips"; box.id = id;
  opcoes.forEach(v => {
    const b = document.createElement("button"); b.type = "button";
    b.textContent = fmt(v);
    b.setAttribute("aria-pressed", String(String(v) === String(atual)));
    b.onclick = () => aoEscolher(v);
    box.appendChild(b);
  });
  g.append(r, box);
  return g;
}

async function qfTrocarParam(campo, valor){
  const novo = { dias: QF.dias, margem_pct: QF.margem_pct };
  novo[campo] = valor;
  /* guarda para a Jessica e o Henrique verem a mesma conta; se não gravar, a conta sai assim mesmo */
  const { error } = await sb.from("jb_quanto_param").update({ [campo]: valor, atualizado_em: new Date().toISOString() }).eq("id", 1);
  try { QF = await qfConta({ p_dias: novo.dias, p_margem_pct: novo.margem_pct }); }
  catch(e){ aviso("qfMsg", "Não consegui refazer a conta agora.", "err"); return; }
  montarQuanto();
  if(error) aviso("qfMsg", "A conta mudou só neste celular: não consegui guardar a escolha.", "warn");
}

function qfDetalhe(it){
  const p = [];
  if(it.fonte === "vendas") p.push("vende " + qfNum(it.venda_dia) + " por dia");
  else if(it.fonte === "meta") p.push("doce novo: usando sua meta de " + it.meta_semana + " por semana" + (it.dias_hist ? " (" + it.dias_hist + " dias de venda até agora)" : ""));
  else if(it.fonte === "pouco") p.push("só " + it.dias_hist + (it.dias_hist === 1 ? " dia" : " dias") + " de venda: toque e digite a meta da semana");
  else p.push("sem venda registrada: toque e digite a meta da semana");
  p.push("tem " + it.expositora + " na geladeira" + (it.freezer ? " e " + it.freezer + " no freezer" : ""));
  p.push("precisa de " + it.alvo + " para " + it.cobertura + (it.cobertura === 1 ? " dia" : " dias")
    + (it.validade_dias && it.validade_dias < QF.dias ? " (limite da validade)" : ""));
  if(Number(it.extra) > 0) p.push("acabou na geladeira em " + it.zerou + (it.zerou === 1 ? " dia" : " dias") + ", pedi um pouco mais");
  if(Number(it.rend) > 1 && it.fazer > 0){
    const n = Math.round(it.fazer / Number(it.rend));
    p.push(n + (n === 1 ? " assadeira" : " assadeiras") + " de " + qfNum(it.rend));
  }
  if(!it.ficha_id) p.push("sem ficha técnica: fica fora das massas e do plano");
  return p.join(" · ");
}

function qfEditor(it){
  const ed = document.createElement("div"); ed.className = "qf-ed"; ed.id = "qfEd" + it.produto_id;
  const l1 = document.createElement("label");
  l1.innerHTML = "<span>Meta da semana</span><small>vale enquanto o doce tiver menos de 7 dias de venda</small>";
  const meta = document.createElement("input"); meta.type = "tel"; meta.inputMode = "numeric"; meta.className = "q";
  meta.id = "qfMeta"; meta.value = it.meta_semana == null ? "" : String(it.meta_semana); meta.placeholder = "ex.: 80";
  l1.appendChild(meta);
  const l2 = document.createElement("label");
  l2.innerHTML = "<span>Validade depois de pronto</span><small>em dias; a conta não pede mais do que dá para vender nesse prazo</small>";
  const val = document.createElement("input"); val.type = "tel"; val.inputMode = "numeric"; val.className = "q";
  val.id = "qfValidade"; val.value = it.validade_dias == null ? "" : String(it.validade_dias); val.placeholder = "ex.: 4";
  l2.appendChild(val);
  const bt = document.createElement("button"); bt.type = "button"; bt.className = "qf-bt"; bt.id = "qfSalvarMeta";
  bt.textContent = "Salvar";
  bt.onclick = travar(bt, async () => {
    const lerInt = (s, max) => {
      const t = String(s || "").trim();
      if(t === "") return null;
      const n = Math.round(Number(t.replace(",", ".")));
      return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN;
    };
    const m = lerInt(meta.value, 9999), v = lerInt(val.value, 60);
    if(Number.isNaN(m) || Number.isNaN(v) || v === 0){ aviso("qfMsg", "Confira os números: meta até 9999 e validade de 1 a 60 dias.", "warn"); return; }
    const { error } = await sb.from("jb_quanto_meta").upsert(
      { produto_id: it.produto_id, meta_semana: m, validade_dias: v, atualizado_em: new Date().toISOString() },
      { onConflict: "produto_id" });
    if(error){ aviso("qfMsg", "Não consegui salvar agora.", "err"); return; }
    QF_ABERTO = null;
    try { QF = await qfConta({ p_dias: QF.dias, p_margem_pct: QF.margem_pct }); } catch(e){}
    montarQuanto();
    aviso("qfMsg", it.nome + ": guardado. A conta já foi refeita.", "ok");
  });
  ed.append(l1, l2, bt);
  return ed;
}

async function qfCarregarPlano(){
  const r = await sb.from("jb_producao_dia").select("id,data,tipo,ref_id,qtd,feito,feito_qtd,quem,para,para_freela,rendimento,unidade_producao")
    .gte("data", hojeSP());
  QF_PLANO = (r && !r.error && r.data) || [];
}

/* os itens da conta num formato só: doces e massas/recheios */
function qfLinhas(){
  const doces = ((QF && QF.itens) || []).map(it => ({
    chave: "ficha:" + it.ficha_id, tipo: "ficha", ref_id: it.ficha_id, nome: it.nome, it, sem_ficha: !it.ficha_id,
    fazer: it.fazer, emLotes: false, rendimento: 1, unidade_producao: null }));
  const bases = ((QF && QF.bases) || []).map(b => ({
    chave: "subreceita:" + b.subreceita_id, tipo: "subreceita", ref_id: b.subreceita_id, nome: b.nome, base: b,
    fazer: Number(b.lotes_fazer) || 0, emLotes: true, rendimento: Number(b.rendimento_kg) || 1, unidade_producao: b.unidade_producao }));
  return { doces, bases };
}
/* quanto desse item já está no plano e ainda não foi feito (na mesma unidade da tela) */
function qfNoPlano(l){
  const ps = QF_PLANO.filter(p => p.tipo === l.tipo && Number(p.ref_id) === Number(l.ref_id));
  const aberto = ps.filter(p => !p.feito).reduce((t, p) => t + Math.max(Number(p.qtd) - Number(p.feito_qtd || 0), 0), 0);
  return { ps, aberto: l.emLotes ? aberto / l.rendimento : aberto };
}
function qfFaltaMandar(l){
  if(l.sem_ficha) return 0;
  const v = Math.max(l.fazer - qfNoPlano(l).aberto, 0);
  return l.emLotes ? Math.ceil(v * 2) / 2 : Math.ceil(v);
}
function qfQtdTx(l, v){ return l.emLotes ? loteTx(v, l.unidade_producao) : qfNum(v) + " un"; }

function qfLinhaItem(l){
  const row = document.createElement("div");
  const sel = QF_SEL.has(l.chave);
  const falta = qfFaltaMandar(l);
  row.className = "prod qf-item qf-sel-row" + (l.fazer > 0 ? "" : " feito") + (sel ? " escolhido" : "")
    + (l.it && l.it.fonte !== "vendas" ? " travado" : "") + (l.base ? " qf-base" : "");
  row.dataset.chave = l.chave;
  if(l.it) row.dataset.pid = l.it.produto_id;
  const ck = document.createElement("input"); ck.type = "checkbox"; ck.className = "qf-ck"; ck.checked = sel;
  ck.disabled = !!l.sem_ficha;
  ck.setAttribute("aria-label", "Escolher " + l.nome);
  ck.onchange = () => {
    if(ck.checked) QF_SEL.set(l.chave, falta > 0 ? falta : l.fazer || (l.emLotes ? 1 : 1));
    else QF_SEL.delete(l.chave);
    montarQuanto();
  };
  row.appendChild(ck);
  if(l.it){ const im = imgFoto(l.it.foto_url); if(im) row.appendChild(im); }
  const nm = document.createElement("button"); nm.type = "button"; nm.className = "n qf-nome"; nm.textContent = l.nome;
  const sm = document.createElement("small");
  sm.textContent = l.it ? qfDetalhe(l.it) : "cerca de " + qtdBonita(l.base.kg, "kg") + " no total · para " + l.base.para;
  nm.appendChild(sm);
  const np = qfNoPlano(l);
  if(np.ps.length){
    const tg = document.createElement("small"); tg.className = "qf-plano";
    tg.textContent = "No plano: " + np.ps.map(p => qfNomeDia(p.data).toLowerCase() + " " + qfQtdTx(l, l.emLotes ? Number(p.qtd) / l.rendimento : Number(p.qtd))
      + " para " + nomeQuem(quemDe(p)) + (p.feito ? " (feito)" : "")).join("; ")
      + (l.fazer > 0 ? ". Falta mandar: " + (falta > 0 ? qfQtdTx(l, falta) : "nada") : "");
    nm.appendChild(tg);
  }
  if(l.it) nm.onclick = () => { QF_ABERTO = QF_ABERTO === l.it.produto_id ? null : l.it.produto_id; montarQuanto(); };
  else nm.onclick = () => { ck.checked = !ck.checked; ck.onchange(); };
  const qt = document.createElement("span"); qt.className = "qt";
  qt.textContent = l.fazer > 0 ? (l.emLotes ? loteTx(l.fazer, l.unidade_producao) : String(l.fazer)) : "ok";
  row.append(nm, qt);
  return row;
}

function montarQuanto(){
  const box = $("qfCorpo");
  box.innerHTML = "";
  const { doces, bases } = qfLinhas();

  /* o resumo */
  const card = document.createElement("div"); card.className = "freezer-card qf-resumo"; card.id = "qfResumo";
  const h = document.createElement("h4"); h.textContent = "Fazer agora";
  const n = document.createElement("p"); n.className = "qf-total"; n.id = "qfTotal";
  n.textContent = Number(QF.total_fazer) > 0 ? QF.total_fazer + " doces" : "Nada: tem o suficiente";
  const s = document.createElement("p"); s.className = "s";
  s.textContent = "Para " + QF.dias + " dias de venda, com " + QF.margem_pct + "% de folga, já descontando a geladeira e o freezer. "
    + "A conta é refeita sozinha a cada contagem: vendeu mais, sobe; geladeira cheia, desce. "
    + "Base: " + QF.dias_base + " dias fechados nas últimas 4 semanas.";
  card.append(h, n, s);
  box.appendChild(card);

  box.appendChild(qfChips("Cobrir quantos dias", QF_OPC_DIAS, QF.dias, v => v + " dias", v => qfTrocarParam("dias", v), "qfDias"));
  box.appendChild(qfChips("Folga", QF_OPC_FOLGA, QF.margem_pct, v => v + "%", v => qfTrocarParam("margem_pct", v), "qfFolga"));

  const como = document.createElement("p"); como.className = "tip qf-como";
  como.textContent = "Marque os itens, escolha o dia e quem vai fazer, e mande. Depois marque outros para outro dia ou outra pessoa. Toque no nome do doce para dizer a meta ou a validade.";
  box.appendChild(como);
  const atalhos = document.createElement("div"); atalhos.className = "qf-atalhos";
  const tudo = document.createElement("button"); tudo.type = "button"; tudo.className = "qf-link"; tudo.id = "qfSelTudo";
  tudo.textContent = "Marcar tudo que falta mandar";
  tudo.onclick = () => { [...doces, ...bases].forEach(l => { const f = qfFaltaMandar(l); if(f > 0) QF_SEL.set(l.chave, f); }); montarQuanto(); };
  atalhos.appendChild(tudo);
  if(QF_SEL.size){
    const limpa = document.createElement("button"); limpa.type = "button"; limpa.className = "qf-link"; limpa.id = "qfSelLimpa";
    limpa.textContent = "Desmarcar tudo";
    limpa.onclick = () => { QF_SEL.clear(); montarQuanto(); };
    atalhos.appendChild(limpa);
  }
  box.appendChild(atalhos);

  /* doces: primeiro o que precisa fazer, do maior para o menor */
  const t1 = document.createElement("h3"); t1.className = "qf-tit"; t1.textContent = "Doces";
  box.appendChild(t1);
  doces.slice().sort((a, b) => (b.fazer > 0) - (a.fazer > 0) || b.fazer - a.fazer || a.it.ordem - b.it.ordem).forEach(l => {
    box.appendChild(qfLinhaItem(l));
    if(QF_ABERTO === l.it.produto_id) box.appendChild(qfEditor(l.it));
  });

  /* massas e recheios */
  if(bases.length){
    const t2 = document.createElement("h3"); t2.className = "qf-tit"; t2.textContent = "Massas e recheios para isso";
    box.appendChild(t2);
    bases.forEach(l => box.appendChild(qfLinhaItem(l)));
    const p = document.createElement("p"); p.className = "tip";
    p.textContent = "Arredondado para meia receita. O que já sobrou de massa ou recheio pronto não entra na conta: desconte de cabeça.";
    box.appendChild(p);
  }

  /* barra que acompanha a rolagem quando há itens marcados */
  if(QF_SEL.size){
    const barra = document.createElement("button"); barra.type = "button"; barra.className = "qf-barra"; barra.id = "qfBarra";
    barra.textContent = QF_SEL.size + (QF_SEL.size === 1 ? " item marcado" : " itens marcados") + " · escolher dia e pessoa";
    barra.onclick = () => { const e = $("qfEnvio"); if(e && e.scrollIntoView) e.scrollIntoView({ behavior: "smooth", block: "start" }); };
    box.appendChild(barra);
  }

  /* o envio dos marcados */
  const env = document.createElement("div"); env.className = "qf-envio"; env.id = "qfEnvio";
  const t3 = document.createElement("h3"); t3.className = "qf-tit"; t3.textContent = "Mandar para o plano";
  env.appendChild(t3);
  const todas = [...doces, ...bases];
  const marcados = todas.filter(l => QF_SEL.has(l.chave));
  if(!marcados.length){
    const p = document.createElement("p"); p.className = "tip"; p.style.margin = "0 2px 8px";
    p.textContent = "Nenhum item marcado. Marque na lista acima.";
    env.appendChild(p);
  } else {
    const lista = document.createElement("div"); lista.className = "qf-dest-lista"; lista.id = "qfMarcados";
    marcados.forEach(l => {
      const lin = document.createElement("div"); lin.className = "qf-dest-item"; lin.dataset.chave = l.chave;
      const nm = document.createElement("span"); nm.textContent = l.nome;
      const q = document.createElement("input"); q.type = "tel"; q.inputMode = "decimal"; q.className = "q";
      q.value = String(QF_SEL.get(l.chave)).replace(".", ",");
      q.setAttribute("aria-label", "Quanto mandar de " + l.nome);
      q.onchange = () => { const v = numBR(q.value); if(v !== null && v > 0) QF_SEL.set(l.chave, v); else q.value = String(QF_SEL.get(l.chave)).replace(".", ","); };
      const un = document.createElement("span"); un.className = "un"; un.textContent = l.emLotes ? nomeLote(2, l.unidade_producao) : "un";
      const x = document.createElement("button"); x.type = "button"; x.className = "tirar"; x.textContent = "tirar";
      x.setAttribute("aria-label", "Desmarcar " + l.nome);
      x.onclick = () => { QF_SEL.delete(l.chave); montarQuanto(); };
      lin.append(nm, q, un, x);
      lista.appendChild(lin);
    });
    env.appendChild(lista);
  }
  const prox = [0, 1, 2, 3, 4, 5, 6].map(diaMais);
  env.appendChild(qfChips("Para que dia", prox, QF_DIA, qfNomeDia, v => { QF_DIA = v; montarQuanto(); }, "qfDia"));
  const rq = document.createElement("span"); rq.className = "qf-rot"; rq.textContent = "Quem vai fazer (pode ser mais de uma pessoa)";
  env.appendChild(rq);
  env.appendChild(pickerQuem(QF_QUEM, arr => { QF_QUEM = arr; qfAtualizaBotao(); }, "qfQuem"));
  const bt = document.createElement("button"); bt.type = "button"; bt.className = "qf-bt cheio"; bt.id = "qfMandar";
  bt.onclick = travar(bt, mandarParaPlano);
  env.appendChild(bt);
  box.appendChild(env);
  qfAtualizaBotao();

  const dica = document.createElement("p"); dica.className = "tip";
  dica.textContent = "Doce novo ou que volta ao cardápio (como a coxinha): ative em Custos e preços › Geladeira, conte junto nas contagens "
    + "e toque no nome dele aqui para digitar a meta da semana. Depois de 7 dias de venda a conta passa a usar o que vendeu. "
    + "Cada pessoa vê o que é dela em O que fazer hoje, abre a receita já na quantidade certa e registra quanto fez.";
  box.appendChild(dica);
}

function qfAtualizaBotao(){
  const bt = $("qfMandar"); if(!bt) return;
  const n = QF_SEL.size;
  bt.textContent = n ? "Mandar " + n + (n === 1 ? " item" : " itens") + " para " + qfNomeDia(QF_DIA).toLowerCase()
    + (QF_QUEM.length ? ", para " + nomeQuem(QF_QUEM) : "") : "Marque itens para mandar";
  bt.disabled = !n || !QF_QUEM.length;
}

async function mandarParaPlano(){
  const { doces, bases } = qfLinhas();
  const marcados = [...doces, ...bases].filter(l => QF_SEL.has(l.chave) && !l.sem_ficha);
  if(!marcados.length){ aviso("qfMsg", "Marque pelo menos um item.", "warn"); return; }
  if(!QF_QUEM.length){ aviso("qfMsg", "Escolha quem vai fazer.", "warn"); return; }
  const { data: ja, error: e1 } = await sb.from("jb_producao_item").select("id,data,tipo,ref_id,qtd").eq("data", QF_DIA);
  if(e1){ aviso("qfMsg", "Não consegui ler o plano agora.", "err"); return; }
  const achar = l => (ja || []).find(j => j.tipo === l.tipo && Number(j.ref_id) === Number(l.ref_id));
  const repetidas = marcados.filter(achar);
  if(repetidas.length && !confirm(repetidas.map(l => l.nome).join(", ") + (repetidas.length === 1 ? " já estava" : " já estavam")
      + " no plano de " + qfNomeDia(QF_DIA).toLowerCase() + ". Trocar pela quantidade e pelas pessoas de agora?")) return;
  const dest = gravarQuem(QF_QUEM);
  let erros = 0;
  for(const l of marcados){
    const v = Number(QF_SEL.get(l.chave));
    const qtd = l.emLotes ? Math.round(v * l.rendimento * 1000) / 1000 : v;
    const j = achar(l);
    const r = j
      ? await sb.from("jb_producao_item").update({ qtd, ...dest }).eq("id", j.id)
      : await sb.from("jb_producao_item").insert({ data: QF_DIA, tipo: l.tipo, ref_id: Number(l.ref_id), qtd, ...dest });
    if(r && r.error) erros++;
  }
  if(erros){ aviso("qfMsg", "Mandei quase tudo, mas " + erros + " não entraram. Confira em Tarefas da equipe.", "warn"); }
  const n = marcados.length - erros;
  QF_SEL.clear();
  await qfCarregarPlano();
  montarQuanto();
  if(!erros) aviso("qfMsg", "Mandei " + n + (n === 1 ? " item" : " itens") + " para " + qfNomeDia(QF_DIA).toLowerCase() + ", para "
    + nomeQuem(QF_QUEM) + ". Cada um vê em O que fazer hoje e registra quanto fez. Marque outros itens para outro dia ou outra pessoa.", "ok");
  window.scrollTo(0, 0);
}
