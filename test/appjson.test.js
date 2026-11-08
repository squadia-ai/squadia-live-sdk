import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validarAppJson, validarAppJsonTexto } from "../src/appjson.js";

const ok = { id: "meu-app", acesso: "publico", pasta: "dist" };

test("app.json válido passa", () => assert.equal(validarAppJson(ok).ok, true));

for (const campo of ["id", "acesso", "pasta"]) {
  test(`campo ${campo} ausente nomeia o campo`, () => {
    const { [campo]: _, ...resto } = ok;
    const r = validarAppJson(resto);
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [`app.json: campo "${campo}" ausente`]);
  });
  test(`campo ${campo} com tipo errado nomeia o campo`, () => {
    const r = validarAppJson({ ...ok, [campo]: 5 });
    assert.match(r.errors[0], new RegExp(`campo "${campo}" inválido`));
  });
}

test("id com caracteres inválidos", () => {
  assert.match(validarAppJson({ ...ok, id: "a/b" }).errors[0], /campo "id" inválido/);
});

test("pasta absoluta e que escapa são rejeitadas", () => {
  for (const pasta of ["/etc", "../fora", "a/../../x", "..", "C:\\x"]) {
    assert.match(validarAppJson({ ...ok, pasta }).errors[0], /campo "pasta" inválido/, pasta);
  }
  assert.equal(validarAppJson({ ...ok, pasta: "./dist/../dist" }).ok, true);
  assert.equal(validarAppJson({ ...ok, pasta: "." }).ok, true);
});

test("JSON malformado e não-objeto", () => {
  assert.match(validarAppJsonTexto("{").errors[0], /JSON inválido/);
  assert.equal(validarAppJsonTexto("[]").ok, false);
});

test("app.json de exemplo do README passa na validação", () => {
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const m = readme.match(/## app\.json[\s\S]*?```json\n([\s\S]*?)```/);
  assert.ok(m, "exemplo não encontrado");
  assert.equal(validarAppJsonTexto(m[1]).ok, true);
});

test("README referencia a ação na v0.1.0 e package.json declara 0.1.0", () => {
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /uses: squadia-ai\/squadia-live-sdk@v0\.1\.0/);
  assert.match(readme, /id-token: write/);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, "0.1.0");
});
