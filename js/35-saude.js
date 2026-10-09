/* JB OS · saúde do negócio. Só gestor.
   Junta, num lugar só, o que os outros módulos já calculam: quanto sobra, para onde vai o
   dinheiro, o imposto certo, o peso da equipe e se dá para contratar. Nada aqui é digitado:
   muda sozinho quando muda um preço, um insumo, uma conta fixa, o faturamento ou a escala. */

let SAUDE = null;

/* Referências de mercado usadas na análise da equipe (setembro de 2026).
   Fonte: claude/jb-custo-de-uma-contratacao-40h-set2026.md (piso CAGED de auxiliar de
   confeitaria, encargos do Simples Anexo I/II, vale-transporte de SP). */
const REF_EQUIPE = {
  pisoMes44h: 2320.41,        // salário de auxiliar de confeitaria, 44h
  horasMes44h: 220,
  clt40hCusto: 2918.22,       // salário proporcional a 40h + 32,2% de encargos + VT, sem VR
  horasMes40h: 173.33,
  diariaFreela: 140,          // diária de produção já praticada na casa
  tetoEquipe: 0.25            // equipe até 25% da venda é a referência usada para confeitaria de delivery
};

/* faixas do veredito, pela sobra de cada R$ 100 depois de tudo, pró-labore incluído */
function saudeVeredito(sobra){
  if(sobra == null) return { tom: "cinza", rot: "Sem dados", frase: "Ainda não há um mês fechado com faturamento lançado." };
  if(sobra >= 0.10) return { tom: "verde", rot: "Saudável", frase: "Dá lucro com folga, depois de pagar tudo e o pró-labore." };
  if(sobra >= 0.03) return { tom: "amarelo", rot: "Atenção", frase: "Dá lucro, mas a folga é curta para imprevisto." };
  if(sobra >= 0) return { tom: "ambar", rot: "No limite", frase: "Paga as contas e o pró-labore, e sobra quase nada." };
  return { tom: "vermelho", rot: "No vermelho", frase: "A venda não está pagando todas as contas e o pró-labore." };
}

/* o mês de referência é o último mês fechado com venda estimada: o mês corrente ainda está pela metade */
function saudeMesRef(destinos, hoje){
  const atual = primeiroDia(hoje);
  return destinos.filter(d => d.mes < atual && Number(d.bruto_estimado) > 0)
                 .sort((a, b) => a.mes < b.mes ? 1 : -1)[0] || null;
}

/* tudo que a tela mostra sai daqui: pura, para dar para testar a conta sem tela */
function saudeCalcular(x){
  const D = x.destino, K = x.kpi || {};
  const bruto = D ? Number(D.bruto_estimado) : 0;
  const sobra = D ? Number(D.sobra) : null;
  const lucro = D ? Math.round(bruto * sobra * 100) / 100 : null;
  const proLabore = Number(K.pro_labore || 0);
  const r = { mes: D ? D.mes : null, bruto, sobra, lucro, proLabore, donoLeva: lucro == null ? null : proLabore + lucro,
              veredito: saudeVeredito(sobra) };

  // folga sobre o ponto de equilíbrio
  r.udia = K.unidades_dia != null ? Number(K.unidades_dia) : null;
  r.equilibrio = K.equilibrio_dia != null ? Number(K.equilibrio_dia) : null;
  r.contribUn = K.contrib_un != null ? Number(K.contrib_un) : null;
  r.folga = r.udia != null && r.equilibrio ? (r.udia - r.equilibrio) / r.equilibrio : null;

  // equipe do mês de referência
  const eq = x.equipe || [];
  r.equipe = eq;
  r.equipeTotal = eq.reduce((s, p) => s + Number(p.mes || 0), 0);
  r.equipePct = bruto > 0 ? r.equipeTotal / bruto : null;

  // contratar
  const ref = REF_EQUIPE;
  r.cabe = lucro != null ? Math.max(0, lucro) : 0;
  r.faltaClt = Math.max(0, ref.clt40hCusto - r.cabe);
  r.unExtraDia = r.contribUn > 0 ? Math.ceil(r.faltaClt / r.contribUn / 30) : null;
  r.pontosApp = bruto > 0 ? r.faltaClt / bruto : null;
  r.diariasCabem = Math.floor(r.cabe / ref.diariaFreela);

  // imposto
  const I = x.imposto;
  r.imposto = I ? {
    usado: Number(I.aliquota_usada), modo: I.modo, anexo: I.anexo, faixa: I.faixa, rbt12: Number(I.rbt12),
    meses: I.meses_com_dado, pago: I.pago_sobre_bruto != null ? Number(I.pago_sobre_bruto) : null
  } : null;
  if(r.imposto && r.imposto.pago != null && bruto > 0)
    r.imposto.diferencaMes = Math.max(0, (r.imposto.usado - r.imposto.pago) * bruto);

  // caixa do Nosso Financeiro no mesmo mês
  r.caixa = K.entradas != null ? { entrou: Number(K.entradas), saiu: Number(K.saidas || 0), sobrou: Number(K.entradas) - Number(K.saidas || 0) } : null;

  r.app = D ? Number(D.app) : null;
  r.destino = D;
  r.recomendacoes = saudeRecomendacoes(r);
  return r;
}

