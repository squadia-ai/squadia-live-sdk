// Rotas reservadas do Squadia Live (contrato da H08/SQD-864). Único lugar do SDK que as escreve.
// São sempre relativas ao próprio app (mesma origem): o SDK nunca chama o endereço do Squadia Live.
export const ROTA_IDENTIDADE = "/_squadia/eu";
export const ROTA_ENTRADA = "/_squadia/entrar";
export const ROTA_SAIDA = "/_squadia/sair";

/** Parâmetro de URL (decisão do PO, v1) que marca a abertura da aba pela casca do HexCot. */
export const PARAM_CASCA = "casca";
export const VALOR_CASCA = "hexcot";
/** Única chave de armazenamento da aba usada pelo módulo. */
export const CHAVE_CASCA = "squadia_casca";

/** Arquivo estático (servido pelo dev server do próprio app) com a pessoa simulada do modo dev. */
export const ARQUIVO_DEV = "/squadia-live.dev.json";
