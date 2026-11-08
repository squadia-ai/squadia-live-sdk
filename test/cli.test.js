import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executar, lerArgumentos, lerApi, USO } from "../src/cli/publicar.js";
import { entrar, ErroLogin } from "../src/cli/login.js";
import { criarSessao, dirConfigPadrao } from "../src/cli/sessao.js";
import { redigir } from "../src/cli/redigir.js";

const API = "https://squadia.live";
const TOKEN = "slp_TOKENsecreto123_abc-XYZ";
const TOKEN_NOVO = "slp_NOVOtoken456";
const DEVICE = "sld_DEVICEsecreto789";
const USER_CODE = "BCDF-GHJK";

function diretorio(arquivos = { "index.html": "<h1>oi</h1>", "app.json": '{"nome":"demo"}' }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cli-build-"));
  for (const [k, v] of Object.entries(arquivos)) {
    fs.mkdirSync(path.dirname(path.join(d, k)), { recursive: true });
    fs.writeFileSync(path.join(d, k), v);
  }
  return d;
}
const dirConfig = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cli-cfg-")), "squadia-live");

const resp = (status, corpo) => ({ status, ok: status >= 200 && status < 300, text: async () => (corpo === undefined ? "" : JSON.stringify(corpo)) });

/**
 * Central de mentira: device flow + as três chamadas da publicação. Só o dono (token válido) publica no app
 * `meu-app`; o veredito da conclusão é configurável.
 */
function central({
  polls = ["authorization_pending", "ok"],
  tokensValidos = [TOKEN_NOVO],
  donoDe = { "meu-app": true, "de-outro": false },
  concluir = [200, { versaoId: "v1", estado: "aceita" }],
  inicio,
} = {}) {
  const chamadas = [];
  let poll = 0;
  const f = async (url, init = {}) => {
    const u = String(url);
    chamadas.push({ url: u, ...init });
    if (u === `${API}/v1/dispositivo/codigo`) {
      return resp(200, {
        device_code: DEVICE,
        user_code: USER_CODE,
        verification_uri: `${API}/entrar/dispositivo`,
        verification_uri_complete: `${API}/entrar/dispositivo?codigo=${USER_CODE}`,
        expires_in: 600,
        interval: 5,
      });
    }
    if (u === `${API}/v1/dispositivo/token`) {
      assert.deepEqual(JSON.parse(init.body), { device_code: DEVICE });
      const passo = polls[Math.min(poll++, polls.length - 1)];
      if (passo === "ok") return resp(200, { access_token: TOKEN_NOVO, token_type: "Bearer", expires_in: 28800, scope: "publicar" });
      if (typeof passo === "number") return resp(passo, { erro: "fora" });
      return resp(400, { error: passo, error_description: "descrição", ...(passo === "slow_down" ? { interval: 10 } : {}) });
    }
    const m = /^https:\/\/squadia\.live\/v1\/apps\/([^/]+)\/versoes(?:\/([^/]+)\/concluir)?$/.exec(u);
    if (m) {
      const token = (init.headers?.Authorization ?? "").replace(/^Bearer /, "");
      if (!tokensValidos.includes(token)) return resp(401, { erro: "token de publicação expirado; entre de novo pela CLI", motivo: "token_expirado" });
      if (!(m[1] in donoDe)) return resp(404, { erro: `app '${m[1]}' não existe` });
      if (!donoDe[m[1]]) return resp(403, { erro: `você não é dono do app '${m[1]}': só o dono do app pode publicar nele`, motivo: "nao_e_dono" });
      if (m[2]) return resp(...concluir);
      if (inicio) return inicio(JSON.parse(init.body));
      const { arquivos } = JSON.parse(init.body);
      return resp(201, {
        versaoId: "v1",
        envios: arquivos.map((a) => ({ path: a.path, url: `https://storage.test/upload/${a.path}?token=ASSINATURA`, metodo: "PUT", cabecalhos: { "x-upsert": "false" } })),
      });
    }
    if (u.startsWith("https://storage.test/")) return resp(200);
    throw new Error(`rota inesperada ${u}`);
  };
  return { f, chamadas };
}

