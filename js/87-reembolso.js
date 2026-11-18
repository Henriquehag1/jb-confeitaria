/* JB OS · compras que a diarista faz para o ateliê (18/11/2026).

   A Eliana passa no mercado e traz coisas para o ateliê. O caminho:
     1. Ela, no celular: "Comprei para o ateliê". Foto do cupom (obrigatória) e o valor.
        Ela só vê as compras dela: enviada, conferida (entra no próximo pagamento),
        paga ou não aceita. Nada do financeiro.
     2. A Jessica ou o Henrique confere pela Compra pela nota (a leitura separa os itens,
        atualiza preço, estoque e fichas). Ao gravar, jb_reembolso_conferir cria a conta
        de reembolso ligada a ela, que soma no "A pagar agora" do cartão dela.
     3. No Quem veio, "Paguei a Eliana": jb_pagar_diarista marca dias e reembolsos como
        pagos e a Edge Function lança no Nosso Financeiro, na data do Pix: diárias em
        Pessoas e cada compra na categoria da nota. Ninguém lança o Pix dela à mão.
   ============================================================ */

let RB = null;   // { lista, fotos, enviando, erro }
const RB_STATUS = {
  enviado:   ["enviada", "A Jessica vai conferir"],
  conferido: ["conferida", "Entra no seu próximo pagamento"],
  pago:      ["paga", "Já foi paga"],
  recusado:  ["não entrou", ""]
};

/* ---------- Home ---------- */
async function montarReembolsoHome(){
  const bt = $("btnReemb");
  if(!bt || !EU) return;
  const gestor = EU.papel === "gestor";
  if(EU.papel === "producao"){
    bt.classList.remove("hide", "enc-nova"); bt.classList.add("ghost");
    bt.querySelector(".t").textContent = "Comprei para o ateliê";
    bt.querySelector(".s").textContent = "Foto do cupom e o valor: entra no seu pagamento";
    return;
  }
  if(!gestor){ bt.classList.add("hide"); return; }
  const { data, error } = await sb.from("jb_reembolso").select("id,user_id,valor").eq("status", "enviado");
  const lista = error ? [] : (data || []);
  bt.classList.toggle("hide", !lista.length);
  if(!lista.length) return;
  const nomes = await rbNomes();
  const soma = lista.reduce((t, r) => t + Number(r.valor), 0);
  const quem = [...new Set(lista.map(r => nomes[r.user_id] || "Equipe"))].join(", ");
  bt.classList.remove("ghost"); bt.classList.add("enc-nova");
  bt.querySelector(".t").textContent = lista.length === 1 ? "Compra da equipe para conferir" : lista.length + " compras da equipe para conferir";
  bt.querySelector(".s").textContent = quem + ": R$ " + moeda(soma) + " · toque para conferir a nota";
}

async function rbNomes(){
  const { data } = await sb.from("jb_usuario").select("user_id,nome");
  const n = {}; (data || []).forEach(u => { n[u.user_id] = u.nome; });
  return n;
}

/* ---------- tela ---------- */
async function abrirReembolso(){
  RB = { lista: [], fotos: [], enviando: false, erro: null, nomes: {} };
  show("scReemb");
  await rbCarregar();
  rbDesenhar();
}

async function rbCarregar(){
  const gestor = EU.papel === "gestor";
  let q = sb.from("jb_reembolso").select("*").order("id", { ascending: false }).limit(40);
  if(!gestor) q = q.eq("user_id", EU.user_id);
  const [r, n] = await Promise.all([q, gestor ? rbNomes() : Promise.resolve({})]);
  RB.lista = (r && !r.error && r.data) || [];
  RB.nomes = n;
  if(r && r.error) RB.erro = "Não consegui carregar as compras. Toque em atualizar.";
}

function rbEl(tag, cls, txt){ const e = document.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }

function rbDesenhar(){
  const box = $("rbCorpo");
  box.innerHTML = "";
  aviso("rbMsg", RB.erro || "", "err");
  if(EU.papel === "gestor") rbTelaGestor(box);
  else rbTelaEquipe(box);
}

