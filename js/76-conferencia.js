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
function confPessoaDoTexto(texto, nomes){
  const palavras = confNorm(texto).split(/[^a-z]+/).filter(Boolean);
  return nomes.find(n => { const p = confNorm(n).split(/[^a-z]+/)[0]; return p && palavras.includes(p); }) || null;
}
const confDias = (a, b) => Math.round((Date.UTC(...b.split("-").map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...a.split("-").map((x, i) => i === 1 ? x - 1 : +x))) / 864e5);
const confR2 = v => Math.round(v * 100) / 100;

/* ============================================================
   A CONTA (pura, testável)
   x = { mes, hoje, pagamentos:[{ref,data,desc,valor}], nomes:[...],
         freelas:[{nome,data,valor,conta_id}], contas:{id:{id,valor,vencimento,pago_em,nf_ref}},
         diarias:[{nome,valor,dias:[iso]}], semanais:[{nome, contas:[{id,valor,vencimento,pago_em,nf_ref,descricao}]}] }
   ============================================================ */
function conferirEquipe(x){
  const mes = x.mes, fimMes = ultimoDia(mes);
  const limite = (() => { const d = new Date(fimMes + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); })();
  const nomes = x.nomes || [];
  const pags = (x.pagamentos || []).filter(p => p.ref && p.data >= mes && p.data <= limite)
    .map(p => Object.assign({}, p, { valor: Number(p.valor), pessoa: confPessoaDoTexto(p.desc, nomes) }));
  const usados = new Set();
  Object.values(x.contas || {}).forEach(c => { if(c.nf_ref) usados.add(c.nf_ref); });
  (x.semanais || []).forEach(s => s.contas.forEach(c => { if(c.nf_ref) usados.add(c.nf_ref); }));
  const r = { casados: [], marcar: [], valorDif: [], semRegistro: [], duplicados: [], esquecidos: [], diarias: [], semanais: [] };

  /* freelas: cada conta é um pagamento esperado; um Pix pode cobrir dias seguidos */
  const porPessoa = {};
  (x.freelas || []).forEach(f => {
    if(!f.conta_id || !x.contas[f.conta_id]) return;
    const p = porPessoa[f.nome] || (porPessoa[f.nome] = {});
    p[f.conta_id] = x.contas[f.conta_id];
  });
  Object.keys(porPessoa).forEach(nome => {
    const contas = Object.values(porPessoa[nome]).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
    const meus = pags.filter(p => p.pessoa === nome);
    meus.forEach(p => {
      const ligadas = contas.filter(c => c.nf_ref === p.ref);
      if(ligadas.length){ r.casados.push({ pag: p, contas: ligadas }); p.ok = true; }
    });
    meus.filter(p => !p.ok && !usados.has(p.ref)).forEach(p => {
      const abertas = contas.filter(c => !c.pago_em && !c._usada && confDias(c.vencimento, p.data) >= -3 && confDias(c.vencimento, p.data) <= 14);
      let achou = null, perto = null;
      for(let i = 0; i < abertas.length && !achou; i++){
        let soma = 0;
        for(let j = i; j < abertas.length; j++){
          soma = confR2(soma + Number(abertas[j].valor));
          const run = abertas.slice(i, j + 1);
          if(Math.abs(soma - p.valor) < 0.01){ achou = run; break; }
          if(!perto && Math.abs(soma - p.valor) <= Math.max(30, p.valor * 0.25)) perto = run;
        }
      }
      if(achou){
        achou.forEach(c => { c._usada = true; r.marcar.push({ id: c.id, pago_em: p.data, valor_pago: Number(c.valor), nf_ref: p.ref }); });
        r.casados.push({ pag: p, contas: achou, novo: true }); p.ok = true;
      } else if(perto){
        perto.forEach(c => { c._usada = true; });
        r.valorDif.push({ pag: p, contas: perto, soma: confR2(perto.reduce((s, c) => s + Number(c.valor), 0)) }); p.ok = true;
      }
    });
    contas.filter(c => !c.pago_em && !c._usada && confDias(c.vencimento, x.hoje) > 7 && c.vencimento >= mes && c.vencimento <= fimMes)
      .forEach(c => r.esquecidos.push({ nome, conta: c }));
  });

  /* quem ganha por dia: soma do mês contra o que foi pago (até o dia 10 do mês seguinte) */
  (x.diarias || []).forEach(d => {
    const devido = confR2(d.dias.length * d.valor);
    /* Pix até o dia 10 é acerto do mês anterior; ele fica fora daqui e não vira aviso */
    const todos = pags.filter(p => p.pessoa === d.nome);
    todos.forEach(p => { p.ok = true; });
    const seus = todos.filter(p => p.data > fimMes || Number(p.data.slice(8)) > 10);
    const pago = confR2(seus.reduce((s, p) => s + p.valor, 0));
    /* dias ainda sem Pix só viram aviso depois do dia 10 do mês seguinte, quando o acerto já devia ter saído */
    const fechou = confDias(fimMes, x.hoje) > 10;
    if(d.dias.length || seus.length) r.diarias.push({ nome: d.nome, valor: d.valor, dias: d.dias.length, devido, pago, pags: seus, dif: confR2(pago - devido), fechou });
  });

  /* quem ganha por semana: cada quinzena casada pelo nf_ref; Pix sem quinzena vira aviso */
  (x.semanais || []).forEach(s => {
    const seus = pags.filter(p => p.pessoa === s.nome);
    s.contas.forEach(c => {
      /* pela referência; se a quinzena foi marcada antes da referência existir, pelo valor e pela data */
      const p = seus.find(q => q.ref === c.nf_ref)
             || seus.find(q => !q.ok && Math.abs(q.valor - Number(c.valor_pago != null ? c.valor_pago : c.valor)) < 0.01
                         && (c.pago_em ? Math.abs(confDias(c.pago_em, q.data)) <= 3 : confDias(c.vencimento, q.data) >= -3 && confDias(c.vencimento, q.data) <= 10));
      if(p) p.ok = true;
      r.semanais.push({ nome: s.nome, conta: c, pag: p || null });
    });
    /* Pix dos primeiros dias do mês seguinte é da quinzena de lá: só entra aqui se casou */
    seus.filter(p => !p.ok).forEach(p => { p.ok = true; if(p.data <= fimMes) r.semRegistro.push(Object.assign({ motivo: s.contas.length ? "quinzena" : "sem_quinzenas" }, p)); });
  });

  /* o que sobrou: Pix sem nada registrado no JB OS */
  pags.filter(p => !p.ok && !usados.has(p.ref)).forEach(p => r.semRegistro.push(p));

  /* duplicado: mesma pessoa (ou mesma descrição), mesmo valor, até 7 dias de distância */
  const vistos = [];
  pags.slice().sort((a, b) => a.data < b.data ? -1 : 1).forEach(p => {
    const chave = p.pessoa || confNorm(p.desc);
    const par = vistos.find(q => (q.pessoa || confNorm(q.desc)) === chave && Math.abs(q.valor - p.valor) < 0.01 && Math.abs(confDias(q.data, p.data)) <= 7);
    if(par) r.duplicados.push([par, p]);
    vistos.push(p);
  });
  r.avisos = r.valorDif.length + r.semRegistro.filter(p => p.motivo !== "sem_quinzenas").length + r.duplicados.length + r.esquecidos.length
           + r.diarias.filter(d => d.dif > 1 || (d.dif < -1 && d.fechou)).length
           + r.semanais.filter(s => !s.conta.pago_em && confDias(s.conta.vencimento, x.hoje) > 3).length;
  return r;
}

