/* JB OS · conferência da equipe com o Nosso Financeiro. Só gestor.
   No JB OS fica quem trabalhou e em que dia; no Nosso Financeiro, o Pix. Aqui os dois se
   encontram: o que casa vira conta paga sozinho, o que não casa vira um aviso.
   Os pagamentos chegam em jb_mes.detalhe (grupo Pessoas e as contas fixas da equipe),
   cada um com a referência 'evento id' ou 'pagamento_conta id' do Nosso Financeiro. */

let CONF = null;   // resultado da conferência do mês aberto em Quem veio no ateliê

/* nome comparável: sem acento, minúsculo, k vira c, y vira i, letra dobrada vira uma */
function confNorm(s){
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ph/g, "f").replace(/k/g, "c").replace(/y/g, "i").replace(/([a-z])\1+/g, "$1");
}
/* apelido que é a mesma pessoa (26/10: Bela e Bella são a Isabella Freitas) */
const CONF_APELIDO = { bela: "isabela" };
function confPessoaDoTexto(texto, nomes){
  const palavras = confNorm(texto).split(/[^a-z]+/).filter(Boolean).map(w => CONF_APELIDO[w] || w);
  return nomes.find(n => { const p = confChave(n); return p && palavras.includes(p); }) || null;
}
/* a mesma pessoa escrita de jeitos diferentes (Marcus, Markus, Markus Porthos; Bela, Bella) tem a mesma chave: o primeiro nome comparável */
function confChave(nome){ const k = confNorm(nome).split(/[^a-z]+/).filter(Boolean)[0] || ""; return CONF_APELIDO[k] || k; }
const confDias = (a, b) => Math.round((Date.UTC(...b.split("-").map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...a.split("-").map((x, i) => i === 1 ? x - 1 : +x))) / 864e5);
const confR2 = v => Math.round(v * 100) / 100;
/* quinzena e diária: diferença de até R$ 1 é arredondamento, não é outro pagamento */
const CONF_TOL = 1;

/* ============================================================
   A CONTA (pura, testável)
   x = { mes, hoje, pagamentos:[{ref,data,desc,valor}], nomes:[...],
         freelas:[{nome,data,valor,conta_id}], contas:{id:{id,valor,valor_pago,vencimento,pago_em,pago_por,nf_ref}},
         diarias:[{nome,valor,dias:[iso],pagos:[{data,pago_em}]}],
         semanais:[{nome, contas:[{id,valor,valor_pago,vencimento,pago_em,pago_por,nf_ref,descricao}]}] }
   Quinzena com vencimento antes do mês só serve para explicar o Pix do começo do mês; não aparece na lista.
   ============================================================ */