/* ---------- o lado dela ---------- */
function rbTelaEquipe(box){
  box.appendChild(rbEl("p", "tip", "Comprou alguma coisa para o ateliê com o seu dinheiro? Tire foto do cupom e ponha o valor. A Jessica confere e o valor entra no seu próximo pagamento, junto com as diárias."));
  const f = rbEl("div", "card rb-form");
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/*,application/pdf"; inp.className = "hide"; inp.id = "rbArquivo";
  inp.setAttribute("aria-label", "Foto do cupom");
  inp.onchange = () => { const x = inp.files && inp.files[0]; inp.value = ""; if(x) rbAdicionarFoto(x); };
  f.appendChild(inp);
  if(RB.fotos.length){
    const g = rbEl("div", "cf-fotos");
    RB.fotos.forEach((ft, i) => {
      const d = rbEl("div", "cf-foto");
      if(ft.previa){ const im = document.createElement("img"); im.src = ft.previa; im.alt = "parte " + (i + 1); d.appendChild(im); }
      else d.appendChild(rbEl("span", null, "PDF"));
      const x = rbEl("button", "rm", "tirar"); x.type = "button";
      x.onclick = () => { RB.fotos.splice(i, 1); rbDesenhar(); };
      d.appendChild(x);
      g.appendChild(d);
    });
    f.appendChild(g);
  }
  const bf = rbEl("button", "big" + (RB.fotos.length ? " ghost" : "")); bf.type = "button"; bf.id = "rbFoto";
  bf.innerHTML = '<span class="tx"><span class="t"></span><span class="s"></span></span>';
  bf.querySelector(".t").textContent = RB.fotos.length ? "Adicionar outra parte" : "Tirar foto do cupom";
  bf.querySelector(".s").textContent = RB.fotos.length ? "Só se o cupom não coube numa foto" : "Abre a câmera ou a galeria";
  bf.disabled = RB.fotos.length >= 4 || !!RB.subindo;
  bf.onclick = () => inp.click();
  f.appendChild(bf);
  if(RB.subindo) f.appendChild(rbEl("p", "tip", "Guardando a foto..."));

  const campo = (rot, el) => { const l = rbEl("label", "rb-campo", rot); l.appendChild(el); f.appendChild(l); return el; };
  const v = document.createElement("input"); v.type = "text"; v.inputMode = "decimal"; v.id = "rbValor"; v.placeholder = "0,00"; v.value = RB.valor || "";
  v.oninput = () => { RB.valor = v.value; rbBotao(); };
  campo("Quanto você pagou (R$)", v);
  const lj = document.createElement("input"); lj.type = "text"; lj.id = "rbLoja"; lj.maxLength = 80; lj.placeholder = "Ex.: Atacadão"; lj.value = RB.loja || "";
  lj.oninput = () => { RB.loja = lj.value; };
  campo("Onde comprou (opcional)", lj);
  const ob = document.createElement("input"); ob.type = "text"; ob.id = "rbObs"; ob.maxLength = 300; ob.placeholder = "Ex.: leite em pó e ovos"; ob.value = RB.obs || "";
  ob.oninput = () => { RB.obs = ob.value; };
  campo("O que comprou (opcional)", ob);
  const dt = document.createElement("input"); dt.type = "date"; dt.id = "rbData"; dt.value = RB.data || hojeSP(); dt.max = hojeSP();
  dt.oninput = () => { RB.data = dt.value; };
  campo("Dia da compra", dt);

  const env = rbEl("button", "big"); env.type = "button"; env.id = "rbEnviar";
  env.innerHTML = '<span class="tx"><span class="t"></span><span class="s">A Jessica confere e entra no seu pagamento</span></span>';
  env.onclick = travar(env, rbEnviar);
  f.appendChild(env);
  box.appendChild(f);
  rbBotao();

  box.appendChild(rbEl("h3", "cf-tit", "Suas compras"));
  if(!RB.lista.length){ box.appendChild(rbEl("p", "tip", "Nenhuma compra enviada ainda.")); return; }
  RB.lista.forEach(r => {
    const st = RB_STATUS[r.status] || RB_STATUS.enviado;
    const c = rbEl("div", "card rb-item " + r.status);
    const top = rbEl("div", "rb-top");
    top.append(rbEl("b", null, dataCurta(r.data) + (r.loja ? " · " + r.loja : "")), rbEl("span", "enc-chip " + (r.status === "enviado" ? "nova" : r.status === "recusado" ? "" : "ok"), st[0]));
    c.appendChild(top);
    c.appendChild(rbEl("p", null, "R$ " + moeda(r.valor) + (r.obs ? " · " + r.obs : "")));
    const sub = r.status === "recusado" ? (r.motivo ? "Motivo: " + r.motivo : "Fale com a Jessica.") : st[1];
    if(sub) c.appendChild(rbEl("small", null, sub));
    box.appendChild(c);
  });
}

function rbValorNum(){ const n = numBR(RB.valor || ""); return n != null && n > 0 ? Math.round(n * 100) / 100 : null; }

function rbBotao(){
  const b = $("rbEnviar"); if(!b) return;
  const falta = [];
  if(!RB.fotos.length) falta.push("a foto do cupom");
  if(!rbValorNum()) falta.push("o valor");
  b.disabled = falta.length > 0 || !!RB.subindo;
  b.querySelector(".t").textContent = falta.length ? "Falta " + falta.join(" e ") : "Enviar para a Jessica";
}

async function rbAdicionarFoto(file){
  const pdf = /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || "");
  if(!pdf && !/^image\//i.test(file.type || "") && !/\.(jpe?g|png|heic|heif|webp)$/i.test(file.name || "")){
    RB.erro = "Esse arquivo não é foto nem PDF."; rbDesenhar(); return;
  }
  RB.erro = null; RB.subindo = true; rbDesenhar();
  try {
    const f = pdf ? file : await cfReduzir(file);
    if(f.size > 4500000) throw new Error("grande");
    const caminho = "reembolso/" + EU.user_id + "/" + hojeSP().replace(/-/g, "") + "-" + Date.now() + "-" + RB.fotos.length + (pdf ? ".pdf" : ".jpg");
    const r = await sb.storage.from("contas").upload(caminho, f, { contentType: pdf ? "application/pdf" : "image/jpeg", upsert: false });
    if(r.error) throw r.error;
    RB.fotos.push({ caminho, previa: pdf ? null : URL.createObjectURL(f) });
  } catch(e){
    RB.erro = /grande/.test(String(e && e.message)) ? "O arquivo ficou grande demais. Tire a foto de novo, um pouco mais longe."
      : "Não consegui guardar a foto. Confira a internet e tente de novo.";
  }
  RB.subindo = false;
  rbDesenhar();
}

async function rbEnviar(){
  const valor = rbValorNum();
  if(!valor || !RB.fotos.length) return;
  const linha = { user_id: EU.user_id, status: "enviado", valor, data: RB.data || hojeSP(), fotos: RB.fotos.map(f => f.caminho),
                  loja: String(RB.loja || "").trim() || null, obs: String(RB.obs || "").trim() || null };
  const { error } = await sb.from("jb_reembolso").insert(linha);
  if(error){ RB.erro = "Não consegui enviar agora. Tente de novo."; rbDesenhar(); return; }
  toast("Enviado. A Jessica vai conferir.");
  RB.fotos = []; RB.valor = ""; RB.loja = ""; RB.obs = ""; RB.data = null; RB.erro = null;
  await rbCarregar();
  rbDesenhar();
}

/* ---------- o lado de quem confere ---------- */
function rbTelaGestor(box){
  const novas = RB.lista.filter(r => r.status === "enviado");
  const resto = RB.lista.filter(r => r.status !== "enviado");
  box.appendChild(rbEl("p", "tip", "Compras que a equipe fez com o próprio dinheiro. Conferir abre a Compra pela nota com a foto: o preço, o estoque e as fichas se atualizam, e o valor entra no pagamento da pessoa."));
  if(!novas.length) box.appendChild(rbEl("p", "tip", "Nenhuma compra esperando conferência."));
  novas.forEach(r => {
    const nome = RB.nomes[r.user_id] || "Equipe";
    const c = rbEl("div", "card rb-item enviado");
    c.dataset.id = r.id;
    c.appendChild(rbEl("b", null, nome + " · " + dataCurta(r.data) + (r.loja ? " · " + r.loja : "")));
    c.appendChild(rbEl("p", null, "R$ " + moeda(r.valor) + (r.obs ? " · " + r.obs : "") + " · " + (r.fotos || []).length + ((r.fotos || []).length === 1 ? " foto" : " fotos")));
    const ac = rbEl("div", "enc-acoes");
    const conf = rbEl("button", "", "Conferir a nota"); conf.type = "button";
    conf.onclick = () => abrirCompraReembolso(r, nome);
    const rec = rbEl("button", "sec", "Não aceitar"); rec.type = "button";
    rec.onclick = () => {
      if(c.querySelector(".rb-recusa")) return;
      const f = rbEl("div", "rb-recusa");
      const m = document.createElement("input"); m.type = "text"; m.maxLength = 200; m.placeholder = "Por quê? Ela vê esta frase"; m.setAttribute("aria-label", "Motivo");
      const ok = rbEl("button", "perigo", "Confirmar"); ok.type = "button";
      ok.onclick = travar(ok, async () => {
        const { error } = await sb.rpc("jb_reembolso_recusar", { p_id: r.id, p_motivo: m.value });
        if(error){ toast("Não consegui salvar.", "err"); return; }
        toast("Marcada como não aceita.");
        await rbCarregar(); rbDesenhar();
      });
      f.append(m, ok);
      c.appendChild(f);
      m.focus();
    };
    ac.append(conf, rec);
    c.appendChild(ac);
    box.appendChild(c);
  });
  if(resto.length){
    const det = document.createElement("details"); det.className = "enc-fim";
    det.appendChild(rbEl("summary", null, "Já conferidas (" + resto.length + ")"));
    resto.forEach(r => {
      const st = RB_STATUS[r.status] || RB_STATUS.enviado;
      det.appendChild(rbEl("p", "rb-linha", (RB.nomes[r.user_id] || "Equipe") + " · " + dataCurta(r.data) + " · R$ " + moeda(r.valor) + " · " + st[0]
        + (r.status === "recusado" && r.motivo ? " (" + r.motivo + ")" : "")));
    });
    box.appendChild(det);
  }
}

/* abre a Compra pela nota já com a foto que ela mandou */
async function abrirCompraReembolso(r, nome){
  CF = cfNovo();
  CF.reemb = { id: r.id, user_id: r.user_id, nome, valor: Number(r.valor), loja: r.loja, data: r.data, obs: r.obs };
  CF.pag.quem = r.user_id;
  CF.fotos = (r.fotos || []).map(c => ({ caminho: c, previa: null }));
  show("scCompra");
  await cfLer();
}

/* ---------- pagamento da diarista ---------- */
/* total em aberto que o cartão mostra: dias do mês sem pagamento + reembolsos dela */
function rbBlocoPagar(uid, nome, total){
  const w = rbEl("div", "rb-pagar");
  if(!(total > 0)) return w;
  const det = document.createElement("details");
  det.appendChild(rbEl("summary", null, "Paguei " + nome + " (Pix de R$ " + moeda(total) + ")"));
  det.appendChild(rbEl("p", "tip", "Marca os dias e as compras como pagos e lança no Nosso Financeiro na data do Pix: as diárias em Pessoas e cada compra na categoria dela. Não precisa lançar o Pix à mão."));
  const f = rbEl("div", "rb-pg-form");
  const l = rbEl("label", null, "Dia do Pix");
  const d = document.createElement("input"); d.type = "date"; d.value = hojeSP(); d.max = hojeSP(); d.className = "rb-pg-data";
  l.appendChild(d); f.appendChild(l);
  const ok = rbEl("button", "rb-pg-ok", "Confirmar pagamento de R$ " + moeda(total)); ok.type = "button";
  ok.onclick = travar(ok, () => rbPagar(uid, nome, d.value, total));
  f.appendChild(ok);
  det.appendChild(f);
  w.appendChild(det);
  return w;
}

async function rbPagar(uid, nome, data, total){
  if(!data || data > hojeSP()){ aviso("diasMsg", "Escolha o dia do Pix (hoje ou antes).", "warn"); return; }
  const { data: r, error } = await sb.rpc("jb_pagar_diarista", { p_user: uid, p_data: data, p_valor: total });
  if(error){
    const m = String(error.message || "");
    const k = m.match(/total em aberto é ([\d.]+)/);
    aviso("diasMsg", k ? "O total em aberto de " + nome + " é R$ " + moeda(Number(k[1])) + " (tem dia de outro mês em aberto). Confira em Marcar dias como pagos."
      : "Não consegui registrar o pagamento agora. Nada foi alterado.", "err");
    return;
  }
  let fin = null;
  try { fin = await cfInvocar({ acao: "pagamento", pagamento_id: r.pagamento_id }); }
  catch(e){ fin = { status: "erro", erro: e.message }; }
  await abrirDias();
  if(fin && fin.status === "lancado")
    aviso("diasMsg", "Pagamento de " + nome + " registrado: R$ " + moeda(r.total) + " em " + dataCurta(data) + ". Já está no Nosso Financeiro.", "ok");
  else
    aviso("diasMsg", "Pagamento de " + nome + " registrado aqui, mas não consegui lançar no Nosso Financeiro" + (fin && fin.erro ? " (" + fin.erro + ")" : "")
      + ". Lance o Pix à mão: diárias em Pessoas e as compras em Mercado.", "warn");
  toast("Pagamento de " + nome + " registrado.");
}
