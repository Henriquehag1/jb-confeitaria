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
  const [rc, rp] = await Promise.all([
    sb.from("jb_contagem")
      .select("id,data,momento,registrado_por,nome_responsavel,criado_em")
      .in("data", [ontem, hoje]),
    gestor ? sb.from("jb_pendencias").select("grupo,ordem,texto,dica,qtd").order("ordem") : Promise.resolve({ data: [] })
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
  montarPendencias(rp.data || []);
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
  /* Lembrete ativo para a equipe: depois das 22h com a geladeira pronta e sem fechar. */
  if(!gestor && ab && !fe && (horaSPnum() >= 22 || turnoDeOntem)){
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
function montarPendencias(lista){
  const box = $("cardPend");
  box.innerHTML = "";
  if(!lista || !lista.length) return;
  const card = document.createElement("div");
  card.className = "card pend";
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = "Pendências · " + lista.length;
  card.appendChild(k);
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
  const MAX = 5;
  lista.slice(0, MAX).forEach(p => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "p " + p.grupo;
    const t = document.createElement("span"); t.className = "t"; t.textContent = p.texto;
    const d = document.createElement("span"); d.className = "d"; d.textContent = p.dica || "";
    b.append(t, d);
    b.onclick = () => { (abre[p.grupo] || (() => {}))(); };
    card.appendChild(b);
  });
  if(lista.length > MAX){
    const m = document.createElement("button");
    m.type = "button"; m.className = "mais";
    m.textContent = "Ver as outras " + (lista.length - MAX);
    m.onclick = () => {
      m.remove();
      lista.slice(MAX).forEach(p => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "p " + p.grupo;
        const t = document.createElement("span"); t.className = "t"; t.textContent = p.texto;
        const d = document.createElement("span"); d.className = "d"; d.textContent = p.dica || "";
        b.append(t, d);
        b.onclick = () => { (abre[p.grupo] || (() => {}))(); };
        card.appendChild(b);
      });
    };
    card.appendChild(m);
  }
  box.appendChild(card);
}

/* Hora em São Paulo como número, sem depender do formato da string. */
function horaSPnum(){
  return Number(new Intl.DateTimeFormat("en-US",{timeZone:TZ,hour:"numeric",hourCycle:"h23"}).format(agora()));
}
