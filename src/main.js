// Ponto de entrada da Action (node20). Sem dependências externas: o runner executa este arquivo direto.
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { publicar } from "./publicar.js";
import { API_PADRAO } from "./cliente.js";

const input = (nome, padrao) => process.env[`INPUT_${nome.toUpperCase().replaceAll(" ", "_")}`]?.trim() || padrao;

const mascarar = (s) => {
  if (s) process.stdout.write(`::add-mask::${String(s).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`);
};

function saida(nome, valor) {
  const arq = process.env.GITHUB_OUTPUT;
  if (!arq) return;
  const delim = `ghadelim_${randomUUID()}`;
  appendFileSync(arq, `${nome}<<${delim}\n${valor}\n${delim}\n`);
}

function erro(msg) {
  process.stdout.write(`::error::${msg.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`);
}

const ambiente = {
  temPermissao: () => Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  async getIDToken(audience) {
    const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
    url.searchParams.set("audience", audience);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
    if (!res.ok) throw new Error(`falha ao obter o token OIDC: HTTP ${res.status}`);
    const { value } = await res.json();
    if (!value) throw new Error("resposta de token OIDC sem valor");
    return value;
  },
  setSecret: mascarar,
  info: (s) => process.stdout.write(`${s}\n`),
};

try {
  const r = await publicar({
    workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
    appJson: input("app-json", "app.json"),
    api: input("api", API_PADRAO),
    ambiente,
  });
  saida("versao-id", r.versaoId);
  saida("estado", r.estado);
  if (!r.ok) {
    erro(`versão ${r.estado}${r.motivos.length ? `: ${r.motivos.join("; ")}` : ""}`);
    process.exitCode = 1;
  } else {
    ambiente.info(`versão ${r.versaoId} aceita e no ar`);
  }
} catch (e) {
  erro(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
