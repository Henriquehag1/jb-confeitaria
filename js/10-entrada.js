/* JB OS · login, carga inicial e a Home (com as pendências do gestor). */

/* ============================================================
   LOGIN
   ============================================================ */
let escolhido = null;

function montarLogin(){
  $("loginVersao").textContent = "JB OS · versão " + VERSAO;
  const box = $("pickWho");
  box.innerHTML = "";
  LOGINS.forEach(l => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = l.nome;
    b.setAttribute("aria-pressed","false");
    b.onclick = () => {
      escolhido = l;
      [...box.children].forEach(c => c.setAttribute("aria-pressed", String(c === b)));
      $("pin").focus();
    };
    box.appendChild(b);
  });
  const ultimo = localStorage.getItem("jb_ultimo");
  if(ultimo){
    const i = LOGINS.findIndex(l => l.email === ultimo);
    if(i >= 0) box.children[i].click();
  }
}

async function entrar(){
  const pin = $("pin").value.trim();
  $("loginErr").classList.add("hide");
  if(!escolhido){ erroLogin("Toque no seu nome primeiro."); return; }
  if(pin.length < 6){ erroLogin("O PIN tem 6 números."); return; }
  $("btnEntrar").disabled = true;
  $("btnEntrar").textContent = "...";
  const { error } = await sb.auth.signInWithPassword({ email: escolhido.email, password: pin });
  $("btnEntrar").disabled = false;
  $("btnEntrar").textContent = "Entrar";
  if(error){ erroLogin("PIN incorreto. Tente de novo."); $("pin").value = ""; return; }
  localStorage.setItem("jb_ultimo", escolhido.email);
  $("pin").value = "";
  await iniciar();
}
function erroLogin(t){ const e = $("loginErr"); e.textContent = t; e.classList.remove("hide"); }

/* ============================================================
   CARGA
   ============================================================ */
async function iniciar(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session){ montarLogin(); show("scLogin"); return; }

  const { data: u, error: eu } = await sb.from("jb_usuario")
    .select("user_id,nome,papel,ativo").eq("user_id", session.user.id).maybeSingle();
  if(eu){
    /* Erro de rede não é falta de acesso: não derruba a sessão, só avisa. */
    montarLogin(); show("scLogin");
    erroLogin("Sem conexão agora. Confira o sinal e toque em Entrar de novo.");
    return;
  }
  if(!u || u.ativo === false){
    await sb.auth.signOut();
    montarLogin(); show("scLogin");
    erroLogin(!u ? "Este acesso ainda não foi liberado. Fale com o Henrique."
                 : "Este acesso foi encerrado. Fale com o Henrique.");
    return;
  }
  EU = u;

  const { data: p, error: ep } = await sb.from("jb_produto_app").select("id,nome,ordem,foto_url").eq("ativo", true).order("ordem");
  PRODUTOS = p || [];
  PRODUTOS_OK = !ep;

  // quem não é gestor abriu o app hoje, então marca a presença como sugestão
  if(EU.papel !== "gestor") await baterPonto();

  await carregarHome();
}

