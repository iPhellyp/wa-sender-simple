# Sync Read-Only WhatsApp

## Objetivo

Sincronizar conversas, contatos e mensagens recebidas pelo Baileys sem alterar o fluxo de conexao, campanhas, envio ou etiquetas.

## Como funciona

O worker cria o socket Baileys e registra listeners em `sock.ev`. Cada evento recebido e persistido no Postgres por helpers em `src/lib/baileys/sync.ts`.

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
[sync] history set { chats: X, contacts: Y, messages: Z }
[sync] history chats { processed: X, skipped: Y, failed: Z, firstError: null }
[sync] history contacts { processed: X, skipped: Y, failed: Z, firstError: null }
[sync] history messages { processed: X, skipped: Y, failed: Z, firstError: null }
```

Ao receber mensagem nova:

```text
[sync] messages upsert { messages: X, type: "notify" }
[sync] messages upsert { processed: X, skipped: Y, failed: Z, firstError: null }
```

Ao atualizar mensagem:

```text
[sync] messages update { messages: X }
[sync] messages update { processed: X, skipped: Y, failed: Z, firstError: null }
```

## Limitacoes

- Nao sincroniza labels nesta fase.
- Nao cria `accountId`, pois ainda existe apenas um numero.
- Nao envia mensagem pela tela de conversa.
- Nao altera campanhas.
- Nao apaga ou reseta sessao Baileys.
- `messages.update` ainda nao possui campo de status dedicado; salva atualizacao simples em `rawJson`.

## Proxima fase sugerida

Implementar labels em modo read-only:

1. Registrar payload real de `labels.edit` e `labels.association`.
2. Criar `WhatsappLabel` e `WhatsappChatLabel`.
3. Persistir associacoes sem aplicar etiqueta no WhatsApp.
4. Exibir etiquetas em `/conversas`.
