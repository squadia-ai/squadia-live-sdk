# @squadia/live

SDK do Squadia Live (v0.1.0, MIT), publicado no npm como `@squadia/live` (repositório `squadia-ai/squadia-live-sdk`): a Action `publicar` envia o build do seu app pelo seu próprio fluxo de automação e conclui a versão na plataforma. Sem segredo no repositório: a autenticação é por OIDC do GitHub.

## app.json

Fica na raiz do repositório (ou onde apontar o input `app-json`) e declara o que será publicado:

```json
{
  "id": "meu-app",
  "acesso": "publico",
  "pasta": "dist"
}
```

- `id`: identificador do app (letras, números, `.`, `_`, `-`).
- `acesso`: o acesso desejado (texto não vazio; a plataforma decide o que aceita).
- `pasta`: pasta do build, relativa à raiz do workspace (não pode ser absoluta nem sair dele).

A pasta publicada precisa conter `index.html` e `app.json` na raiz, ter no máximo 500 arquivos e 50 MB no total, e nenhum path com `..` ou começando por `_squadia/`. Dica: copie o `app.json` para dentro da pasta do build. A validação local serve só para falhar cedo; o servidor refaz toda conferência.

## Fluxo de automação (exemplo completo)

```yaml
name: publicar
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  publicar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: |
          mkdir -p dist
          cp index.html app.json dist/
      - uses: squadia-ai/squadia-live-sdk@v0.1.0
        id: publicar
      - run: echo "versão ${{ steps.publicar.outputs.versao-id }} (${{ steps.publicar.outputs.estado }})"
```

Só valem os eventos `push` e `workflow_dispatch`, no ramo vinculado ao app; `pull_request` é recusado.

Inputs: `app-json` (padrão `app.json`) e `api` (padrão `https://squadia.live`, para testes). Saídas: `versao-id` e `estado`. A ação sai com erro se a versão for recusada (motivos no log) ou se o pedido falhar. Sem `permissions: id-token: write` ela falha antes de enviar qualquer coisa.

## CLI `publicar` (da sua máquina)

Para publicar sem GitHub Actions. A CLI usa o mesmo ponto de recebimento e as mesmas regras da Action, e a central decide igual pelos dois caminhos. Só o dono do app publica.

```sh
npm install -g @squadia/live
publicar --app meu-app dist
```

- `--app <app>`: id do app de que você é dono.
- `[diretório]`: a pasta do build (padrão: a atual), com `index.html` e `app.json` na raiz. Valem os mesmos limites da Action.

Na primeira vez, a CLI mostra um endereço e um código. Abra o endereço, entre na central e confirme o código. Não é preciso configurar credencial nenhuma. A sessão fica em `~/.config/squadia-live/sessao.json` (ou `$XDG_CONFIG_HOME`/`%APPDATA%`), com permissão `0600`, e vale por algumas horas. Quando ela vence, a CLI pede o login de novo.

Saída: `0` quando a versão é aceita e vai ao ar; `1` quando o login é negado ou expira, quando você não é dono do app, quando o manifesto é recusado (com a razão da central, igual à da Action) ou quando a central falha; `2` quando o comando é usado de forma incorreta. Nenhum token aparece na saída. `SQUADIA_LIVE_API` troca a central, só para testes (https, ou http em localhost).

## Uso como biblioteca

```sh
npm install @squadia/live
```

```js
import { nome, versao, validarAppJson, validarAppJsonTexto, API_PADRAO } from "@squadia/live";

validarAppJson({ id: "meu-app", acesso: "publico", pasta: "dist" }); // { ok: true, errors: [], value: {...} }
```

A entrada é ESM, sem dependências e com tipos (`src/index.d.ts`). Ela exporta o nome e a versão do pacote, a mesma validação local do `app.json` usada pela Action e pela CLI e as operações de identidade do navegador (`quemSou`, `entrar`, `sair`, `naCasca`, abaixo).

## Identidade no navegador

O app roda no navegador, na mesma origem do Squadia Live, e usa quatro operações. Todas as chamadas são a caminhos relativos ao próprio app (`/_squadia/...`); o SDK nunca chama o endereço do Squadia Live. A sessão fica num cookie HttpOnly que o SDK não vê, e o código novo nunca lê, expõe nem guarda credencial.

```js
import { quemSou, entrar, sair, naCasca } from "@squadia/live";

const r = await quemSou();
// { ok: true, pessoa: { id, nome, email, papel } }  papel: "dono" | "usuario"
// { ok: false, motivo: "sem-sessao" }                sem sessão (ausente, expirada ou revogada)
// { ok: false, motivo: "falha" }                     erro de rede ou resposta inválida (nunca há pessoa padrão)

entrar();                     // navega a /_squadia/entrar?volta=<caminho atual com a query>
entrar({ volta: "/painel" }); // `volta` precisa ser um caminho relativo começando por "/"
await sair();                 // POST /_squadia/sair, sem corpo, espera 204; depois quemSou() devolve "sem-sessao"
naCasca();                    // true/false
```

- `quemSou()` consulta `GET /_squadia/eu` (`credentials: "same-origin"`); a resposta `null` é "sem sessão".
- `entrar()` é navegação de página inteira; o retorno (`/_squadia/retorno`) é interno e o SDK não o chama.
- `sair()` não é navegação. Resposta diferente de 204 ou erro de rede dá `{ ok: false, motivo: "falha" }`.
- `naCasca()` é `true` quando a URL de abertura da aba trouxe `casca=hexcot` (v1, decisão do PO). O SDK memoriza isso no `sessionStorage` (chave `squadia_casca`) para a aba toda e remove o parâmetro da barra de endereço (`history.replaceState`), preservando os outros parâmetros e o hash. Fora disso é `false`. **O resultado é só informativo (exibição) e nunca deve ser usado para autorizar nada.** Acrescentar `casca=hexcot` ao abrir um app é trabalho do HexCot, ainda pendente.

### Modo de desenvolvimento (localhost)

Quando o host é exatamente `localhost` ou `127.0.0.1`, `quemSou()` devolve a pessoa simulada do arquivo estático `/squadia-live.dev.json`, servido pelo dev server do seu app (lido a cada chamada), sem consultar o endpoint de identidade:

```json
{ "id": "00000000-0000-0000-0000-000000000001", "nome": "Dev", "email": "dev@exemplo.local", "papel": "dono" }
```

Use `null` no arquivo para simular "sem sessão". Arquivo ausente ou inválido dá `{ ok: false, motivo: "falha" }`. Em qualquer outro host o modo não ativa, nem por opção, e o arquivo é ignorado. Nesse modo `entrar()` não navega e `sair()` não faz requisição: `sair()` marca "sem sessão" em memória até `entrar()` ser chamado ou a página recarregar.

## Desenvolvimento

`npm test` (Node ≥ 20, sem dependências). `npm run test:pacote` empacota com `npm pack`, instala o tarball num projeto temporário e importa `@squadia/live` de lá; a CI do PR roda os dois e `npm pack --dry-run`.

## Publicação no npm

O workflow `publicar.yml` publica quando uma versão é marcada: a tag `vX.Y.Z` tem de ser igual ao `version` do `package.json`, senão o run falha antes de publicar. Também pode ser disparado à mão (`workflow_dispatch`) escolhendo uma tag como ref. A publicação usa trusted publishing (OIDC do GitHub, `npm publish --provenance`): não há token de npm no repositório. O escopo `@squadia` no npm e o cadastro deste repositório e do workflow `publicar.yml` como publicador confiável do pacote são configuração do dono do escopo.

## Licença

MIT
