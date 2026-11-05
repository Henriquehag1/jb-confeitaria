// JB OS: compra pela foto da nota (05/11/2026).
// Ações (POST JSON, só gestor logado):
//   ler        { fotos: ["notas/..."] }            lê a nota com IA e devolve as linhas, já ligadas aos insumos
//   cartoes    {}                                   cartões que a confeitaria usa, vindos do Nosso Financeiro
//   financeiro { compra_id, forcar? }               lança a compra no Nosso Financeiro sem duplicar
// A chave da Anthropic fica só aqui (secret ANTHROPIC_API_KEY); nunca vai para o navegador.
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODELO = Deno.env.get("JB_NOTA_MODELO") || "claude-haiku-4-5";
// preço por milhão de tokens (US$), para registrar quanto cada nota custou
const PRECO: Record<string, [number, number]> = { "claude-haiku-4-5": [1, 5] };
const NF_URL = "https://oihyhyyhessqnpkknhsi.supabase.co";
const NF_KEY = "sb_publishable_T7LERNVYS8mAK0tOlWfl5A_4-yCUjie";
const BALDE = "contas";
const MAX_FOTOS = 4;
const MAX_BYTES = 4_500_000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

async function sbUser(auth: string, path: string, init: RequestInit = {}) {
  const r = await fetch(SB_URL + path, {
    ...init,
    headers: { apikey: SB_ANON, Authorization: auth, "content-type": "application/json", ...(init.headers || {}) },
  });
  return r;
}

