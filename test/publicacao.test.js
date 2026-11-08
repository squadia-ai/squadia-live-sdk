// Metadados de publicação de @squadia/live e os workflows de CI e de publicação no npm.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as entrada from "../src/index.js";

const ler = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pkg = JSON.parse(ler("package.json"));

/** Linhas dentro de blocos `run:` (inline ou `run: |`), para conferir que nenhum interpola `${{ }}`. */
function linhasDeRun(yaml) {
  const linhas = yaml.split("\n");
  const saida = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(linhas[i]);
    if (!m) continue;
    if (m[2] !== "|" && m[2] !== ">") {
      saida.push(m[2]);
      continue;
    }
    const recuo = m[1].length;
    for (let j = i + 1; j < linhas.length && (linhas[j].trim() === "" || linhas[j].search(/\S/) > recuo); j++) saida.push(linhas[j]);
  }
  return saida;
}

test("package.json: nome público @squadia/live, publicação pública com proveniência", () => {
  assert.equal(pkg.name, "@squadia/live");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.publishConfig, { access: "public", provenance: true, registry: "https://registry.npmjs.org/" });
  assert.equal(pkg.repository.url, "git+https://github.com/squadia-ai/squadia-live-sdk.git");
  assert.deepEqual(pkg.files, ["bin/", "src/"]);
  assert.equal(pkg.exports["."].default, "./src/index.js");
  assert.equal(pkg.exports["."].types, "./src/index.d.ts");
  assert.equal(pkg.main, "./src/index.js");
  assert.equal(pkg.types, "./src/index.d.ts");
  for (const f of [pkg.main, pkg.types, pkg.bin.publicar]) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
});

test("a entrada do pacote exporta nome, versão e a validação do app.json, sem efeito colateral", () => {
  assert.equal(entrada.nome, "@squadia/live");
  assert.equal(entrada.versao, pkg.version);
  assert.equal(entrada.API_PADRAO, "https://squadia.live");
  assert.equal(entrada.validarAppJson({ id: "a", acesso: "publico", pasta: "dist" }).ok, true);
  assert.equal(entrada.validarAppJsonTexto("{").ok, false);
  const tipos = ler("src/index.d.ts");
  for (const nome of Object.keys(entrada)) assert.match(tipos, new RegExp(`export (const|function) ${nome}\\b`), `tipo de ${nome}`);
});

test("workflow de publicação: por tag, trusted publishing (OIDC) com --provenance, sem token no repositório", () => {
  const y = ler(".github/workflows/publicar.yml");
  assert.match(y, /^on:\n {2}push:\n {4}tags: \["v\*\.\*\.\*"\]/m);
  assert.match(y, /^permissions:\n {2}contents: read\n {2}id-token: write$/m);
  assert.match(y, /if: github\.ref_type == 'tag'/);
  assert.match(y, /run: npm publish --provenance --access public$/m);
  assert.match(y, /registry-url: https:\/\/registry\.npmjs\.org/);
  assert.doesNotMatch(y, /secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|pull_request/);
  // A versão publicada é a do package.json e tem de bater com a tag (tag só entra por env:).
  assert.match(y, /TAG: \$\{\{ github\.ref_name \}\}/);
  for (const l of linhasDeRun(y)) assert.doesNotMatch(l, /\$\{\{/, `interpolação em run: ${l}`);
  assert.ok(linhasDeRun(y).some((l) => l.includes('"$TAG" != "$esperada"')));
});

test("CI do PR: testes, npm pack e instalação do tarball em projeto temporário", () => {
  const y = ler(".github/workflows/ci.yml");
  assert.match(y, /^on:\n {2}pull_request:\n {4}branches: \[develop\]/m);
  assert.match(y, /^permissions:\n {2}contents: read$/m);
  assert.match(y, /run: npm test$/m);
  assert.match(y, /run: npm pack --dry-run$/m);
  assert.match(y, /run: npm run test:pacote$/m);
  assert.doesNotMatch(y, /secrets\.|id-token/);
  for (const l of linhasDeRun(y)) assert.doesNotMatch(l, /\$\{\{/, `interpolação em run: ${l}`);
  assert.equal(pkg.scripts["test:pacote"], 'node --test "test/pacote/*.test.js"');
});

test("README apresenta o pacote pelo nome público", () => {
  const readme = ler("README.md");
  assert.match(readme, /^# @squadia\/live$/m);
  assert.match(readme, /npm install -g @squadia\/live/);
  assert.match(readme, /import \{[^}]*\} from "@squadia\/live"/);
  assert.doesNotMatch(readme, /npm install -g github:/);
});
