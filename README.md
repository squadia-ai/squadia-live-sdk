# squadia-live-sdk

SDK do Squadia Live (v0.1.0, MIT): a Action `publicar` envia o build do seu app pelo seu próprio fluxo de automação e conclui a versão na plataforma. Sem segredo no repositório: a autenticação é por OIDC do GitHub.

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

## Desenvolvimento

`npm test` (Node ≥ 20, sem dependências).

## Licença

MIT