async function carregarHome(){
  $("whoName").textContent = EU.nome;
  $("homeVersao").textContent = "JB OS · versão " + VERSAO;
  $("homeSub").textContent = EU.papel === "gestor" ? "Ateliê" : (EU.papel === "producao" ? "Produção" : "Contagem de turno");
  $("hoje").textContent = dataLonga(hojeSP());
  $("agora").textContent = horaSP();

  const conta   = EU.papel === "gestor" || EU.papel === "equipe";
  const produz  = EU.papel === "gestor" || EU.papel === "producao";

  ["btnAbertura","btnFechamento","btnHist"].forEach(b => $(b).classList.toggle("hide", !conta));
  $("btnProducao").classList.toggle("hide", !produz);
  $("btnProducao").className = "big" + (conta ? " ghost" : "");
  $("btnProducao").querySelector(".t").textContent =
    EU.papel === "gestor" ? "Plano de produção" : "O que fazer hoje";
  $("btnProducao").querySelector(".s").textContent =
    EU.papel === "gestor" ? "Diga o que precisa ser feito e em que quantidade"
                          : "Suas receitas com as quantidades certas";
  $("homeTip").textContent = conta
    ? "Conte item por item, sem pressa. Se errar, dá para corrigir no mesmo dia."
    : "Toque na receita para ver os ingredientes já na quantidade certa e o passo a passo.";
  $("btnHist").querySelector(".s").textContent = EU.papel === "gestor"
    ? "O que saiu em cada dia"
    : "Os dias que já foram fechados";

  await montarMeusDias();

  if(!conta){
    $("btnCustos").classList.add("hide");
    $("btnDias").classList.add("hide");
    $("btnAfazeres").classList.add("hide");
    aviso("homeMsg","","");
    show("scHome");
    return;
  }

  /* O turno da noite atravessa a meia-noite. Se a equipe abre o app de madrugada
     e o dia de hoje ainda não tem contagem nenhuma, o app segue no turno de ontem,
     para ela conseguir anotar um pedido que saiu depois do fechamento. */
  const ontem = diaMais(-1), hoje = hojeSP();
  const gestor = EU.papel === "gestor";
  const [rc, rp, rok] = await Promise.all([
    sb.from("jb_contagem")
      .select("id,data,momento,registrado_por,nome_responsavel,criado_em")
      .in("data", [ontem, hoje]),
    gestor ? sb.from("jb_pendencias").select("grupo,ordem,texto,dica,qtd").order("ordem") : Promise.resolve({ data: [] }),
    gestor ? sb.from("jb_pendencia_ok").select("chave,texto_quando,ate").gte("ate", hoje) : Promise.resolve({ data: [] })
  ]);
  if(rc.error){
    /* Sem a contagem do dia o app não sabe em que pé está: melhor dizer isso do que
       mostrar botões que vão gravar no lugar errado. */
    aviso("homeMsg","Não consegui falar com o servidor agora. Toque em atualizar quando o sinal voltar.","err");
    $("btnAbertura").classList.add("hide"); $("btnFechamento").classList.add("hide");
    show("scHome");
    return;
  }
  const data = rc.data;
  const doDia = dia => {
    const r = { abertura:null, fechamento:null };
    (data || []).forEach(c => { if(c.data === dia) r[c.momento] = c; });
    return r;
  };
  const hj = doDia(hoje), on = doDia(ontem);
  const madrugada = horaSPnum() < 8;
  /* Turno de ontem: de madrugada, se hoje ainda não tem nada e ontem teve abertura,
     a equipe continua em ontem, tanto para fechar tarde quanto para o adendo. */
  const turnoDeOntem = EU.papel === "equipe" && madrugada
                       && !hj.abertura && !hj.fechamento && !!on.abertura;
  TURNO_DIA = turnoDeOntem ? ontem : hoje;
  HOME_DIA = hoje;
  CONTAGEM_HOJE = turnoDeOntem ? on : hj;
  montarPendencias(rp.data || [], rok.data || []);
  const ab = CONTAGEM_HOJE.abertura, fe = CONTAGEM_HOJE.fechamento;
  const bAb = $("btnAbertura"), bFe = $("btnFechamento");
  /* Deixar a geladeira pronta é parte da Jessica. O cartão nem aparece para a
     equipe, para não haver confusão com o fechamento. Só volta se a própria
     pessoa tiver registrado a abertura daquele dia, para ela poder corrigir. */
  const aberturaMinha = !!ab && ab.registrado_por === EU.user_id;
  const escondeAb = turnoDeOntem || (!gestor && !aberturaMinha);

  bAb.className = "big" + (ab ? " done" : "") + (escondeAb ? " hide" : "");
  bAb.querySelector(".t").textContent = ab ? "Deixado pronto ✓" : "Deixando pronto";
  bAb.querySelector(".s").textContent = ab
    ? "Registrado por " + ab.nome_responsavel + " às " + horaDe(ab.criado_em) + ". Repôs alguma coisa? Toque para somar."
    : "Conte o que está na geladeira agora";

  bFe.className = "big" + (fe ? " done" : (ab ? "" : " ghost"));
  bFe.querySelector(".t").textContent = fe
    ? (turnoDeOntem ? "Turno de ontem fechado ✓" : "Turno fechado ✓")
    : "Fechando o turno";
  bFe.querySelector(".s").textContent = fe
    ? "Registrado por " + fe.nome_responsavel + " às " + horaDe(fe.criado_em) + ". " +
      (gestor ? "Toque para ver o que saiu." : "Toque se saiu algo depois.")
    : (ab ? "Conte o que sobrou no fim da noite" : "Só depois que alguém deixar a geladeira pronta");
  bFe.disabled = !ab && !fe;

  $("btnCustos").classList.toggle("hide", EU.papel !== "gestor");
  $("btnResultado").classList.toggle("hide", EU.papel !== "gestor");
  $("btnDias").classList.toggle("hide", EU.papel !== "gestor");
  $("btnAfazeres").classList.toggle("hide", EU.papel !== "gestor");

  aviso("homeMsg","", "");
  /* Lembrete ativo para a equipe: perto de fechar a loja, com a geladeira pronta
     e o turno em aberto. 22h de segunda a sábado, 21h no domingo. */
  if(!gestor && ab && !fe && (horaSPnum() >= horaDoLembrete() || turnoDeOntem)){
    aviso("homeMsg", turnoDeOntem
      ? "O turno de ontem ainda não foi fechado. Conte o que sobrou e salve."
      : "Hora de fechar o turno: conte o que sobrou na geladeira e salve.", "warn");
  }
  if(gestor){ await Promise.all([avisarAfazeres(), avisarPendencias()]); }
  show("scHome");
}

