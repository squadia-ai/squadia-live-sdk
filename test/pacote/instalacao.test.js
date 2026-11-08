// Prova que @squadia/live é instalável sem depender da publicação real: empacota (npm pack), instala o
// tarball num projeto temporário e importa o pacote de lá. Roda na CI (`npm run test:pacote`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function npm(args, cwd) {
  const r = spawnSync(NPM, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });
  assert.equal(r.status, 0, `npm ${args.join(" ")} falhou:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test("o tarball de @squadia/live instala num projeto temporário e pode ser importado", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "squadia-live-pacote-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // npm <= 11 devolve uma lista; npm 12 devolve um objeto indexado pelo nome do pacote.
  const saida = JSON.parse(npm(["pack", "--json", "--pack-destination", tmp], RAIZ));
  const pacote = Array.isArray(saida) ? saida[0] : Object.values(saida)[0];
  assert.equal(pacote.name, "@squadia/live");
  const arquivos = pacote.files.map((f) => f.path);
  for (const obrigatorio of ["package.json", "README.md", "LICENSE", "bin/publicar.js", "src/index.js", "src/index.d.ts"]) {
    assert.ok(arquivos.includes(obrigatorio), `falta ${obrigatorio} no pacote`);
  }
  assert.ok(!arquivos.some((f) => f.startsWith("test/") || f.startsWith(".github/")), "teste ou workflow no pacote");

  const projeto = path.join(tmp, "projeto");
  fs.mkdirSync(projeto);
  fs.writeFileSync(path.join(projeto, "package.json"), JSON.stringify({ name: "projeto-temporario", private: true, type: "module" }));
  npm(["install", "--no-save", "--ignore-scripts", path.join(tmp, pacote.filename)], projeto);

  const importa = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", 'const m = await import("@squadia/live"); console.log(JSON.stringify({ nome: m.nome, versao: m.versao, ok: m.validarAppJson({ id: "a", acesso: "publico", pasta: "dist" }).ok }));'],
    { cwd: projeto, encoding: "utf8" },
  );
  assert.equal(importa.status, 0, importa.stderr);
  const versao = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8")).version;
  assert.deepEqual(JSON.parse(importa.stdout), { nome: "@squadia/live", versao, ok: true });

  const instalado = path.join(projeto, "node_modules", "@squadia", "live");
  assert.ok(fs.existsSync(path.join(instalado, "src", "index.d.ts")), "tipos ausentes no pacote instalado");
  const cli = spawnSync(process.execPath, [path.join(instalado, "bin", "publicar.js"), "--ajuda"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /uso: publicar --app <app>/);
  assert.ok(fs.existsSync(path.join(projeto, "node_modules", ".bin", "publicar")), "executável publicar não foi ligado");
});