function saudeRecomendacoes(r){
  const l = [];
  if(r.app != null && r.app >= 0.35)
    l.push({ tom: "ambar", t: "A maior conta é o app: R$ " + moeda(r.app * 100) + " de cada R$ 100.",
             d: "Cada 1 ponto a menos de promoção ou de comissão vale cerca de R$ " + moeda(r.bruto * 0.01) + " por mês. É a alavanca mais forte, mais do que equipe ou ingrediente." });
  if(r.folga != null && r.folga < 0.15)
    l.push({ tom: r.folga < 0 ? "vermelho" : "ambar", t: "Folga pequena sobre o ponto de equilíbrio.",
             d: "Vende " + r.udia + " por dia e precisa de " + r.equilibrio + " para pagar tudo. Uma semana fraca já vira prejuízo." });
  if(r.imposto && r.imposto.diferencaMes > 100)
    l.push({ tom: "ambar", t: "Imposto pago abaixo da tabela.",
             d: "Pela venda, o Simples daria " + pct(r.imposto.usado) + "; o DAS pago ficou em " + pct(r.imposto.pago) + ". São cerca de R$ " + moeda(r.imposto.diferencaMes) + " por mês de diferença. O preço já está protegido; a declaração é com o contador." });
  if(r.lucro != null && r.lucro < REF_EQUIPE.clt40hCusto)
    l.push({ tom: "cinza", t: "Contratar CLT de 40h ainda não cabe.",
             d: "Custa R$ " + moeda(REF_EQUIPE.clt40hCusto) + " por mês. Hoje cabem R$ " + moeda(r.cabe) + ". Para pico de trabalho, freela por diária é o caminho até o lucro passar de R$ " + moeda(REF_EQUIPE.clt40hCusto * 1.2) + " por dois meses seguidos." });
  if(r.equipePct != null && r.equipePct <= REF_EQUIPE.tetoEquipe)
    l.push({ tom: "verde", t: "Equipe do tamanho certo para a venda.",
             d: "Custa " + pct(r.equipePct) + " da venda; a referência usada é até " + pct(REF_EQUIPE.tetoEquipe) + ". O aperto não vem da folha." });
  return l;
}

/* ============================================================
   CARREGAR
   ============================================================ */
