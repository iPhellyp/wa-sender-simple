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

O botao `Sincronizar historico` enfileira um job para manter o socket ativo e registrar a solicitacao, mas nao executa `fetchMessageHistory` sem cursor seguro. Na versao instalada, `fetchMessageHistory` exige:

- quantidade;
- chave da mensagem mais antiga;
- timestamp da mensagem mais antiga.

Sem essa referencia, uma sincronizacao completa sob demanda nao e segura.

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

Solicitacao manual de sync:

```text
[worker] sync-whatsapp-history job received
[baileys] history sync requested { syncFullHistory: true, hasOnDemandHistory: true, mode: "event-driven" }
[worker] sync-whatsapp-history finished { hasOnDemandHistory: true, mode: "event-driven" }
```

## Mudancas de UI

`/conversas` agora usa layout de inbox:

- cards de metricas;
- filtros por todas, contatos, grupos e nao lidas;
- busca grande;
- lista de conversas em cards;
- botao compacto de nova conversa;
- botao de sincronizar historico.

`/conversas/[id]` agora usa layout de chat:

- cabecalho de conversa;
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
