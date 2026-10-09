/* JB OS · bolsa de ajuda extra do mês. Só gestor.
   O que é obrigatório fica fora da bolsa: alguém à noite todos os dias e o domingo
   (hoje a Yasmin, já nas contas fixas). A bolsa paga o resto: os dias da Eliana e os freelas.
   Tamanho: uma fatia (jb_parametro.bolsa_fatia, hoje 50%) do que sobrou no mês anterior
   antes da ajuda extra. Cada dia da Eliana confirmado e cada freela registrada tira da bolsa;
   falta da Yasmin descontada devolve. */

let BOLSA_BASE = null;   // { mes, base, antesExtra, fatia, total, freela }

function mesSeguinte(iso){
  const [a, m] = iso.split("-").map(Number);
  return (m === 12 ? (a + 1) + "-01" : a + "-" + String(m + 1).padStart(2, "0")) + "-01";
}

/* conta pura: a bolsa, o que já saiu dela e o que sobra */
function bolsaCalcular(base, gasto){
  const r2b = v => Math.round(v * 100) / 100;
  const total = base ? base.total : 0;
  const freela = base && base.freela ? base.freela : 120;
  const itens = (gasto && gasto.itens) || [];
  const saiu = r2b(itens.reduce((s, i) => s + Number(i.valor || 0), 0));
  const volta = r2b(Number((gasto && gasto.devolvido) || 0));
  const disponivel = r2b(total - saiu + volta);
  return { total, saiu, volta, disponivel, itens, freela,
           noites: Math.max(0, Math.floor(disponivel / freela)),
           usadoPct: total > 0 ? Math.min(1, Math.max(0, (saiu - volta) / total)) : (saiu > volta ? 1 : 0) };
}

/* a base da bolsa de um mês: o que sobrou no mês anterior, antes da Eliana e dos freelas */
async function carregarBolsaBase(mes){
  const base = mesAnterior(mes);
  const [dd, cf, pr, us] = await Promise.all([
    sb.from("jb_kpi_destino").select("mes,bruto_estimado,app,imposto,ingrediente"),
    sb.from("jb_custo_fixo_calculado").select("origem,nome,valor"),
    sb.from("jb_parametro").select("chave,valor"),
    sb.from("jb_usuario").select("user_id,nome")
  ]);
  const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
  if(dd.error || cf.error) return null;
  const param = {}; ((pr && pr.data) || []).forEach(p => { param[p.chave] = Number(p.valor); });
  const fatia = param.bolsa_fatia != null ? param.bolsa_fatia : 0.5;
  const freela = param.freela_noite || 120;
  const D = (dd.data || []).find(d => d.mes === base && Number(d.bruto_estimado) > 0);
  if(!D) return { mes, base, antesExtra: null, fatia, total: 0, freela, nomes, semDado: true };
  const L = saudeLucroMes(D, cf.data || []);
  const total = Math.round(Math.max(0, L.antesExtra) * fatia * 100) / 100;
  return { mes, base, antesExtra: L.antesExtra, fatia, total, freela, nomes, margemPct: L.bruto > 0 ? L.margem / L.bruto : null };
}

/* o que saiu da bolsa num mês, direto do banco (Home e Saúde do negócio) */
async function bolsaGastoMes(mes){
  const ini = mes, fim = ultimoDia(mes);
  const [ac, dt, fr, fa, us] = await Promise.all([
    sb.from("jb_acordo").select("user_id,inicio,fim,regime,valor").lte("inicio", fim).or("fim.is.null,fim.gte." + ini),
    sb.from("jb_dia_trabalhado").select("user_id,data,status").eq("status", "confirmado").gte("data", ini).lte("data", fim),
    sb.from("jb_freela").select("valor,data").eq("cancelada", false).gte("data", ini).lte("data", fim),
    sb.from("jb_falta").select("valor_desconto,desconta,data").eq("cancelada", false).gte("data", ini).lte("data", fim),
    sb.from("jb_usuario").select("user_id,nome")
  ]);
  if(ac.error || dt.error) return null;
  const nomes = {}; ((us && us.data) || []).forEach(u => { nomes[u.user_id] = u.nome; });
  return bolsaItens((ac.data || []), (dt.data || []), (fr && fr.data) || [], (fa && fa.data) || [], u => nomes[u] || "Pessoa");
}

