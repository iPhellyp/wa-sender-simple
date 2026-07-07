# WhatsApp Labels e Envio por Etiqueta

## Como as etiquetas sao sincronizadas

O worker Baileys escuta eventos reais da versao instalada:

- `labels.edit` — cria/atualiza `WhatsappLabel` (nome, cor, deleted)
- `labels.association` — associa ou remove chat ↔ etiqueta em `WhatsappChatLabel`

Tipos Baileys usados:

- `Label` (`id`, `name`, `color`, `deleted`, `predefinedId?`)
- `ChatLabelAssociation` (`type: "label_jid"`, `chatId` = JID, `labelId` = id WhatsApp)
- `MessageLabelAssociation` — ignorado por enquanto (sem migration de message labels)

`waLabelId` guarda o id real do WhatsApp. O `id` interno do Prisma e cuid.

Etiquetas removidas no celular ficam com `deleted=true`. Associacoes antigas podem ser removidas por evento `remove`.

## Limitacoes

- Etiquetas so aparecem apos conexao e eventos do WhatsApp.
- Labels/associacoes antigas podem nao chegar se a sessao ja estava pareada antes.
- Pode ser necessario reset/reconnect para historico completo de labels (sem alterar automaticamente).
- Dashboard de labels e read-only; criar/editar etiqueta no WhatsApp nao esta implementado.
- Envio por etiqueta usa JID da conversa; grupos ficam excluidos por padrao.

## Validar no banco

```sql
SELECT COUNT(*) FROM "WhatsappLabel";
SELECT COUNT(*) FROM "WhatsappChatLabel";

SELECT wl.name, COUNT(wcl.id) AS conversas
FROM "WhatsappLabel" wl
LEFT JOIN "WhatsappChatLabel" wcl ON wcl."labelId" = wl.id
WHERE wl.deleted = false
GROUP BY wl.id, wl.name
ORDER BY conversas DESC;
```

## Validar no dashboard

- `/etiquetas` — lista e metricas
- `/etiquetas/[id]` — conversas da etiqueta
- `/etiquetas/[id]/enviar` — preview e criacao de envio
- `/conversas` — badges e filtro por etiqueta
- `/envios` — campanhas por etiqueta e detalhes

## Criar envio por etiqueta

1. Abra `/etiquetas/[id]/enviar`.
2. Preencha nome, mensagem e opcoes.
3. Clique **Pre-visualizar publico**.
4. Confirme elegiveis/ignorados.
5. **Criar envio (rascunho)** ou **Criar e iniciar envio**.
6. Acompanhe em `/envios`.

Defaults seguros:

- `includeGroups=false`
- `excludeAlreadySentDays=7`
- `maxRecipients=100` (limite absoluto 500)

## Anti-repeticao

1. Dedupe por `jid` na mesma campanha (`@@unique([campaignId, jid])`).
2. Opt-out sempre verificado (`Contact.optedOut` por telefone do JID).
3. `excludeAlreadySentDays` consulta `CampaignRecipient` e `SendLog` enviados recentemente.
4. Grupos ignorados por padrao (`group_excluded`).
5. Limite `maxRecipients` por lote.
6. Intervalo minimo entre envios via `intervalMinutes` da campanha (fila existente).
7. `SendLog` registra envios por JID para auditoria.

## Opt-out

- Listener `messages.upsert` existente continua marcando `Contact.optedOut`.
- Preview e worker cancelam destinatarios opt-out.
- Nunca envia para telefone com opt-out ativo.

## Logs esperados

```text
[sync] labels edit { labels: 1, processed: 1, skipped: 0, failed: 0 }
[sync] labels association { associations: 1, processed: 1, skipped: 0, removed: 0, failed: 0 }
[worker] campaign message sent { recipientId: "...", campaignId: "...", jidType: "contact" }
```

Associacao de mensagem ignorada:

```text
[sync] labels association skipped; message label not persisted { type: "label_message" }
```

## Riscos de bloqueio WhatsApp

- Envios em massa agressivos podem causar restricao.
- Use lotes menores, intervalo adequado e relacionamento real com contatos.
- Respeite opt-out e evite repeticao em poucos dias.

## APIs

- `GET /api/etiquetas`
- `GET /api/etiquetas/[id]`
- `GET /api/etiquetas/[id]/audience`
- `POST /api/etiquetas/[id]/campaigns`
- `GET /api/envios`
- `GET /api/envios/[id]`

## Migration

Arquivo: `prisma/migrations/20260706200000_whatsapp_labels/migration.sql`

Nao executada automaticamente neste prompt. Rodar manualmente na VPS apos deploy.