async function eGestor(auth: string) {
  const r = await sbUser(auth, "/rest/v1/rpc/jb_e_gestor", { method: "POST", body: "{}" });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

async function tokenSync(): Promise<string> {
  const r = await fetch(SB_URL + "/rest/v1/rpc/jb_sync_token_srv", {
    method: "POST", body: "{}",
    headers: { apikey: SB_SRV, Authorization: "Bearer " + SB_SRV, "content-type": "application/json" },
  });
  if (!r.ok) throw new Error("não achei o token da sincronização");
  const t = await r.json();
  if (!t) throw new Error("JB OS não está pareado com o Nosso Financeiro");
  return t;
}

async function nf(rpc: string, body: unknown) {
  const r = await fetch(NF_URL + "/rest/v1/rpc/" + rpc, {
    method: "POST", body: JSON.stringify(body),
    headers: { apikey: NF_KEY, Authorization: "Bearer " + NF_KEY, "content-type": "application/json" },
  });
  const txt = await r.text();
  if (!r.ok) {
    let m = txt;
    try { m = JSON.parse(txt).message || txt; } catch (_) { /* texto puro */ }
    throw new Error("Nosso Financeiro: " + m);
  }
  return txt ? JSON.parse(txt) : null;
}

function b64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

const FERRAMENTA = {
  name: "registrar_nota",
  description: "Registra o que está escrito na nota fiscal ou cupom de compra.",
  input_schema: {
    type: "object",
    properties: {
      legivel: { type: "boolean", description: "false se a foto não permite ler os itens com segurança" },
      tipo_documento: { type: "string", description: "NFC-e, NF-e (DANFE), cupom, pedido online, orçamento, recibo ou outro" },
      sem_valor_fiscal: { type: "boolean", description: "true se o papel diz 'sem valor fiscal', 'orçamento' ou 'não é documento fiscal'" },
      fornecedor: { type: "string", description: "nome do emitente (nome fantasia se houver, senão razão social)" },
      cnpj_emitente: { type: ["string", "null"] },
      destinatario_doc: { type: ["string", "null"], description: "CNPJ ou CPF do destinatário/consumidor, só dígitos; null se não aparece" },
      destinatario_nome: { type: ["string", "null"] },
      data: { type: ["string", "null"], description: "data de emissão em AAAA-MM-DD. Na nota brasileira a data vem DIA/MÊS/ANO: 05/11/2026 é 2026-11-05" },
      numero: { type: ["string", "null"], description: "número da nota ou do pedido" },
      chave: { type: ["string", "null"], description: "chave de acesso de 44 dígitos, só se estiver inteira e legível" },
      valor_produtos: { type: ["number", "null"] },
      desconto: { type: ["number", "null"] },
      frete: { type: ["number", "null"] },
      valor_pago: { type: ["number", "null"], description: "valor total a pagar da nota" },
      pagamento_na_nota: { type: ["string", "null"], description: "forma de pagamento escrita na nota, se houver" },
      itens: {
        type: "array",
        items: {
          type: "object",
          properties: {
            codigo: { type: ["string", "null"] },
            descricao: { type: "string", description: "como está na nota" },
            qtd: { type: ["number", "null"] },
            unidade: { type: ["string", "null"], description: "unidade da nota: UN, KG, CX, PCT..." },
            valor_unit: { type: ["number", "null"] },
            desconto: { type: ["number", "null"], description: "desconto da linha, positivo" },
            valor_total: { type: ["number", "null"], description: "valor da linha já com o desconto da linha" },
            embalagem: { type: ["string", "null"], description: "o que vem em cada unidade: '1kg', 'caixa 20 x 1kg', 'pacote 144un', '395g'" },
            insumo_id: { type: ["integer", "null"], description: "id do insumo da lista que é este produto; null se nenhum serve" },
            qtd_base: { type: ["number", "null"], description: "quantidade TOTAL da linha na unidade do insumo escolhido (kg, un, L ou m)" },
            destino: { type: "string", enum: ["insumo", "consumo", "revenda"] },
            certeza: { type: "number", description: "0 a 1: quão seguro está da leitura desta linha" },
          },
          required: ["descricao", "valor_total", "destino", "certeza"],
        },
      },
      observacoes: { type: ["string", "null"], description: "o que ficou ilegível ou estranho, em português" },
    },
    required: ["legivel", "fornecedor", "itens"],
  },
};

const INSTRUCAO = `Você lê notas fiscais e cupons de compra da JB Confeitaria (CNPJ 47.010.705/0001-53), em São Paulo.
Leia a foto com cuidado e chame a ferramenta registrar_nota uma vez.
Regras:
- Copie os números exatamente como estão. Não invente: o que não der para ler fica null, e baixe a "certeza" da linha.
- Uma linha da ferramenta para cada linha de produto da nota, na ordem da nota. Frete, taxa de entrega e serviço não são itens: vão em "frete".
- valor_total da linha já com o desconto da própria linha. O desconto geral da nota vai em "desconto".
- Ligue cada produto ao insumo da lista quando for o mesmo produto (marca diferente do mesmo produto ainda serve). Se não houver insumo certo, insumo_id null e destino "consumo" (embalagem fora da lista, material de limpeza, utensílio, mercado). "revenda" é só bebida pronta para vender (refrigerante, água, suco).
- qtd_base é a quantidade total na unidade do insumo. Exemplos: 20 x "LEITE COND 5KG", insumo em kg: 100. 3 x "POTE 500ML C/144", insumo em un: 432. 2 CX "ACUCAR MASCAVO 20X1KG", insumo em kg: 40. 1,234 KG de morango, insumo em kg: 1.234. Se o peso ou o tamanho da embalagem não aparece na descrição, qtd_base null.
- Datas: a nota brasileira escreve DIA/MÊS/ANO. "05/11/2026" é 5 de novembro de 2026, que vira 2026-11-05. Nunca inverta dia e mês.
- Se o papel disser "sem valor fiscal" ou "orçamento", marque sem_valor_fiscal true.
- Valores com ponto decimal.`;

async function ler(auth: string, body: any) {
  if (!AI_KEY) return json({ erro: "A leitura por IA ainda não está ligada (falta a chave no servidor)." }, 503);
  const fotos: string[] = Array.isArray(body.fotos) ? body.fotos.slice(0, MAX_FOTOS) : [];
  if (!fotos.length) return json({ erro: "Mande pelo menos uma foto." }, 400);
  if (fotos.some(f => typeof f !== "string" || !/^notas\/[\w.\-]+$/.test(f))) return json({ erro: "Caminho de foto inválido." }, 400);

  const conteudo: any[] = [];
  for (const f of fotos) {
    const r = await sbUser(auth, "/storage/v1/object/authenticated/" + BALDE + "/" + f);
    if (!r.ok) return json({ erro: "Não consegui abrir a foto guardada." }, 400);
    const tipo = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ erro: "Foto grande demais." }, 400);
    if (tipo === "application/pdf") conteudo.push({ type: "document", source: { type: "base64", media_type: tipo, data: b64(buf) } });
    else if (/^image\/(jpeg|png|webp|gif)$/.test(tipo)) conteudo.push({ type: "image", source: { type: "base64", media_type: tipo, data: b64(buf) } });
    else return json({ erro: "Formato de arquivo não aceito (" + tipo + ")." }, 400);
  }

  const ri = await sbUser(auth, "/rest/v1/jb_insumo?select=id,nome,unidade,categoria&ativo=is.true&order=nome.asc");
  const insumos = ri.ok ? await ri.json() : [];
  const lista = insumos.map((i: any) => `${i.id} | ${i.nome} | ${i.unidade} | ${i.categoria || ""}`).join("\n");
  conteudo.push({ type: "text", text: "Hoje é " + hojeSP() + " (São Paulo). Insumos cadastrados (id | nome | unidade | tipo):\n" + lista + "\n\nLeia a nota da(s) foto(s) acima." });

  const t0 = Date.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO, max_tokens: 6000, temperature: 0,
      system: INSTRUCAO,
      tools: [FERRAMENTA], tool_choice: { type: "tool", name: "registrar_nota" },
      messages: [{ role: "user", content: conteudo }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const tipo = out?.error?.type || "";
    const msg = tipo === "rate_limit_error" ? "Muitas leituras seguidas. Espere um minuto."
      : /credit|billing|limit/i.test(out?.error?.message || "") ? "O limite de gasto da IA deste mês acabou."
      : "A leitura falhou (" + (tipo || r.status) + ").";
    return json({ erro: msg }, 502);
  }
  const uso = out.usage || {};
  const p = PRECO[MODELO] || [1, 5];
  const custo = ((uso.input_tokens || 0) * p[0] + (uso.output_tokens || 0) * p[1]) / 1e6;
  const bloco = (out.content || []).find((c: any) => c.type === "tool_use");
  if (!bloco) return json({ erro: "A IA não devolveu a leitura. Tente de novo com a foto mais nítida." }, 502);
  return json({
    nota: revisar(bloco.input, hojeSP()),
    ia: { modelo: MODELO, entrada: uso.input_tokens || 0, saida: uso.output_tokens || 0, custo_usd: Math.round(custo * 10000) / 10000, ms: Date.now() - t0, parou: out.stop_reason },
  });
}

