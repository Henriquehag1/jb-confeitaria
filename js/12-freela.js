/* JB OS · modo freela.
   A freela não tem conta de login: ela entra com o código que o gestor gerou em Quem veio.
   O banco devolve um token, guardado neste celular, e tudo o que ela faz passa por quatro
   funções que conferem esse token (jb_freela_dados, jb_freela_salvar, jb_freela_adendo,
   jb_freela_producao, jb_freela_marcar e jb_freela_registrar para o plano do dia).
   Para o resto do app não precisar saber disso, o modo freela troca o "sb" por um cliente
   pequeno que responde às mesmas perguntas (from/rpc/auth) com o que veio do banco. */

const FREELA_TOKEN_KEY = "jb_freela_token";
function lerTokenFreela(){ try { return localStorage.getItem(FREELA_TOKEN_KEY) || ""; } catch(e){ return ""; } }
function guardarTokenFreela(t){ try { t ? localStorage.setItem(FREELA_TOKEN_KEY, t) : localStorage.removeItem(FREELA_TOKEN_KEY); } catch(e){} }

/* motivo que o banco devolve no jb_freela_entrar -> o que a freela lê */
function msgEntradaFreela(motivo){
  return motivo === "codigo"    ? "Código errado. Confira os 6 números que a Jessica mandou."
       : motivo === "bloqueado" ? "Código bloqueado depois de muitas tentativas. Peça para a Jessica liberar de novo."
       : motivo === "em_uso"    ? "Este código já foi usado em outro celular. Peça para a Jessica liberar de novo."
       : motivo === "espere"    ? "Muitas tentativas agora. Espere uns minutos e tente de novo."
       : "O acesso de freela não está liberado agora. Peça para a Jessica liberar no JB OS.";
}

function clienteFreela(real, token, aoTerminar){
  const C = { ok: false, id: null, nome: "", valido_ate: null, produtos: [], contagens: [], itens: [], adendos: [],
              producao: { itens: [], fichas: [], ficha_itens: [], subs: [], sub_itens: [] } };

  async function carregar(){
    const { data, error } = await real.rpc("jb_freela_dados", { p_token: token });
    if(error) return { rede: true };
    if(!data || !data.ok){ C.ok = false; return { fim: true }; }
    Object.assign(C, { ok: true, id: data.id, nome: data.nome, valido_ate: data.valido_ate,
      produtos: data.produtos || [], contagens: data.contagens || [], itens: data.itens || [], adendos: data.adendos || [] });
    return { ok: true };
  }

  /* o plano do dia que é dela (ou de todos), com as receitas para abrir já multiplicadas */
  async function carregarProducao(){
    const { data, error } = await real.rpc("jb_freela_producao", { p_token: token });
    if(error) return { rede: true };
    if(!data || !data.ok) return { fim: true };
    C.producao = { itens: data.itens || [], fichas: data.fichas || [], ficha_itens: data.ficha_itens || [],
                   subs: data.subs || [], sub_itens: data.sub_itens || [] };
    return { ok: true };
  }

  const linhas = t => t === "jb_produto_app" ? C.produtos
                    : t === "jb_producao_dia" ? C.producao.itens
                    : t === "jb_receita_ficha" ? C.producao.fichas
                    : t === "jb_receita_ficha_item" ? C.producao.ficha_itens
                    : t === "jb_receita_sub" ? C.producao.subs
                    : t === "jb_receita_sub_item" ? C.producao.sub_itens
                    : t === "jb_contagem" ? C.contagens
                    : t === "jb_contagem_item" ? C.itens
                    : t === "jb_adendo" ? C.adendos
                    : [];

  function from(t){
    const filtros = []; let ordem = null; let limite = null;
    async function exec(){
      /* a Home lê as contagens: é a hora de conferir se o acesso ainda vale e trazer o que mudou */
      if(t === "jb_producao_dia"){
        const r = await carregarProducao();
        if(r.rede) return { data: null, error: { message: "rede" } };
        if(r.fim){ if(aoTerminar) aoTerminar(); return { data: [], error: null }; }
      }
      if(t === "jb_contagem"){
        const r = await carregar();
        if(r.rede) return { data: null, error: { message: "rede" } };
        if(r.fim){ if(aoTerminar) aoTerminar(); return { data: [], error: null }; }
      }
      let out = linhas(t).filter(r => filtros.every(f => f(r))).map(r => ({ ...r }));
      if(ordem) out.sort((a, b) => (a[ordem.c] < b[ordem.c] ? -1 : a[ordem.c] > b[ordem.c] ? 1 : 0) * (ordem.asc ? 1 : -1));
      if(limite !== null) out = out.slice(0, limite);
      return { data: out, error: null };
    }
    const q = {
      select(){ return q; },
      eq(c, v){ filtros.push(r => String(r[c]) === String(v)); return q; },
      neq(c, v){ filtros.push(r => String(r[c]) !== String(v)); return q; },
      in(c, vs){ const s = (vs || []).map(String); filtros.push(r => s.includes(String(r[c]))); return q; },
      gte(c, v){ filtros.push(r => r[c] != null && String(r[c]) >= String(v)); return q; },
      lte(c, v){ filtros.push(r => r[c] != null && String(r[c]) <= String(v)); return q; },
      gt(c, v){ filtros.push(r => r[c] != null && String(r[c]) > String(v)); return q; },
      lt(c, v){ filtros.push(r => r[c] != null && String(r[c]) < String(v)); return q; },
      is(c, v){ filtros.push(r => r[c] == v); return q; },
      order(c, o){ ordem = { c, asc: !(o && o.ascending === false) }; return q; },
      limit(n){ limite = n; return q; },
      maybeSingle: async () => { const r = await exec(); return { data: (r.data || [])[0] || null, error: r.error }; },
      single: async () => { const r = await exec(); const d = (r.data || [])[0]; return d ? { data: d, error: null } : { data: null, error: r.error || { message: "no rows" } }; },
      then(res, rej){ return exec().then(res, rej); },
      insert: async (v) => {
        if(t !== "jb_adendo") return { data: null, error: { message: "sem acesso", code: "42501" } };
        const arr = Array.isArray(v) ? v : [v];
        const p_linhas = arr.map(x => ({ data: x.data, produto_id: x.produto_id, qtd: x.qtd, texto: x.texto }));
        const r = await real.rpc("jb_freela_adendo", { p_token: token, p_linhas });
        if(!r.error) await carregar();
        return { data: null, error: r.error || null };
      },
      update: () => ({ eq: async () => ({ data: null, error: { message: "sem acesso", code: "42501" } }) }),
      delete: () => ({ eq: async () => ({ data: null, error: { message: "sem acesso", code: "42501" } }) })
    };
    return q;
  }

  async function rpc(nome, args){
    if(nome === "jb_salvar_contagem"){
      const r = await real.rpc("jb_freela_salvar", { p_token: token, p_data: args.p_data, p_momento: args.p_momento, p_itens: args.p_itens });
      if(!r.error) await carregar();
      return r;
    }
    if(nome === "jb_marcar_producao"){
      return real.rpc("jb_freela_marcar", { p_token: token, p_id: args.p_id, p_feito: args.p_feito });
    }
    if(nome === "jb_producao_registrar"){
      return real.rpc("jb_freela_registrar", { p_token: token, p_id: args.p_id, p_qtd: args.p_qtd });
    }
    return { data: null, error: { message: "sem acesso", code: "42501" } };
  }

  return {
    freela: true, cache: C, carregar, from, rpc,
    storage: real.storage,
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => { guardarTokenFreela(""); sb = real; return {}; },
      onAuthStateChange: (cb) => real.auth.onAuthStateChange(cb)
    }
  };
}