/* ---------- pendências: o que o banco diz que está faltando ----------
   Uma lista só, gerada pelo dado, no topo da Home do gestor. Cada linha abre
   a tela onde se resolve. Nada aqui depende de alguém lembrar. */
const chavePend = p => p.grupo + ":" + p.ordem;
const PEND_FECHADO = "jb_pend_fechado";
let PEND_VER_GUARDADAS = false;

function montarPendencias(lista, guardadas){
  const box = $("cardPend");
  box.innerHTML = "";
  if(!lista || !lista.length) return;

  /* O que recebeu "ok" some por uma semana. Se a situação mudar, o texto muda
     junto (ele carrega a contagem) e a pendência volta na hora, sem depender
     de ninguém lembrar de reabrir. */
  const ok = {};
  (guardadas || []).forEach(g => ok[g.chave] = g.texto_quando);
  const guardada = p => ok[chavePend(p)] === p.texto;
  const escondidas = lista.filter(guardada);
  const visiveis = PEND_VER_GUARDADAS ? lista : lista.filter(p => !guardada(p));
  if(!visiveis.length && !escondidas.length) return;

  const card = document.createElement("div");
  card.className = "card pend";

  const cab = document.createElement("button");
  cab.type = "button"; cab.className = "cab";
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = "Pendências · " + visiveis.filter(p => !guardada(p)).length;
  const seta = document.createElement("span");
  seta.className = "seta";
  cab.append(k, seta);
  card.appendChild(cab);

  const corpo = document.createElement("div");
  corpo.className = "corpo";
  card.appendChild(corpo);

  /* Nasce fechado: a Home abre limpa, com o título e o número, e a lista fica
     a um toque. Depois vale a escolha da pessoa, guardada no próprio celular. */
  let fechado = true;
  try { fechado = localStorage.getItem(PEND_FECHADO) !== "0"; } catch(e){}
  const pintarAberto = () => {
    corpo.classList.toggle("hide", fechado);
    cab.setAttribute("aria-expanded", String(!fechado));
    seta.textContent = fechado ? "ver ▾" : "fechar ▴";
  };
  cab.onclick = () => {
    fechado = !fechado;
    try { localStorage.setItem(PEND_FECHADO, fechado ? "1" : "0"); } catch(e){}
    pintarAberto();
  };
  pintarAberto();

  const abre = {
    taxa:     () => { ABA = "preco";   abrirCustos(); },
    contagem: () => abrirHistorico(),
    receita:  () => { ABA = "fichas";  abrirCustos(); },
    ficha:    () => { ABA = "fichas";  abrirCustos(); },
    preco:    () => { ABA = "preco";   abrirCustos(); },
    insumo:   () => { ABA = "insumos"; abrirCustos(); },
    presenca: () => abrirDias(),
    sync:     () => abrirMes()
  };
  const linha = p => {
    const row = document.createElement("div");
    row.className = "p " + p.grupo + (guardada(p) ? " guardada" : "");
    const b = document.createElement("button");
    b.type = "button"; b.className = "abre";
    const t = document.createElement("span"); t.className = "t"; t.textContent = p.texto;
    const d = document.createElement("span"); d.className = "d"; d.textContent = p.dica || "";
    b.append(t, d);
    b.onclick = () => { (abre[p.grupo] || (() => {}))(); };
    const bOk = document.createElement("button");
    bOk.type = "button"; bOk.className = "ok";
    bOk.textContent = guardada(p) ? "voltar" : "ok";
    bOk.setAttribute("aria-label", (guardada(p) ? "Trazer de volta: " : "Já sei disso: ") + p.texto);
    bOk.onclick = travar(bOk, () => guardada(p) ? desguardarPendencia(p) : guardarPendencia(p));
    row.append(b, bOk);
    return row;
  };

  const MAX = 5;
  visiveis.slice(0, MAX).forEach(p => corpo.appendChild(linha(p)));
  if(visiveis.length > MAX){
    const m = document.createElement("button");
    m.type = "button"; m.className = "mais";
    m.textContent = "Ver as outras " + (visiveis.length - MAX);
    m.onclick = () => {
      m.remove();
      visiveis.slice(MAX).forEach(p => corpo.appendChild(linha(p)));
    };
    corpo.appendChild(m);
  }

  /* O que foi guardado não desaparece de vez: fica um jeito de olhar e trazer de volta. */
  if(escondidas.length && !PEND_VER_GUARDADAS){
    const g = document.createElement("button");
    g.type = "button"; g.className = "mais";
    g.textContent = escondidas.length === 1
      ? "1 guardada por uma semana. Ver"
      : escondidas.length + " guardadas por uma semana. Ver";
    g.onclick = () => { PEND_VER_GUARDADAS = true; montarPendencias(lista, guardadas); };
    corpo.appendChild(g);
  }
  if(PEND_VER_GUARDADAS){
    const g = document.createElement("button");
    g.type = "button"; g.className = "mais";
    g.textContent = "Esconder de novo as guardadas";
    g.onclick = () => { PEND_VER_GUARDADAS = false; montarPendencias(lista, guardadas); };
    corpo.appendChild(g);
  }

  if(!visiveis.length){
    const p = document.createElement("p");
    p.className = "tip";
    p.style.margin = "2px 4px 6px";
    p.textContent = "Tudo guardado por enquanto. Se alguma situação mudar, ela volta sozinha.";
    corpo.appendChild(p);
  }
  box.appendChild(card);
}

