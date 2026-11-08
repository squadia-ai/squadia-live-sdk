/** Resultado da validação local do app.json (o servidor refaz toda a conferência). */
export interface ResultadoAppJson {
  ok: boolean;
  errors: string[];
  value?: { id: string; acesso: string; pasta: string };
}

/** Valida o objeto já lido do app.json. */
export function validarAppJson(obj: unknown): ResultadoAppJson;

/** Lê e valida o texto do app.json. */
export function validarAppJsonTexto(texto: string): ResultadoAppJson;

/** Central padrão do Squadia Live. */
export const API_PADRAO: string;

/** Nome público do pacote no npm. */
export const nome: "@squadia/live";

/** Versão do pacote. */
export const versao: string;
