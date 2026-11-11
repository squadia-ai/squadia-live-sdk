import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publicar, MSG_SEM_PERMISSAO } from "../src/publicar.js";
import { ErroValidacao, validarLimites } from "../src/arquivos.js";
import { ErroApi } from "../src/cliente.js";

function workspace(extra = {}, app = { id: "meuapp", acesso: "publico", pasta: "dist" }) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-"));
  fs.mkdirSync(path.join(ws, "dist"));
  fs.writeFileSync(path.join(ws, "dist/index.html"), "<h1>oi</h1>");
  fs.writeFileSync(path.join(ws, "dist/app.json"), JSON.stringify(app));
  fs.writeFileSync(path.join(ws, "app.json"), typeof app === "string" ? app : JSON.stringify(app));
  for (const [k, v] of Object.entries(extra)) fs.writeFileSync(path.join(ws, k), v);
  return ws;
}

function ambiente({ perm = true } = {}) {
  const segredos = [];
  const logs = [];
  return {
    segredos,
    logs,
    temPermissao: () => perm,
    getIDToken: async (aud) => {
      assert.equal(aud, "squadia.live");
      return "TOKEN";
    },
    setSecret: (s) => segredos.push(s),
    info: (s) => logs.push(s),
  };
}

const resp = (status, corpo) => ({ status, ok: status >= 200 && status < 300, text: async () => (corpo === undefined ? "" : JSON.stringify(corpo)) });

function fakeApi({ concluir = [200, { versaoId: "v1", estado: "aceita" }], putStatus = 200, iniciar } = {}) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url: String(url), ...init });
    if (url === "https://squadia.live/v1/apps/meuapp/versoes") {
      return iniciar ? iniciar(chamadas) : resp(201, {
        versaoId: "v1",
        envios: ["app.json", "index.html"].map((p) => ({ path: p, url: `https://s3/${p}?sig=X`, metodo: "PUT", cabecalhos: { "x-a": "1" } })),
      });
    }
    if (String(url).startsWith("https://s3/")) return resp(putStatus);
    if (url.endsWith("/concluir")) return resp(...concluir);
    throw new Error("rota inesperada " + url);
  };
  return { f, chamadas };
}

const base = (ws, amb, f, extra = {}) => ({ workspace: ws, appJson: "app.json", api: "https://squadia.live", ambiente: amb, fetch: f, sleep: async () => {}, ...extra });

test("publica ponta a ponta seguindo o contrato", async () => {
  const ws = workspace();
  const amb = ambiente();
  const { f, chamadas } = fakeApi();
  const r = await publicar(base(ws, amb, f));
  assert.deepEqual([r.ok, r.estado, r.versaoId], [true, "aceita", "v1"]);
  const ini = chamadas[0];
  assert.equal(ini.headers.Authorization, "Bearer TOKEN");
  assert.equal(ini.headers["Content-Type"], "application/json");
  const corpo = JSON.parse(ini.body);
  assert.deepEqual(corpo.arquivos.map((a) => a.path), ["app.json", "index.html"]);
  assert.match(corpo.arquivos[1].sha256, /^[0-9a-f]{64}$/);
  assert.equal(corpo.arquivos[1].size, 11);
  const puts = chamadas.filter((c) => c.url.startsWith("https://s3/"));
  assert.equal(puts.length, 2);
  assert.equal(puts[0].method, "PUT");
  assert.equal(puts[0].headers["x-a"], "1");
  assert.equal(puts[0].headers.Authorization, undefined);
  const fim = chamadas.at(-1);
  assert.equal(fim.url, "https://squadia.live/v1/apps/meuapp/versoes/v1/concluir");
  assert.equal(fim.headers.Authorization, "Bearer TOKEN");
  assert.equal(fim.body, undefined);
  assert.ok(amb.segredos.includes("TOKEN"));
  assert.ok(amb.segredos.some((s) => s.startsWith("https://s3/")));
  assert.ok(!amb.logs.join("\n").includes("sig=X"));
});

test("app.json inválido aborta antes de qualquer chamada", async () => {
  const ws = workspace({}, { id: "xyz", pasta: "dist" });
  const { f, chamadas } = fakeApi();
  await assert.rejects(publicar(base(ws, ambiente(), f)), (e) => e instanceof ErroValidacao && /campo "acesso" ausente/.test(e.message));
  assert.equal(chamadas.length, 0);
});

test("pasta que escapa do workspace aborta", async () => {
  const ws = workspace({}, { id: "xyz", acesso: "p", pasta: "../fora" });
  const { f, chamadas } = fakeApi();
  await assert.rejects(publicar(base(ws, ambiente(), f)), /pasta/);
  assert.equal(chamadas.length, 0);
});

