// Redação de segredos em toda saída da CLI: nenhum token chega ao terminal nem a log.

/**
 * Redige token de publicação (`slp_…`), `device_code` (`sld_…`), JWT, credencial após `Bearer` e
 * assinaturas em query string de URL assinada. O `user_code` (XXXX-XXXX) é feito para ser exibido.
 * @param {string} texto
 */
export function redigir(texto) {
  return String(texto)
    .replace(/\bsl[pd]_[A-Za-z0-9_-]+/g, "[token redigido]")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[token redigido]")
    .replace(/(bearer\s+)[^\s"',;]+/gi, "$1[redigido]")
    .replace(/([?&](?:token|sig|signature|x-amz-signature|x-amz-credential|access_token)=)[^&\s"']+/gi, "$1[redigido]");
}
