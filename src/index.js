// Entrada pública do pacote `@squadia/live` (`import ... from "@squadia/live"`). Sem efeito colateral:
// a Action (`src/main.js`) e a CLI (`bin/publicar.js`) têm os próprios pontos de entrada.
export { validarAppJson, validarAppJsonTexto } from "./appjson.js";
export { API_PADRAO } from "./cliente.js";
export { quemSou, entrar, sair, naCasca } from "./navegador/index.js";

/** Nome público do pacote no npm. */
export const nome = "@squadia/live";

/** Versão do pacote; acompanha o `version` do package.json (conferido nos testes). */
export const versao = "0.1.0";