/* "Ok, já sei": some por uma semana, ou até o texto da pendência mudar. */
async function guardarPendencia(p){
  const ate = diaMais(7);
  const { error } = await sb.from("jb_pendencia_ok")
    .upsert({ chave: chavePend(p), texto_quando: p.texto, ate }, { onConflict: "chave" });
  if(error){ aviso("homeMsg","Não consegui guardar essa pendência agora.","err"); return; }
  toast("Guardada por uma semana.");
  await carregarHome();
}

async function desguardarPendencia(p){
  const { error } = await sb.from("jb_pendencia_ok").delete().eq("chave", chavePend(p));
  if(error){ aviso("homeMsg","Não consegui trazer essa pendência de volta agora.","err"); return; }
  PEND_VER_GUARDADAS = false;
  await carregarHome();
}

/* Hora em São Paulo como número, sem depender do formato da string. */
function horaSPnum(){
  return Number(new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric",hourCycle:"h23"}).format(agora()));
}

/* 0 é domingo. Meio-dia evita a virada de fuso na conversão da data. */
function diaDaSemanaSP(iso){
  return new Date((iso || hojeSP()) + "T12:00:00").getDay();
}

/* A loja fecha 22:45 de segunda a sábado e 21:45 no domingo. O lembrete de fechar
   o turno acompanha isso, em vez de chegar sempre no mesmo horário. */
function horaDoLembrete(){
  return diaDaSemanaSP() === 0 ? 21 : 22;
}