async function rodar(argv, { fake = central(), cfg = dirConfig(), env = {}, agora } = {}) {
  const out = [];
  const err = [];
  const esperas = [];
  const codigo = await executar({
    argv,
    env,
    cwd: os.tmpdir(),
    dirConfig: cfg,
    saida: (s) => out.push(s),
    erros: (s) => err.push(s),
    fetch: fake.f,
    sleep: async (ms) => void esperas.push(ms),
    ...(agora ? { agora } : {}),
  });
  return { codigo, out: out.join("\n"), err: err.join("\n"), esperas, chamadas: fake.chamadas, cfg };
}

const semSegredo = (r) => {
  const tudo = `${r.out}\n${r.err}`;
  for (const s of [TOKEN, TOKEN_NOVO, DEVICE, "ASSINATURA"]) assert.ok(!tudo.includes(s), `saída contém segredo ${s}`);
};
const publicacoes = (r) => r.chamadas.filter((c) => c.url.includes("/v1/apps/"));
const envios = (r) => r.chamadas.filter((c) => c.url.startsWith("https://storage.test/"));

test("sem sessão: entra por device flow, guarda o token com 0600 e publica nas três chamadas", async () => {
  const dir = diretorio({ "index.html": "<h1>oi</h1>", "app.json": "{}", "assets/a.js": "1" });
  const r = await rodar(["--app", "meu-app", dir]);
  assert.equal(r.codigo, 0, r.err);
  assert.match(r.out, new RegExp(`abra ${API}/entrar/dispositivo e confirme o código ${USER_CODE}`));
  assert.match(r.out, /aceita e no ar/);
  assert.deepEqual(r.esperas, [5000, 5000]);
  // Três passos: início, PUT de cada arquivo, conclusão — com o token só nas chamadas da central.
  const [ini, fim] = [publicacoes(r)[0], publicacoes(r).at(-1)];
  assert.equal(ini.url, `${API}/v1/apps/meu-app/versoes`);
  assert.equal(ini.headers.Authorization, `Bearer ${TOKEN_NOVO}`);
  assert.deepEqual(JSON.parse(ini.body).arquivos.map((a) => a.path), ["app.json", "assets/a.js", "index.html"]);
  assert.equal(envios(r).length, 3);
  assert.ok(envios(r).every((c) => c.method === "PUT" && c.headers.Authorization === undefined && c.headers["x-upsert"] === "false"));
  assert.equal(fim.url, `${API}/v1/apps/meu-app/versoes/v1/concluir`);
  // Sessão guardada com permissão restrita, no diretório do usuário.
  const arq = path.join(r.cfg, "sessao.json");
  assert.equal(fs.statSync(arq).mode & 0o777, 0o600);
  assert.equal(fs.statSync(r.cfg).mode & 0o777, 0o700);
  assert.equal(JSON.parse(fs.readFileSync(arq, "utf8")).token, TOKEN_NOVO);
  semSegredo(r);
});

test("com sessão válida guardada, publica sem pedir login", async () => {
  const cfg = dirConfig();
  await criarSessao({ dir: cfg }).gravar(API, { token: TOKEN, expiraEm: Date.now() + 3600_000 });
  const r = await rodar(["--app", "meu-app", diretorio()], { cfg, fake: central({ tokensValidos: [TOKEN] }) });
  assert.equal(r.codigo, 0, r.err);
  assert.ok(!r.chamadas.some((c) => c.url.includes("/v1/dispositivo/")));
  assert.ok(!r.out.includes("confirme o código"));
  semSegredo(r);
});

test("sessão guardada recusada pela central (401): apaga, entra de novo e publica", async () => {
  const cfg = dirConfig();
  await criarSessao({ dir: cfg }).gravar(API, { token: TOKEN, expiraEm: Date.now() + 3600_000 });
  const r = await rodar(["--app", "meu-app", diretorio()], { cfg });
  assert.equal(r.codigo, 0, r.err);
  assert.match(r.out, /sessão expirou/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, "sessao.json"), "utf8")).token, TOKEN_NOVO);
  assert.equal(publicacoes(r).filter((c) => c.url.endsWith("/versoes")).length, 2);
  semSegredo(r);
});

test("sessão de outra central ou vencida não é usada", async () => {
  const cfg = dirConfig();
  const s = criarSessao({ dir: cfg });
  await s.gravar("https://outra.central", { token: TOKEN, expiraEm: Date.now() + 3600_000 });
  assert.equal(await s.ler(API), null);
  await s.gravar(API, { token: TOKEN, expiraEm: Date.now() + 60_000 });
  assert.equal(await s.ler(API), null, "vence em menos que a margem");
  fs.writeFileSync(s.arquivo, "{quebrado");
  assert.equal(await s.ler(API), null);
  await s.apagar();
  assert.equal(await s.ler(API), null);
});

