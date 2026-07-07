# Inbox Operacional e Envio Manual

## Objetivo

Transformar `/conversas` em uma inbox basica para operar conversas sincronizadas e enviar mensagens manuais sem enviar diretamente pelo servidor Next.js.

## Fluxo de envio manual

1. Usuario abre `/conversas/[id]`.
2. Composer envia `POST /api/conversas/[id]/send`.
3. API valida conversa e texto.
4. API enfileira job BullMQ `send-manual-message`.
5. Worker processa o job usando o socket Baileys vivo.
6. Worker chama `sendWhatsappMessageToJid(jid, text)`.
7. Apos sucesso, worker salva `WhatsappMessage` outbound.
8. Worker atualiza `WhatsappChat.lastMessageAt`, `lastMessageText` e `lastOutboundAt`.

## APIs

### `POST /api/conversas/start`

Cria ou abre conversa individual por telefone.

Body:

```json
{
  "phone": "38999999999",
  "name": "Nome opcional"
}
```

Retorno:

```json
{
  "chatId": "...",
  "redirectUrl": "/conversas/..."
}
```

### `POST /api/conversas/[id]/send`

Enfileira envio manual.

Body:

```json
{
  "text": "Mensagem"
}
```

Retorno:

```json
{
  "ok": true,
  "jobId": "...",
  "message": "Mensagem enviada para fila"
}
```

## Job BullMQ

Nome:

```text
send-manual-message
```

Payload:

```json
{
  "chatId": "...",
  "jid": "55DDDNUMERO@s.whatsapp.net",
  "text": "Mensagem"
}
```

Configuracao:

- `attempts: 1`
- `removeOnComplete: true`
- `removeOnFail: 1000`

## UI

`/conversas`:

- filtros `Todas`, `Contatos`, `Grupos`;
- busca por nome, JID, telefone ou ultima mensagem;
- formulario `Nova conversa`;
- aviso quando ha apenas grupos sincronizados.

`/conversas/[id]`:

- cabecalho com JID, tipo, nao lidas, ultima mensagem e resumo;
- mensagens alinhadas por direcao;
- composer para envio manual;
- aviso quando a conversa e grupo.

## Como validar

1. Abrir `/conversas`.
2. Filtrar por `Contatos` e `Grupos`.
3. Iniciar conversa por telefone brasileiro.
4. Abrir a conversa criada.
5. Digitar mensagem no composer.
6. Confirmar mensagem `Mensagem enviada para fila`.
7. Ver logs do worker.
8. Recarregar conversa apos o worker processar.

## Logs esperados

```text
[worker] job received { name: "send-manual-message", id: "..." }
[worker] manual message sent { chatId: "...", jidType: "contact" }
```

Em caso de falha:

```text
[worker] manual message failed { chatId: "...", jidType: "contact", error: "..." }
```

## Limitacoes

- Sem realtime; e preciso recarregar/aguardar refresh simples.
- Sem status persistido de mensagem manual em fila.
- Mensagem outbound so e salva depois de `sendMessage` retornar sucesso.
- Sem verificacao se o numero existe no WhatsApp.
- Sem multiplos numeros.
- Sem automacao.
- Este documento descreve a fase de envio manual; labels/envio por etiqueta estao documentados separadamente em `WHATSAPP_LABELS_AND_BULK_SEND.md`.
