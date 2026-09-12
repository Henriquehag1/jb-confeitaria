/* JB OS · ligações dos botões e partida do app. Tem que ser o último arquivo. */

/* ============================================================
   LIGAÇÕES
   ============================================================ */
$("navVoltar").onclick = () => { const c = NAV[TELA]; if(c) c.voltar(); else carregarHome(); };
$("navRecarregar").onclick = recarregarTela;
$("homeRecarregar").onclick = recarregarTela;

// o botão de voltar do celular anda junto com a tela
window.addEventListener("popstate", () => {
  POR_POP = true;
  setTimeout(() => { POR_POP = false; }, 4000);   // se a volta não trocar de tela, não fica preso
  const c = NAV[TELA];
  if(c){ c.voltar(); }
  else if(TELA !== "scLogin" && TELA !== "scHome"){ carregarHome(); }
  else POR_POP = false;
});

// o relógio da home não pode envelhecer com o app aberto
setInterval(() => { if(TELA === "scHome") $("agora").textContent = horaSP(); }, 30000);

/* O celular mantém o app aberto por dias. Ao voltar para ele, se o dia mudou,
   a Home se refaz (senão gravaria no dia errado) e a presença do dia é sugerida. */
document.addEventListener("visibilitychange", async () => {
  if(document.visibilityState !== "visible" || !EU) return;
  if(HOME_DIA && hojeSP() !== HOME_DIA){
    if(EU.papel !== "gestor") await baterPonto();
    if(TELA === "scHome") await carregarHome();
    else HOME_DIA = null;   // na próxima volta para a Home ela se refaz
  }
});

/* Sessão que expirou de verdade volta para o login em vez de falhar em silêncio. */
sb.auth.onAuthStateChange((evento) => {
  if(evento === "SIGNED_OUT" && TELA !== "scLogin"){ EU = null; montarLogin(); show("scLogin"); }
});

// sair é definitivo para quem não sabe o PIN, então pergunta antes
$("btnEntrar").onclick = entrar;
$("pin").addEventListener("keydown", e => { if(e.key === "Enter") entrar(); });
$("btnSair").onclick = async () => {
  if(!confirm("Sair do app?\n\nPara entrar de novo vai precisar do PIN.")) return;
  await sb.auth.signOut(); montarLogin(); show("scLogin");
};
$("btnAbertura").onclick = () => abrirContagem("abertura");
$("btnFechamento").onclick = () => {
  if(!CONTAGEM_HOJE.fechamento) return abrirContagem("fechamento");
  if(EU && EU.papel === "gestor") return mostrarResultado(diaDoTurno());
  return mostrarFeito(diaDoTurno());
};
$("btnAdendo").onclick = () => abrirAdendo(FEITO_DIA || diaDoTurno());
$("btnFeitoOk").onclick = carregarHome;
$("btnAdSalvar").onclick = salvarAdendo;
$("btnAdVoltar").onclick = () => mostrarFeito(FEITO_DIA || diaDoTurno());
$("btnPeSalvar").onclick = salvarPerda;
$("btnPeVoltar").onclick = voltarDaPerda;
$("peObs").addEventListener("input", pintarPerda);
$("adTexto").addEventListener("input", pintarAdendo);
$("btnHist").onclick = abrirHistorico;
$("btnEditarLista").onclick = alternarEdicaoLista;
$("btnModoRepor").onclick  = () => trocarModo("repor");
$("btnModoContar").onclick = () => trocarModo("contar");
$("btnSalvar").onclick = salvar;
$("btnVoltar").onclick = carregarHome;
$("btnResOk").onclick = carregarHome;

$("btnCustos").onclick = abrirCustos;
$("btnResultado").onclick = abrirMes;
$("btnDias").onclick = abrirDias;
$("btnAfazeres").onclick = abrirAfazeres;
$("afaAdd").onclick = addTarefa;
$("afaTexto").addEventListener("input", () => {
  const escrevendo = $("afaTexto").value.trim().length > 0;
  $("afaDetalhe").classList.toggle("hide", !escrevendo);
  $("afaAdd").disabled = !escrevendo;
});
$("afaTexto").addEventListener("keydown", e => { if(e.key === "Enter") addTarefa(); });
$("afaVerFeitas").onclick = () => { AFA_VER_FEITAS = !AFA_VER_FEITAS; montarAfazeres(); };
$("abaFichas").onclick = () => trocarAba("fichas");
$("abaInsumos").onclick = () => trocarAba("insumos");
$("abaPreco").onclick   = () => trocarAba("preco");
$("abaGeladeira").onclick = () => trocarAba("geladeira");

$("btnProducao").onclick = abrirProducao;
$("addProd").onchange = () => addReceitaAoDia($("addProd").value);
$("btnRecFeito").onclick = marcarFeito;
$("btnFichaApagar").onclick = apagarFicha;
$("fFoto").addEventListener("change", mostrarFoto);
$("fFoto").addEventListener("blur", mostrarFoto);
$("fPreparo").addEventListener("input", avisoPreparo);
$("fConferido").addEventListener("change", avisoPreparo);
$("buscaInsumo").addEventListener("input", () => { if(ABA === "insumos") listarInsumos(); });
$("fRend").addEventListener("input", calcular);
$("btnFichaSalvar").onclick = salvarFicha;
$("btnFichaVoltar").onclick = sairDaFicha;
/* qualquer digitação na ficha marca que há trabalho não salvo */
$("scFicha").addEventListener("input", () => { FICHA_SUJA = true; });
$("scFicha").addEventListener("change", () => { FICHA_SUJA = true; });

iniciar();