test("login negado: sai com erro claro e nada é enviado", async () => {
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ polls: ["authorization_pending", "access_denied"] }) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /login foi negado na central\. Nada foi publicado/);
  assert.equal(publicacoes(r).length, 0);
  assert.ok(!fs.existsSync(path.join(r.cfg, "sessao.json")));
  semSegredo(r);
});

test("login expirado (resposta da central): sai com erro claro e nada é enviado", async () => {
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ polls: ["expired_token"] }) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /código de login expirou antes da aprovação\. Nada foi publicado\. Rode publicar de novo e aprove o código em até 10 minutos/);
  assert.equal(publicacoes(r).length, 0);
});

test("login expirado pelo relógio local: para de consultar e não envia nada", async () => {
  let t = 0;
  const fake = central({ polls: ["authorization_pending"] });
  const r = await rodar(["--app", "meu-app", diretorio()], { fake, agora: () => (t += 100_000) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /expirou/);
  assert.ok(r.chamadas.filter((c) => c.url.endsWith("/token")).length < 10);
  assert.equal(publicacoes(r).length, 0);
});

test("slow_down aumenta o intervalo das consultas", async () => {
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ polls: ["slow_down", "authorization_pending", "ok"] }) });
  assert.equal(r.codigo, 0, r.err);
  assert.deepEqual(r.esperas, [5000, 10000, 10000]);
});

test("central fora do ar durante o login: desiste após falhas seguidas, sem publicar", async () => {
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ polls: [503] }) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /não respondeu durante o login: HTTP 503/);
  assert.equal(publicacoes(r).length, 0);
});

test("app de outra pessoa: a central recusa, a CLI explica e nada é enviado", async () => {
  const r = await rodar(["--app", "de-outro", diretorio()]);
  assert.equal(r.codigo, 1);
  assert.match(r.err, /você não é dono do app "de-outro": só o dono do app pode publicar nele\. Nada foi publicado\. Confira o --app/);
  assert.equal(envios(r).length, 0);
  assert.ok(!r.chamadas.some((c) => c.url.endsWith("/concluir")));
  semSegredo(r);
});

test("app inexistente: diz para conferir o --app", async () => {
  const r = await rodar(["--app", "nao-existe", diretorio()]);
  assert.equal(r.codigo, 1);
  assert.match(r.err, /o app "nao-existe" não existe na central\. Nada foi publicado\. Confira o --app/);
});

test("manifesto recusado no início: mostra a razão da central sem reescrever", async () => {
  const motivos = ['"x": caminho contém \'..\'', "falta o app.json na raiz"];
  const fake = central({ inicio: () => resp(422, { erro: "manifesto recusado", motivos }) });
  const r = await rodar(["--app", "meu-app", diretorio()], { fake });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /manifesto recusado pela central/);
  for (const m of motivos) assert.ok(r.err.includes(`  - ${m}`), r.err);
  assert.equal(envios(r).length, 0);
});

test("versão recusada na conclusão: mostra os motivos da central e sai com erro", async () => {
  const motivos = ['"index.html": SHA-256 enviado difere do declarado no manifesto'];
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ concluir: [422, { versaoId: "v1", estado: "recusada", motivos }] }) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /versão v1 recusada pela central; a versão anterior continua no ar/);
  assert.ok(r.err.includes(`  - ${motivos[0]}`));
});

test("409 enviando não é sucesso", async () => {
  const r = await rodar(["--app", "meu-app", diretorio()], { fake: central({ concluir: [409, { versaoId: "v1", estado: "enviando" }] }) });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /não foi concluída/);
});

test("validação local falha antes de qualquer rede (mesma regra local da Action)", async () => {
  const semIndex = await rodar(["--app", "meu-app", diretorio({ "app.json": "{}" })]);
  assert.equal(semIndex.codigo, 1);
  assert.match(semIndex.err, /validação local[\s\S]*index\.html/);
  assert.equal(semIndex.chamadas.length, 0);
  const inexistente = await rodar(["--app", "meu-app", path.join(os.tmpdir(), "nao-existe-xyz")]);
  assert.match(inexistente.err, /diretório não encontrado/);
  assert.equal(inexistente.chamadas.length, 0);
});

