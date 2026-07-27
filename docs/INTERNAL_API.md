# API interna do WA Sender 2

Contrato servidor-servidor para o fluxo CRM Meta → WA Sender 2. A base é
`/api/internal/v1`. Esta API não usa o cookie administrativo do painel e não
abre sockets Baileys no processo web.

## Segurança e headers

Todas as rotas exigem:

```http
Authorization: Bearer <segredo-interno>
```

Configure `WA2_INTERNAL_API_SECRET` somente no servidor. Durante rotação,
`WA2_INTERNAL_API_PREVIOUS_SECRET` pode manter temporariamente o segredo
anterior. Nunca registre, envie ao navegador ou inclua esses valores em
exemplos. A comparação usa hashes SHA-256 de tamanho fixo antes da comparação
resistente a timing attack.

`X-Request-Id` é opcional. UUIDs válidos são preservados; valores ausentes ou
inválidos são substituídos. Toda resposta devolve `X-Request-Id`.

As mutações exigem `Idempotency-Key` (8 a 128 caracteres alfanuméricos,
`.` `_` `:` ou `-`). A chave fica associada a método, rota e hash do corpo.
Reuso com outro corpo retorna `409`. Respostas repetidas podem conter
`X-Idempotent-Replay: true`.

O rate limit usa Redis e é configurado por:

- `WA2_INTERNAL_API_RATE_LIMIT` (padrão `60`);
- `WA2_INTERNAL_API_RATE_WINDOW_SECONDS` (padrão `60`);
- `WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS` (padrão `86400`).

Uma mutação é bloqueada se o Redis necessário à proteção estiver indisponível.
`429` inclui `Retry-After`.

## Respostas de erro

```json
{
  "error": {
    "code": "INSTANCE_NOT_FOUND",
    "message": "Instância não encontrada",
    "requestId": "123e4567-e89b-42d3-a456-426614174000"
  }
}
```

Códigos: `VALIDATION_ERROR`, `UNAUTHORIZED`, `RATE_LIMITED`,
`INSTANCE_NOT_FOUND`, `INSTANCE_STATE_CONFLICT`, `QR_NOT_AVAILABLE`,
`CONTACT_NOT_FOUND`, `CONTACT_AMBIGUOUS`, `CHAT_NOT_FOUND`,
`LABEL_NOT_FOUND`, `LID_UNRESOLVED`, `UNSUPPORTED_JID`,
`IDEMPOTENCY_CONFLICT`, `DEPENDENCY_UNAVAILABLE` e `INTERNAL_ERROR`.
Stacks, SQL, dados do Redis, caminhos de sessão e erros internos do Baileys não
são expostos.

## Endpoints

| Método | Rota | Corpo | Resultado |
|---|---|---|---|
| GET | `/health` | — | Saúde sanitizada da aplicação, banco, Redis e estado conhecido do worker |
| GET | `/instances` | — | Instâncias sem `sessionKey` ou credenciais |
| POST | `/instances` | `{"name":"CRM","role":"GENERAL"}` | Cria ou localiza a mesma instância sem conectar |
| GET | `/instances/:id/status` | — | Status sanitizado |
| GET | `/instances/:id/qr` | — | QR persistido, somente leitura |
| POST | `/instances/:id/connect` | `{"mode":"auto"}` | Enfileira conexão e retorna `202` |
| POST | `/instances/:id/sync` | `{"scope":"quick"}` | Enfileira sincronização e retorna `202` |
| POST | `/instances/:id/disconnect` | `{"preserveSession":true}` | Enfileira desconexão segura |
| GET | `/instances/:id/labels` | — | Etiquetas da instância |
| GET | `/instances/:id/chats/:chatId/labels` | — | Etiquetas do chat |
| PUT | `/instances/:id/chats/:chatId/labels/:waLabelId` | — | Enfileira aplicação idempotente |
| DELETE | `/instances/:id/chats/:chatId/labels/:waLabelId` | — | Enfileira remoção idempotente |
| GET | `/instances/:id/contacts/by-phone/:phone` | — | Contato, chat e etiquetas por telefone exato |

Papéis aceitos: `SALES`, `SUPPORT`, `BILLING`, `POST_SALES`, `AFFILIATE` e
`GENERAL`. Modos de conexão: `auto`, `resume` e `new_qr`. Uma sessão confirmada
não pode ser apagada por `new_qr`. Escopos de sincronização: `quick`, `catalog`
e `history`.

## QR e estados

O GET de QR apenas lê `WhatsappSession.qrCode`: não abre socket e não gera QR.
`expiresAt` é uma estimativa de três minutos, marcada por
`expiresAtHeuristic: true`. O QR nunca deve aparecer em logs ou cache de
idempotência.

Connect e sync somente enfileiram jobs. Disconnect encerra o socket no worker,
preserva os arquivos e credenciais da sessão e não executa reset. Exclusão de
instância, reset de sessão e envio de mensagens estão fora deste contrato.

## Etiquetas, telefone e LID

Chat e etiqueta são sempre consultados com `instanceId`. A alteração remota é
executada pelo worker que detém o socket; o vínculo local é atualizado somente
depois da chamada Baileys concluir. Repetir aplicação ou remoção é seguro.

A busca usa o normalizador brasileiro existente e igualdade de
`phoneNormalized`; não usa nome, prefixo, `contains` ou alteração de nono
dígito. JIDs `@lid` não são convertidos em telefone e retornam
`LID_UNRESOLVED`. Grupos, status, broadcasts, newsletters e tipos desconhecidos
retornam `UNSUPPORTED_JID`.

## Exemplo sanitizado

```bash
curl -H "Authorization: Bearer VALOR_FORNECIDO_FORA_DE_LOGS" \
  -H "X-Request-Id: 123e4567-e89b-42d3-a456-426614174000" \
  https://wa2.exemplo.invalid/api/internal/v1/instances
```