// Data de hoje em São Paulo, AAAA-MM-DD.
function hojeSP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
const dataValida = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(Date.parse(iso + "T12:00:00Z"))
  && new Date(iso + "T12:00:00Z").toISOString().slice(0, 10) === iso;
const br = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);

// Conferências depois da leitura (05/11/2026: a primeira nota real veio com dia e mês trocados).
// O que for ajustado ou suspeito vai para "observacoes", que a tela mostra em amarelo.
function revisar(nota: any, hoje: string) {
  const obs: string[] = [];
  const d = String(nota.data || "");
  const normal = (x: string) => dataValida(x) && diasEntre(x, hoje) <= 1 && diasEntre(x, hoje) >= -60;
  if (d && dataValida(d) && !normal(d)) {
    const troca = d.slice(0, 4) + "-" + d.slice(8, 10) + "-" + d.slice(5, 7);
    if (normal(troca)) {
      nota.data = troca;
      obs.push("A data veio como " + br(d) + ", com dia e mês trocados; usei " + br(troca) + ". Confira na nota.");
    } else obs.push("A data " + br(d) + " está fora do normal. Confira na nota antes de gravar.");
  } else if (d && !dataValida(d)) { nota.data = null; obs.push("Não consegui ler a data. Preencha à mão."); }
  if (nota.sem_valor_fiscal) obs.push("Este papel é orçamento, SEM VALOR FISCAL: não vale como nota para o contador. Peça a nota fiscal no CNPJ 47.010.705/0001-53.");
  const bebida = /refri|coca|guaran|pepsi|fanta|sprite|agua|água|suco|cerveja|cha |chá |energetic|lata|\d+\s?ml/i;
  (nota.itens || []).forEach((it: any) => {
    if (it.destino === "revenda" && !bebida.test(String(it.descricao || ""))) it.destino = "consumo";
  });
  if (obs.length) nota.observacoes = [obs.join(" "), nota.observacoes].filter(Boolean).join(" ");
  return nota;
}

