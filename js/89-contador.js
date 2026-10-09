/* JB OS · dados para o contador. Só gestor.
   Todo mês, no dia combinado (dia 5, ou o próximo dia útil), a Jessica manda ao contador
   o que ele precisa para o PGDAS-D e o DAS do mês anterior: a venda de cada canal
   (valor dos pedidos, antes da comissão do app), o que caiu na conta e os impostos pagos.
   Tudo sai sozinho do que o app já tem. A venda exata vem do relatório de cada app:
   quando a Jessica copia o número de lá, ele substitui a estimativa. */

let CONTADOR_MES = null;
let CONTADOR = null;

const CONTADOR_DICA = {
  "iFood":  "No portal do iFood, Financeiro, relatório do mês: o \"valor dos itens\".",
  "99Food": "Nas cobranças da 99Food do mês: o \"preço de cardápio\".",
  "Keeta":  "No Bill overview do Keeta do mês: o \"Item sales\".",
  "Próprio": "Pix, cartão e encomendas: o que caiu na conta já é a venda."
};
const nomeCanalContador = n => n === "Próprio" ? "Venda direta (Pix, cartão e encomendas)" : (n === "Vale-refeição" ? "Vale-refeição (Pluxee)" : n);

/* o dia de mandar: dia D do mês seguinte; sábado e domingo passam para segunda */
function contadorPrazo(mes, dia){
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, Number(dia || 5), 12));
  const dow = d.getUTCDay();
  if(dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  if(dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const ddmm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
/* a data de um carimbo de hora, no fuso de São Paulo */
const diaSPde = ts => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));

/* fatia da venda que cai na conta em cada canal: o que o app não leva e, no 99Food e no Keeta,
   sem a parte paga em vale (ela chega separada, pela Pluxee) */
function contadorFatiaConta(c, taxaPluxee){
  const tx = c.taxa_efetiva != null ? Number(c.taxa_efetiva) : Number(c.taxa || 0) + Number(c.promo || 0);
  return 1 - tx - Number(c.vale_fatia || 0) * (1 - Number(taxaPluxee || 0));
}

/* ============================================================
   CONTA PURA (testável sem tela)
   ============================================================ */
