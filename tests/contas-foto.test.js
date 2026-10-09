const test = require("node:test");
const assert = require("node:assert/strict");
const { abrir, encerrar } = require("./harness");
test.after(encerrar);
test("foto grande do celular encolhe antes de subir; pdf e foto pequena passam inteiros", async () => {
  const a = await abrir("uJes");
  const r = await a.page.evaluate(async () => {
    const cv = document.createElement("canvas"); cv.width = 3000; cv.height = 2200;
    const g = cv.getContext("2d"); const img = g.createImageData(3000, 2200);
    for(let i = 0; i < img.data.length; i++) img.data[i] = (Math.random() * 255) | 0;
    g.putImageData(img, 0, 0);
    const blob = await new Promise(ok => cv.toBlob(ok, "image/png"));
    const grande = new File([blob], "IMG_1.png", { type: "image/png" });
    const g2 = await contaReduzirFoto(grande);
    const pdf = new File([new Uint8Array(2000000)], "x.pdf", { type: "application/pdf" });
    const peq = new File([new Uint8Array(1000)], "p.jpg", { type: "image/jpeg" });
    const bmp = await createImageBitmap(g2);
    return { antes: grande.size, depois: g2.size, tipo: g2.type, nome: g2.name, lado: Math.max(bmp.width, bmp.height),
             pdf: (await contaReduzirFoto(pdf)) === pdf, peq: (await contaReduzirFoto(peq)) === peq };
  });
  assert.ok(r.depois < r.antes, JSON.stringify(r));
  assert.equal(r.tipo, "image/jpeg"); assert.equal(r.nome, "IMG_1.jpg"); assert.equal(r.lado, 1800);
  assert.ok(r.pdf && r.peq);
  assert.deepEqual(a.erros, []); await a.fechar();
});
