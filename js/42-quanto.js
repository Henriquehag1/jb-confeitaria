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
let QF_DIA_BASES = null;   // dia das massas e recheios no plano
let QF_DIA_MONTA = null;   // dia da montagem no plano
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
  if(!QF_DIA_BASES || QF_DIA_BASES < hojeSP()) QF_DIA_BASES = hojeSP();
  if(!QF_DIA_MONTA || QF_DIA_MONTA < hojeSP()) QF_DIA_MONTA = diaMais(1);
  try { QF = await qfConta(); }
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

function montarQuanto(){
  const box = $("qfCorpo");
  box.innerHTML = "";
  const itens = (QF && QF.itens) || [];
  const bases = (QF && QF.bases) || [];

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

  /* doces: primeiro o que precisa fazer, do maior para o menor */
  const t1 = document.createElement("h3"); t1.className = "qf-tit"; t1.textContent = "Doces";
  box.appendChild(t1);
  const ordem = itens.slice().sort((a, b) => (b.fazer > 0) - (a.fazer > 0) || b.fazer - a.fazer || a.ordem - b.ordem);
  ordem.forEach(it => {
    const row = document.createElement("button"); row.type = "button";
    row.className = "prod qf-item" + (it.fazer > 0 ? "" : " feito") + (it.fonte === "vendas" ? "" : " travado");
    row.dataset.pid = it.produto_id;
    const im = imgFoto(it.foto_url); if(im) row.appendChild(im);
    const nm = document.createElement("span"); nm.className = "n"; nm.textContent = it.nome;
    const sm = document.createElement("small"); sm.textContent = qfDetalhe(it);
    nm.appendChild(sm);
    const qt = document.createElement("span"); qt.className = "qt";
    qt.textContent = it.fazer > 0 ? String(it.fazer) : "ok";
    row.append(nm, qt);
    row.onclick = () => { QF_ABERTO = QF_ABERTO === it.produto_id ? null : it.produto_id; montarQuanto(); };
    box.appendChild(row);
    if(QF_ABERTO === it.produto_id) box.appendChild(qfEditor(it));
  });

  /* massas e recheios */
  if(bases.length){
    const t2 = document.createElement("h3"); t2.className = "qf-tit"; t2.textContent = "Massas e recheios para isso";
    box.appendChild(t2);
    bases.forEach(b => {
      const row = document.createElement("div"); row.className = "prod qf-base";
      const nm = document.createElement("span"); nm.className = "n"; nm.textContent = b.nome;
      const sm = document.createElement("small");
      sm.textContent = "cerca de " + qtdBonita(b.kg, "kg") + " no total · para " + b.para;
      nm.appendChild(sm);
      const qt = document.createElement("span"); qt.className = "qt";
      qt.textContent = loteTx(b.lotes_fazer, b.unidade_producao);
      row.append(nm, qt);
      box.appendChild(row);
    });
    const p = document.createElement("p"); p.className = "tip";
    p.textContent = "Arredondado para meia receita. O que já sobrou de massa ou recheio pronto não entra na conta: desconte de cabeça.";
    box.appendChild(p);
  }

  /* mandar para o plano de produção */
  const t3 = document.createElement("h3"); t3.className = "qf-tit"; t3.textContent = "Mandar para o plano de produção";
  box.appendChild(t3);
  const prox = [0, 1, 2, 3, 4, 5, 6].map(diaMais);
  box.appendChild(qfChips("Massas e recheios no dia", prox, QF_DIA_BASES, qfNomeDia, v => { QF_DIA_BASES = v; montarQuanto(); }, "qfDiaBases"));
  box.appendChild(qfChips("Montagem dos doces no dia", prox, QF_DIA_MONTA, qfNomeDia, v => { QF_DIA_MONTA = v; montarQuanto(); }, "qfDiaMonta"));
  const bt = document.createElement("button"); bt.type = "button"; bt.className = "qf-bt cheio"; bt.id = "qfMandar";
  bt.textContent = "Mandar para o plano";
  bt.onclick = travar(bt, mandarParaPlano);
  box.appendChild(bt);

  const dica = document.createElement("p"); dica.className = "tip";
  dica.textContent = "Doce novo ou que volta ao cardápio (como a coxinha): ative em Custos e preços › Geladeira, conte junto nas contagens "
    + "e toque nele aqui para digitar a meta da semana. Depois de 7 dias de venda a conta passa a usar o que vendeu. "
    + "Toque em qualquer doce para dizer a validade.";
  box.appendChild(dica);
}

async function mandarParaPlano(){
  const bases = ((QF && QF.bases) || []).filter(b => Number(b.lotes_fazer) > 0 && Number(b.rendimento_kg) > 0);
  const doces = ((QF && QF.itens) || []).filter(i => i.fazer > 0 && i.ficha_id);
  if(!bases.length && !doces.length){ aviso("qfMsg", "Nada para mandar: tem o suficiente de tudo.", "ok"); return; }
  const dias = [...new Set([QF_DIA_BASES, QF_DIA_MONTA])];
  const { data: ja, error: e1 } = await sb.from("jb_producao_item").select("id,data,tipo,ref_id,qtd").in("data", dias);
  if(e1){ aviso("qfMsg", "Não consegui ler o plano agora.", "err"); return; }
  const linhas = [
    ...bases.map(b => ({ data: QF_DIA_BASES, tipo: "subreceita", ref_id: Number(b.subreceita_id),
                         qtd: Math.round(Number(b.lotes_fazer) * Number(b.rendimento_kg) * 1000) / 1000 })),
    ...doces.map(i => ({ data: QF_DIA_MONTA, tipo: "ficha", ref_id: Number(i.ficha_id), qtd: i.fazer }))
  ];
  const achar = l => (ja || []).find(j => j.data === l.data && j.tipo === l.tipo && Number(j.ref_id) === l.ref_id);
  const repetidas = linhas.filter(achar).length;
  if(repetidas && !confirm(repetidas + (repetidas === 1 ? " receita já estava" : " receitas já estavam")
      + " no plano desses dias. Trocar pela quantidade da conta?")) return;
  let erros = 0;
  for(const l of linhas){
    const j = achar(l);
    const r = j
      ? await sb.from("jb_producao_item").update({ qtd: l.qtd }).eq("id", j.id)
      : await sb.from("jb_producao_item").insert({ ...l, para: PARA_PADRAO(l.tipo) });
    if(r && r.error) erros++;
  }
  if(erros){ aviso("qfMsg", "Mandei quase tudo, mas " + erros + " não entraram. Confira no Plano de produção.", "warn"); return; }
  aviso("qfMsg", "No plano: " + bases.length + " massas e recheios para " + qfNomeDia(QF_DIA_BASES).toLowerCase()
    + " e " + doces.length + " doces para montar " + (QF_DIA_MONTA === QF_DIA_BASES ? "no mesmo dia" : qfNomeDia(QF_DIA_MONTA).toLowerCase())
    + ". Abra o Plano de produção para ajustar ou passar para quem vai fazer.", "ok");
}