function conferirEquipe(x){
  const mes = x.mes, fimMes = ultimoDia(mes);
  const limite = (() => { const d = new Date(fimMes + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); })();
  const nomes = x.nomes || [];
  const pags = (x.pagamentos || []).filter(p => p.ref && p.data >= mes && p.data <= limite)
    .map(p => { const pessoa = confPessoaDoTexto(p.desc, nomes); return Object.assign({}, p, { valor: Number(p.valor), pessoa, chave: pessoa ? confChave(pessoa) : null }); });
  const usados = new Set();
  Object.values(x.contas || {}).forEach(c => { if(c.nf_ref) usados.add(c.nf_ref); });
  (x.semanais || []).forEach(s => s.contas.forEach(c => { if(c.nf_ref) usados.add(c.nf_ref); }));
  const r = { casados: [], marcar: [], valorDif: [], semRegistro: [], duplicados: [], esquecidos: [], diarias: [], semanais: [] };
  const valorConta = c => Number(c.pago_em && c.valor_pago != null ? c.valor_pago : c.valor);
  /* conta paga à mão (sem Pix ligado) também pode ser explicada por um Pix: só ganha a referência */
  const ligar = (c, p, vp) => r.marcar.push(c.pago_em ? { id: c.id, nf_ref: p.ref, so_ref: true }
                                                      : { id: c.id, pago_em: p.data, valor_pago: vp != null ? vp : Number(c.valor), nf_ref: p.ref });

  /* freelas: cada conta é um pagamento esperado; um Pix pode cobrir dias seguidos */
  const porPessoa = {};
  (x.freelas || []).forEach(f => {
    if(!f.conta_id || !x.contas[f.conta_id]) return;
    const k = confChave(f.nome); if(!k) return;
    const p = porPessoa[k] || (porPessoa[k] = { nome: f.nome, contas: {} });
    p.nome = f.nome;
    p.contas[f.conta_id] = x.contas[f.conta_id];
  });
  Object.keys(porPessoa).forEach(k => {
    const nome = porPessoa[k].nome;
    const contas = Object.values(porPessoa[k].contas).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
    const meus = pags.filter(p => p.chave === k);
    meus.forEach(p => {
      const ligadas = contas.filter(c => c.nf_ref === p.ref);
      if(ligadas.length){ r.casados.push({ pag: p, contas: ligadas }); p.ok = p.casou = true; }
    });
    meus.filter(p => !p.ok && !usados.has(p.ref)).forEach(p => {
      const livres = contas.filter(c => !c._usada && !c.nf_ref && !(c.pago_em && c.pago_por === "financeiro")
                                      && confDias(c.vencimento, p.data) >= -3 && confDias(c.vencimento, p.data) <= 14);
      let achou = null, perto = null;
      for(let i = 0; i < livres.length && !achou; i++){
        let soma = 0;
        for(let j = i; j < livres.length; j++){
          soma = confR2(soma + valorConta(livres[j]));
          const run = livres.slice(i, j + 1);
          if(Math.abs(soma - p.valor) < 0.01){ achou = run; break; }
          if(!perto && !run.some(c => c.pago_em) && Math.abs(soma - p.valor) <= Math.max(30, p.valor * 0.25)) perto = run;
        }
      }
      if(achou){
        achou.forEach(c => { c._usada = true; ligar(c, p); });
        r.casados.push({ pag: p, contas: achou, novo: true, ja_pago: achou.every(c => c.pago_em) }); p.ok = p.casou = true;
      } else if(perto){
        perto.forEach(c => { c._usada = true; });
        r.valorDif.push({ pag: p, contas: perto, soma: confR2(perto.reduce((s, c) => s + Number(c.valor), 0)) }); p.ok = p.casou = true;
      }
    });
    contas.filter(c => !c.pago_em && !c._usada && confDias(c.vencimento, x.hoje) > 7 && c.vencimento >= mes && c.vencimento <= fimMes)
      .forEach(c => r.esquecidos.push({ nome, conta: c }));
  });

  /* quem ganha por dia: soma do mês contra o que foi pago (até o dia 10 do mês seguinte) */
  (x.diarias || []).forEach(d => {
    const devido = confR2(d.dias.length * d.valor);
    const k = confChave(d.nome);
    const todos = pags.filter(p => p.chave === k);
    todos.forEach(p => { p.ok = true; });
    /* Pix até o dia 10 costuma ser o acerto do mês anterior; ele só conta aqui quando bate com
       dias deste mês marcados como pagos naquela data (mais ou menos 3 dias) */
    const lotes = {};
    (d.pagos || []).forEach(g => { if(g.data >= mes && g.data <= fimMes && g.pago_em) (lotes[g.pago_em] = lotes[g.pago_em] || []).push(g.data); });
    const cedo = todos.filter(p => p.data <= fimMes && Number(p.data.slice(8)) <= 10);
    const anteriores = [];
    cedo.forEach(p => {
      const lote = Object.keys(lotes).find(q => !lotes[q]._usado && Math.abs(confDias(q, p.data)) <= 3 && Math.abs(lotes[q].length * d.valor - p.valor) <= CONF_TOL);
      if(lote){ lotes[lote]._usado = true; p.deste = p.casou = true; } else anteriores.push(p);
    });
    const seus = todos.filter(p => p.deste || p.data > fimMes || Number(p.data.slice(8)) > 10);
    const pago = confR2(seus.reduce((s, p) => s + p.valor, 0));
    /* dias ainda sem Pix só viram aviso depois do dia 10 do mês seguinte, quando o acerto já devia ter saído */
    const fechou = confDias(fimMes, x.hoje) > 10;
    const pagosDias = (d.pagos || []).map(g => g.data).filter(x => d.dias.includes(x));
    const abertos = d.dias.filter(x => !pagosDias.includes(x));
    if(d.dias.length || seus.length) r.diarias.push({ nome: d.nome, valor: d.valor, dias: d.dias.length, devido, pago, pags: seus, anteriores, dif: confR2(pago - devido), fechou,
                                                      abertos, pagosDias, aPagar: confR2(abertos.length * d.valor) });
  });

  /* quem ganha por semana: cada quinzena casada pelo nf_ref, ou pelo valor (até R$ 1) e pela data */
  (x.semanais || []).forEach(s => {
    const k = confChave(s.nome);
    const seus = pags.filter(p => p.chave === k);
    s.contas.slice().sort((a, b) => a.vencimento < b.vencimento ? -1 : 1).forEach(c => {
      const alvo = Number(c.valor_pago != null ? c.valor_pago : c.valor);
      const p = (c.nf_ref && seus.find(q => q.ref === c.nf_ref))
             || seus.find(q => !q.ok && Math.abs(q.valor - alvo) <= CONF_TOL
                         && (c.pago_em ? Math.abs(confDias(c.pago_em, q.data)) <= 3 : confDias(c.vencimento, q.data) >= -3 && confDias(c.vencimento, q.data) <= 10));
      if(p){
        p.ok = p.casou = true;
        if(!c.nf_ref) ligar(c, p, p.valor);
      }
      if(c.vencimento >= mes) r.semanais.push({ nome: s.nome, conta: c, pag: p || null, ligada_agora: !!(p && !c.nf_ref) });
    });
    /* Pix dos primeiros dias do mês seguinte é da quinzena de lá: só entra aqui se casou */
    seus.filter(p => !p.ok).forEach(p => { p.ok = true; if(p.data <= fimMes) r.semRegistro.push(Object.assign({ motivo: s.contas.length ? "quinzena" : "sem_quinzenas" }, p)); });
  });

  /* o que sobrou: Pix sem nada registrado no JB OS */
  pags.filter(p => !p.ok && !usados.has(p.ref)).forEach(p => r.semRegistro.push(p));

  /* duplicado: mesma pessoa (ou mesma descrição), mesmo valor, até 7 dias de distância, e pelo menos
     um dos dois sem dia registrado que o explique (dois fins de semana pagos certinho não é duplicado) */
  const vistos = [], dup = new Set();
  pags.slice().sort((a, b) => a.data < b.data ? -1 : 1).forEach(p => {
    const chave = p.chave || confNorm(p.desc);
    const par = vistos.find(q => (q.chave || confNorm(q.desc)) === chave && Math.abs(q.valor - p.valor) < 0.01 && Math.abs(confDias(q.data, p.data)) <= 7 && !(q.casou && p.casou));
    if(par){ r.duplicados.push([par, p]); if(!par.casou) dup.add(par.ref); if(!p.casou) dup.add(p.ref); }
    vistos.push(p);
  });
  r.semRegistro = r.semRegistro.filter(p => !dup.has(p.ref));
  r.avisos = r.valorDif.length + r.semRegistro.filter(p => p.motivo !== "sem_quinzenas").length + r.duplicados.length + r.esquecidos.length
           + r.diarias.filter(d => d.dif > CONF_TOL || (d.dif < -CONF_TOL && d.fechou)).length
           + r.semanais.filter(s => !s.conta.pago_em && !s.pag && confDias(s.conta.vencimento, x.hoje) > 3).length;
  return r;
}