/* ============================================================
   CARREGAR (Quem veio no ateliê) e marcar o que casou
   ============================================================ */
async function carregarConferencia(mes){
  const ant = mesAnterior(mes), prox = mesSeguinte(mes), fim = ultimoDia(mes);
  const [jm, fr, us, ac, dt, ce] = await Promise.all([
    sb.from("jb_mes").select("mes,detalhe").in("mes", [mes, prox]),
    sb.from("jb_freela").select("nome,data,valor,conta_id").eq("cancelada", false).gte("data", ant).lte("data", fim),
    sb.from("jb_usuario").select("user_id,nome"),
    sb.from("jb_acordo").select("user_id,inicio,fim,regime,valor").lte("inicio", fim).or("fim.is.null,fim.gte." + mes),
    sb.from("jb_dia_trabalhado").select("user_id,data,status").eq("status", "confirmado").gte("data", mes).lte("data", fim),
    sb.from("jb_conta").select("id,descricao,valor,vencimento,pago_em,nf_ref,equipe_user_id").eq("tipo", "equipe").eq("arquivada", false).gte("vencimento", mes).lte("vencimento", fim)
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
    const c = await sb.from("jb_conta").select("id,valor,vencimento,pago_em,nf_ref").in("id", ids);
    ((c && !c.error && c.data) || []).forEach(k => { contas[k.id] = k; });
  }
  const acordos = (ac && ac.data) || [];
  const diarias = [], semanais = [];
  acordos.forEach(a => {
    const nome = nomes[a.user_id]; if(!nome) return;
    if(a.regime === "diaria") diarias.push({ nome, valor: Number(a.valor), dias: ((dt && dt.data) || []).filter(d => d.user_id === a.user_id).map(d => d.data) });
    if(a.regime === "semanal" && !semanais.some(s => s.nome === nome))
      semanais.push({ nome, contas: ((ce && ce.data) || []).filter(c => c.equipe_user_id && c.equipe_user_id === a.user_id) });
  });
  /* só pagamentos que parecem de gente: o grupo Pessoas inteiro, e das contas fixas só as da equipe */
  const listaNomes = [...new Set(freelas.map(f => f.nome).concat(Object.values(nomes)))];
  const pags = pagamentos.filter(p => p.grupo === "Pessoas" || confPessoaDoTexto(p.desc, listaNomes));
  return conferirEquipe({ mes, hoje: hojeSP(), pagamentos: pags, nomes: listaNomes, freelas, contas, diarias, semanais });
}

async function aplicarConferencia(r){
  if(!r || !r.marcar.length) return 0;
  let n = 0;
  for(const m of r.marcar){
    const { error } = await sb.from("jb_conta").update({ pago_em: m.pago_em, valor_pago: m.valor_pago, pago_por: "financeiro", nf_ref: m.nf_ref }).eq("id", m.id);
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
  r.duplicados.forEach(([a, b]) => linha("aviso", "Possível pagamento duplicado", pix(a) + " e " + pix(b) + ". Mesmo valor em poucos dias: confira no Nosso Financeiro."));
  r.valorDif.forEach(v => linha("aviso", "Valor diferente: " + (v.pag.pessoa || ""), pix(v.pag) + " para " + v.contas.length + (v.contas.length === 1 ? " dia registrado" : " dias registrados") + " que somam " + reais(v.soma) + ". Diferença de " + reais(confR2(v.pag.valor - v.soma)) + ".",
    ["Confirmar (hora extra ou acerto)", () => confirmarValorDif(v)]));
  r.esquecidos.forEach(e => linha("aviso", "Registrado e ainda sem Pix", e.nome + ", " + dd(e.conta.vencimento) + ", " + reais(e.conta.valor) + ". Passou de 7 dias e não achei o pagamento no Nosso Financeiro."));
  r.diarias.forEach(d => {
    const ok = Math.abs(d.dif) <= 1 || (d.dif < 0 && !d.fechou);
    linha(ok ? "ok" : "aviso", d.nome + ": " + d.dias + (d.dias === 1 ? " dia" : " dias") + " × " + reais(d.valor) + " = " + reais(d.devido),
      (d.pags.length ? "Pago no Financeiro: " + d.pags.map(p => reais(p.valor) + " em " + dd(p.data)).join(" + ") + " = " + reais(d.pago) + ". " : "Nenhum Pix ainda. ")
      + (Math.abs(d.dif) <= 1 ? "Bate." : d.dif < 0 && !d.fechou ? "Faltam " + reais(-d.dif) + " a pagar; o acerto pode sair até o dia 10 do mês seguinte." : d.dif > 0 ? "Pagou " + reais(d.dif) + " a mais que os dias registrados: falta registrar dia, ou foi acerto." : "Faltam " + reais(-d.dif) + " para pagar os dias registrados."));
  });
  r.semanais.forEach(s => {
    const vence = s.conta.vencimento;
    const st = s.conta.pago_em ? "paga em " + dd(s.conta.pago_em) + (s.pag ? " (" + pix(s.pag) + ")" : "") : confDias(vence, hojeSP()) > 3 ? "vencida e sem Pix no Financeiro" : "vence " + dd(vence);
    linha(s.conta.pago_em ? "ok" : (confDias(vence, hojeSP()) > 3 ? "aviso" : "ok"), s.conta.descricao || s.nome, st + ".");
  });
  if(r.casados.length){
    const d = linha("ok", r.casados.length + (r.casados.length === 1 ? " Pix de freela conferido" : " Pix de freela conferidos"),
      r.casados.map(k => (k.pag.pessoa || "") + " " + reais(k.pag.valor) + " em " + dd(k.pag.data) + (k.novo ? " (marcado como pago agora)" : "")).join(" · "));
    d.id = "confCasados";
  }
  sdTexto(c, "Quem trabalhou e em que dia fica aqui; o Pix fica no Nosso Financeiro. O que casa vira pago sozinho; o resto aparece acima. Correção de lançamento é no Nosso Financeiro.", "nota");
  return c;
}
