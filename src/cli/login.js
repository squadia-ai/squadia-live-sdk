// Login da CLI por device flow (RFC 8628) na central: nenhuma credencial é configurada à mão.

export class ErroLogin extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = "ErroLogin";
  }
}

const ACRESCIMO_SLOW_DOWN_S = 5;
const MAX_FALHAS_SEGUIDAS = 3;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function postar(f, url, corpo) {
  let res;
  try {
    res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch (e) {
    return { status: 0, corpo: undefined, falha: e instanceof Error ? e.message : String(e) };
  }
  const texto = await res.text();
  let json;
  try {
    json = texto ? JSON.parse(texto) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, corpo: json };
}

/**
 * Inicia o device flow, mostra a URL e o código e consulta até a aprovação, respeitando o intervalo
 * e o `slow_down`. Negado, expirado ou recusado: `ErroLogin` com o que fazer; nada é publicado.
 * @param {{ api: string, info: (s: string) => void, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>, agora?: () => number }} o
 * @returns {Promise<{ token: string, expiraEm: number }>}
 */
export async function entrar({ api, info, fetch: f = globalThis.fetch, sleep = dormir, agora = Date.now }) {
  const ini = await postar(f, `${api}/v1/dispositivo/codigo`);
  const c = ini.corpo;
  if (ini.status !== 200 || !c || typeof c.device_code !== "string" || typeof c.user_code !== "string" || !c.verification_uri) {
    const causa = ini.status === 0 ? `sem resposta (${ini.falha})` : `HTTP ${ini.status}`;
    throw new ErroLogin(`não foi possível iniciar o login na central ${api}: ${causa}. Confira a conexão e tente de novo.`);
  }
  const expiraEmS = Number(c.expires_in) > 0 ? Number(c.expires_in) : 600;
  let intervaloS = Number(c.interval) > 0 ? Number(c.interval) : 5;
  info(`Para entrar, abra ${c.verification_uri} e confirme o código ${c.user_code}`);
  if (c.verification_uri_complete) info(`(ou abra direto: ${c.verification_uri_complete})`);
  info("Aguardando a aprovação na central...");

  const limite = agora() + expiraEmS * 1000;
  let falhas = 0;
  for (;;) {
    await sleep(intervaloS * 1000);
    if (agora() >= limite) throw expirou(expiraEmS);
    const r = await postar(f, `${api}/v1/dispositivo/token`, { device_code: c.device_code });
    if (r.status === 200 && r.corpo && typeof r.corpo.access_token === "string") {
      const validadeS = Number(r.corpo.expires_in) > 0 ? Number(r.corpo.expires_in) : 3600;
      return { token: r.corpo.access_token, expiraEm: agora() + validadeS * 1000 };
    }
    const erro = r.status === 400 && r.corpo ? r.corpo.error : undefined;
    if (erro === "authorization_pending") {
      falhas = 0;
      continue;
    }
    if (erro === "slow_down") {
      falhas = 0;
      intervaloS = Number(r.corpo.interval) > intervaloS ? Number(r.corpo.interval) : intervaloS + ACRESCIMO_SLOW_DOWN_S;
      continue;
    }
    if (erro === "access_denied") {
      throw new ErroLogin("o login foi negado na central. Nada foi publicado. Se foi você, rode publicar de novo e aprove o código.");
    }
    if (erro === "expired_token") throw expirou(expiraEmS);
    if (typeof erro === "string") {
      const desc = r.corpo.error_description ? ` (${r.corpo.error_description})` : "";
      throw new ErroLogin(`a central recusou o login: ${erro}${desc}. Nada foi publicado. Rode publicar de novo.`);
    }
    // Central fora do ar ou rede instável: tenta de novo algumas vezes antes de desistir.
    if (++falhas >= MAX_FALHAS_SEGUIDAS) {
      const causa = r.status === 0 ? `sem resposta (${r.falha})` : `HTTP ${r.status}`;
      throw new ErroLogin(`a central não respondeu durante o login: ${causa}. Nada foi publicado. Tente de novo em instantes.`);
    }
  }
}

function expirou(expiraEmS) {
  const min = Math.max(1, Math.round(expiraEmS / 60));
  return new ErroLogin(
    `o código de login expirou antes da aprovação. Nada foi publicado. Rode publicar de novo e aprove o código em até ${min} minutos.`,
  );
}