/* ============================================================
   CARREGAR (Quem veio no ateliê) e marcar o que casou
   ============================================================ */
async function carregarConferencia(mes){
  const ant = mesAnterior(mes), prox = mesSeguinte(mes), fim = ultimoDia(mes);
  const [jm, fr, us, ac, dt, ce, dp] = await Promise.all([
    sb.from("jb_mes").select("mes,detalhe").in("mes", [mes, prox]),
    sb.from("jb_freela").select("nome,data,valor,conta_id").eq("cancelada", false).gte("data", ant).lte("data", fim),
    sb.from("jb_usuario").select("user_id,nome"),
    sb.from("jb_acordo").select("user_id,inicio,fim,regime,valor").lte("inicio", fim).or("fim.is.null,fim.gte." + mes),
    sb.from("jb_dia_trabalhado").select("user_id,data,status").eq("status", "confirmado").gte("data", mes).lte("data", fim),
    /* quinzenas da equipe: as do mês e as do mês anterior (o Pix do começo do mês paga a de lá).
       Vem do Contas a pagar como tipo equipe ou como conta fixa ligada a alguém da equipe. */
    sb.from("jb_conta").select("id,tipo,descricao,valor,valor_pago,vencimento,pago_em,pago_por,nf_ref,equipe_user_id").eq("arquivada", false).gte("vencimento", ant).lte("vencimento", fim),
    sb.from("jb_dia_pago").select("user_id,data,pago_em").gte("data", mes).lte("data", fim)
  ]);
  if(jm.error || fr.error) return null;
  const pagamentos = [];
  (jm.data || []).forEach(m => ((m.detalhe && m.detalhe.grupos) || []).forEach(g => (g.itens || []).forEach(i => {
    if(i.previsto || !i.ref) return;
    if(g.nome === "Pessoas" || g.nome === "Contas fixas") pagamentos.push({ ref: i.ref, data: i.data, desc: i.desc, valor: i.valor, grupo: g.nome });
  })));
  const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
  const freelas = fr.data || [];
  const ids = [...new Set(freelas.map(f => f.conta_id).filter(Boolean))];
  const contas = {};
  if(ids.length){
    const c = await sb.from("jb_conta").select("id,valor,valor_pago,vencimento,pago_em,pago_por,nf_ref").in("id", ids);
    ((c && !c.error && c.data) || []).forEach(k => { contas[k.id] = k; });
  }
  const acordos = (ac && ac.data) || [];
  const daEquipe = ((ce && ce.data) || []).filter(c => c.equipe_user_id && (c.tipo === "equipe" || c.tipo === "fixa"));
  const pagosDia = ((dp && !dp.error && dp.data) || []);
  const diarias = [], semanais = [];
  acordos.forEach(a => {
    const nome = nomes[a.user_id]; if(!nome) return;
    if(a.regime === "diaria" && !diarias.some(d => d.nome === nome))
      diarias.push({ nome, valor: Number(a.valor), dias: ((dt && dt.data) || []).filter(d => d.user_id === a.user_id).map(d => d.data),
                     pagos: pagosDia.filter(g => g.user_id === a.user_id).map(g => ({ data: g.data, pago_em: diaDoPagamento(g.pago_em) })) });
    if(a.regime === "semanal" && !semanais.some(s => s.nome === nome))
      semanais.push({ nome, contas: daEquipe.filter(c => c.equipe_user_id === a.user_id) });
  });
  /* só pagamentos que parecem de gente: o grupo Pessoas inteiro, e das contas fixas só as da equipe */
  const listaNomes = [...new Set(freelas.slice().reverse().map(f => f.nome).concat(Object.values(nomes)))];
  const pags = pagamentos.filter(p => p.grupo === "Pessoas" || confPessoaDoTexto(p.desc, listaNomes));
  return conferirEquipe({ mes, hoje: hojeSP(), pagamentos: pags, nomes: listaNomes, freelas, contas, diarias, semanais });
}

