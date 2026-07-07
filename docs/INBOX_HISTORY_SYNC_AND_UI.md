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

## Configuracao de full history

O socket foi configurado com:

- `browser: Browsers.macOS("Desktop")`
- `syncFullHistory: true`
- `shouldSyncHistoryMessage: () => true`
- `markOnlineOnConnect: false`
- `getMessage` lendo do banco por `jid + waMessageId`

Isso pede ao WhatsApp Web historico completo quando a sessao permite.

## Por que nem tudo pode aparecer

Se a sessao ja estava pareada antes de `syncFullHistory: true`, o WhatsApp pode nao reenviar todo o historico antigo. Nesse caso, a aplicacao nao consegue inventar conversas que nao chegaram por evento.

Alguns contatos tambem podem chegar sem nome amigavel. Dependendo do evento, a Baileys pode entregar apenas JID, telefone, `lid`, `pushName` parcial ou nenhum historico de mensagem.

O botao `Verificar historico` consulta o status atual da sessao e retorna orientacao informativa. Ele nao cria socket novo, nao chama `startBaileysConnection` e nao executa `fetchMessageHistory` sem cursor seguro. Na versao instalada, `fetchMessageHistory` exige:

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
5. Fallback amigavel para grupo ou `lid`.
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

Connect, reset, disconnect e sync-history usam `jobId` fixo no Redis/BullMQ:

- `connect-whatsapp-singleton`
- `reset-whatsapp-singleton`
- `disconnect-whatsapp-singleton`
- `sync-whatsapp-history-singleton`

Isso impede rajada de jobs quando o usuario clica varias vezes. Reset remove jobs pendentes de connect/disconnect/sync antes de enfileirar.

## Quando usar reset/reconnect manual

Use reconnect manual se o worker nao estiver conectado ou se nao houver eventos novos.

Use reset manual apenas quando aceitar parear novamente o numero. Para forcar o WhatsApp a reenviar mais historico, pode ser necessario resetar a sessao e parear de novo com `syncFullHistory` ja ativo.

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
[sync] history set { syncType: ..., chats: X, contacts: Y, messages: Z }
[sync] history chats { syncType: ..., chats: X, processed: X, skipped: Y, failed: Z }
[sync] history contacts { syncType: ..., contacts: X, processed: X, skipped: Y, failed: Z }
[sync] history messages { syncType: ..., messages: X, processed: X, skipped: Y, failed: Z }
```

Mensagens:

```text
[sync] messages upsert { type: "append", messages: X, processed: X, skipped: Y, failed: Z }
[sync] messages upsert { type: "notify", messages: X, processed: X, skipped: Y, failed: Z }
```

Solicitacao manual de verificacao de historico:

```text
[baileys] history sync skipped; not connected { status: "disconnected" }
```

ou, se conectado:

```text
[baileys] history sync requested { syncFullHistory: true, hasOnDemandHistory: true, mode: "event-driven" }
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

O filtro `Sem mensagem` concentra contatos sincronizados que ainda nao possuem mensagem salva. Isso evita que a tela inicial vire uma lista gigante de JIDs ou contatos vazios.

`/conversas/[id]` agora usa layout de chat:

- cabecalho de conversa;
- display name amigavel e telefone/JID abaixo;
- bolhas inbound/outbound;
- composer no rodape;
- aviso ao enviar para grupo.

## Limitacoes

- Sem realtime.
- Sem labels.
- Sem multiplos numeros.
- Sem status persistido de job manual.
- Historico completo depende do que o WhatsApp reenviar para a sessao.
- `fetchLatestBaileysVersion` segue ativo porque a conexao esta estavel, mas a propria Baileys recomenda cautela com mudancas de versao.
- Etiquetas e envio por etiqueta: ver `docs/WHATSAPP_LABELS_AND_BULK_SEND.md`.
