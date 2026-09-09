/* JB OS · afazeres da Jessica. */

/* ============================================================
   AFAZERES
   A lista de tarefas da Jessica. Compartilhada entre os dois gestores,
   porque comprar embalagem é tarefa do negócio, não de uma pessoa.
   A equipe e a produção não veem nada disso.
   ============================================================ */
let AFA = [];                 // tarefas carregadas
let AFA_QUANDO = "hoje";      // vira a data de hoje na hora de montar; null é sem data
let AFA_CAT = "outro";
let AFA_VER_FEITAS = false;

const CATEGORIAS = [
  { k: "produzir", r: "Produzir" },
  { k: "comprar",  r: "Comprar"  },
  { k: "contato",  r: "Falar com" },
  { k: "outro",    r: "Outro"    }
];
const CAT_ROTULO = k => (CATEGORIAS.find(c => c.k === k) || CATEGORIAS[3]).r;

function maisDias(iso, n){
  const [a,m,d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m-1, d + n));
  return dt.toISOString().slice(0,10);
}

// as mesmas opções de data servem para criar e para adiar uma tarefa
function opcoesQuando(box, atual, escolher){
  box.innerHTML = "";
  const hoje = hojeSP();
  [["Hoje", hoje], ["Amanhã", maisDias(hoje,1)], ["Sem data", null]].forEach(([rot, val]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = rot;
    b.setAttribute("aria-pressed", String(atual === val));
    b.onclick = () => escolher(val);
    box.appendChild(b);
  });
  const inp = document.createElement("input");
  inp.type = "date";
  inp.setAttribute("aria-label","Escolher outra data");
  if(atual && atual !== hoje && atual !== maisDias(hoje,1)) inp.value = atual;
  inp.onchange = () => escolher(inp.value || null);
  box.appendChild(inp);
}

function opcoesCategoria(box, atual, escolher){
  box.innerHTML = "";
  CATEGORIAS.forEach(c => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c.r;
    b.setAttribute("aria-pressed", String(atual === c.k));
    b.onclick = () => escolher(c.k);
    box.appendChild(b);
  });
}

// na home, o botão diz o que está pegando fogo
async function avisarAfazeres(){
  const b = $("btnAfazeres");
  let atrasadas = 0, hoje = 0;
  try {
    const { data, error } = await sb.from("jb_tarefa").select("prazo").eq("feito", false);
    if(!error && data){
      const h = hojeSP();
      data.forEach(t => { if(t.prazo && t.prazo < h) atrasadas++; else if(t.prazo === h) hoje++; });
    }
  } catch(e){}
  const partes = [];
  if(atrasadas) partes.push(atrasadas === 1 ? "1 atrasada" : atrasadas + " atrasadas");
  if(hoje)      partes.push(hoje === 1 ? "1 para hoje" : hoje + " para hoje");
  b.className = atrasadas > 0 ? "big" : "big ghost";
  b.querySelector(".s").textContent = partes.length ? partes.join(", ") : "Sua lista de tarefas";
}

async function abrirAfazeres(){
  aviso("afaMsg","","");
  const { data, error } = await sb.from("jb_tarefa").select("*").order("criado_em");
  if(error){
    aviso("afaMsg","Não consegui carregar a lista agora. Toque em atualizar.","err");
    show("scAfa"); return;
  }
  AFA = data || [];
  montarAfazeres();
  show("scAfa");
}

async function addTarefa(){
  const texto = $("afaTexto").value.trim();
  if(!texto) return;
  $("afaAdd").disabled = true;
  const { data, error } = await sb.from("jb_tarefa")
    .insert({ texto, categoria: AFA_CAT, prazo: quandoValor(), criado_por: EU.user_id })
    .select("*").single();
  $("afaAdd").disabled = false;
  if(error){ aviso("afaMsg","Não consegui salvar essa tarefa agora.","err"); return; }
  AFA.push(data);
  $("afaTexto").value = "";
  AFA_CAT = "outro";
  AFA_QUANDO = "hoje";
  aviso("afaMsg","","");
  montarAfazeres();
  $("afaTexto").focus();
}

// "hoje" só vira data na hora de gravar, para o app aberto virando o dia não errar
function quandoValor(){ return AFA_QUANDO === "hoje" ? hojeSP() : AFA_QUANDO; }

async function mudarTarefa(t, campos){
  const { error } = await sb.from("jb_tarefa").update(campos).eq("id", t.id);
  if(error){ aviso("afaMsg","Não consegui salvar essa mudança agora.","err"); return false; }
  Object.assign(t, campos);
  aviso("afaMsg","","");
  montarAfazeres();
  return true;
}

async function apagarTarefa(t){
  if(!confirm("Apagar esta tarefa?\n\n" + t.texto)) return;
  const { error } = await sb.from("jb_tarefa").delete().eq("id", t.id);
  if(error){ aviso("afaMsg","Não consegui apagar agora.","err"); return; }
  AFA = AFA.filter(x => x.id !== t.id);
  montarAfazeres();
}

function prazoRotulo(iso){
  const hoje = hojeSP();
  if(!iso) return null;
  if(iso === hoje) return "hoje";
  if(iso === maisDias(hoje,1)) return "amanhã";
  if(iso === maisDias(hoje,-1)) return "era ontem";
  return dataCurta(iso);
}