async function aplicarConferencia(r){
  if(!r || !r.marcar.length) return 0;
  let n = 0;
  for(const m of r.marcar){
    /* conta já paga à mão: só guarda qual Pix pagou; o valor e a data que vocês marcaram ficam */
    const campos = m.so_ref ? { nf_ref: m.nf_ref } : { pago_em: m.pago_em, valor_pago: m.valor_pago, pago_por: "financeiro", nf_ref: m.nf_ref };
    const { error } = await sb.from("jb_conta").update(campos).eq("id", m.id);
    if(!error) n++;
  }
  return n;
}

/* confirmar um Pix com valor diferente: as contas viram pagas, a diferença vai na última */
async function confirmarValorDif(item){
  const contas = item.contas, dif = confR2(item.pag.valor - item.soma);
  for(let i = 0; i < contas.length; i++){
    const c = contas[i], ult = i === contas.length - 1;
    const campos = { pago_em: item.pag.data, valor_pago: confR2(Number(c.valor) + (ult ? dif : 0)), pago_por: "financeiro", nf_ref: item.pag.ref };
    if(ult) campos.obs = "Pix de R$ " + moeda(item.pag.valor) + " cobriu " + contas.length + (contas.length === 1 ? " dia" : " dias") + "; diferença de R$ " + moeda(dif) + " confirmada em " + dataCurta(hojeSP()) + ".";
    const { error } = await sb.from("jb_conta").update(campos).eq("id", c.id);
    if(error){ toast("Não consegui salvar", "err"); return; }
  }
  toast("Pagamento confirmado");
  await abrirDias();
}

