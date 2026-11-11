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

export interface Pessoa {
  id: string;
  nome: string | null;
  email: string | null;
  papel: "dono" | "usuario";
}

export type ResultadoQuemSou =
  | { ok: true; pessoa: Pessoa }
  | { ok: false; motivo: "sem-sessao" | "falha" };

export type ResultadoSair = { ok: true } | { ok: false; motivo: "falha" };

/** Quem é a pessoa (GET /_squadia/eu na mesma origem; em localhost, o arquivo /squadia-live.dev.json). */
export function quemSou(): Promise<ResultadoQuemSou>;

/** Navega à entrada; `volta` (começa com "/") padroniza para o caminho atual com a query. */
export function entrar(opcoes?: { volta?: string }): void;

/** POST /_squadia/sair na mesma origem (204); depois quemSou() devolve "sem-sessao". */
export function sair(): Promise<ResultadoSair>;

/** App aberto numa aba do HexCot (`casca=hexcot`)? Só informativo; nunca autoriza nada. */
export function naCasca(): boolean;