async function carregarSaude(){
  const hoje = hojeSP();
  const [dest, kpi, imp, ac, es] = await Promise.all([
    sb.from("jb_kpi_destino").select("*"),
    sb.from("jb_kpi_mes").select("*"),
    sb.from("jb_imposto_estimado").select("*").maybeSingle(),
    sb.from("jb_acordo").select("user_id,inicio,fim,regime,valor"),
    sb.from("jb_escala").select("user_id,dia_semana,entrada,saida,inicio,fim")
  ]);
  const destinos = (dest && !dest.error && dest.data) || [];
  const D = saudeMesRef(destinos, hoje);
  if(!D) return { vazio: true };
  const ini = D.mes, fim = ultimoDia(D.mes);
  const K = ((kpi && kpi.data) || []).find(k => k.mes === D.mes) || null;
  const acordos = ((ac && ac.data) || []).filter(a => a.inicio <= fim && (!a.fim || a.fim >= ini));
  const escalas = (es && es.data) || [];

  const [dt, fr, us] = await Promise.all([
    sb.from("jb_dia_trabalhado").select("id,user_id,data,status").eq("status", "confirmado").gte("data", ini).lte("data", fim),
    sb.from("jb_freela").select("valor,data").eq("cancelada", false).gte("data", ini).lte("data", fim),
    sb.from("jb_usuario").select("user_id,nome")
  ]);
  const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
  const dias = (dt && dt.data) || [];
  const equipe = [];
  acordos.forEach(a => {
    const nome = nomes[a.user_id] || "Pessoa";
    if(a.regime === "semanal"){
      const h = eqHorasSemana(escalas, a.user_id, fim);
      equipe.push({ nome, regime: "semanal", mes: Number(a.valor) * 52 / 12, hora: h > 0 ? Number(a.valor) / h : null,
                    detalhe: "R$ " + moeda(Number(a.valor)) + " por semana" + (h > 0 ? ", " + eqHorasTx(h) + " por semana" : "") });
    } else if(a.regime === "diaria"){
      const n = dias.filter(d => d.user_id === a.user_id).length;
      equipe.push({ nome, regime: "diaria", mes: n * Number(a.valor), hora: Number(a.valor) / 8,
                    detalhe: n + (n === 1 ? " dia" : " dias") + " × R$ " + moeda(Number(a.valor)) });
    }
  });
  const freelas = (fr && fr.data) || [];
  if(freelas.length) equipe.push({ nome: "Freelas", regime: "freela", mes: freelas.reduce((s, f) => s + Number(f.valor), 0), hora: null,
                                   detalhe: freelas.length + (freelas.length === 1 ? " diária" : " diárias") });

  const tendencia = destinos.filter(d => d.mes <= D.mes && Number(d.bruto_estimado) > 0)
    .sort((a, b) => a.mes < b.mes ? -1 : 1).slice(-4)
    .map(d => ({ mes: d.mes, lucro: Number(d.bruto_estimado) * Number(d.sobra), sobra: Number(d.sobra) }));

  const r = saudeCalcular({ destino: D, kpi: K, equipe, imposto: (imp && !imp.error && imp.data) || null });
  r.tendencia = tendencia;
  return r;
}

async function abrirSaude(){
  aviso("saudeMsg", "", "");
  $("saudeCorpo").innerHTML = "<p class='tip'>Fazendo as contas...</p>";
  show("scSaude");
  try { SAUDE = await carregarSaude(); }
  catch(e){ SAUDE = null; }
  montarSaude();
}

/* resumo de uma linha para o botão da Home */
async function resumoSaudeHome(){
  const { data, error } = await sb.from("jb_kpi_destino").select("mes,bruto_estimado,sobra");
  if(error || !data) return null;
  const D = saudeMesRef(data, hojeSP());
  if(!D) return null;
  const lucro = Number(D.bruto_estimado) * Number(D.sobra);
  return { mes: D.mes, lucro, veredito: saudeVeredito(Number(D.sobra)) };
}

/* ============================================================
   TELA
   ============================================================ */
function sdCard(titulo, id){
  const c = document.createElement("div"); c.className = "sd-card"; if(id) c.id = id;
  if(titulo){ const h = document.createElement("h3"); h.textContent = titulo; c.appendChild(h); }
  return c;
}
function sdLinha(alvo, rot, val, cls){
  const l = document.createElement("div"); l.className = "sd-ln" + (cls ? " " + cls : "");
  const a = document.createElement("span"); a.textContent = rot;
  const b = document.createElement("b"); b.textContent = val;
  l.append(a, b); alvo.appendChild(l); return l;
}
function sdTexto(alvo, t, cls){ const p = document.createElement("p"); p.className = "sd-tx" + (cls ? " " + cls : ""); p.textContent = t; alvo.appendChild(p); return p; }
const reais = v => (v < 0 ? "− R$ " : "R$ ") + moeda(Math.abs(v));

