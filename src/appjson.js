// Validação local do app.json: só feedback rápido. O servidor refaz toda a conferência.
import path from "node:path";

// Formato do id do app (ADR-034 §4), cópia do que a central confere (src/app/id.ts do squadia-live): o SDK
// não importa o registro. É a única declaração dentro do SDK; o servidor continua sendo quem decide.
export const ID_APP_RE = /^[a-z][a-z0-9]{2,39}$/;
export const MENSAGEM_ID_APP = "O id usa só letras minúsculas e números (3 a 40), começando por letra.";

/** Problema com a pasta de build (absoluta ou fora do workspace), ou null. */
export function problemaPasta(pasta) {
  if (typeof pasta !== "string" || pasta.trim() === "") return "deve ser um texto não vazio";
  if (path.isAbsolute(pasta) || path.win32.isAbsolute(pasta)) return "não pode ser caminho absoluto";
  const norm = path.posix.normalize(pasta.replaceAll("\\", "/"));
  if (norm === ".." || norm.startsWith("../")) return "não pode sair do workspace (..)";
  return null;
}

/** Valida o objeto já lido do JSON. Retorna { ok, errors: string[], value }. */
export function validarAppJson(obj) {
  const errors = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, errors: ["app.json: deve ser um objeto JSON"] };
  }
  for (const campo of ["id", "acesso", "pasta"]) {
    if (obj[campo] === undefined) errors.push(`app.json: campo "${campo}" ausente`);
    else if (typeof obj[campo] !== "string" || obj[campo].trim() === "") {
      errors.push(`app.json: campo "${campo}" inválido: deve ser um texto não vazio`);
    }
  }
  if (typeof obj.id === "string" && obj.id.trim() !== "" && !ID_APP_RE.test(obj.id)) {
    errors.push(`app.json: campo "id" inválido: ${MENSAGEM_ID_APP}`);
  }
  if (typeof obj.pasta === "string" && obj.pasta.trim() !== "") {
    const p = problemaPasta(obj.pasta);
    if (p) errors.push(`app.json: campo "pasta" inválido: ${p}`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, value: { id: obj.id, acesso: obj.acesso, pasta: obj.pasta } };
}

/** Valida o texto do app.json (JSON malformado vira erro legível). */
export function validarAppJsonTexto(texto) {
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch (e) {
    return { ok: false, errors: [`app.json: JSON inválido (${e.message})`] };
  }
  return validarAppJson(obj);
}