test("symlink que escapa do workspace é rejeitado", async () => {
  const ws = workspace({}, { id: "xyz", acesso: "p", pasta: "link" });
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), "fora-"));
  fs.symlinkSync(fora, path.join(ws, "link"));
  const { f, chamadas } = fakeApi();
  await assert.rejects(publicar(base(ws, ambiente(), f)), /escapa do workspace/);
  assert.equal(chamadas.length, 0);
});

test("sem id-token: write falha com mensagem clara e sem rede", async () => {
  const ws = workspace();
  const { f, chamadas } = fakeApi();
  await assert.rejects(publicar(base(ws, ambiente({ perm: false }), f)), (e) => e.message === MSG_SEM_PERMISSAO);
  assert.match(MSG_SEM_PERMISSAO, /id-token: write/);
  assert.equal(chamadas.length, 0);
});

test("falta index.html na pasta aborta antes da rede", async () => {
  const ws = workspace();
  fs.rmSync(path.join(ws, "dist/index.html"));
  const { f, chamadas } = fakeApi();
  await assert.rejects(publicar(base(ws, ambiente(), f)), /index\.html/);
  assert.equal(chamadas.length, 0);
});

test("limites locais", () => {
  const mk = (p, size = 1) => ({ path: p, size });
  const raiz = [mk("index.html"), mk("app.json")];
  assert.deepEqual(validarLimites(raiz), []);
  assert.match(validarLimites([...raiz, mk("_squadia/x")])[0], /_squadia/);
  assert.match(validarLimites([...raiz, mk("a/../b")])[0], /\.\./);
  assert.match(validarLimites([mk("index.html", 51 * 1024 * 1024), mk("app.json")])[0], /50 MB/);
  assert.match(validarLimites([...raiz, ...Array.from({ length: 500 }, (_, i) => mk(`f${i}`))])[0], /500 arquivos/);
});

test("falha de envio não conclui a versão", async () => {
  const ws = workspace();
  const { f, chamadas } = fakeApi({ putStatus: 403 });
  await assert.rejects(publicar(base(ws, ambiente(), f)), (e) => e instanceof ErroApi && /HTTP 403/.test(e.message));
  assert.ok(!chamadas.some((c) => c.url.endsWith("/concluir")));
});

test("recusa do servidor (422) falha com motivos", async () => {
  const ws = workspace();
  const { f } = fakeApi({ concluir: [422, { versaoId: "v1", estado: "recusada", motivos: ["manifesto ruim"] }] });
  const r = await publicar(base(ws, ambiente(), f));
  assert.deepEqual([r.ok, r.estado, r.motivos], [false, "recusada", ["manifesto ruim"]]);
});

test("409 enviando não é sucesso", async () => {
  const ws = workspace();
  const { f } = fakeApi({ concluir: [409, { versaoId: "v1", estado: "enviando" }] });
  const r = await publicar(base(ws, ambiente(), f));
  assert.deepEqual([r.ok, r.estado], [false, "enviando"]);
});

test("503 tenta de novo até 3 vezes com espera exponencial", async () => {
  const ws = workspace();
  let n = 0;
  const esperas = [];
  const { f, chamadas } = fakeApi({ iniciar: () => (++n <= 3 ? resp(503, { erro: "indisp" }) : resp(201, { versaoId: "v1", envios: [] })) });
  const r = await publicar(base(ws, ambiente(), f, { sleep: async (ms) => esperas.push(ms) }));
  assert.deepEqual(esperas, [1000, 2000, 4000]);
  assert.equal(r.versaoId, "v1");
  assert.equal(chamadas.filter((c) => c.url.endsWith("/versoes")).length, 4);
});

test("503 persistente falha após 3 novas tentativas", async () => {
  const ws = workspace();
  const { f, chamadas } = fakeApi({ iniciar: () => resp(503, { erro: "indisp" }) });
  await assert.rejects(publicar(base(ws, ambiente(), f)), /HTTP 503/);
  assert.equal(chamadas.length, 4);
});

test("outros erros não têm retry e mostram motivo", async () => {
  const ws = workspace();
  const { f, chamadas } = fakeApi({ iniciar: () => resp(403, { erro: "proibido", motivo: "ramo não vinculado" }) });
  await assert.rejects(publicar(base(ws, ambiente(), f)), /proibido: ramo não vinculado/);
  assert.equal(chamadas.length, 1);
});

test("cliente recusa id de app fora do formato antes de qualquer rede", async () => {
  const { criarCliente } = await import("../src/cliente.js");
  let chamadas = 0;
  const cliente = criarCliente({ fetch: async () => { chamadas++; return new Response("{}"); }, token: "t", api: "https://x.test" });
  await assert.rejects(() => cliente.iniciar("meu-app", []), /id de app inválido/);
  await assert.rejects(() => cliente.concluir("MeuApp", "v1"), /id de app inválido/);
  assert.equal(chamadas, 0);
});