/* ============================================================
   TELA: cartão em Quem veio no ateliê
   ============================================================ */
function blocoConferencia(){
  const r = CONF;
  const c = sdCard(null, "confCard"); c.classList.add("conf");
  const h = document.createElement("h3"); h.textContent = "Conferência com o Nosso Financeiro"; c.appendChild(h);
  if(!r){ sdTexto(c, "Não consegui conferir agora. Toque em atualizar.", "nota"); return c; }
  const topo = document.createElement("p"); topo.className = "conf-topo " + (r.avisos ? "alerta" : "bom"); topo.id = "confTopo";
  topo.textContent = r.avisos ? r.avisos + (r.avisos === 1 ? " ponto para olhar" : " pontos para olhar") : "Tudo certo: cada Pix bate com os dias registrados.";
  c.appendChild(topo);

  const linha = (cls, titulo, texto, botao) => {
    const d = document.createElement("div"); d.className = "conf-item " + cls;
    const b = document.createElement("b"); b.textContent = titulo;
    const p = document.createElement("p"); p.textContent = texto;
    d.append(b, p);
    if(botao){ const x = document.createElement("button"); x.type = "button"; x.textContent = botao[0]; x.onclick = travar(x, botao[1]); d.appendChild(x); }
    c.appendChild(d);
    return d;
  };
  const dd = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
  const pix = p => "Pix de " + reais(p.valor) + " em " + dd(p.data) + " (\"" + p.desc + "\")";

  r.semRegistro.forEach(p => linha(p.motivo === "sem_quinzenas" ? "ok" : "aviso", p.motivo === "sem_quinzenas" ? "Pix de " + (p.pessoa || "") + " sem quinzena no JB OS" : "Pago sem registro no JB OS",
    pix(p) + (p.motivo === "quinzena" ? ", sem quinzena correspondente." : p.motivo === "sem_quinzenas" ? ". Neste mês ainda não havia quinzenas no JB OS; só para registro." : ". Se foi freela, registre os dias para a bolsa contar."),
    p.motivo ? null : ["Registrar como freela", () => { EQ_FORM = { tipo: "freela", data: p.data, entrada: "", saida: "", nome: (p.pessoa || String(p.desc).split(/[ ,]/)[0]), valor: moeda(p.valor), no_lugar_de: "", obs: "Pago no Nosso Financeiro: " + p.desc }; EQ_CANCELA = null; montarCalendarioDias(); }]));
  r.duplicados.forEach(([a, b]) => linha("aviso", "Possível pagamento duplicado", pix(a) + " e " + pix(b) + ". Mesmo valor em poucos dias"
    + (a.casou || b.casou ? " e só um deles tem dias registrados que o expliquem" : "") + ": confira no Nosso Financeiro se saiu duas vezes. Se foi outro dia de trabalho, registre o dia."));
  r.valorDif.forEach(v => linha("aviso", "Valor diferente: " + (v.pag.pessoa || ""), pix(v.pag) + " para " + v.contas.length + (v.contas.length === 1 ? " dia registrado" : " dias registrados") + " que somam " + reais(v.soma) + ". Diferença de " + reais(confR2(v.pag.valor - v.soma)) + ".",
    ["Confirmar (hora extra ou acerto)", () => confirmarValorDif(v)]));
  r.esquecidos.forEach(e => linha("aviso", "Registrado e ainda sem Pix", e.nome + ", " + dd(e.conta.vencimento) + ", " + reais(e.conta.valor) + ". Passou de 7 dias e não achei o pagamento no Nosso Financeiro."));
  /* diarista sem dias fixos: o que importa é o que está em aberto agora */
  r.diarias.forEach(d => {
    const ok = Math.abs(d.dif) <= CONF_TOL || (d.dif < 0 && !d.fechou);
    const abertos = d.abertos || [], pagosDias = d.pagosDias || [];
    const titulo = d.nome + ": " + (abertos.length ? "falta pagar " + reais(d.aPagar) : "nada em aberto");
    const pixTx = d.pags.length ? "Pix de " + d.pags.map(p => reais(p.valor) + " em " + dd(p.data)).join(" e ") : "";
    linha(ok ? "ok" : "aviso", titulo,
      (abertos.length ? "Em aberto: " + listaDiasTx(abertos) + " (" + abertos.length + " × " + reais(d.valor) + "). " : "")
      + (pagosDias.length ? "Já pagos: " + listaDiasTx(pagosDias) + (pixTx ? ", " + pixTx : "") + ". " : (pixTx ? pixTx + " no Financeiro. " : ""))
      + (d.anteriores && d.anteriores.length ? (d.anteriores.length === 1 ? "O Pix de " : "Os Pix de ") + d.anteriores.map(p => reais(p.valor) + " em " + dd(p.data)).join(" e ")
          + (d.anteriores.length === 1 ? " é o acerto do mês anterior. " : " são o acerto do mês anterior. ") : "")
      + (d.dif > CONF_TOL ? "Pagou " + reais(d.dif) + " a mais que os dias registrados: falta registrar dia, ou foi acerto."
         : d.dif < -CONF_TOL && d.fechou ? "Já passou do dia 10 do mês seguinte e ainda faltam " + reais(-d.dif) + "."
         : abertos.length ? "O acerto pode sair até o dia 10 do mês seguinte." : ""));
  });
  r.semanais.forEach(s => {
    const vence = s.conta.vencimento;
    const st = s.conta.pago_em ? "paga em " + dd(s.conta.pago_em) + (s.pag ? " (" + pix(s.pag) + ")" : "") : confDias(vence, hojeSP()) > 3 ? "vencida e sem Pix no Financeiro" : "vence " + dd(vence);
    linha(s.conta.pago_em ? "ok" : (confDias(vence, hojeSP()) > 3 ? "aviso" : "ok"), s.conta.descricao || s.nome, st + ".");
  });
  if(r.casados.length){
    const d = linha("ok", r.casados.length + (r.casados.length === 1 ? " Pix de freela conferido" : " Pix de freela conferidos"),
      r.casados.map(k => (k.pag.pessoa || "") + " " + reais(k.pag.valor) + " em " + dd(k.pag.data) + (k.novo ? (k.ja_pago ? " (ligado ao dia pago)" : " (marcado como pago agora)") : "")).join(" · "));
    d.id = "confCasados";
  }
  sdTexto(c, "Quem trabalhou e em que dia fica aqui; o Pix fica no Nosso Financeiro. O que casa vira pago sozinho; o resto aparece acima. Correção de lançamento é no Nosso Financeiro.", "nota");
  return c;
}
