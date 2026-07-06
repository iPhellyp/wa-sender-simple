# Sync Read-Only WhatsApp

## Objetivo

Sincronizar conversas, contatos e mensagens recebidas pelo Baileys sem alterar o fluxo de conexao, campanhas, envio ou etiquetas.

## Como funciona

O worker cria o socket Baileys e registra listeners em `sock.ev`. Cada evento recebido e persistido no Postgres por helpers em `src/lib/baileys/sync.ts`.

O socket usa `syncFullHistory: true`, `Browsers.macOS("Desktop")`, `shouldSyncHistoryMessage: () => true` e `getMessage` lendo mensagens salvas para auxiliar retries internos da Baileys.

O processamento e idempotente:

- chats usam `jid` unico;
- contatos usam `jid` unico;
- mensagens usam `jid + waMessageId` unico;
- mensagens duplicadas atualizam campos simples em vez de criar outro registro.

Eventos grandes sao processados em lotes pequenos com `Promise.allSettled`, para evitar que um item invalido derrube o worker.

## Eventos Baileys usados

- `messaging-history.set`
- `chats.upsert`
- `chats.update`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`
- `messages.update`

## Dados persistidos

Models:

- `WhatsappChat`
- `WhatsappContact`
- `WhatsappMessage`

Campos principais:

- JID da conversa ou contato;
- nome quando disponivel;
- indicador de grupo;
- contador de nao lidas quando disponivel;
- ultima mensagem;
- ultima entrada inbound/outbound;
- tipo da mensagem;
- texto extraido quando disponivel;
- `rawJson` defensivo para auditoria tecnica.

## Como validar

1. Confirmar que o WhatsApp continua `connected`.
2. Iniciar o worker.
3. Receber ou enviar uma mensagem no numero conectado.
4. Conferir logs do worker.
5. Abrir `/conversas`.
6. Abrir uma conversa e conferir as ultimas mensagens salvas.

## Logs esperados

Ao sincronizar historico:

```text
[sync] history set { syncType: "...", chats: X, contacts: Y, messages: Z }
[sync] history chats { syncType: "...", chats: X, processed: X, skipped: Y, failed: Z }
[sync] history contacts { syncType: "...", contacts: X, processed: X, skipped: Y, failed: Z }
[sync] history messages { syncType: "...", messages: X, processed: X, skipped: Y, failed: Z }
```

Ao receber mensagem nova:

```text
[sync] messages upsert { type: "notify", messages: X, processed: X, skipped: Y, failed: Z }
[sync] messages upsert { type: "append", messages: X, processed: X, skipped: Y, failed: Z }
```

Ao atualizar mensagem:

```text
[sync] messages update { messages: X, processed: X, skipped: Y, failed: Z }
```

## Limitacoes

- Nao sincroniza labels nesta fase.
- Nao cria `accountId`, pois ainda existe apenas um numero.
- Nao altera campanhas.
- Nao apaga ou reseta sessao Baileys.
- Historico completo depende do que o WhatsApp reenviar para a sessao.
- `messages.update` ainda nao possui campo de status dedicado; salva atualizacao simples em `rawJson`.

## Proxima fase sugerida

Implementar labels em modo read-only:

1. Registrar payload real de `labels.edit` e `labels.association`.
2. Criar `WhatsappLabel` e `WhatsappChatLabel`.
3. Persistir associacoes sem aplicar etiqueta no WhatsApp.
4. Exibir etiquetas em `/conversas`.

## Evolucao operacional

A inbox basica com envio manual esta documentada em `docs/INBOX_MANUAL_SEND.md`.

O redesenho da inbox e as limitacoes de historico completo estao documentados em `docs/INBOX_HISTORY_SYNC_AND_UI.md`.