function montarSaude(){
  const box = $("saudeCorpo");
  box.innerHTML = "";
  const S = SAUDE;
  if(!S || S.vazio){
    sdTexto(box, "Ainda não há um mês fechado com faturamento lançado. Assim que o Nosso Financeiro empurrar as entradas do mês, esta tela se monta sozinha.");
    return;
  }

  /* 1. o veredito */
  const v = sdCard(null, "sdVeredito"); v.classList.add("sd-veredito", "tom-" + S.veredito.tom);
  const et = document.createElement("span"); et.className = "sd-selo"; et.textContent = S.veredito.rot; v.appendChild(et);
  const q = document.createElement("p"); q.className = "sd-pergunta"; q.textContent = "O negócio está dando lucro? " + mesLongo(S.mes); v.appendChild(q);
  const n = document.createElement("div"); n.className = "sd-numero"; n.id = "sdLucro";
  n.textContent = reais(S.lucro);
  const ns = document.createElement("small"); ns.textContent = " por mês, depois de tudo"; n.appendChild(ns);
  v.appendChild(n);
  sdTexto(v, S.veredito.frase);
  const mini = document.createElement("div"); mini.className = "sd-mini";
  [["Sobra de cada R$ 100", reais(S.sobra * 100)], ["Pró-labore", reais(S.proLabore)], ["O dono leva", reais(S.donoLeva)]].forEach(([a, b]) => {
    const d = document.createElement("div"); const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; d.append(y, x); mini.appendChild(d);
  });
  v.appendChild(mini);
  box.appendChild(v);

  /* 2. tendência */
  if(S.tendencia && S.tendencia.length > 1){
    const t = sdCard("Lucro depois de tudo, mês a mês", "sdTendencia");
    const mx = Math.max(...S.tendencia.map(x => Math.abs(x.lucro)), 1);
    const g = document.createElement("div"); g.className = "sd-colunas";
    S.tendencia.forEach(x => {
      const c = document.createElement("div"); c.className = "sd-col" + (x.lucro < 0 ? " neg" : "") + (x.mes === S.mes ? " atual" : "");
      const val = document.createElement("b"); val.textContent = (x.lucro < 0 ? "−" : "") + "R$ " + Math.round(Math.abs(x.lucro)).toLocaleString("pt-BR");
      const bar = document.createElement("i"); bar.style.height = Math.max(4, Math.abs(x.lucro) / mx * 70) + "px";
      const m = document.createElement("span"); m.textContent = mesCurto(x.mes);
      c.append(val, bar, m); g.appendChild(c);
    });
    t.appendChild(g);
    sdTexto(t, "Calculado pela conta de cada produto: venda estimada × o que sobra depois de app, imposto, ingrediente e contas fixas.", "nota");
    box.appendChild(t);
  }

  /* 3. para onde vai cada R$ 100 */
  const pv = sdCard("Para onde vai cada R$ 100 vendidos", "sdDestino");
  const D = S.destino;
  const fatias = [["App e promoção", Number(D.app), "app"], ["Imposto", Number(D.imposto), "imp"], ["Ingrediente e embalagem", Number(D.ingrediente), "ing"],
                  ["Contas fixas e pró-labore", Number(D.custo_fixo), "fixo"], [Number(D.sobra) >= 0 ? "Sobra" : "Falta", Math.abs(Number(D.sobra)), Number(D.sobra) >= 0 ? "sobra" : "falta"]];
  const pilha = document.createElement("div"); pilha.className = "sd-pilha";
  fatias.forEach(([, f, cls]) => { const s = document.createElement("i"); s.className = cls; s.style.width = Math.max(0, f * 100) + "%"; pilha.appendChild(s); });
  pv.appendChild(pilha);
  fatias.forEach(([rot, f, cls]) => sdLinha(pv, rot, "R$ " + moeda(f * 100), "cor-" + cls));
  box.appendChild(pv);

  /* 4. folga */
  if(S.udia != null && S.equilibrio != null){
    const f = sdCard("Quanto falta para dar prejuízo", "sdFolga");
    sdLinha(f, "Vendendo por dia", S.udia + " doces");
    sdLinha(f, "Precisa vender para pagar tudo", S.equilibrio + " doces");
    sdLinha(f, "Folga", (S.folga >= 0 ? "" : "−") + Math.round(Math.abs(S.folga) * 100) + "%", S.folga < 0.15 ? "alerta" : "bom");
    sdTexto(f, "Cada doce deixa R$ " + moeda(S.contribUn) + " depois de app, imposto e ingrediente. É com isso que se pagam as contas fixas.", "nota");
    box.appendChild(f);
  }

  /* 5. imposto */
  if(S.imposto){
    const I = S.imposto;
    const c = sdCard("Imposto usado nos preços", "sdImposto");
    sdLinha(c, "Alíquota usada", pct(I.usado) + (I.modo === "auto" ? " · automática" : " · fixa"));
    if(I.modo === "auto") sdLinha(c, "Simples, Anexo " + I.anexo + ", faixa " + I.faixa, "venda de 12 meses R$ " + moeda(I.rbt12));
    if(I.pago != null) sdLinha(c, "DAS pago nos últimos 3 meses", pct(I.pago) + " da venda", I.pago < I.usado - 0.01 ? "alerta" : "");
    sdTexto(c, I.modo === "auto"
      ? "Calculado sozinho pela tabela do Simples com a venda estimada" + (I.meses < 12 ? " (média de " + I.meses + " meses × 12)" : "") + ". Quando o faturamento sobe de faixa, o preço saudável sobe junto em Custos e preços."
      : "Número fixo digitado em Custos e preços. Não acompanha o faturamento.", "nota");
    box.appendChild(c);
  }

  /* 6. equipe */
  const e = sdCard("Equipe", "sdEquipe");
  S.equipe.forEach(p => {
    const l = sdLinha(e, p.nome, "R$ " + moeda(p.mes) + " no mês");
    const sm = document.createElement("small");
    const ref = REF_EQUIPE.pisoMes44h / REF_EQUIPE.horasMes44h;
    sm.textContent = p.detalhe + (p.hora ? " · R$ " + moeda(p.hora) + " a hora" + (p.hora > ref * 1.3 ? " (acima do piso de R$ " + moeda(ref) + ")" : "") : "");
    l.querySelector("span").appendChild(sm);
  });
  sdLinha(e, "Equipe no mês", "R$ " + moeda(S.equipeTotal) + (S.equipePct != null ? " · " + pct(S.equipePct) + " da venda" : ""), S.equipePct != null && S.equipePct > REF_EQUIPE.tetoEquipe ? "alerta" : "bom");
  sdTexto(e, "Referência: piso de auxiliar de confeitaria R$ " + moeda(REF_EQUIPE.pisoMes44h) + " por 44h (R$ " + moeda(REF_EQUIPE.pisoMes44h / REF_EQUIPE.horasMes44h) + " a hora). Registrada com encargos, uma pessoa de 40h custa R$ " + moeda(REF_EQUIPE.clt40hCusto) + " por mês. O pró-labore fica fora desta conta.", "nota");
  box.appendChild(e);

  /* 7. contratar */
  const k = sdCard("Dá para contratar?", "sdContratar");
  sdLinha(k, "Cabe hoje no lucro", "R$ " + moeda(S.cabe) + " por mês", S.cabe >= REF_EQUIPE.clt40hCusto ? "bom" : "alerta");
  sdLinha(k, "Freela por diária (R$ " + moeda(REF_EQUIPE.diariaFreela) + ")", S.diariasCabem + (S.diariasCabem === 1 ? " diária por mês" : " diárias por mês"));
  sdLinha(k, "CLT 40h, salário R$ " + moeda(REF_EQUIPE.pisoMes44h * 200 / 220), "custa R$ " + moeda(REF_EQUIPE.clt40hCusto));
  if(S.faltaClt > 0){
    sdTexto(k, "Para caber uma pessoa de 40h registrada faltam R$ " + moeda(S.faltaClt) + " por mês: vender mais " + (S.unExtraDia != null ? S.unExtraDia + " doces por dia" : "—")
      + (S.pontosApp != null ? ", ou baixar " + (S.pontosApp * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " pontos da fatia dos apps" : "") + ".");
  } else {
    sdTexto(k, "O lucro já paga uma pessoa de 40h registrada. Bom momento para contratar se o volume pedir.");
  }
  box.appendChild(k);

  /* 8. o que fazer */
  if(S.recomendacoes.length){
    const r = sdCard("O que um consultor diria", "sdConselhos");
    S.recomendacoes.forEach(x => {
      const d = document.createElement("div"); d.className = "sd-cons tom-" + x.tom;
      const b = document.createElement("b"); b.textContent = x.t;
      const p = document.createElement("p"); p.textContent = x.d;
      d.append(b, p); r.appendChild(d);
    });
    box.appendChild(r);
  }

  /* 9. caixa x competência */
  if(S.caixa){
    const c = sdCard("E o caixa do Nosso Financeiro?", "sdCaixa");
    sdLinha(c, "Entrou no mês", "R$ " + moeda(S.caixa.entrou));
    sdLinha(c, "Saiu no mês", "R$ " + moeda(S.caixa.saiu));
    sdLinha(c, "Sobrou no caixa", reais(S.caixa.sobrou));
    sdTexto(c, "O caixa costuma mostrar mais do que o lucro de verdade: compra no cartão entra só a parcela do mês, e parte do repasse que cai num mês é venda do mês anterior. Para saber se dá lucro, vale o número de cima.", "nota");
    box.appendChild(c);
  }
}