/* entra no modo freela com o token guardado; devolve false se não deu */
async function iniciarFreela(token){
  const cli = clienteFreela(SB_REAL, token, fimDoAcessoFreela);
  const r = await cli.carregar();
  if(r.rede){
    montarLogin(); show("scLogin");
    erroLogin("Sem conexão agora. Confira o sinal e toque em Entrar de novo.");
    return true;
  }
  if(r.fim){ guardarTokenFreela(""); return false; }
  sb = cli;
  EU = { user_id: "freela:" + cli.cache.id, nome: cli.cache.nome + " (freela)", apelido: cli.cache.nome,
         papel: "freela", ativo: true, freela_ate: cli.cache.valido_ate };
  PRODUTOS = cli.cache.produtos.slice();
  PRODUTOS_OK = true;
  await carregarHome();
  return true;
}

async function fimDoAcessoFreela(){
  guardarTokenFreela("");
  sb = SB_REAL;
  EU = null;
  /* celular de alguém da equipe que foi usado para um teste: volta para a conta normal */
  try {
    const { data } = await SB_REAL.auth.getSession();
    if(data && data.session){ toast("O acesso de freela terminou."); await iniciar(); return; }
  } catch(e){}
  montarLogin(); show("scLogin");
  erroLogin("Seu acesso de freela terminou. Se ainda precisar, peça para a Jessica liberar de novo.");
}

async function entrarFreela(codigo){
  const { data, error } = await SB_REAL.rpc("jb_freela_entrar", { p_codigo: codigo });
  if(error){ erroLogin("Sem conexão agora. Confira o sinal e tente de novo."); return; }
  if(!data || !data.ok){ erroLogin(msgEntradaFreela(data && data.motivo)); $("pin").value = ""; return; }
  guardarTokenFreela(data.token);
  $("pin").value = "";
  if(!(await iniciarFreela(data.token))){
    montarLogin(); show("scLogin");
    erroLogin(msgEntradaFreela("fechado"));
  }
}
