// CLI `publicar`: publica uma versão a partir da máquina local, com login por device flow.
// Mesmo ponto de recebimento e mesmas três chamadas da Action (cliente.js); quem decide é sempre a central.
import fs from "node:fs/promises";
import path from "node:path";
import { ID_APP_RE, MENSAGEM_ID_APP } from "../appjson.js";
import { coletarArquivos, ErroValidacao } from "../arquivos.js";
import { API_PADRAO, criarCliente, ErroApi } from "../cliente.js";
import { entrar, ErroLogin } from "./login.js";
import { redigir } from "./redigir.js";
import { criarSessao, dirConfigPadrao } from "./sessao.js";

/** Variável de ambiente que troca a central (testes). Padrão: produção. */
export const VAR_API = "SQUADIA_LIVE_API";

export const USO = `uso: publicar --app <app> [diretório]

Publica no Squadia Live a versão que está em <diretório> (padrão: o atual). O diretório precisa ter
index.html e app.json na raiz. Na primeira vez, a CLI pede que você entre na central pelo navegador.

opções:
  --app <app>   id do app de que você é dono
  -h, --ajuda   mostra esta ajuda`;

class ErroUso extends Error {}

/** @returns {{ ajuda: true } | { ajuda: false, app: string, diretorio: string }} */
export function lerArgumentos(argv) {
  let app;
  const posicionais = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--ajuda" || a === "--help") return { ajuda: true };
    if (a === "--app") {
      if (i + 1 >= argv.length) throw new ErroUso("--app precisa de um valor: --app <app>");
      app = argv[++i];
    } else if (a.startsWith("--app=")) app = a.slice("--app=".length);
    else if (a.startsWith("-") && a !== "-") throw new ErroUso(`opção desconhecida: ${a}`);
    else posicionais.push(a);
  }
  if (posicionais.length > 1) throw new ErroUso(`informe um só diretório (recebi ${posicionais.length})`);
  if (app === undefined || app === "") throw new ErroUso("informe o app: --app <app>");
  if (!ID_APP_RE.test(app)) {
    throw new ErroUso(`id de app inválido: "${app}". ${MENSAGEM_ID_APP}`);
  }
  return { ajuda: false, app, diretorio: posicionais[0] ?? "." };
}