test("uso incorreto sai com 2 e mostra a ajuda; --ajuda sai com 0", async () => {
  for (const argv of [[], ["--app"], ["--app", "Maiusculo"], ["--app", "a", "x", "y"], ["--app", "a", "--outra"]]) {
    const r = await rodar(argv);
    assert.equal(r.codigo, 2, argv.join(" "));
    assert.ok(r.err.includes(USO));
    assert.equal(r.chamadas.length, 0);
  }
  const ajuda = await rodar(["--ajuda"]);
  assert.equal(ajuda.codigo, 0);
  assert.equal(ajuda.out, USO);
});

test("argumentos: --app=x, diretório padrão", () => {
  assert.deepEqual(lerArgumentos(["--app=meu-app"]), { ajuda: false, app: "meu-app", diretorio: "." });
  assert.deepEqual(lerArgumentos(["dist", "--app", "a"]), { ajuda: false, app: "a", diretorio: "dist" });
});

test("central: padrão de produção, troca por SQUADIA_LIVE_API, https obrigatório fora da máquina local", () => {
  assert.equal(lerApi({}), "https://squadia.live");
  assert.equal(lerApi({ SQUADIA_LIVE_API: "https://teste.squadia.live/" }), "https://teste.squadia.live");
  assert.equal(lerApi({ SQUADIA_LIVE_API: "http://localhost:8787" }), "http://localhost:8787");
  assert.throws(() => lerApi({ SQUADIA_LIVE_API: "http://squadia.live" }), /https/);
  assert.throws(() => lerApi({ SQUADIA_LIVE_API: "não é url" }), /URL válida/);
});

test("erro inesperado com segredo na mensagem sai redigido", async () => {
  const fake = central();
  const original = fake.f;
  fake.f = async (url, init) => {
    if (String(url).startsWith("https://storage.test/")) throw new Error(`falhou ${url} com Bearer ${TOKEN_NOVO} e ${DEVICE}`);
    return original(url, init);
  };
  const r = await rodar(["--app", "meu-app", diretorio()], { fake });
  assert.equal(r.codigo, 1);
  assert.match(r.err, /erro inesperado/);
  semSegredo(r);
});

test("redigir cobre token, device_code, JWT, Bearer e assinatura de URL; mantém o user_code", () => {
  const t = redigir(`a ${TOKEN} b ${DEVICE} c eyJa.eyJb.c Authorization: Bearer xyz https://s/x?token=abc&y=1 ${USER_CODE}`);
  for (const s of [TOKEN, DEVICE, "eyJa.eyJb.c", "xyz", "abc"]) assert.ok(!t.includes(s), t);
  assert.ok(t.includes(USER_CODE));
  assert.ok(t.includes("y=1"));
});

test("entrar: falha ao iniciar dá mensagem legível", async () => {
  await assert.rejects(
    entrar({ api: API, info: () => {}, fetch: async () => resp(503, {}), sleep: async () => {} }),
    (e) => e instanceof ErroLogin && /não foi possível iniciar o login na central https:\/\/squadia\.live: HTTP 503/.test(e.message),
  );
  await assert.rejects(
    entrar({ api: API, info: () => {}, fetch: async () => { throw new Error("ECONNREFUSED"); }, sleep: async () => {} }),
    /sem resposta \(ECONNREFUSED\)/,
  );
});

test("diretório de configuração do usuário", () => {
  assert.equal(dirConfigPadrao({ XDG_CONFIG_HOME: "/x" }, "linux", "/h"), path.join("/x", "squadia-live"));
  assert.equal(dirConfigPadrao({}, "linux", "/h"), path.join("/h", ".config", "squadia-live"));
  assert.equal(dirConfigPadrao({ APPDATA: "C:/ad" }, "win32", "/h"), path.join("C:/ad", "squadia-live"));
});

test("o pacote expõe o executável publicar, e ele roda", () => {
  const raiz = fileURLToPath(new URL("..", import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
  assert.equal(pkg.bin.publicar, "bin/publicar.js");
  const bin = path.join(raiz, pkg.bin.publicar);
  assert.match(fs.readFileSync(bin, "utf8"), /^#!\/usr\/bin\/env node\n/);
  const r = spawnSync(process.execPath, [bin, "--ajuda"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /uso: publicar --app <app> \[diretório\]/);
  const semApp = spawnSync(process.execPath, [bin], { encoding: "utf8" });
  assert.equal(semApp.status, 2);
  assert.match(semApp.stderr, /informe o app/);
});