// Recado do Nosso Financeiro em português claro.
function recadoFin(m: string) {
  if (/data fora/.test(m)) return "A data da compra está fora do normal (mais de 4 meses atrás ou no futuro). Corrija a data e tente de novo.";
  if (/cartao desconhecido/.test(m)) return "Esse cartão não existe no Nosso Financeiro.";
  if (/categoria invalida/.test(m)) return "Categoria inválida no Nosso Financeiro.";
  if (/token/.test(m)) return "O JB OS perdeu o pareamento com o Nosso Financeiro.";
  return m;
}

async function cartoes() {
  const tok = await tokenSync();
  return json({ cartoes: await nf("jb_cartoes_para_compra", { p_token: tok }) });
}

async function financeiro(auth: string, body: any) {
  const id = Number(body.compra_id);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "compra_id inválido" }, 400);
  const rc = await sbUser(auth, "/rest/v1/jb_compra?select=id,data,fornecedor,valor_pago,forma,cartao,parcelas,fin_categoria,fin_status,documento&id=eq." + id);
  const c = (rc.ok ? await rc.json() : [])[0];
  if (!c) return json({ erro: "Compra não encontrada." }, 404);
  if (!c.forma || !c.fin_categoria) return json({ erro: "Falta a forma de pagamento ou a categoria." }, 400);
  const tok = await tokenSync();
  let res: any;
  try {
    res = await nf("jb_receber_compra", {
      p_token: tok, p_forcar: body.forcar === true,
      p: {
        compra_id: c.id, valor: c.valor_pago, data: c.data, parcelas: c.parcelas || 1, forma: c.forma, cartao: c.cartao,
        categoria_id: c.fin_categoria, descricao: c.fornecedor + (c.documento ? " (nota " + c.documento + ")" : ""),
      },
    });
  } catch (e) {
    await sbUser(auth, "/rest/v1/jb_compra?id=eq." + id, { method: "PATCH", body: JSON.stringify({ fin_status: "erro", fin_em: new Date().toISOString() }) });
    return json({ erro: recadoFin(String((e as Error).message || e)) }, 502);
  }
  const ref = res.status === "lancado" ? "jbos compra " + id : (res.evento ? "evento " + res.evento.id : null);
  await sbUser(auth, "/rest/v1/jb_compra?id=eq." + id, {
    method: "PATCH", body: JSON.stringify({ fin_status: res.status, fin_ref: ref, fin_em: new Date().toISOString() }),
  });
  return json(res);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const auth = req.headers.get("authorization") || "";
  try {
    if (!(await eGestor(auth))) return json({ erro: "Só gestor." }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.acao === "ler") return await ler(auth, body);
    if (body.acao === "cartoes") return await cartoes();
    if (body.acao === "financeiro") return await financeiro(auth, body);
    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