function linhaTarefa(t){
  const row = document.createElement("div");
  row.className = "tarefa" + (t.feito ? " pronta" : "");

  const marca = document.createElement("button");
  marca.type = "button"; marca.className = "marca";
  marca.textContent = t.feito ? "✓" : "";
  marca.setAttribute("aria-label", (t.feito ? "Desmarcar " : "Marcar como feita ") + t.texto);
  marca.onclick = travar(marca, () => mudarTarefa(t, t.feito
    ? { feito: false, feito_em: null }
    : { feito: true, feito_em: new Date().toISOString() }));
  row.appendChild(marca);

  const corpo = document.createElement("div");
  corpo.className = "corpo";

  const txt = document.createElement("div");
  txt.className = "t";
  txt.textContent = t.texto;
  // tocar no texto abre para editar, sem sair da lista
  txt.onclick = () => {
    if(t.feito) return;
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = t.texto; inp.className = "txt";
    inp.style.width = "100%";
    let fechado = false;
    const fechar = async (salvar) => {
      if(fechado) return;
      fechado = true;
      const novo = inp.value.trim();
      if(salvar && novo && novo !== t.texto) await mudarTarefa(t, { texto: novo });
      else montarAfazeres();
    };
    inp.onblur = () => fechar(true);
    inp.addEventListener("keydown", e => {
      if(e.key === "Enter") fechar(true);
      if(e.key === "Escape") fechar(false);
    });
    txt.replaceWith(inp);
    inp.focus(); inp.select();
  };
  corpo.appendChild(txt);

  const meta = document.createElement("div");
  meta.className = "meta";

  const cat = document.createElement("span");
  cat.className = "cat";
  cat.textContent = CAT_ROTULO(t.categoria);
  cat.onclick = () => {
    if(t.feito) return;
    const cx = document.createElement("div");
    cx.className = "opcoes";
    cx.style.marginTop = "6px";
    opcoesCategoria(cx, t.categoria, k => mudarTarefa(t, { categoria: k }));
    meta.replaceWith(cx);
    corpo.appendChild(cx);
  };
  meta.appendChild(cat);

  const rot = prazoRotulo(t.prazo);
  const atrasada = !t.feito && t.prazo && t.prazo < hojeSP();
  const dt = document.createElement("span");
  if(atrasada) dt.className = "atrasada";
  dt.textContent = rot || "sem data";
  dt.onclick = () => {
    if(t.feito) return;
    const qx = document.createElement("div");
    qx.className = "opcoes";
    qx.style.marginTop = "6px";
    opcoesQuando(qx, t.prazo, v => mudarTarefa(t, { prazo: v }));
    meta.replaceWith(qx);
    corpo.appendChild(qx);
  };
  meta.appendChild(dt);

  corpo.appendChild(meta);
  row.appendChild(corpo);

  const lixo = document.createElement("button");
  lixo.type = "button"; lixo.className = "lixo"; lixo.textContent = "×";
  lixo.setAttribute("aria-label", "Apagar " + t.texto);
  lixo.onclick = travar(lixo, () => apagarTarefa(t));
  row.appendChild(lixo);

  return row;
}

function montarAfazeres(){
  // formulário de cima. As opções só aparecem depois que ela começa a escrever,
  // para a tela abrir na lista e não num formulário.
  const escrevendo = $("afaTexto").value.trim().length > 0;
  $("afaDetalhe").classList.toggle("hide", !escrevendo);
  opcoesQuando($("afaQuando"), quandoValor(), v => { AFA_QUANDO = v; montarAfazeres(); });
  opcoesCategoria($("afaCat"), AFA_CAT, k => { AFA_CAT = k; montarAfazeres(); });
  $("afaAdd").disabled = !escrevendo;

  const hoje = hojeSP(), amanha = maisDias(hoje,1);
  const abertas = AFA.filter(t => !t.feito);
  const feitas  = AFA.filter(t => t.feito)
                     .sort((a,b) => String(b.feito_em||"").localeCompare(String(a.feito_em||"")));

  const grupos = [
    { rot: "Atrasado",  urgente: true,  itens: abertas.filter(t => t.prazo && t.prazo < hoje) },
    { rot: "Hoje",      urgente: false, itens: abertas.filter(t => t.prazo === hoje) },
    { rot: "Amanhã",    urgente: false, itens: abertas.filter(t => t.prazo === amanha) },
    { rot: "Próximos dias", urgente: false, itens: abertas.filter(t => t.prazo && t.prazo > amanha) },
    { rot: "Sem data",  urgente: false, itens: abertas.filter(t => !t.prazo) }
  ];

  const box = $("afaLista");
  box.innerHTML = "";

  if(!abertas.length){
    const v = document.createElement("div");
    v.className = "vazio";
    v.textContent = feitas.length
      ? "Nada em aberto. Tudo em dia por aqui."
      : "Sua lista está vazia. Escreva ali em cima o que precisa ser feito e escolha para quando.";
    box.appendChild(v);
  }

  grupos.forEach(g => {
    if(!g.itens.length) return;
    g.itens.sort((a,b) => String(a.prazo||"").localeCompare(String(b.prazo||""))
                       || String(a.criado_em).localeCompare(String(b.criado_em)));
    const h = document.createElement("div");
    h.className = "grupotar" + (g.urgente ? " urgente" : "");
    h.textContent = g.rot + " · " + g.itens.length;
    box.appendChild(h);
    g.itens.forEach(t => box.appendChild(linhaTarefa(t)));
  });

  // as feitas ficam guardadas, para a lista não virar um cemitério
  const bf = $("afaVerFeitas");
  bf.classList.toggle("hide", feitas.length === 0);
  bf.textContent = AFA_VER_FEITAS
    ? "Esconder as feitas"
    : "Ver as " + feitas.length + (feitas.length === 1 ? " feita" : " feitas");
  const fx = $("afaFeitas");
  fx.innerHTML = "";
  if(AFA_VER_FEITAS) feitas.slice(0,40).forEach(t => fx.appendChild(linhaTarefa(t)));
}
