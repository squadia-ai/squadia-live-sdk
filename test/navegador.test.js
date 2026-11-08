import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { quemSou, entrar, sair, naCasca, modoDevAtivo, _reiniciarParaTestes } from "../src/navegador/index.js";
import * as pub from "../src/index.js";

const PESSOA = { id: "11111111-1111-1111-1111-111111111111", nome: "Ana", email: "ana@x.com", papel: "usuario" };

function loc(href = "https://app.exemplo.com/a/b?x=1") {
  const u = new URL(href);
  const l = { href, hostname: u.hostname, pathname: u.pathname, search: u.search, assigned: [], assign(v) { this.assigned.push(v); } };
  return l;
}
function fetchFalso(resp) {
  const f = async (url, init) => { f.calls.push({ url, init }); if (resp instanceof Error) throw resp; return resp; };
  f.calls = [];
  return f;
}
const json = (corpo, ok = true, status = 200) => ({ ok, status, json: async () => corpo });
function storage() { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; }

beforeEach(() => _reiniciarParaTestes());

test("quemSou devolve a pessoa com sessão válida (GET mesma origem)", async () => {
  const f = fetchFalso(json(PESSOA));
  const r = await quemSou({ fetch: f, location: loc() });
  assert.deepEqual(r, { ok: true, pessoa: PESSOA });
  assert.equal(f.calls[0].url, "/_squadia/eu");
  assert.equal(f.calls[0].init.credentials, "same-origin");
  assert.equal(f.calls[0].init.method, "GET");
});

test("quemSou: resposta nula é sem-sessao; inválida, não-2xx e rede são falha", async () => {
  assert.deepEqual(await quemSou({ fetch: fetchFalso(json(null)), location: loc() }), { ok: false, motivo: "sem-sessao" });
  for (const corpo of [{}, { ...PESSOA, papel: "admin" }, { ...PESSOA, id: 1 }, "x", [], { ...PESSOA, nome: undefined }]) {
    assert.deepEqual(await quemSou({ fetch: fetchFalso(json(corpo)), location: loc() }), { ok: false, motivo: "falha" });
  }
  assert.deepEqual(await quemSou({ fetch: fetchFalso(json(PESSOA, false, 500)), location: loc() }), { ok: false, motivo: "falha" });
  assert.deepEqual(await quemSou({ fetch: fetchFalso(new Error("rede")), location: loc() }), { ok: false, motivo: "falha" });
  const semJson = fetchFalso({ ok: true, status: 200, json: async () => { throw new Error("x"); } });
  assert.deepEqual(await quemSou({ fetch: semJson, location: loc() }), { ok: false, motivo: "falha" });
});

test("quemSou aceita nome e email nulos", async () => {
  const p = { ...PESSOA, nome: null, email: null, papel: "dono" };
  assert.deepEqual(await quemSou({ fetch: fetchFalso(json(p)), location: loc() }), { ok: true, pessoa: p });
});

test("entrar usa o caminho atual com a query como volta", () => {
  const l = loc("https://app.exemplo.com/a/b?x=1&y=2");
  entrar(undefined, { location: l });
  assert.deepEqual(l.assigned, ["/_squadia/entrar?volta=" + encodeURIComponent("/a/b?x=1&y=2")]);
});

test("entrar com volta informada; volta inválida cai no padrão", () => {
  const l = loc();
  entrar({ volta: "/painel?z=1" }, { location: l });
  entrar({ volta: "https://evil.com/" }, { location: l });
  entrar({ volta: "//evil.com" }, { location: l });
  assert.equal(l.assigned[0], "/_squadia/entrar?volta=" + encodeURIComponent("/painel?z=1"));
  assert.equal(l.assigned[1], "/_squadia/entrar?volta=" + encodeURIComponent("/a/b?x=1"));
  assert.equal(l.assigned[2], l.assigned[1]);
});

