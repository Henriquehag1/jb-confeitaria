const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { abrir, encerrar } = require("./harness");

test.after(encerrar);
const semErros = a => assert.deepEqual(a.erros, [], "sem erros de página");

const ARQUIVO = path.resolve(__dirname, "..", "img", "insumos", "nutella.jpg");

/* abre a aba Insumos e clica em editar a linha do insumo pelo nome */
async function editarInsumo(a, nome){
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaInsumos"); await a.espera(700);
  await a.page.evaluate(n => {
    const row = [...document.querySelectorAll("#listaCustos .ing")]
      .find(r => r.querySelector(".nm").textContent.trim() === n);
    row.querySelector(".bot .rm").click();
  }, nome);
  await a.espera(300);
}

test("o campo de foto aparece no editar insumo, com miniatura e botão", async () => {
  const a = await abrir("uJes");
  await editarInsumo(a, "Ovos");
  const t = await a.page.evaluate(() => {
    const cf = document.querySelector("#formCustos .campofoto");
    if(!cf) return null;
    return {
      botao: cf.querySelector("button.fotobt").textContent,
      temArquivo: !!cf.querySelector('input[type="file"]'),
      accept: cf.querySelector('input[type="file"]').accept,
      semFoto: !!cf.querySelector(".prev .sem"),
      url: cf.querySelector(".urlfoto").value
    };
  });
  assert.equal(t.temArquivo, true, "tem o input de arquivo escondido");
  assert.equal(t.accept, "image/*", "abre a câmera e a galeria do celular");
  assert.equal(t.botao, "Tirar ou escolher foto");
  assert.equal(t.semFoto, true, "sem foto ainda");
  assert.equal(t.url, "");
  semErros(a); await a.fechar();
});

test("escolher uma foto sobe para o storage e grava o link no insumo", async () => {
  const a = await abrir("uJes");
  await editarInsumo(a, "Ovos");
  await a.page.setInputFiles("#formCustos .campofoto input[type=file]", ARQUIVO);
  await a.espera(900);

  const up = (await a.log("upload"))[0];
  assert.ok(up, "subiu alguma coisa: " + JSON.stringify(await a.log()));
  assert.equal(up[1], "fotos", "balde certo");
  assert.match(up[2], /^insumo\/\d+-\d+\.jpg$/, "caminho: " + up[2]);
  assert.equal(up[4], "image/jpeg", "sobe sempre em jpeg");
  assert.ok(up[3] > 0 && up[3] < 200000, "encolhida antes de subir, " + up[3] + " bytes");

  const est = await a.page.evaluate(() => ({
    url: document.querySelector("#formCustos .urlfoto").value,
    botao: document.querySelector("#formCustos button.fotobt").textContent,
    temImg: !!document.querySelector("#formCustos .campofoto .prev img")
  }));
  assert.match(est.url, /^https:\/\/stub\.local\/storage\/v1\/object\/public\/fotos\/insumo\//);
  assert.equal(est.botao, "Trocar a foto");
  assert.equal(est.temImg, true, "a miniatura trocou na hora");
  assert.match(await a.texto("#toast"), /Foto no ar/);

  // salvar grava o link
  await a.page.evaluate(() => [...document.querySelectorAll("#formCustos .acoes button")]
    .find(b => b.textContent === "Salvar").click());
  await a.espera(700);
  const upd = (await a.log("update")).filter(u => u[1] === "jb_insumo");
  assert.equal(upd.length, 1);
  assert.equal(upd[0][2].foto_url, est.url);
  semErros(a); await a.fechar();
});

test("a foto que já existe aparece na miniatura e o botão diz trocar", async () => {
  const a = await abrir("uJes", { db: db => {
    db.jb_insumo.find(i => i.nome === "Ovos").foto_url = "img/insumos/nutella.jpg";
    return db;
  }});
  await editarInsumo(a, "Ovos");
  const t = await a.page.evaluate(() => ({
    botao: document.querySelector("#formCustos button.fotobt").textContent,
    src: (document.querySelector("#formCustos .campofoto .prev img") || {}).getAttribute
       ? document.querySelector("#formCustos .campofoto .prev img").getAttribute("src") : null
  }));
  assert.equal(t.botao, "Trocar a foto");
  assert.equal(t.src, "img/insumos/nutella.jpg");
  semErros(a); await a.fechar();
});

test("quando a internet cai no meio, a foto antiga fica e o aviso é claro", async () => {
  const a = await abrir("uJes", { falha: { upload: true } });
  await editarInsumo(a, "Ovos");
  await a.page.setInputFiles("#formCustos .campofoto input[type=file]", ARQUIVO);
  await a.espera(900);
  assert.match(await a.texto("#toast"), /A internet caiu no meio/);
  assert.equal(await a.page.evaluate(() => document.querySelector("#formCustos .urlfoto").value), "",
    "não inventou link nenhum");
  assert.equal(await a.page.evaluate(() => document.querySelector("#formCustos button.fotobt").disabled), false,
    "o botão volta a funcionar");
  semErros(a); await a.fechar();
});

test("a ficha do produto também sobe foto pelo mesmo botão", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.evaluate(() => abrirFicha(10, "ficha")); await a.espera(800);
  assert.equal(await a.tela(), "scFicha");
  await a.page.setInputFiles("#fFotoArq", ARQUIVO);
  await a.espera(900);
  const up = (await a.log("upload"))[0];
  assert.ok(up, "subiu");
  assert.match(up[2], /^ficha\/10-\d+\.jpg$/, "caminho: " + up[2]);
  assert.match(await a.page.evaluate(() => document.getElementById("fFoto").value),
               /\/fotos\/ficha\/10-/);
  assert.equal(await a.page.evaluate(() => !!document.querySelector("#fFotoPrev img")), true);
  semErros(a); await a.fechar();
});

test("o ingrediente novo já nasce com foto", async () => {
  const a = await abrir("uJes");
  await a.page.click("#btnCustos"); await a.espera(600);
  await a.page.click("#abaInsumos"); await a.espera(700);
  await a.page.evaluate(() => [...document.querySelectorAll("#listaCustos .lin")]
    .find(b => b.querySelector(".n").childNodes[0].textContent.trim() === "Novo ingrediente").click());
  await a.espera(400);
  const temCampo = await a.page.evaluate(() => !!document.querySelector("#formCustos .campofoto"));
  assert.equal(temCampo, true, "o formulário de novo ingrediente tem o botão de foto");
  semErros(a); await a.fechar();
});