function contadorPacote(x){
  const r2c = v => Math.round(v * 100) / 100;
  const P = x.param || {};
  const reg = x.registro || {};
  const relat = reg.vendas || {};
  const fat = {}; (x.fat || []).forEach(f => { fat[f.canal_id] = (fat[f.canal_id] || 0) + Number(f.valor || 0); });
  const canais = (x.canais || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  const vendas = canais.filter(c => c.ativo).map(c => {
    const recebido = r2c(fat[c.id] || 0);
    const fatia = contadorFatiaConta(c, P.taxa_pluxee);
    const estimado = fatia > 0 ? r2c(recebido / fatia) : null;
    const rel = relat[c.id] != null ? Number(relat[c.id]) : null;
    return { canal_id: c.id, nome: c.nome, rot: nomeCanalContador(c.nome), recebido, fatia, estimado, relatorio: rel, vale: Number(c.vale_fatia || 0) > 0,
             valor: rel != null ? rel : (estimado || 0), origem: rel != null ? "relatorio" : (fatia >= 0.999 ? "conta" : "estimado") };
  });
  const recebidos = canais.filter(c => (fat[c.id] || 0) > 0)
    .map(c => ({ canal_id: c.id, nome: c.nome, rot: nomeCanalContador(c.nome), valor: r2c(fat[c.id]) }));
  const impostos = (x.impostos || []).filter(i => i.pago_em && i.pago_em >= x.mes && i.pago_em <= ultimoDia(x.mes))
    .sort((a, b) => a.pago_em < b.pago_em ? -1 : 1)
    .map(i => ({ descricao: i.descricao, valor: Number(i.valor_pago != null ? i.valor_pago : i.valor), pago_em: i.pago_em }));

  const p = {
    mes: x.mes, vendas, recebidos, impostos,
    totalVendas: r2c(vendas.reduce((s, v) => s + v.valor, 0)),
    totalRecebido: r2c(recebidos.reduce((s, v) => s + v.valor, 0)),
    estimados: vendas.filter(v => v.origem === "estimado" && v.valor > 0).length,
    prazo: contadorPrazo(x.mes, P.contador_dia || 5),
    enviado: reg.enviado_em ? diaSPde(reg.enviado_em) : null,
    conferido: reg.conferido_em ? diaSPde(reg.conferido_em) : null, conferencia: reg.conferencia || null
  };
  p.mensagem = contadorMensagem(p);
  return p;
}

/* a mensagem pronta para o WhatsApp: curta, sem travessão, na ordem que o contador usa */
function contadorMensagem(p){
  const M = mesLongo(p.mes).toLowerCase().replace(" de ", "/");
  const m = mesLongo(p.mes).split(" ")[0].toLowerCase();
  const L = [];
  L.push("Olá! Tudo bem?");
  L.push("Seguem os dados da JB Confeitaria de " + M + " para o PGDAS-D e o DAS.");
  L.push("");
  L.push("*Vendas de " + m + "* (valor dos pedidos, antes da comissão dos aplicativos):");
  p.vendas.filter(v => v.valor > 0).forEach(v => L.push("• " + v.rot + ": R$ " + moeda(v.valor) + (v.origem === "estimado" ? " (estimado)" : "")));
  L.push("Total de vendas: R$ " + moeda(p.totalVendas));
  const comVale = p.vendas.filter(v => v.vale && v.valor > 0).map(v => v.nome);
  if(comVale.length && p.recebidos.some(v => v.nome === "Vale-refeição"))
    L.push("O vale-refeição (Pluxee) é forma de pagamento de pedidos do " + comVale.join(" e do ") + ": já está dentro dessas vendas.");
  L.push("");
  L.push("*Recebido na conta em " + m + "* (para conferência):");
  p.recebidos.forEach(v => L.push("• " + v.rot + ": R$ " + moeda(v.valor)));
  L.push("Total recebido: R$ " + moeda(p.totalRecebido));
  if(p.impostos.length){
    L.push("");
    L.push("*Impostos pagos em " + m + ":*");
    p.impostos.forEach(i => L.push("• " + i.descricao + ": R$ " + moeda(i.valor) + " em " + ddmm(i.pago_em)));
  }
  if(p.estimados){
    L.push("");
    L.push("Os valores marcados como estimado foram calculados pelo repasse. Se precisar, mando o relatório do aplicativo.");
  }
  L.push("");
  L.push("Qualquer dúvida me chama. Obrigada!");
  return L.join("\n");
}

/* ============================================================
   CARREGAR E SALVAR
   ============================================================ */
async function carregarContador(mes){
  const fim = ultimoDia(mes);
  const [ca, fa, co, pr, rg] = await Promise.all([
    sb.from("jb_canal").select("id,nome,ordem,taxa,promo,taxa_efetiva,vale_fatia,ativo"),
    sb.from("jb_faturamento").select("canal_id,valor").eq("mes", mes),
    sb.from("jb_conta").select("descricao,valor,valor_pago,pago_em,tipo,arquivada").eq("tipo", "imposto").eq("arquivada", false).gte("pago_em", mes).lte("pago_em", fim),
    sb.from("jb_parametro").select("chave,valor"),
    sb.from("jb_contador_mes").select("*").eq("mes", mes).maybeSingle()
  ]);
  const param = {}; ((pr && pr.data) || []).forEach(p => { param[p.chave] = Number(p.valor); });
  return contadorPacote({ mes, canais: (ca && ca.data) || [], fat: (fa && fa.data) || [], impostos: (co && co.data) || [],
                          param, registro: (rg && !rg.error && rg.data) || null });
}

async function salvarContador(campos){
  const atual = (await sb.from("jb_contador_mes").select("*").eq("mes", CONTADOR_MES).maybeSingle()).data || {};
  const linha = Object.assign({ mes: CONTADOR_MES, vendas: atual.vendas || {} }, campos, { atualizado_em: agora().toISOString() });
  const r = await sb.from("jb_contador_mes").upsert(linha, { onConflict: "mes" });
  if(r.error){ toast("Não consegui salvar", "err"); return false; }
  return true;
}

async function guardarRelatorio(canalId, valor){
  const atual = (await sb.from("jb_contador_mes").select("vendas").eq("mes", CONTADOR_MES).maybeSingle()).data;
  const vendas = Object.assign({}, (atual && atual.vendas) || {});
  if(valor == null) delete vendas[canalId]; else vendas[canalId] = valor;
  if(await salvarContador({ vendas })) await abrirContador(CONTADOR_MES);
}

/* ============================================================
   TELA
   ============================================================ */
function mesDoContador(){ return mesAnterior(primeiroDia(hojeSP())); }

async function abrirContador(mes){
  CONTADOR_MES = mes || CONTADOR_MES || mesDoContador();
  aviso("contadorMsg", "", "");
  $("contadorCorpo").innerHTML = "<p class='tip'>Juntando os números...</p>";
  show("scContador");
  try { CONTADOR = await carregarContador(CONTADOR_MES); }
  catch(e){ CONTADOR = null; }
  montarContador();
}

function montarContador(){
  const chips = $("contadorChips");
  chips.innerHTML = "";
  const ref = mesDoContador();
  [mesAnterior(mesAnterior(ref)), mesAnterior(ref), ref].forEach(iso => {
    const b = document.createElement("button"); b.type = "button";
    b.textContent = mesCurto(iso);
    b.setAttribute("aria-pressed", String(iso === CONTADOR_MES));
    b.onclick = () => abrirContador(iso);
    chips.appendChild(b);
  });
  const box = $("contadorCorpo");
  box.innerHTML = "";
  fecharExplicacao();
  const P = CONTADOR;
  if(!P){ sdTexto(box, "Não consegui juntar os números agora. Tente de novo em instantes."); return; }
  const m = mesLongo(P.mes).split(" ")[0].toLowerCase();

  /* 1. quando mandar */
  const st = sdCard(null, "ctStatus"); st.classList.add("ct-status");
  const dias = contaDias(P.prazo);
  const tom = P.enviado ? "ok" : dias < 0 ? "atraso" : dias <= 3 ? "logo" : "";
  st.classList.add(tom ? "tom-" + tom : "tom-normal");
  const t = document.createElement("b");
  t.textContent = P.enviado ? "Enviado em " + ddmm(P.enviado) + " ✓"
    : dias < 0 ? "Atrasado: era até " + dataCurta(P.prazo)
    : dias === 0 ? "Mandar hoje" : "Mandar até " + dataCurta(P.prazo);
  const s = document.createElement("p");
  s.textContent = "Dados de " + mesLongo(P.mes).toLowerCase() + ". Todo mês, no dia 5 (ou no próximo dia útil). O DAS vence no dia 20.";
  st.append(t, s);
  explicar(st, "Por que o dia 5", ["O contador precisa da venda do mês anterior para fazer o PGDAS-D e gerar o DAS, que vence no dia 20.",
    "No dia 5 os relatórios dos aplicativos do mês anterior já fecharam, e ele ainda tem duas semanas."], { tudoClicavel: true });
  box.appendChild(st);

  /* 1b. conferência nos portais (tarefa do dia 5) */
  if(P.conferido){
    const cf = sdCard("Conferido nos portais em " + ddmm(P.conferido), "ctConferencia");
    sdTexto(cf, P.conferencia || "Números conferidos.");
    box.appendChild(cf);
  }

  /* 2. vendas */
  const v = sdCard("Vendas de " + m, "ctVendas");
  sdTexto(v, "Valor dos pedidos, antes da comissão do app. É sobre isso que o Simples é calculado.", "nota");
  P.vendas.forEach(x => {
    const l = sdLinha(v, x.rot, "R$ " + moeda(x.valor), x.origem === "relatorio" ? "bom" : "", null);
    l.dataset.canal = x.canal_id;
    const sm = document.createElement("small");
    sm.textContent = x.origem === "relatorio" ? "do relatório do app" : x.origem === "conta" ? "o que caiu na conta" : x.valor > 0 ? "estimado pelo repasse" : "sem venda no mês";
    if(x.origem === "estimado" && x.valor > 0) sm.className = "est";
    l.querySelector("span").appendChild(sm);
    const linhas = [CONTADOR_DICA[x.nome] || "", x.origem === "relatorio" ? "Número copiado do relatório. Para voltar à estimativa, apague o campo." : "Para usar o número exato, copie do relatório e cole aqui."];
    const conta = x.fatia < 0.999 ? "Recebido R$ " + moeda(x.recebido) + " ÷ " + pct(x.fatia) + " que cai na conta = R$ " + moeda(x.estimado || 0) : null;
    const cx = explicar(l, x.rot, linhas, { conta, tudoClicavel: true });
    if(x.fatia < 0.999){
      const f = document.createElement("div"); f.className = "ct-rel";
      const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal";
      inp.placeholder = "Valor do relatório"; inp.id = "ctRel" + x.canal_id;
      if(x.relatorio != null) inp.value = moeda(x.relatorio);
      const ok = document.createElement("button"); ok.type = "button"; ok.textContent = "Usar este";
      ok.onclick = travar(ok, () => guardarRelatorio(x.canal_id, numBR(inp.value)));
      inp.addEventListener("click", e => e.stopPropagation());
      f.append(inp, ok); cx.appendChild(f);
    }
  });
  sdLinha(v, "Total de vendas", "R$ " + moeda(P.totalVendas), "ct-total", ["Total de vendas", ["A soma dos canais acima."],
    P.vendas.filter(x => x.valor > 0).map(x => moeda(x.valor)).join(" + ") + " = R$ " + moeda(P.totalVendas)]);
  box.appendChild(v);

  /* 3. recebido */
  const rc = sdCard("Recebido na conta em " + m, "ctRecebido");
  if(!P.recebidos.length) sdTexto(rc, "Nada lançado ainda no Nosso Financeiro para este mês.", "nota");
  P.recebidos.forEach(x => sdLinha(rc, x.rot, "R$ " + moeda(x.valor), null, [x.rot, x.nome === "Vale-refeição"
    ? ["Não é venda separada: é o pagamento em vale de pedidos do 99Food e do Keeta, que chega pela Pluxee, já sem a taxa dela.", "Por isso aparece aqui, no recebido, e não nas vendas. A mensagem explica isso ao contador."]
    : ["O que caiu na conta no mês, lançado no Nosso Financeiro.", "Vai para o contador conferir com o que os aplicativos informam à Receita."]]));
  if(P.recebidos.length) sdLinha(rc, "Total recebido", "R$ " + moeda(P.totalRecebido), "ct-total", null);
  box.appendChild(rc);

  /* 4. impostos */
  const ip = sdCard("Impostos pagos em " + m, "ctImpostos");
  if(!P.impostos.length) sdTexto(ip, "Nenhum imposto marcado como pago neste mês em Contas a pagar.", "nota");
  P.impostos.forEach(i => sdLinha(ip, i.descricao, "R$ " + moeda(i.valor), null, [i.descricao, ["Pago em " + ddmm(i.pago_em) + ", marcado em Contas a pagar."]]));
  box.appendChild(ip);

  /* 5. a mensagem */
  const mg = sdCard("Mensagem pronta", "ctMensagem");
  const pre = document.createElement("pre"); pre.className = "ct-texto"; pre.id = "ctTexto"; pre.textContent = P.mensagem;
  mg.appendChild(pre);
  const ac = document.createElement("div"); ac.className = "ct-acoes";
  const cp = document.createElement("button"); cp.type = "button"; cp.id = "ctCopiar"; cp.className = "ct-prim"; cp.textContent = "Copiar mensagem";
  cp.onclick = async () => {
    try { await navigator.clipboard.writeText(P.mensagem); toast("Mensagem copiada. Cole no WhatsApp do contador."); }
    catch(e){ aviso("contadorMsg", "Não deu para copiar sozinho. Segure o dedo no texto e copie.", "err"); }
  };
  const wa = document.createElement("a"); wa.id = "ctWhats"; wa.className = "ct-sec"; wa.textContent = "Abrir no WhatsApp";
  wa.href = "https://wa.me/?text=" + encodeURIComponent(P.mensagem); wa.target = "_blank"; wa.rel = "noopener";
  ac.append(cp, wa);
  mg.appendChild(ac);
  const en = document.createElement("button"); en.type = "button"; en.id = "ctEnviado"; en.className = "ct-env" + (P.enviado ? " feito" : "");
  en.textContent = P.enviado ? "Enviado em " + ddmm(P.enviado) + ". Desfazer" : "Já mandei para o contador";
  en.onclick = travar(en, async () => {
    if(await salvarContador(P.enviado ? { enviado_em: null, enviado_por: null } : { enviado_em: agora().toISOString(), enviado_por: EU ? EU.user_id : null })){
      toast(P.enviado ? "Desfeito" : "Marcado como enviado");
      await abrirContador(CONTADOR_MES);
    }
  });
  mg.appendChild(en);
  if(P.estimados) sdTexto(mg, "Tem canal estimado. Fica mais exato colando o número do relatório do app (toque no canal, lá em cima).", "nota");
  box.appendChild(mg);
}

/* resumo para o botão da Home */
async function resumoContadorHome(){
  const ref = mesDoContador();
  const [rg, pr] = await Promise.all([
    sb.from("jb_contador_mes").select("mes,enviado_em").eq("mes", ref).maybeSingle(),
    sb.from("jb_parametro").select("chave,valor").eq("chave", "contador_dia").maybeSingle()
  ]);
  if(rg.error) return null;
  const dia = pr && pr.data ? Number(pr.data.valor) : 5;
  const prazo = contadorPrazo(ref, dia);
  if(rg.data && rg.data.enviado_em)
    return { tom: "ok", texto: mesLongo(ref).split(" ")[0] + " enviado ✓ · próximo até " + ddmm(contadorPrazo(primeiroDia(hojeSP()), dia)) };
  const d = contaDias(prazo);
  if(d < 0) return { tom: "atraso", texto: "Atrasado: dados de " + mesLongo(ref).split(" ")[0].toLowerCase() + " (era até " + ddmm(prazo) + ")" };
  return { tom: d <= 3 ? "logo" : "", texto: "Mandar até " + ddmm(prazo) + " · dados de " + mesLongo(ref).split(" ")[0].toLowerCase() };
}