test("sair faz POST sem corpo na mesma origem e depois quemSou é sem-sessao sem consultar", async () => {
  const f = fetchFalso({ ok: true, status: 204 });
  const env = { fetch: f, location: loc() };
  assert.deepEqual(await sair(env), { ok: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/_squadia/sair");
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.credentials, "same-origin");
  assert.equal("body" in f.calls[0].init, false);
  assert.deepEqual(await quemSou(env), { ok: false, motivo: "sem-sessao" });
  assert.equal(f.calls.length, 1);
});

test("sair com status diferente de 204 ou erro de rede é falha e não marca sem sessão", async () => {
  assert.deepEqual(await sair({ fetch: fetchFalso({ ok: true, status: 200 }), location: loc() }), { ok: false, motivo: "falha" });
  assert.deepEqual(await sair({ fetch: fetchFalso(new Error("rede")), location: loc() }), { ok: false, motivo: "falha" });
  const r = await quemSou({ fetch: fetchFalso(json(PESSOA)), location: loc() });
  assert.equal(r.ok, true);
});

test("naCasca: casca=hexcot grava no sessionStorage e remove só o parâmetro da barra", () => {
  const s = storage();
  const calls = [];
  const env = {
    location: loc("https://app.exemplo.com/p?a=1&casca=hexcot&b=2#h"),
    sessionStorage: s,
    history: { state: { k: 1 }, replaceState: (...a) => calls.push(a) },
  };
  assert.equal(naCasca(env), true);
  assert.equal(s.m.get("squadia_casca"), "1");
  assert.deepEqual(calls, [[{ k: 1 }, "", "/p?a=1&b=2#h"]]);
  // navegação seguinte da mesma aba: URL sem o parâmetro, lê o storage
  assert.equal(naCasca({ location: loc("https://app.exemplo.com/outra"), sessionStorage: s, history: env.history }), true);
});

test("naCasca é false sem o sinal ou com valor diferente, e sem tocar na barra", () => {
  const calls = [];
  const history = { state: null, replaceState: (...a) => calls.push(a) };
  assert.equal(naCasca({ location: loc(), sessionStorage: storage(), history }), false);
  assert.equal(naCasca({ location: loc("https://a.com/?casca=outro"), sessionStorage: storage(), history }), false);
  assert.equal(calls.length, 0);
});

test("naCasca funciona sem sessionStorage disponível", () => {
  const quebrado = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(naCasca({ location: loc("https://a.com/?casca=hexcot"), sessionStorage: quebrado, history: { replaceState() {} } }), true);
  assert.equal(naCasca({ location: loc(), sessionStorage: quebrado }), false);
});

test("modoDevAtivo só para localhost e 127.0.0.1 exatos", () => {
  assert.equal(modoDevAtivo("localhost"), true);
  assert.equal(modoDevAtivo("127.0.0.1"), true);
  for (const h of ["localhost.exemplo.com", "127.0.0.1.exemplo.com", "meulocalhost", "app.exemplo.com", "", undefined, null]) {
    assert.equal(modoDevAtivo(h), false, String(h));
  }
});

test("modo dev: quemSou lê o arquivo local a cada chamada, sem tocar o endpoint de identidade", async () => {
  let atual = PESSOA;
  const f = async (url, init) => { f.calls.push(url); return json(atual); };
  f.calls = [];
  const env = { fetch: f, location: loc("http://localhost:5173/") };
  assert.deepEqual(await quemSou(env), { ok: true, pessoa: PESSOA });
  atual = { ...PESSOA, nome: "Outro" };
  assert.equal((await quemSou(env)).pessoa.nome, "Outro");
  assert.deepEqual(f.calls, ["/squadia-live.dev.json", "/squadia-live.dev.json"]);
  assert.deepEqual(await quemSou({ fetch: fetchFalso(json({})), location: loc("http://127.0.0.1:3000/") }), { ok: false, motivo: "falha" });
  assert.deepEqual(await quemSou({ fetch: fetchFalso(new Error("404")), location: loc("http://localhost/") }), { ok: false, motivo: "falha" });
});

test("fora de localhost o arquivo dev é ignorado", async () => {
  const f = fetchFalso(json(PESSOA));
  await quemSou({ fetch: f, location: loc("https://localhost.exemplo.com/") });
  assert.equal(f.calls[0].url, "/_squadia/eu");
});

test("modo dev: sair não faz requisição e marca sem sessão até entrar; entrar não navega", async () => {
  const f = fetchFalso(json(PESSOA));
  const l = loc("http://localhost:5173/x");
  const env = { fetch: f, location: l };
  assert.deepEqual(await sair(env), { ok: true });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await quemSou(env), { ok: false, motivo: "sem-sessao" });
  assert.equal(f.calls.length, 0);
  entrar(undefined, env);
  assert.deepEqual(l.assigned, []);
  assert.equal((await quemSou(env)).ok, true);
});

test("o índice público exporta as quatro operações", () => {
  for (const n of ["quemSou", "entrar", "sair", "naCasca"]) assert.equal(typeof pub[n], "function", n);
});

const DIR = new URL("../src/navegador/", import.meta.url);
const arquivos = fs.readdirSync(fileURLToPath(DIR)).filter((a) => a.endsWith(".js"));
const fonte = arquivos.map((a) => fs.readFileSync(new URL(a, DIR), "utf8")).join("\n");

test("o módulo de navegador não lê, expõe nem guarda credencial", () => {
  assert.ok(arquivos.length >= 2);
  for (const proibido of [/token/i, /localStorage/, /document\.cookie/, /authorization/i]) {
    assert.doesNotMatch(fonte, proibido);
  }
  const chaves = [...fonte.matchAll(/(?:setItem|getItem)\(([^,)]*)/g)].map((m) => m[1].trim());
  assert.ok(chaves.length > 0 && chaves.every((c) => c === "CHAVE_CASCA"));
});

test("naCasca não usa iframe nem a ponte do HexCot", () => {
  for (const proibido of [/iframe/i, /window\.hexcot/, /\.hexcot\b/, /\bparent\b/, /window\.top/, /\btop\b/, /postMessage/]) {
    assert.doesNotMatch(fonte, proibido);
  }
});
