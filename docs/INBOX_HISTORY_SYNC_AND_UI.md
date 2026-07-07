# Inbox, Historico e UI

## Como a Baileys envia historico

A Baileys entrega historico por eventos:

- `messaging-history.set`
- `chats.upsert`
- `chats.update`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`

O evento `messages.upsert` pode chegar como `notify` ou `append`. A inbox processa ambos.

## QR Safe Mode vs modo conectado

Quando `session files = 0`, o pareamento limpo entra em QR_SAFE_MODE:

- usa browser conservador para QR;
- nao passa `version` obtida por `fetchLatestBaileysVersion`;
- `syncFullHistory: false`;
- `shouldSyncHistoryMessage: () => false`;
- nao injeta `getMessage` antes do pareamento.

Esse modo prioriza gerar QR e conectar. Historico completo antigo nao deve bloquear o pareamento.

Quando a sessao ja possui arquivos, o socket entra no modo normal:

- pode buscar latest version;
- pode usar `Browsers.macOS("Desktop")`;
- pode usar `getMessage` lendo do banco por `jid + waMessageId`;
- usa `syncFullHistory: true` somente fora do pareamento limpo;
- processa eventos naturais de mensagens, historico, contatos, chats e labels.

## Por que nem tudo pode aparecer

Se a sessao ja estava pareada antes dos ajustes de historico, o WhatsApp pode nao reenviar todo o historico antigo. Nesse caso, a aplicacao nao consegue inventar conversas que nao chegaram por evento.

Alguns contatos tambem podem chegar sem nome amigavel. Dependendo do evento, a Baileys pode entregar apenas JID, telefone, `lid`, `pushName` parcial ou nenhum historico de mensagem.

O botao `Verificar historico` enfileira um job singleton somente quando `WhatsappSession.status = connected`. Ele nao cria socket novo, nao reseta sessao e nao executa `fetchMessageHistory` sem cursor seguro. Na versao instalada, `fetchMessageHistory` exige:

- quantidade;
- chave da mensagem mais antiga;
- timestamp da mensagem mais antiga.

Sem essa referencia, uma sincronizacao completa sob demanda nao e segura.

## Como os nomes da inbox sao resolvidos

A UI nao usa JID cru como primeira opcao quando existe dado melhor. O nome exibido segue esta prioridade:

1. `WhatsappChat.name`, se existir e nao for JID cru.
2. `WhatsappContact.name`, se existir.
3. `WhatsappContact.pushName`, se existir.
4. Telefone formatado a partir do JID, quando o JID for `@s.whatsapp.net`.
5. Fallback amigavel para grupo ou `lid` (`Contato WhatsApp` + sufixo curto).
6. JID completo apenas como ultimo fallback.

O sync tambem evita sobrescrever um nome bom com candidato pior. Valores iguais ao JID, `@lid` cru ou telefone puro do proprio JID sao tratados como ausencia de nome.

## Status 428 e sessao removida no celular

O status `428` (`Connection Terminated`) significa sessao encerrada, invalida ou removida no celular. Nesse caso o Baileys **nao** deve reconectar em loop.

Comportamento esperado apos o hotfix:

1. O worker para de criar sockets repetidos.
2. `WhatsappSession` fica `disconnected` ou `error`, com `qrCode` e `connectedPhone` nulos.
3. `lastError` orienta: use Resetar sessao e Reconectar para gerar novo QR.

Para gerar QR novo apos remover o dispositivo no celular:

1. Pare o worker se estiver em loop infinito.
2. Aplique o hotfix e faca deploy.
3. Em `/whatsapp`, clique em `Resetar sessao`.
4. Clique em `Reconectar`.
5. Escaneie o QR Code novo.

Nao clique repetidamente em `Verificar historico`. O botao apenas confirma status e orienta; nao forca historico antigo.

## Jobs administrativos singleton

Connect, reset e disconnect usam `jobId` fixo no Redis/BullMQ:

- `connect-whatsapp`
- `reset-whatsapp`
- `disconnect-whatsapp`

Isso reduz rajada de jobs administrativos quando o usuario clica varias vezes. A rota de reconnect tambem evita enfileirar novo connect se o status ja estiver `connecting` ou `qr`.

## Quando usar reset/reconnect manual

Use reconnect manual se o worker nao estiver conectado ou se nao houver eventos novos.

Use reset manual apenas quando aceitar parear novamente o numero. No estado atual, reset/reconnect prioriza QR e conexao estavel; historico antigo completo nao e garantido.

Nao use reset automatico em producao sem decisao operacional.

## Como validar no banco

```sql
SELECT COUNT(*) FROM "WhatsappChat";
SELECT COUNT(*) FROM "WhatsappContact";
SELECT COUNT(*) FROM "WhatsappMessage";
```

Separar grupos e contatos:

```sql
SELECT "isGroup", COUNT(*) FROM "WhatsappChat" GROUP BY "isGroup";
```

Ver ultimas conversas:

```sql
SELECT "jid", "name", "isGroup", "lastMessageAt", "lastMessageText"
FROM "WhatsappChat"
ORDER BY "updatedAt" DESC
LIMIT 20;
```

## Logs esperados

Historico:

```text
[history] messaging-history.set received { syncType: ..., chats: X, contacts: Y, messages: Z }
[history] chats persisted { count: X, skipped: Y, failed: Z }
[history] contacts persisted { count: X, skipped: Y, failed: Z }
[history] messages persisted { count: X, skipped: Y, failed: Z }
[history] message skipped { reason: "system-or-empty" }
```

Mensagens:

```text
[history] messages.upsert received { type: "append", count: X }
[history] live messages persisted { type: "append", count: X, skipped: Y, failed: Z }
[sync] messages upsert { type: "append", messages: X, processed: X, skipped: Y, failed: Z }
```

Solicitacao manual de verificacao de historico:

```text
[history] sync-whatsapp-history skipped; not connected { status: "disconnected" }
```

ou, se conectado:

```text
[history] sync-whatsapp-history requested { syncFullHistory: false, hasFetchMessageHistory: true, hasOldestMessageCursor: true, mode: "event-driven" }
```

Sessao encerrada no celular (428):

```text
[baileys] connection.update { connection: "close", hasQr: false, statusCode: 428, error: "Connection Terminated" }
[baileys] connection terminated 428; reconnect disabled
```

## Mudancas de UI

`/conversas` agora usa layout de inbox:

- cards de metricas;
- filtro padrao `Recentes`, mostrando primeiro conversas com mensagem salva;
- filtros por todas, contatos, grupos e sem mensagem;
- busca grande;
- lista de conversas em cards com nome amigavel, telefone/JID discreto e badges;
- botao compacto de nova conversa;
- botao de verificar historico.
- status discreto da conexao e ultimo evento salvo.

O filtro `Sem mensagem` concentra contatos sincronizados que ainda nao possuem mensagem salva. Isso evita que a tela inicial vire uma lista gigante de JIDs ou contatos vazios.

`/conversas/[id]` agora usa layout de chat:

- cabecalho de conversa;
- display name amigavel e telefone/JID abaixo;
- bolhas inbound/outbound;
- composer no rodape;
- aviso ao enviar para grupo.

## Limitacoes

- Sem realtime na UI por WebSocket/SSE; o backend persiste eventos live recebidos pela Baileys.
- Sem multiplos numeros.
- Sem status persistido de job manual.
- Sem backfill automatico por `fetchMessageHistory` sem cursor de mensagem antiga.
- Historico completo depende do que o WhatsApp reenviar para a sessao.
- Labels e envio por etiqueta existem como feature parcial; ver `docs/WHATSAPP_LABELS_AND_BULK_SEND.md`.
- QR_SAFE_MODE nao obriga `fetchLatestBaileysVersion` quando a pasta da sessao esta vazia.
