/* Banco falso do JB OS para os testes.
   Um stub só, com a semântica que o app usa: from().select().eq().in()..., rpc(), auth.
   Emula o RLS por papel do jeito que o banco de verdade faz. */

const hojeSP = (agora) => new Intl.DateTimeFormat("en-CA",
  { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora ? new Date(agora) : new Date());

function diaMais(iso, n){
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

const USUARIOS = {
  uJes: { user_id: "uJes", nome: "Jessica", papel: "gestor",   ativo: true },
  uHen: { user_id: "uHen", nome: "Henrique", papel: "gestor",  ativo: true },
  uYas: { user_id: "uYas", nome: "Yasmin",  papel: "equipe",   ativo: true },
  uEli: { user_id: "uEli", nome: "Eliana",  papel: "producao", ativo: true }
};

/* Base pequena e coerente: 3 produtos, 2 fichas, 1 sub-receita, 4 canais. */
function baseDB(agora){
  const hoje = hojeSP(agora);
  const mes = hoje.slice(0, 7) + "-01";
  return {
    jb_usuario: Object.values(USUARIOS),
    jb_produto: [
      { id: 1, nome: "Brownie Brigadeiro", ordem: 1, ativo: true,  foto_url: null },
      { id: 2, nome: "Bolo Gelado Supreme", ordem: 2, ativo: true, foto_url: null },
      { id: 3, nome: "Pudim", ordem: 3, ativo: true, foto_url: null },
      { id: 4, nome: "Torta antiga", ordem: 4, ativo: false, foto_url: null }
    ],
    jb_contagem: [],
    jb_contagem_item: [],
    jb_adendo: [],
    jb_ficha: [
      { id: 10, nome: "Brownie Brigadeiro", produto_id: 1, rendimento_un: 24, tempo_mo_min: 60, rascunho: false, modo_preparo: "Misture tudo", preparo_conferido: false, foto_url: null, ativo: true },
      { id: 11, nome: "Pudim", produto_id: 3, rendimento_un: 10, tempo_mo_min: 30, rascunho: true, modo_preparo: null, preparo_conferido: false, foto_url: null, ativo: true }
    ],
    jb_ficha_item: [
      { ficha_id: 10, ordem: 1, ingrediente: "Chocolate 50%", unidade: "g",  qtd: 500 },
      { ficha_id: 10, ordem: 2, ingrediente: "Ovos",          unidade: "un", qtd: 6 },
      { ficha_id: 10, ordem: 3, ingrediente: "Massa Brownie", unidade: "kg", qtd: 1 }
    ],
    jb_subreceita: [
      { id: 20, nome: "Massa Brownie", rendimento_kg: 2.5, custo_kg: 30, ativo: true, modo_preparo: "Bata", preparo_conferido: true },
      { id: 21, nome: "Creme de Ninho", rendimento_kg: 1.0, custo_kg: 40, ativo: true, modo_preparo: "Bata", preparo_conferido: true }
    ],
    jb_subreceita_item: [
      { subreceita_id: 20, ordem: 1, ingrediente: "Chocolate 50%", unidade: "g", qtd: 800 }
    ],
    jb_insumo: [
      { id: 100, nome: "Chocolate 50%", unidade: "kg", custo_unit: 40, fornecedor: "Distribuidora", categoria: "ingrediente", equiv_g: null, ativo: true,
        no_estoque: true, local: "secos", emb_nome: "pacote 2,05kg", emb_qtd: 2.05, cobertura_semanas: 2, consumo_semana_manual: 3,
        foto_url: "img/insumos/chocolate-blend-melken.jpg" },
      { id: 101, nome: "Ovos",          unidade: "un", custo_unit: 0.72, fornecedor: "Granja", categoria: "ingrediente", equiv_g: null, ativo: true,
        no_estoque: true, local: "secos", emb_nome: null, emb_qtd: null, cobertura_semanas: 2, consumo_semana_manual: 100 },
      { id: 102, nome: "Açúcar",        unidade: "kg", custo_unit: 2.69, fornecedor: null, categoria: "ingrediente", equiv_g: null, ativo: true,
        no_estoque: false, cobertura_semanas: 2 }
    ],
    jb_estoque_contagem: [],
    jb_estoque_item: [],
    jb_uso_ingrediente: [{ nome: "Chocolate 50%", em_fichas: 1, em_subreceitas: 1 }, { nome: "Ovos", em_fichas: 1, em_subreceitas: 0 }],
    jb_insumo_ultimo_pago: [
      { insumo_id: 102, compra_item_id: 12, data: hoje, fornecedor: "Atacadão", custo_base: 2.89, unidade_base: "kg" }
    ],
    jb_canal: [
      { id: 1, nome: "Próprio", ordem: 1, taxa: 0,    promo: 0,    ativo: true, taxa_efetiva: null, taxa_efetiva_em: null },
      { id: 2, nome: "iFood",   ordem: 2, taxa: 0.30, promo: 0.15, ativo: true, taxa_efetiva: null, taxa_efetiva_em: null },
      { id: 3, nome: "99Food",  ordem: 3, taxa: 0.27, promo: 0.47, ativo: true, taxa_efetiva: null, taxa_efetiva_em: null, vale_fatia: 0.0455, vale_fatia_em: hoje },
      { id: 9, nome: "Vale-refeição", ordem: 50, taxa: 0, promo: 0, ativo: false, taxa_efetiva: null, taxa_efetiva_em: null, vale_fatia: 0 }
    ],
    jb_vale_taxa: [
      { operadora: "Pluxee", taxa: 0.1516, taxa_contrato: 0.053, medido_em: hoje, antecipacao: true, modalidades: 2 }
    ],
    jb_config: [
      { chave: "custo_fixo_mes", valor: 8846.98 }, { chave: "volume_mes", valor: 1700 },
      { chave: "custo_hora", valor: 17.5 }, { chave: "perdas_pct", valor: 0.05 },
      { chave: "margem_alvo", valor: 0.2 }, { chave: "pro_labore_mes", valor: 2500 },
      { chave: "imposto_pct", valor: 0.05 }, { chave: "volume_min_dias", valor: 7 }
    ],
    jb_custo_fixo_item: [{ id: 1, nome: "Aluguel do ateliê (metade)", valor: 1916.11, ordem: 10, ativo: true, obs: null }],
    jb_custo_fixo_calculado: [
      { origem: "item", nome: "Aluguel do ateliê (metade)", valor: 1916.11, ordem: 10, obs: null, item_id: 1 },
      { origem: "folha", nome: "Folha: Yasmin", valor: 3683.33, ordem: 900, obs: "Acordo semanal de R$ 850.00", item_id: null },
      { origem: "pro_labore", nome: "Pró-labore da Jessica", valor: 2500, ordem: 950, obs: null, item_id: null }
    ],
    jb_custo_fixo_total: [{ total: 8099.44, folha: 3683.33, contas: 1916.11, pro_labore: 2500 }],
    jb_volume_calculado: [{ volume: 1700, dias_de_contagem: 1, origem: "cadastro", media_dia: 32,
      min_dias: 7, volume_real: 960, volume_cadastro: 1700 }],
    jb_giro_produto: [
      { ficha_id: 10, produto: "Brownie Brigadeiro", nome_na_contagem: "Brownie Classico",
        vendeu: 60, perdeu: 2, dias: 12,
        inconsistente: false, por_dia: 5, por_mes: 150, fatia: 0.4, perda_pct: 0.032 }
    ],
    jb_preco: [
      { ficha_id: 10, canal_id: 1, preco: 18 }, { ficha_id: 10, canal_id: 2, preco: 22 }
    ],
    jb_margem: [
      { ficha_id: 10, produto: "Brownie Brigadeiro", rascunho: false, canal_id: 1, preco: 18, custo_total: 12, custo_fixo_un: 5.43, cmv: 6 },
      { ficha_id: 10, produto: "Brownie Brigadeiro", rascunho: false, canal_id: 2, preco: 22, custo_total: 12, custo_fixo_un: 5.43, cmv: 6 },
      { ficha_id: 10, produto: "Brownie Brigadeiro", rascunho: false, canal_id: 3, preco: null, custo_total: 12, custo_fixo_un: 5.43, cmv: 6 },
      { ficha_id: 11, produto: "Pudim", rascunho: true, canal_id: 1, preco: null, custo_total: 9, custo_fixo_un: 5.43, cmv: 4 }
    ],
    jb_promo_teto: [
      { produto: "Bolo Gelado Supreme", canal: "99Food", canal_ordem: 30, preco: 26.98, cmv: 5.07, custo_fixo_un: 4.94,
        teto: 0.3298, lucro_20: 3.51, lucro_25: 2.16, lucro_30: 0.81, lucro_40: -1.89 },
      { produto: "Cookie Nutella", canal: "99Food", canal_ordem: 30, preco: 22.90, cmv: 5.20, custo_fixo_un: 4.94,
        teto: 0.2576, lucro_20: 1.33, lucro_25: 0.19, lucro_30: -0.96, lucro_40: -3.25 },
      { produto: "Potinho Brigadeiro Cremoso", canal: "99Food", canal_ordem: 30, preco: 10.99, cmv: 4.08, custo_fixo_un: 4.94,
        teto: -0.1802, lucro_20: -4.25, lucro_25: -4.79, lucro_30: -5.34, lucro_40: -6.44 },
      { produto: "Bolo Gelado Supreme", canal: "iFood", canal_ordem: 20, preco: 27.80, cmv: 5.07, custo_fixo_un: 4.94,
        teto: 0.4111, lucro_20: 5.32, lucro_25: 3.93, lucro_30: 2.54, lucro_40: -0.24 }
    ],
    jb_pendencias: [
      { grupo: "taxa", ordem: 10, texto: "Medir a taxa efetiva do iFood", dica: "Pegue um repasse", qtd: 1 },
      { grupo: "contagem", ordem: 20, texto: "6 dias sem nenhuma contagem nos últimos 7", dica: "Dias: 01/09", qtd: 6 },
      { grupo: "receita", ordem: 30, texto: "23 receitas sem passo a passo conferido", dica: "", qtd: 23 }
    ],
    jb_producao_item: [
      { id: 1, data: hoje, tipo: "ficha", ref_id: 10, qtd: 48, feito: false, feito_em: null, obs: null, para: "todos", criado_em: hoje + "T10:00:00Z" },
      { id: 2, data: hoje, tipo: "subreceita", ref_id: 20, qtd: 3, feito: false, feito_em: null, obs: null, para: "producao", criado_em: hoje + "T10:05:00Z" },
      { id: 3, data: hoje, tipo: "ficha", ref_id: 11, qtd: 5, feito: false, feito_em: null, obs: null, para: "equipe", criado_em: hoje + "T10:06:00Z" }
    ],
    jb_perda: [],
    jb_tarefa: [],
    jb_acordo: [
      { id: 1, user_id: "uEli", inicio: "2026-01-01", fim: null, regime: "diaria", valor: 140, dias_semana: [4, 5], turno: "dia", obs: null, a_confirmar: false },
      { id: 3, user_id: "uYas", inicio: "2026-09-01", fim: null, regime: "semanal", valor: 850, dias_semana: [0, 1, 2, 3, 4, 5, 6], turno: "noite", obs: null, a_confirmar: false }
    ],
    jb_dia_trabalhado: [],
    jb_pessoal_mes: [],
    jb_mes: [{ mes, saidas: 8687.25, saidas_manual: false, obs: "Contas fixas mais gastos", atualizado_em: new Date(Date.now() - 2 * 86400000).toISOString() }],
    jb_faturamento: [
      { mes, canal_id: 2, valor: 317.02, manual: false },
      { mes, canal_id: 3, valor: 3011.12, manual: false }
    ]
  };
}

/* O código do stub roda dentro da página. Recebe o DB e o usuário logado. */
function stubSource(uid, db, agora){
  return `
window.__UID=${JSON.stringify(uid)}; window.__DB=${JSON.stringify(db)}; window.__LOG=[];
${agora ? "window.__AGORA=" + JSON.stringify(agora) + ";" : ""}
(function(){
  const DB = window.__DB;
  const eu = () => DB.jb_usuario.find(u => u.user_id === window.__UID) || null;
  const gestor = () => { const u = eu(); return !!(u && u.ativo && u.papel === "gestor"); };
  const membro = () => { const u = eu(); return !!(u && u.ativo); };
  const hojeSP = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(window.__AGORA ? new Date(window.__AGORA) : new Date());
  const nextId = t => Math.max(0, ...(DB[t]||[]).map(r => Number(r.id)||0)) + 1;
  const diaMais = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };

  /* views calculadas a partir das tabelas */
  function viewProdutoApp(){
    return DB.jb_produto.map(p => {
      const f = DB.jb_ficha.find(x => x.produto_id === p.id);
      return { id:p.id, nome:p.nome, ordem:p.ordem, ativo:p.ativo, foto_url: p.foto_url || (f && f.foto_url) || null };
    });
  }
  function itensVisiveis(){
    return DB.jb_contagem_item.filter(i => {
      const c = DB.jb_contagem.find(x => x.id === i.contagem_id);
      return c && (gestor() || c.registrado_por === window.__UID);
    });
  }
  function viewSaidas(){
    const vis = itensVisiveis(); const out = [];
    DB.jb_contagem.filter(c => c.momento === "abertura").forEach(a => {
      const f = DB.jb_contagem.find(x => x.data === a.data && x.momento === "fechamento");
      vis.filter(i => i.contagem_id === a.id).forEach(ia => {
        const p = DB.jb_produto.find(x => x.id === ia.produto_id); if(!p) return;
        const isf = f ? vis.find(i => i.contagem_id === f.id && i.produto_id === p.id) : null;
        const sobrou = f ? (isf ? isf.qtd : null) : 0;
        const saiu = f ? (isf ? ia.qtd - isf.qtd : null) : ia.qtd;
        const dep = DB.jb_adendo.filter(x => x.data === a.data && x.produto_id === p.id).reduce((s,x) => s + (x.qtd||0), 0);
        // o que a geladeira guardou do dia anterior, ja descontado o que saiu depois de fechar
        const somaPerda = (dia, pid, apos) => (DB.jb_perda||[])
          .filter(x => x.data === dia && x.produto_id === pid && !!x.apos_fechamento === apos)
          .reduce((s,x) => s + (x.qtd||0), 0);
        const ontem = diaMais(a.data, -1);
        const fo = DB.jb_contagem.find(x => x.data === ontem && x.momento === "fechamento");
        const ito = fo ? vis.find(i => i.contagem_id === fo.id && i.produto_id === p.id) : null;
        const depO = DB.jb_adendo.filter(x => x.data === ontem && x.produto_id === p.id).reduce((s,x) => s + (x.qtd||0), 0);
        const deOntem = (fo && ito) ? Math.max(0, ito.qtd - depO - somaPerda(ontem, p.id, true)) : null;
        const per = somaPerda(a.data, p.id, false);
        const perDep = somaPerda(a.data, p.id, true);
        const total = saiu === null ? null : saiu + dep;
        out.push({ data:a.data, produto_id:p.id, produto:p.nome, ordem:p.ordem, deixou:ia.qtd, sobrou, saiu, depois:dep,
                   saiu_total: total, fechado: !!f,
                   de_ontem: deOntem, entrou: deOntem === null ? null : ia.qtd - deOntem,
                   perdeu: per, vendeu: total === null ? null : total - per,
                   perdeu_depois: perDep,
                   ficou: f ? Math.max(0, (isf ? isf.qtd : 0) - dep - perDep) : null });
      });
    });
    return out;
  }
  function viewReceitaFicha(){ return DB.jb_ficha.filter(f => f.ativo).map(f => ({ ficha_id:f.id, nome:f.nome, rendimento_un:f.rendimento_un, tempo_mo_min:f.tempo_mo_min, modo_preparo:f.modo_preparo, preparo_conferido:f.preparo_conferido, rascunho:f.rascunho, foto_url:f.foto_url })); }
  function viewReceitaFichaItem(){ return DB.jb_ficha_item.map(i => { const s = DB.jb_subreceita.find(x => x.nome === i.ingrediente && x.ativo); return { ...i, e_subreceita: !!s, subreceita_id: s ? s.id : null }; }); }
  function viewReceitaSub(){ return DB.jb_subreceita.filter(s => s.ativo).map(s => ({ subreceita_id:s.id, nome:s.nome, rendimento_kg:s.rendimento_kg, modo_preparo:s.modo_preparo, preparo_conferido:s.preparo_conferido })); }
  function viewReceitaSubItem(){ return DB.jb_subreceita_item.map(i => ({ ...i, e_subreceita:false, subreceita_id_link:null })); }
  function viewProducaoDia(){
    /* igual à view do banco: gestor vê tudo, os outros só o que é deles ou de todos */
    const meu = (eu() || {}).papel;
    return DB.jb_producao_item.filter(p =>
        gestor() || !p.para || p.para === "todos" || p.para === meu).map(p => {
      const f = p.tipo === "ficha" ? DB.jb_ficha.find(x => x.id === p.ref_id) : null;
      const s = p.tipo === "subreceita" ? DB.jb_subreceita.find(x => x.id === p.ref_id) : null;
      const r = f || s || {};
      return { ...p, nome: r.nome, rendimento: f ? f.rendimento_un : (s ? s.rendimento_kg : null), unidade: f ? "un" : "kg",
               preparo_conferido: !!r.preparo_conferido, modo_preparo: r.modo_preparo || null, foto_url: f ? f.foto_url : null };
    });
  }
  function viewFichaCusto(){ return DB.jb_ficha.map(f => ({ id:f.id, nome:f.nome, produto_id:f.produto_id, rendimento_un:f.rendimento_un, tempo_mo_min:f.tempo_mo_min, custo_unit: 6, itens: DB.jb_ficha_item.filter(i => i.ficha_id === f.id).length, itens_sem_preco:0, itens_sem_quantidade:0, rascunho:f.rascunho, cmv_ingrediente_un:5, cmv_embalagem_un:1 })); }
  function viewSubCusto(){ return DB.jb_subreceita.map(s => ({ id:s.id, nome:s.nome, rendimento_kg:s.rendimento_kg, custo_kg_planilha:s.custo_kg, custo_total:32, custo_kg_calculado:12.8, ingredientes_sem_preco:0 })); }

  function viewFichaItemCusto(){
    return DB.jb_ficha_item.map(fi => {
      const i = DB.jb_insumo.find(x => x.nome === fi.ingrediente);
      const s = DB.jb_subreceita.find(x => x.nome === fi.ingrediente);
      const custo = i ? i.custo_unit : (s ? 12.8 : null);
      return { ...fi, unidade_custo: i ? i.unidade : "kg", custo_referencia: custo,
               origem: i ? "insumo" : (s ? "sub-receita" : "sem cadastro"),
               custo_linha: custo == null ? null : fi.qtd * custo, categoria: i ? i.categoria : "ingrediente" };
    });
  }
  function viewResultadoMes(){
    return DB.jb_mes.map(m => {
      const entradas = DB.jb_faturamento.filter(f => f.mes === m.mes).reduce((s,f) => s + Number(f.valor), 0);
      return { ...m, entradas, resultado: entradas - Number(m.saidas), margem: entradas > 0 ? (entradas - Number(m.saidas)) / entradas : null,
               custo_fixo_referencia: (DB.jb_custo_fixo_total[0] || {}).total || null };
    });
  }
  /* espelho de jb_estoque_saldo + jb_estoque_compras + jb_estoque_sugestao */
  function viewEstoqueSugestao(){
    const fechadas = (DB.jb_estoque_contagem||[]).filter(c => c.fechada)
                       .sort((a,b) => String(b.data).localeCompare(String(a.data)));
    const atual = fechadas[0] || null;
    const ant   = fechadas[1] || null;
    const itensDe = c => c ? (DB.jb_estoque_item||[]).filter(i => String(i.contagem_id) === String(c.id)) : [];
    const ia = itensDe(atual), ib = itensDe(ant);
    const compras = (de, ate) => {
      const m = {};
      (DB.jb_compra_item||[]).forEach(ci => {
        const c = (DB.jb_compra||[]).find(x => String(x.id) === String(ci.compra_id));
        if(!c || ci.insumo_id == null) return;
        if(de && !(String(c.data) > String(de))) return;
        if(ate && !(String(c.data) <= String(ate))) return;
        m[ci.insumo_id] = (m[ci.insumo_id] || 0) + Number(ci.qtd_base || 0);
      });
      return m;
    };
    const cPeriodo = atual && ant ? compras(ant.data, atual.data) : {};
    const cDepois  = atual ? compras(atual.data, null) : {};
    const dias = (atual && ant)
      ? Math.max(Math.round((new Date(atual.data) - new Date(ant.data)) / 86400000), 1) : null;

    return (DB.jb_insumo||[]).filter(i => i.ativo && i.no_estoque).map(i => {
      const ea = ia.find(x => String(x.insumo_id) === String(i.id));
      const eb = ib.find(x => String(x.insumo_id) === String(i.id));
      const saldoContado = ea ? Number(ea.qtd_base) : null;
      const saldo = (saldoContado || 0) + (cDepois[i.id] || 0);
      const consumoPeriodo = (ea && eb)
        ? Number(eb.qtd_base) + (cPeriodo[i.id] || 0) - Number(ea.qtd_base) : null;
      const porContagem = (consumoPeriodo != null && dias && consumoPeriodo > 0)
        ? consumoPeriodo / dias * 7 : null;
      const consumo = porContagem != null ? porContagem
                    : (i.consumo_semana_manual != null ? Number(i.consumo_semana_manual) : null);
      const cob = i.cobertura_semanas == null ? 2 : Number(i.cobertura_semanas);
      const falta = Math.round(Math.max((consumo || 0) * cob - saldo, 0) * 10000) / 10000;
      return {
        insumo_id: i.id, nome: i.nome, unidade: i.unidade, categoria: i.categoria,
        local: i.local || "sem prateleira", emb_nome: i.emb_nome, emb_qtd: i.emb_qtd, foto_url: i.foto_url || null,
        custo_unit: i.custo_unit, fornecedor: i.fornecedor, cobertura_semanas: cob,
        consumo_semana_manual: i.consumo_semana_manual,
        contado_em: atual ? atual.data : null,
        saldo_contado: saldoContado, validade: ea ? ea.validade : null,
        comprado_depois: cDepois[i.id] || 0, saldo,
        saldo_anterior: eb ? Number(eb.qtd_base) : null,
        comprado_no_periodo: cPeriodo[i.id] || 0,
        periodo_de: ant ? ant.data : null,
        consumo_periodo: consumoPeriodo, dias_periodo: dias,
        consumo_semana: consumo == null ? null : Math.round(consumo * 10000) / 10000,
        origem_consumo: consumoPeriodo != null ? "contagem"
                      : (i.consumo_semana_manual != null ? "estimado" : "sem base"),
        dura_semanas: consumo > 0 ? Math.round(saldo / consumo * 100) / 100 : null,
        falta,
        comprar_emb: (i.emb_qtd > 0 && consumo > 0)
          ? Math.ceil(Math.round(falta / Number(i.emb_qtd) * 1e6) / 1e6) : null,
        custo_da_compra: Math.round(falta * Number(i.custo_unit || 0) * 100) / 100,
        valor_parado: Math.round(saldo * Number(i.custo_unit || 0) * 100) / 100
      };
    });
  }

  function tabela(t){
    if(t === "jb_estoque_sugestao") return gestor() ? viewEstoqueSugestao() : [];
    if(t === "jb_produto_app") return viewProdutoApp();
    if(t === "jb_ficha_item_custo") return gestor() ? viewFichaItemCusto() : [];
    if(t === "jb_resultado_mes") return gestor() ? viewResultadoMes() : [];
    if(t === "jb_saidas") return viewSaidas();
    if(t === "jb_contagem_item") return itensVisiveis();
    if(t === "jb_receita_ficha") return viewReceitaFicha();
    if(t === "jb_receita_ficha_item") return viewReceitaFichaItem();
    if(t === "jb_receita_sub") return viewReceitaSub();
    if(t === "jb_receita_sub_item") return viewReceitaSubItem();
    if(t === "jb_producao_dia") return viewProducaoDia();
    if(t === "jb_ficha_custo") return viewFichaCusto();
    if(t === "jb_subreceita_custo") return viewSubCusto();
    // RLS de mentira: o que so gestor le
    const soGestor = ["jb_perda","jb_tarefa","jb_acordo","jb_pessoal_mes","jb_pendencias","jb_custo_fixo_item","jb_custo_fixo_calculado",
                      "jb_custo_fixo_total","jb_volume_calculado","jb_giro_produto","jb_insumo","jb_preco","jb_margem","jb_promo_teto","jb_canal","jb_config","jb_vale_taxa","jb_meio_pagamento",
                      "jb_mes","jb_faturamento","jb_ficha","jb_ficha_item","jb_subreceita","jb_subreceita_item","jb_uso_ingrediente",
                      "jb_insumo_ultimo_pago","jb_ficha_alertas","jb_compra","jb_compra_item","jb_estoque_contagem","jb_estoque_item","jb_estoque_sugestao"];
    if(soGestor.includes(t) && !gestor()) return [];
    if(t === "jb_dia_trabalhado" && !gestor()) return (DB[t]||[]).filter(r => r.user_id === window.__UID);
    if(t === "jb_adendo" && !gestor()) return (DB[t]||[]).filter(r => r.registrado_por === window.__UID);
    if(t === "jb_usuario" && !gestor()) return (DB[t]||[]).filter(r => r.user_id === window.__UID);
    return (DB[t] || []).slice();
  }

  function query(t){
    const filtros = []; let ordem = null; let limite = null;
    const api = {
      select(){ return api; },
      order(c, o){ ordem = { c, asc: !(o && o.ascending === false) }; return api; },
      limit(n){ limite = n; return api; },
      eq(c, v){ filtros.push(r => String(r[c]) === String(v)); return api; },
      neq(c, v){ filtros.push(r => String(r[c]) !== String(v)); return api; },
      in(c, vals){ const s = vals.map(String); filtros.push(r => s.includes(String(r[c]))); return api; },
      gte(c, v){ filtros.push(r => r[c] != null && String(r[c]) >= String(v)); return api; },
      lte(c, v){ filtros.push(r => r[c] != null && String(r[c]) <= String(v)); return api; },
      is(c, v){ filtros.push(r => r[c] == v); return api; },
      or(expr){ filtros.push(r => expr.split(",").some(part => { const [col, op, val] = part.split("."); if(op === "is") return r[col] == null; if(op === "gte") return r[col] != null && String(r[col]) >= String(val); if(op === "eq") return String(r[col]) === String(val); return false; })); return api; },
      maybeSingle(){ return Promise.resolve(pick(true)); },
      single(){ const r = pick(true); return Promise.resolve(r.data ? r : { data:null, error:{ message:"no rows" } }); },
      insert(v){
        const arr = Array.isArray(v) ? v : [v];
        if(!membro()) return Promise.resolve({ data:null, error:{ message:"permission denied", code:"42501" } });
        // unique de nome em jb_produto e jb_insumo
        for(const x of arr){
          if((t === "jb_produto" || t === "jb_insumo") && (DB[t]||[]).some(r => r.nome === x.nome)){
            window.__LOG.push(["insert-erro", t, x]);
            return Promise.resolve({ data:null, error:{ message:"duplicate key value violates unique constraint", code:"23505" } });
          }
        }
        const feitas = arr.map(x => { const row = { ...x }; if(!("id" in row) && t !== "jb_contagem_item" && t !== "jb_preco" && t !== "jb_faturamento" && t !== "jb_ficha_item" && t !== "jb_subreceita_item") row.id = nextId(t); if(!row.criado_em) row.criado_em = new Date().toISOString(); (DB[t] = DB[t] || []).push(row); return row; });
        window.__LOG.push(["insert", t, arr]);
        const p = Promise.resolve({ data:feitas, error:null });
        p.select = () => ({ single: async () => ({ data:feitas[0], error:null }), maybeSingle: async () => ({ data:feitas[0], error:null }) });
        return p;
      },
      update(v){
        window.__LOG.push(["update", t, v]);
        const u = { eqs: [] };
        const exec = async () => { let rows = DB[t] || []; u.eqs.forEach(([c,val]) => { rows = rows.filter(r => String(r[c]) === String(val)); }); rows.forEach(r => Object.assign(r, v)); return { data:rows, error:null }; };
        const ch = { eq(c, val){ u.eqs.push([c, val]); return ch; }, then(res, rej){ return exec().then(res, rej); }, select(){ return { single: exec, maybeSingle: exec }; } };
        return ch;
      },
      upsert(v, opts){
        window.__LOG.push(["upsert", t, v, opts]);
        const arr = Array.isArray(v) ? v : [v];
        const chaves = (opts && opts.onConflict ? opts.onConflict.split(",") : ["id"]).map(s => s.trim());
        arr.forEach(x => { const ex = (DB[t]||[]).find(r => chaves.every(k => String(r[k]) === String(x[k]))); if(ex) Object.assign(ex, x); else (DB[t] = DB[t] || []).push({ ...x }); });
        const p = Promise.resolve({ data:arr, error:null }); p.select = () => ({ single: async () => ({ data:arr[0], error:null }) }); return p;
      },
      delete(){
        window.__LOG.push(["delete", t]);
        const eqs = [];
        const exec = async () => { DB[t] = (DB[t]||[]).filter(r => !eqs.every(([c,val]) => String(r[c]) === String(val))); return { error:null }; };
        const ch = { eq(c, val){ eqs.push([c, val]); return ch; }, then(res, rej){ return exec().then(res, rej); } };
        return ch;
      },
      then(res, rej){ return Promise.resolve(pick(false)).then(res, rej); }
    };
    function pick(single){
      if(window.__FALHA && window.__FALHA[t]) return { data:null, error:{ message:"rede caiu (teste)" } };
      let rows = tabela(t);
      filtros.forEach(f => { rows = rows.filter(f); });
      if(ordem) rows.sort((a,b) => (a[ordem.c] > b[ordem.c] ? 1 : a[ordem.c] < b[ordem.c] ? -1 : 0) * (ordem.asc ? 1 : -1));
      if(limite) rows = rows.slice(0, limite);
      return { data: single ? (rows[0] || null) : rows, error:null };
    }
    return api;
  }

  async function rpc(nome, args){
    window.__LOG.push(["rpc", nome, args]);
    if(window.__FALHA && window.__FALHA["rpc:" + nome]) return { data:null, error:{ message:"rede caiu (teste)" } };
    if(nome === "jb_salvar_contagem"){
      const u = eu(); if(!u) return { data:null, error:{ message:"sem acesso", code:"42501" } };
      let c = DB.jb_contagem.find(x => x.data === args.p_data && x.momento === args.p_momento);
      if(c){
        const podeEditar = gestor() || (c.registrado_por === window.__UID && c.data === hojeSP());
        if(!podeEditar) return { data:null, error:{ message:"new row violates row-level security policy", code:"42501" } };
        c.atualizado_em = new Date().toISOString(); c.nome_responsavel = u.nome;
      } else {
        c = { id: nextId("jb_contagem"), data: args.p_data, momento: args.p_momento, registrado_por: window.__UID, nome_responsavel: u.nome, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() };
        DB.jb_contagem.push(c);
      }
      (args.p_itens || []).forEach(it => {
        const ex = DB.jb_contagem_item.find(x => x.contagem_id === c.id && x.produto_id === it.produto_id);
        if(ex) ex.qtd = it.qtd; else DB.jb_contagem_item.push({ contagem_id:c.id, produto_id:it.produto_id, qtd:it.qtd });
      });
      return { data:c.id, error:null };
    }
    if(nome === "jb_salvar_ficha"){
      if(!gestor()) return { data:null, error:{ message:"so gestor", code:"42501" } };
      const tab = args.p_tipo === "sub" ? "jb_subreceita" : "jb_ficha";
      const itab = args.p_tipo === "sub" ? "jb_subreceita_item" : "jb_ficha_item";
      const fk = args.p_tipo === "sub" ? "subreceita_id" : "ficha_id";
      let id = args.p_id;
      if(id == null){ id = nextId(tab); DB[tab].push({ id, ativo:true, ...args.p_campos }); }
      else { const r = DB[tab].find(x => x.id === id); if(!r) return { data:null, error:{ message:"nao encontrada" } }; Object.assign(r, args.p_campos); }
      DB[itab] = DB[itab].filter(x => x[fk] !== id);
      (args.p_itens || []).forEach((it, i) => DB[itab].push({ [fk]: id, ordem: i + 1, ingrediente: it.ingrediente, unidade: it.unidade, qtd: it.qtd }));
      return { data:id, error:null };
    }
    if(nome === "jb_aplicar_preco_compra"){
      const pg = DB.jb_insumo_ultimo_pago.find(x => x.compra_item_id === args.p_item_id);
      if(!pg) return { data:null, error:{ message:"item sem insumo ligado" } };
      const i = DB.jb_insumo.find(x => x.id === pg.insumo_id); i.custo_unit = pg.custo_base;
      return { data:pg.custo_base, error:null };
    }
    if(nome === "jb_marcar_presenca"){
      const u = eu(); if(!u || u.papel === "gestor") return { data:"nada a fazer", error:null };
      const hoje = hojeSP();
      if(!DB.jb_dia_trabalhado.some(d => d.user_id === u.user_id && d.data === hoje))
        DB.jb_dia_trabalhado.push({ id: nextId("jb_dia_trabalhado"), user_id:u.user_id, data:hoje, turno:"noite", status:"sugerido", origem:"auto" });
      return { data:"ok", error:null };
    }
    if(nome === "jb_marcar_producao"){
      const r = DB.jb_producao_item.find(x => x.id === args.p_id);
      if(r){ r.feito = args.p_feito; r.feito_em = args.p_feito ? new Date().toISOString() : null; }
      return { data:null, error:null };
    }
    if(nome === "jb_renomear_ingrediente"){ return { data:null, error:null }; }
    return { data:null, error:{ message:"rpc desconhecida " + nome } };
  }

  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: window.__UID ? { user: { id: window.__UID } } : null } }),
      signInWithPassword: async ({ email, password }) => { window.__LOG.push(["login", email]); return password === "123456" ? { data:{}, error:null } : { data:null, error:{ message:"Invalid login credentials" } }; },
      signOut: async () => { window.__LOG.push(["signOut"]); window.__UID = null; return {}; },
      onAuthStateChange: (cb) => { window.__authCb = cb; return { data: { subscription: { unsubscribe(){} } } }; }
    },
    rpc,
    from: query
  })};
})();`;
}

module.exports = { baseDB, stubSource, hojeSP, diaMais, USUARIOS };