/** Base da central: padrão de produção; HTTP só para a própria máquina (o token nunca trafega aberto). */
export function lerApi(env) {
  const bruto = env[VAR_API]?.trim() || API_PADRAO;
  let u;
  try {
    u = new URL(bruto);
  } catch {
    throw new ErroUso(`${VAR_API} não é uma URL válida: "${bruto}"`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    throw new ErroUso(`${VAR_API} precisa usar https (http só para localhost): "${bruto}"`);
  }
  return bruto.replace(/\/+$/, "");
}

/**
 * Traduz a resposta de erro da central em mensagem que diz o que corrigir. A razão de recusa de
 * manifesto é a da central, sem reescrita: é a mesma que a Action mostra.
 */
export function mensagemDeErroApi(e, app) {
  const corpo = e.corpo && typeof e.corpo === "object" ? e.corpo : {};
  const doServidor = typeof corpo.erro === "string" ? corpo.erro : "";
  const motivos = Array.isArray(corpo.motivos) ? corpo.motivos.map(String) : [];
  switch (e.status) {
    case 401:
      return `a central não aceitou o seu login${doServidor ? ` (${doServidor})` : ""}. Nada foi publicado. Rode publicar de novo para entrar.`;
    case 403:
      if (corpo.motivo === "nao_e_dono") {
        return `você não é dono do app "${app}": só o dono do app pode publicar nele. Nada foi publicado. Confira o --app ou entre com a conta dona do app.`;
      }
      return `a central recusou a publicação no app "${app}"${doServidor ? `: ${doServidor}` : ""}. Nada foi publicado.`;
    case 404:
      return `o app "${app}" não existe na central. Nada foi publicado. Confira o --app.`;
    case 422:
      return listar("manifesto recusado pela central (corrija e rode de novo):", motivos.length ? motivos : [doServidor]);
    case 503:
      return `a central está indisponível${doServidor ? ` (${doServidor})` : ""}. Nada foi publicado. Tente de novo em instantes.`;
    default:
      return `${e.message}. Nada foi publicado.`;
  }
}

const listar = (titulo, itens) => [titulo, ...itens.map((m) => `  - ${m}`)].join("\n");

/**
 * Executa o comando. Toda saída passa pela redação de segredos.
 * @param {object} o
 * @param {string[]} o.argv
 * @param {Record<string, string | undefined>} [o.env]
 * @param {string} [o.cwd]
 * @param {string} [o.dirConfig] diretório da sessão local (padrão: do usuário)
 * @param {(s: string) => void} [o.saida] stdout
 * @param {(s: string) => void} [o.erros] stderr
 * @param {typeof fetch} [o.fetch]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {() => number} [o.agora]
 * @returns {Promise<number>} código de saída (0 publicado, 1 falha, 2 uso incorreto)
 */
export async function executar({
  argv,
  env = process.env,
  cwd = process.cwd(),
  dirConfig,
  saida = (s) => process.stdout.write(`${s}\n`),
  erros = (s) => process.stderr.write(`${s}\n`),
  fetch,
  sleep,
  agora,
}) {
  const info = (s) => saida(redigir(s));
  const erro = (s) => erros(redigir(`publicar: ${s}`));
  const opcoesRede = { ...(fetch ? { fetch } : {}), ...(sleep ? { sleep } : {}) };

  let args;
  let api;
  try {
    args = lerArgumentos(argv);
    if (args.ajuda) {
      info(USO);
      return 0;
    }
    api = lerApi(env);
  } catch (e) {
    if (!(e instanceof ErroUso)) throw e;
    erro(`${e.message}\n\n${USO}`);
    return 2;
  }
  const { app } = args;

  try {
    // 1. Validação local (nada de rede antes disto) — a mesma da Action; a central refaz tudo.
    const pasta = await resolverDiretorio(path.resolve(cwd, args.diretorio));
    const arquivos = await coletarArquivos(pasta);

    // 2. Sessão guardada ou login por device flow.
    const sessao = criarSessao({ dir: dirConfig ?? dirConfigPadrao(env), ...(agora ? { agora } : {}) });
    const guardada = await sessao.ler(api);
    const novoLogin = async () => {
      const s = await entrar({ api, info, ...opcoesRede, ...(agora ? { agora } : {}) });
      await sessao.gravar(api, s);
      info("Login concluído.");
      return s.token;
    };
    let token = guardada ? guardada.token : await novoLogin();

    // 3. Início; sessão guardada recusada (vencida/revogada) pede um login novo, uma vez.
    let cliente = criarCliente({ api, token, ...opcoesRede });
    let inicio;
    try {
      inicio = await cliente.iniciar(app, arquivos);
    } catch (e) {
      if (!(e instanceof ErroApi && e.status === 401 && guardada)) throw e;
      await sessao.apagar();
      info("Sua sessão expirou. Entre de novo.");
      token = await novoLogin();
      cliente = criarCliente({ api, token, ...opcoesRede });
      inicio = await cliente.iniciar(app, arquivos);
    }

    // 4. Envio de cada arquivo — qualquer falha aborta sem concluir.
    const porPath = new Map(arquivos.map((a) => [a.path, a]));
    for (const envio of inicio.envios) {
      const a = porPath.get(envio.path);
      if (!a) throw new ErroApi(`a central pediu o envio de um arquivo desconhecido: ${envio.path}`);
      await cliente.enviar(envio, await fs.readFile(a.abs));
      info(`enviado: ${envio.path}`);
    }

    // 5. Conclusão: a central valida o conteúdo enviado e decide.
    const r = await cliente.concluir(app, inicio.versaoId);
    const versaoId = r.corpo.versaoId || inicio.versaoId;
    if (r.status === 200 && r.corpo.estado === "aceita") {
      info(`versão ${versaoId} do app ${app} aceita e no ar.`);
      return 0;
    }
    if (r.corpo.estado === "recusada") {
      const motivos = Array.isArray(r.corpo.motivos) ? r.corpo.motivos.map(String) : [];
      erro(listar(`versão ${versaoId} recusada pela central; a versão anterior continua no ar. Corrija e rode de novo:`, motivos));
      return 1;
    }
    erro(`a versão ${versaoId} não foi concluída (estado: ${r.corpo.estado}). Rode publicar de novo.`);
    return 1;
  } catch (e) {
    if (e instanceof ErroValidacao) erro(listar("a versão não passou na validação local (nada foi enviado):", e.erros));
    else if (e instanceof ErroLogin) erro(e.message);
    else if (e instanceof ErroApi) erro(e.status === undefined ? e.message : mensagemDeErroApi(e, app));
    else erro(`erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function resolverDiretorio(dir) {
  let real;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw new ErroValidacao([`diretório não encontrado: ${dir}`]);
  }
  if (!(await fs.stat(real)).isDirectory()) throw new ErroValidacao([`não é um diretório: ${dir}`]);
  return real;
}
