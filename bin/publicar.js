#!/usr/bin/env node
// Executável `publicar` (CLI do Squadia Live). Sem dependências externas.
import { executar } from "../src/cli/publicar.js";

process.exitCode = await executar({ argv: process.argv.slice(2) });
