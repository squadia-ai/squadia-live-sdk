// Orquestração: validar → checar permissão → OIDC → iniciar → enviar → concluir.
import fs from "node:fs/promises";
import path from "node:path";
import { validarAppJsonTexto } from "./appjson.js";
import { coletarArquivos, resolverPasta, ErroValidacao } from "./arquivos.js";
import { criarCliente, ErroApi } from "./cliente.js";

export const MSG_SEM_PERMISSAO =
  "permissão ausente: adicione `permissions: id-token: write` (e `contents: read`) ao job que usa esta ação.";

/**
 * @param {object} o
 * @param {string} o.workspace
 * @param {string} o.appJson caminho relativo do app.json
 * @param {string} o.api
 * @param {{ temPermissao: () => boolean, getIDToken: (aud:string)=>Promise<string>, setSecret: (s:string)=>void, info: (s:string)=>void }} o.ambiente
 * @param {Function} [o.fetch]
 * @param {Function} [o.sleep]
 * @returns {Promise<{ versaoId: string, estado: string, motivos: string[], ok: boolean }>}
 */
export async function publicar({ workspace, appJson, api, ambiente, fetch, sleep }) {
  // 1. Validação local (nada de rede antes disto)
  const raiz = await fs.realpath(workspace);
  const caminhoApp = path.resolve(raiz, appJson);
  const relApp = path.relative(raiz, caminhoApp);
  if (relApp.startsWith("..") || path.isAbsolute(relApp)) {
    throw new ErroValidacao([`caminho do app.json escapa do workspace: ${appJson}`]);
  }
  let texto;
  try {
    texto = await fs.readFile(caminhoApp, "utf8");
  } catch {
    throw new ErroValidacao([`app.json não encontrado: ${appJson}`]);
  }
  const v = validarAppJsonTexto(texto);
  if (!v.ok) throw new ErroValidacao(v.errors);
  const pasta = await resolverPasta(raiz, v.value.pasta);
  const arquivos = await coletarArquivos(pasta);

  // 2. Permissão id-token: write
  if (!ambiente.temPermissao()) throw new ErroValidacao([MSG_SEM_PERMISSAO]);

  // 3. Token OIDC (mascarado antes de qualquer uso)
  const token = await ambiente.getIDToken("squadia.live");
  ambiente.setSecret(token);

  const cliente = criarCliente({ api, token, ...(fetch ? { fetch } : {}), ...(sleep ? { sleep } : {}) });

  // 4. Iniciar
  const { versaoId, envios } = await cliente.iniciar(v.value.id, arquivos);
  for (const e of envios) ambiente.setSecret(e.url);

  // 5. Enviar — qualquer falha aborta sem concluir
  const porPath = new Map(arquivos.map((a) => [a.path, a]));
  for (const e of envios) {
    const a = porPath.get(e.path);
    if (!a) throw new ErroApi(`a plataforma pediu envio de arquivo desconhecido: ${e.path}`);
    await cliente.enviar(e, await fs.readFile(a.abs));
    ambiente.info(`enviado: ${e.path}`);
  }

  // 6. Concluir
  const r = await cliente.concluir(v.value.id, versaoId);
  const estado = r.corpo.estado;
  const motivos = Array.isArray(r.corpo.motivos) ? r.corpo.motivos : [];
  return { versaoId: r.corpo.versaoId || versaoId, estado, motivos, ok: r.status === 200 && estado === "aceita" };
}
