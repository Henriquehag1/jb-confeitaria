/* Falha se o app declarar duas vezes a mesma função ou variável de topo.
   Foi assim que montarDias virou duas e o plano de produção perdeu o seletor de dia. */
const fs = require("fs");
const path = require("path");

const raiz = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");

/* junta o script inline e os arquivos .js que a página carrega da própria pasta */
const fontes = [];
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
inline.forEach((c, i) => fontes.push({ nome: "index.html <script> #" + (i + 1), codigo: c }));
[...html.matchAll(/<script src="([^"]+\.js)(?:\?[^"]*)?"><\/script>/g)]
  .map(m => m[1]).filter(src => !/^https?:/.test(src))
  .forEach(src => fontes.push({ nome: src, codigo: fs.readFileSync(path.join(raiz, src), "utf8") }));

const vistos = new Map();
const problemas = [];
for(const f of fontes){
  const linhas = f.codigo.split("\n");
  linhas.forEach((l, i) => {
    const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) || l.match(/^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\b/);
    if(!m) return;
    const nome = m[1];
    const onde = f.nome + ":" + (i + 1);
    if(vistos.has(nome)) problemas.push(nome + " declarado em " + vistos.get(nome) + " e de novo em " + onde);
    else vistos.set(nome, onde);
  });
}

/* todo $("id") no código precisa existir no HTML: foi assim que o smoke2 quebrou em silêncio */
const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const criadosNoJs = new Set();
for(const f of fontes) for(const m of f.codigo.matchAll(/\.id\s*=\s*"([^"]+)"/g)) criadosNoJs.add(m[1]);
for(const f of fontes){
  for(const m of f.codigo.matchAll(/\$\("([^"]+)"\)/g)){
    const id = m[1];
    if(!idsHtml.has(id) && !criadosNoJs.has(id)) problemas.push('$("' + id + '") em ' + f.nome + " não existe no HTML");
  }
}

/* sintaxe: cada fonte precisa compilar sozinha */
for(const f of fontes){
  try { new Function(f.codigo); }
  catch(e){ problemas.push("erro de sintaxe em " + f.nome + ": " + e.message); }
}

if(problemas.length){
  console.error("Declarações duplicadas ou erro de sintaxe:\n  " + problemas.join("\n  "));
  process.exit(1);
}
console.log("lint ok: " + vistos.size + " declarações de topo, nenhuma repetida, " + fontes.length + " arquivo(s)");