/* junta os itens: dias de quem ganha por diária, freelas e as faltas descontadas */
function bolsaItens(acordos, dias, freelas, faltas, nomeDe){
  const porPessoa = {};
  dias.filter(d => d.status === "confirmado").forEach(d => {
    const a = acordos.find(x => x.user_id === d.user_id && x.inicio <= d.data && (!x.fim || x.fim >= d.data));
    if(!a || a.regime !== "diaria") return;
    const p = porPessoa[d.user_id] || (porPessoa[d.user_id] = { nome: nomeDe(d.user_id), valor: 0, n: 0, diaria: Number(a.valor) });
    p.valor += Number(a.valor); p.n++;
  });
  const itens = Object.values(porPessoa).map(p => ({ nome: p.nome, valor: Math.round(p.valor * 100) / 100,
    detalhe: p.n + (p.n === 1 ? " dia" : " dias") + " × R$ " + moeda(p.diaria) }));
  const fr = freelas.filter(f => !f.cancelada);
  if(fr.length) itens.push({ nome: "Freelas", valor: Math.round(fr.reduce((s, f) => s + Number(f.valor || 0), 0) * 100) / 100,
    detalhe: fr.length + (fr.length === 1 ? " noite" : " noites") });
  const devolvido = Math.round(faltas.filter(f => f.desconta && !f.cancelada).reduce((s, f) => s + Number(f.valor_desconto || 0), 0) * 100) / 100;
  return { itens, devolvido };
}

const bolsaNome = u => (BOLSA_BASE && BOLSA_BASE.nomes && BOLSA_BASE.nomes[u]) || eqNome(u);

/* cartão no topo de Quem veio no ateliê: usa o que a tela já carregou */
function blocoBolsa(){
  const c = sdCard(null, "bolsaCard"); c.classList.add("bolsa");
  const m = mesLongo(DIAS_MES).split(" ")[0].toLowerCase();
  const B0 = BOLSA_BASE;
  const g = bolsaItens(ACORDOS, DIAS, FREELAS, FALTAS, bolsaNome);
  const B = bolsaCalcular(B0, g);
  const h = document.createElement("h3"); h.textContent = "Bolsa de ajuda extra · " + m; c.appendChild(h);

  const topo = document.createElement("div"); topo.className = "bolsa-topo" + (B.disponivel < 0 ? " neg" : "");
  const v = document.createElement("b"); v.id = "bolsaDisp"; v.textContent = reais(B.disponivel);
  const sm = document.createElement("span");
  sm.textContent = B.disponivel < 0 ? "passou da bolsa: sai do lucro" : "disponível · " + B.noites + (B.noites === 1 ? " noite" : " noites") + " de freela de R$ " + moeda(B.freela);
  topo.append(v, sm); c.appendChild(topo);
  const barra = document.createElement("div"); barra.className = "bolsa-barra";
  const i = document.createElement("i"); i.style.width = Math.round(B.usadoPct * 100) + "%"; barra.appendChild(i); c.appendChild(barra);

  if(!B0 || B0.semDado){
    sdTexto(c, "Ainda não há mês anterior fechado com venda para calcular a bolsa.", "nota");
  } else {
    const mb = mesLongo(B0.base).split(" ")[0].toLowerCase();
    sdLinha(c, "Bolsa do mês", reais(B.total), null, ["Bolsa do mês", [pct(B0.fatia) + " do que sobrou em " + mb + " depois das contas fixas, antes da ajuda extra.", "O resto fica de lucro, como reserva."],
      reais(B0.antesExtra) + " × " + pct(B0.fatia) + " = " + reais(B.total)]);
  }
  B.itens.forEach(x => sdLinha(c, "− " + x.nome, reais(x.valor), "sai", [x.nome, [x.detalhe + ". Sai da bolsa assim que é confirmado ou registrado."]]));
  if(B.volta > 0) sdLinha(c, "+ Faltas descontadas", reais(B.volta), "bom", ["Faltas descontadas", ["O desconto das faltas da Yasmin volta para a bolsa e paga quem cobriu."]]);
  if(B0 && B0.margemPct > 0){
    const venda = Math.round(B.freela / B0.margemPct * 100) / 100;
    sdLinha(c, "1 diária de R$ " + moeda(B.freela) + " pede", reais(venda) + " de venda", null, ["Venda que paga uma diária",
      ["De cada R$ 100 vendidos, sobram R$ " + moeda(B0.margemPct * 100) + " depois de app, imposto e ingrediente (medido em " + mesLongo(B0.base).split(" ")[0].toLowerCase() + ")."],
      "R$ " + moeda(B.freela) + " ÷ " + pct(B0.margemPct) + " = " + reais(venda)]);
  }
  sdTexto(c, "Fora da bolsa, sempre: alguém à noite todos os dias e o domingo. Isso já está nas contas fixas.", "nota");
  return c;
}

/* resumo para o botão da Home */
async function resumoBolsaHome(){
  const mes = primeiroDia(hojeSP());
  const [b, g] = await Promise.all([carregarBolsaBase(mes), bolsaGastoMes(mes)]);
  if(!b || !g || b.semDado) return null;
  const B = bolsaCalcular(b, g);
  return { disponivel: B.disponivel, noites: B.noites };
}
