// Cliente do contrato de rede da plataforma (H03). Rotas, audiência e formatos vivem só aqui.
export const API_PADRAO = "https://squadia.live";
export const AUDIENCE = "squadia.live";
export const MAX_TENTATIVAS_503 = 3;

export class ErroApi extends Error {
  constructor(mensagem, { status, corpo } = {}) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.corpo = corpo;
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function descreverErro(status, corpo) {
  const partes = [`HTTP ${status}`];
  if (corpo && typeof corpo === "object") {
    if (corpo.erro) partes.push(String(corpo.erro));
    if (corpo.motivo) partes.push(String(corpo.motivo));
    if (Array.isArray(corpo.motivos)) partes.push(corpo.motivos.join("; "));
  }
  return partes.join(": ");
}

async function lerCorpo(res) {
  const texto = await res.text();
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/**
 * @param {{ api: string, token: string, fetch?: typeof fetch, sleep?: (ms:number)=>Promise<void> }} cfg
 */
export function criarCliente({ api, token, fetch: f = globalThis.fetch, sleep = dormir }) {
  const base = api.replace(/\/+$/, "");

  async function requisitar(metodo, caminho, corpo) {
    for (let tentativa = 0; ; tentativa++) {
      const headers = { Authorization: `Bearer ${token}` };
      if (corpo !== undefined) headers["Content-Type"] = "application/json";
      const res = await f(`${base}${caminho}`, {
        method: metodo,
        headers,
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
      });
      if (res.status === 503 && tentativa < MAX_TENTATIVAS_503) {
        await sleep(1000 * 2 ** tentativa);
        continue;
      }
      return { status: res.status, corpo: await lerCorpo(res) };
    }
  }

  return {
    /** POST /v1/apps/{app}/versoes → { versaoId, envios } */
    async iniciar(app, arquivos) {
      const r = await requisitar("POST", `/v1/apps/${encodeURIComponent(app)}/versoes`, {
        arquivos: arquivos.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
      });
      if (r.status !== 201 || !r.corpo || !r.corpo.versaoId || !Array.isArray(r.corpo.envios)) {
        throw new ErroApi(`falha ao iniciar a versão: ${descreverErro(r.status, r.corpo)}`, r);
      }
      return r.corpo;
    },
    /** POST .../concluir → { status, corpo } (200, 409 e 422 são respostas de domínio). */
    async concluir(app, versaoId) {
      const r = await requisitar(
        "POST",
        `/v1/apps/${encodeURIComponent(app)}/versoes/${encodeURIComponent(versaoId)}/concluir`,
      );
      if ([200, 409, 422].includes(r.status) && r.corpo && r.corpo.estado) return r;
      throw new ErroApi(`falha ao concluir a versão: ${descreverErro(r.status, r.corpo)}`, r);
    },
    /** PUT na URL assinada, com todos os cabeçalhos devolvidos. Sem retry. */
    async enviar(envio, conteudo) {
      const res = await f(envio.url, {
        method: envio.metodo || "PUT",
        headers: envio.cabecalhos || {},
        body: conteudo,
      });
      if (!res.ok) throw new ErroApi(`falha ao enviar ${envio.path}: HTTP ${res.status}`, { status: res.status });
    },
  };
}
