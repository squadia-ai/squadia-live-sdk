// Operações de identidade do app no navegador: quemSou, entrar, sair e naCasca.
// Tudo é de mesma origem; a sessão fica em cookie HttpOnly que este módulo nunca enxerga.
// `env` é injetável nos testes: { fetch, location, history, sessionStorage }.
import {
  ROTA_IDENTIDADE, ROTA_ENTRADA, ROTA_SAIDA, PARAM_CASCA, VALOR_CASCA, CHAVE_CASCA, ARQUIVO_DEV,
} from "./rotas.js";

const PAPEIS = new Set(["dono", "usuario"]);
const HOSTS_DEV = new Set(["localhost", "127.0.0.1"]);

// "Sem sessão" marcado em memória após sair() (nunca em armazenamento).
let semSessao = false;

function ambiente(env) {
  const g = globalThis;
  return {
    fetch: env?.fetch ?? (g.fetch ? g.fetch.bind(g) : undefined),
    location: env?.location ?? g.location,
    history: env?.history ?? g.history,
    sessionStorage: env?.sessionStorage ?? g.sessionStorage,
  };
}

/** Modo dev vale só quando o host é exatamente localhost ou 127.0.0.1; sem opção para forçar. */
export function modoDevAtivo(hostname) {
  return typeof hostname === "string" && HOSTS_DEV.has(hostname);
}

function textoOuNulo(v) {
  return v === null || typeof v === "string";
}

function validarPessoa(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  if (typeof v.id !== "string" || v.id === "") return null;
  if (!textoOuNulo(v.nome) || !textoOuNulo(v.email)) return null;
  if (!PAPEIS.has(v.papel)) return null;
  return { id: v.id, nome: v.nome, email: v.email, papel: v.papel };
}

const FALHA = Object.freeze({ ok: false, motivo: "falha" });
const SEM_SESSAO = Object.freeze({ ok: false, motivo: "sem-sessao" });

async function lerJson(url, f) {
  const r = await f(url, { method: "GET", credentials: "same-origin", headers: { accept: "application/json" } });
  if (!r || !r.ok) throw new Error("status inesperado");
  return r.json();
}

/**
 * Quem é a pessoa. Devolve `{ ok: true, pessoa }`, `{ ok: false, motivo: "sem-sessao" }`
 * ou `{ ok: false, motivo: "falha" }`. Nunca assume uma pessoa padrão.
 */
export async function quemSou(env) {
  const e = ambiente(env);
  if (semSessao) return SEM_SESSAO;
  try {
    const dev = modoDevAtivo(e.location?.hostname);
    const corpo = await lerJson(dev ? ARQUIVO_DEV : ROTA_IDENTIDADE, e.fetch);
    if (corpo === null) return SEM_SESSAO;
    const pessoa = validarPessoa(corpo);
    return pessoa ? { ok: true, pessoa } : FALHA;
  } catch {
    return FALHA;
  }
}

/**
 * Leva a pessoa à entrada por navegação de página inteira. `volta` (caminho relativo que começa
 * com "/") padroniza para o caminho atual com a query. No modo dev não navega: só limpa o "sem sessão".
 */
export function entrar(opcoes, env) {
  const e = ambiente(env);
  semSessao = false;
  if (modoDevAtivo(e.location.hostname)) return;
  const informado = opcoes?.volta;
  const volta = typeof informado === "string" && informado.startsWith("/") && !informado.startsWith("//")
    ? informado
    : e.location.pathname + e.location.search;
  e.location.assign(`${ROTA_ENTRADA}?volta=${encodeURIComponent(volta)}`);
}

/**
 * Encerra a sessão: POST sem corpo na mesma origem, esperando 204; depois a pessoa fica "sem sessão".
 * No modo dev não chama o servidor e só marca "sem sessão" em memória (até entrar() ou recarga).
 * Devolve `{ ok: true }` ou `{ ok: false, motivo: "falha" }`.
 */
export async function sair(env) {
  const e = ambiente(env);
  if (modoDevAtivo(e.location?.hostname)) {
    semSessao = true;
    return { ok: true };
  }
  try {
    const r = await e.fetch(ROTA_SAIDA, { method: "POST", credentials: "same-origin" });
    if (!r || r.status !== 204) return FALHA;
    semSessao = true;
    return { ok: true };
  } catch {
    return FALHA;
  }
}

/**
 * Informa se o app foi aberto numa aba do HexCot (v1: `casca=hexcot` na URL de abertura, memorizado
 * na aba). Só informativo, para exibição: nunca use para autorizar nada.
 */
export function naCasca(env) {
  const e = ambiente(env);
  let armazenamento = null;
  try { armazenamento = e.sessionStorage ?? null; } catch { armazenamento = null; }
  try {
    const url = new URL(e.location.href);
    if (url.searchParams.get(PARAM_CASCA) === VALOR_CASCA) {
      try { armazenamento?.setItem(CHAVE_CASCA, "1"); } catch { /* sem armazenamento: vale só nesta leitura */ }
      url.searchParams.delete(PARAM_CASCA);
      try {
        e.history?.replaceState(e.history.state ?? null, "", url.pathname + url.search + url.hash);
      } catch { /* barra de endereço fica como está */ }
      return true;
    }
  } catch { /* URL ilegível: segue para o armazenamento */ }
  try {
    return armazenamento?.getItem(CHAVE_CASCA) === "1";
  } catch {
    return false;
  }
}

/** Só para testes: zera o "sem sessão" em memória. */
export function _reiniciarParaTestes() {
  semSessao = false;
}
