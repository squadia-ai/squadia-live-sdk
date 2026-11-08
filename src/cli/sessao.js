// Sessão local da CLI: o token de publicação fica num arquivo do usuário com permissão 0600.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const ARQUIVO_SESSAO = "sessao.json";
// Margem para não usar um token que vence no meio do envio.
const MARGEM_MS = 5 * 60 * 1000;

/** Diretório de configuração do usuário: `$XDG_CONFIG_HOME`, `%APPDATA%` ou `~/.config`, mais `squadia-live`. */
export function dirConfigPadrao(env = process.env, plataforma = process.platform, home = os.homedir()) {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "squadia-live");
  if (plataforma === "win32" && env.APPDATA) return path.join(env.APPDATA, "squadia-live");
  return path.join(home, ".config", "squadia-live");
}

/**
 * @param {{ dir: string, agora?: () => number }} o
 */
export function criarSessao({ dir, agora = Date.now }) {
  const arquivo = path.join(dir, ARQUIVO_SESSAO);
  return {
    arquivo,
    /**
     * Sessão válida para esta central, ou `null` (ausente, de outra central, vencida ou ilegível).
     * @param {string} api
     * @returns {Promise<{ token: string, expiraEm: number } | null>}
     */
    async ler(api) {
      let texto;
      try {
        texto = await fs.readFile(arquivo, "utf8");
      } catch (e) {
        if (e && e.code === "ENOENT") return null;
        throw e;
      }
      let s;
      try {
        s = JSON.parse(texto);
      } catch {
        return null;
      }
      if (!s || typeof s !== "object" || s.api !== api || typeof s.token !== "string" || !s.token.startsWith("slp_")) return null;
      if (typeof s.expiraEm !== "number" || s.expiraEm - MARGEM_MS <= agora()) return null;
      return { token: s.token, expiraEm: s.expiraEm };
    },
    /** Grava de forma atômica: arquivo temporário criado já com 0600 e renomeado. */
    async gravar(api, { token, expiraEm }) {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = path.join(dir, `.${ARQUIVO_SESSAO}.${randomBytes(6).toString("hex")}.tmp`);
      try {
        await fs.writeFile(tmp, JSON.stringify({ api, token, expiraEm }), { mode: 0o600, flag: "wx" });
        await fs.chmod(tmp, 0o600);
        await fs.rename(tmp, arquivo);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      await fs.chmod(arquivo, 0o600);
    },
    async apagar() {
      await fs.rm(arquivo, { force: true });
    },
  };
}
