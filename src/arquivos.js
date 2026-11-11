// Coleta dos arquivos do build e validação local dos limites (a API repete tudo).
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_ARQUIVOS = 500;

export class ErroValidacao extends Error {
  constructor(erros) {
    super(erros.join("\n"));
    this.name = "ErroValidacao";
    this.erros = erros;
  }
}

/** Resolve a pasta dentro do workspace, conferindo também via realpath (symlinks). */
export async function resolverPasta(workspace, pasta) {
  const raiz = await fs.realpath(workspace);
  const alvo = path.resolve(raiz, pasta);
  let real;
  try {
    real = await fs.realpath(alvo);
  } catch {
    throw new ErroValidacao([`pasta de build não encontrada: "${pasta}"`]);
  }
  const rel = path.relative(raiz, real);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new ErroValidacao([`pasta de build "${pasta}" escapa do workspace`]);
  }
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new ErroValidacao([`pasta de build "${pasta}" não é um diretório`]);
  return real;
}

async function listar(dir, base, saida) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    if (ent.name === ".git" && dir === base) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) await listar(abs, base, saida);
    else if (ent.isFile()) saida.push(abs);
    else throw new ErroValidacao([`arquivo não suportado (link simbólico ou especial): ${path.relative(base, abs).split(path.sep).join("/")}`]);
  }
}

/** Valida a lista de arquivos ({path,size}) contra os limites do contrato. */
export function validarLimites(arquivos) {
  const erros = [];
  if (arquivos.length > MAX_ARQUIVOS) erros.push(`máximo de ${MAX_ARQUIVOS} arquivos excedido (${arquivos.length})`);
  const total = arquivos.reduce((s, a) => s + a.size, 0);
  if (total > MAX_BYTES) erros.push(`máximo de 50 MB no total excedido (${total} bytes)`);
  const paths = new Set(arquivos.map((a) => a.path));
  for (const obrigatorio of ["index.html", "app.json"]) {
    if (!paths.has(obrigatorio)) erros.push(`arquivo obrigatório ausente na raiz da pasta publicada: ${obrigatorio}`);
  }
  for (const a of arquivos) {
    if (a.path.split("/").includes("..")) erros.push(`path inválido (contém ".."): ${a.path}`);
    if (a.path.startsWith("_squadia/")) erros.push(`path inválido (começa por "_squadia/"): ${a.path}`);
  }
  return erros;
}

/** Retorna [{ path, size, sha256, abs }] ordenado por path; lança ErroValidacao se violar limites. */
export async function coletarArquivos(raizPasta) {
  const abs = [];
  await listar(raizPasta, raizPasta, abs);
  const arquivos = [];
  for (const a of abs.sort()) {
    const buf = await fs.readFile(a);
    arquivos.push({
      path: path.relative(raizPasta, a).split(path.sep).join("/"),
      size: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      abs: a,
    });
  }
  const erros = validarLimites(arquivos);
  if (erros.length) throw new ErroValidacao(erros);
  return arquivos;
}
