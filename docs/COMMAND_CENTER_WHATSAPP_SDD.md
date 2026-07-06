# Command Center WhatsApp - SDD

## 1. Objetivo

Transformar o `wa-sender-simple` em um Command Center WhatsApp interno para operar multiplos numeros, sincronizar conversas/etiquetas, executar campanhas controladas e auditar envios sem misturar sessoes ou dados entre remetentes.

## 2. Escopo Completo

- Conectar multiplos numeros WhatsApp por Baileys.
- Isolar sessao, QR, status, logs e diretorio por numero.
- Sincronizar contatos, chats, mensagens, grupos, etiquetas e associacoes quando a Baileys entregar esses eventos.
- Criar etiquetas internas e mapear com etiquetas do WhatsApp Business quando suportado.
- Criar campanhas por etiqueta, manualmente ou por importacao.
- Aplicar regras anti-repeticao antes de enfileirar destinatarios.
- Atualizar etiquetas apos envio, falha, resposta e opt-out.
- Exibir conversas, etiquetas, fila de envios, logs tecnicos e logs de campanha.

## 3. Fases de Implementacao

### Fase 0 - Estabilizar Baileys QR e conexao

- Usar `fetchLatestBaileysVersion`.
- Adicionar reset controlado de sessao.
- Melhorar reconnect seguro.
- Registrar `lastError` claro.
- Garantir que QR aparece para 1 numero.

### Fase 1 - Sync read-only

- Status: implementada parcialmente em `20260706174000_whatsapp_sync_read_only`.
- Salvar chats, contatos e mensagens.
- Tratar eventos Baileys sem alterar fluxo de campanha.
- Criar tela basica de conversas.
- Labels e associacoes ficam documentadas para fase futura.
- Nao implementar envio por etiqueta ainda.

### Fase 2 - Multiplos numeros

- Criar `WhatsappAccount`.
- Isolar `sessionDir` por conta.
- QR individual por conta.
- Worker gerenciando multiplos sockets por `accountId`.

### Fase 3 - Campanha por etiqueta

- Adicionar `targetLabelId`.
- Gerar previa de publico.
- Criar fila com anti-repeticao.
- Criar `SendLog` basico.

### Fase 4 - Automacao de etiqueta

- Aplicar `afterSendAddLabelIds`.
- Aplicar `afterSendRemoveLabelIds`.
- Aplicar `onReplyAddLabelIds`.
- Aplicar `onReplyRemoveLabelIds`.
- Criar regras configuraveis.

### Fase 5 - Logs avancados e retry

- Criar `/envios`.
- Criar `/logs`.
- Retry manual para falhas.
- Metricas por campanha, etiqueta e remetente.

## 4. Modelagem Prisma Proposta

### WhatsappAccount

- `id`
- `name`
- `phone`
- `jid`
- `status`
- `qrCode`
- `sessionDir`
- `isDefault`
- `lastError`
- `lastSyncAt`
- `historySyncStatus`
- `createdAt`
- `updatedAt`

### WhatsappChat

- `id`
- `jid`
- `name`
- `isGroup`
- `unreadCount`
- `lastMessageAt`
- `lastMessageText`
- `lastInboundAt`
- `lastOutboundAt`
- `createdAt`
- `updatedAt`

### WhatsappContact

- `id`
- `jid`
- `phone`
- `name`
- `pushName`
- `isBusiness`
- `createdAt`
- `updatedAt`

### WhatsappMessage

- `id`
- `chatId`
- `waMessageId`
- `jid`
- `fromMe`
- `senderJid`
- `timestamp`
- `messageType`
- `text`
- `rawJson`
- `campaignId`
- `campaignRecipientId`
- `createdAt`

### WhatsappLabel

- `id`
- `accountId`
- `waLabelId`
- `name`
- `color`
- `deleted`
- `predefinedId`
- `isInternal`
- `createdAt`
- `updatedAt`

### WhatsappChatLabel

- `id`
- `accountId`
- `chatId`
- `labelId`
- `source`
- `createdAt`
- `updatedAt`
- unique `accountId/chatId/labelId`

### Campaign - campos futuros

- `accountId`
- `targetMode`: `all | label | manual | imported`
- `targetLabelId`
- `excludeLabelIds`
- `afterSendAddLabelIds`
- `afterSendRemoveLabelIds`
- `onReplyAddLabelIds`
- `onReplyRemoveLabelIds`
- `dedupeKey`
- `maxRecipients`
- `sendWindowStart`
- `sendWindowEnd`

### CampaignRecipient - campos futuros

- `accountId`
- `chatId`
- `labelSnapshot`
- `dedupeKey`
- `attemptCount`
- `lastAttemptAt`
- `skippedReason`
- `lockedAt`

### SendLog ou EventLog

- `id`
- `accountId`
- `campaignId`
- `recipientId`
- `chatId`
- `level`
- `type`
- `message`
- `metadata`
- `createdAt`

### AutomationRule

- `id`
- `accountId`
- `name`
- `trigger`
- `conditionsJson`
- `actionsJson`
- `enabled`
- `createdAt`
- `updatedAt`

## 5. Eventos Baileys Tratados

Eventos confirmados nos tipos instalados:

- `connection.update`
- `messaging-history.set`
- `chats.upsert`
- `chats.update`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`
- `messages.update`
- `labels.edit`
- `labels.association`

Eventos implementados na Fase 1 read-only:

- `messaging-history.set`
- `chats.upsert`
- `chats.update`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`
- `messages.update`

Eventos de labels confirmados, mas nao implementados nesta fase:

- `labels.edit`
- `labels.association`

Funcao confirmada no socket:

- `fetchMessageHistory`

Observacao: `messaging-history.status` nao apareceu nos tipos locais da versao 6.7.23. Deve ser reavaliado antes de qualquer fase que dependa desse evento.

## 6. Regras Anti-Repeticao

1. Nunca enviar duas vezes para o mesmo chat na mesma campanha.
2. Nunca enviar o mesmo `dedupeKey` para o mesmo chat dentro de X dias.
3. Nao enviar se o chat estiver com etiqueta `em atendimento`, quando a regra estiver ativa.
4. Nao enviar se o contato respondeu depois do ultimo outbound.
5. Nao enviar se opt-out.
6. Nao enviar para grupo salvo se a campanha permitir grupos.
7. Registrar todo envio, skip, erro e cancelamento em `SendLog`.

## 7. Regras de Etiquetas

Fluxo futuro para envio por etiqueta:

1. Usuario escolhe uma etiqueta de origem.
2. Sistema busca chats com essa etiqueta.
3. Sistema remove opt-out, duplicados, ja enviados e bloqueados.
4. Sistema cria `CampaignRecipient` para cada alvo valido.
5. Worker envia respeitando intervalo e janela de horario.
6. Apos envio com sucesso:
   - marca destinatario como `sent`
   - cria `WhatsappMessage` outbound
   - cria `SendLog`
   - aplica `afterSendAddLabelIds`
   - remove `afterSendRemoveLabelIds`
7. Se falhar:
   - marca `failed`
   - cria `SendLog`
   - opcionalmente aplica etiqueta de erro
8. Se responder:
   - atualiza `lastInboundAt`
   - cria mensagem inbound
   - aplica regras `onReply`
   - pode cancelar follow-ups futuros

## 8. Filas BullMQ Necessarias

- `whatsapp-connect`: conectar, reconectar e resetar contas.
- `whatsapp-sync`: processar history sync e sync sob demanda.
- `campaign-sender`: enviar destinatarios com concorrencia controlada.
- `label-actions`: aplicar etiquetas apos envio/resposta/falha.
- `event-log`: persistir logs quando o volume crescer.

## 9. Telas do Dashboard

### `/whatsapp`

- listar numeros
- adicionar numero
- QR por numero
- resetar sessao por numero
- status por numero

### `/conversas`

- lista de chats
- filtro por etiqueta
- filtro por numero
- ultimas mensagens
- status de envio

### `/etiquetas`

- etiquetas sincronizadas
- criar etiqueta interna
- mapear etiqueta WhatsApp
- quantidade de chats por etiqueta

### `/campanhas`

- escolher numero remetente
- escolher etiqueta alvo
- escolher etiquetas a adicionar/remover pos-envio
- previa de publico
- dedupe

### `/envios`

- fila visual
- `sent`, `failed`, `skipped`, `pending`
- retry manual
- logs por destinatario

### `/logs`

- eventos tecnicos
- conexao
- sync
- fila
- Baileys

## 10. Riscos Tecnicos da Baileys

- Baileys usa WhatsApp Web via Linked Devices, nao WABA oficial.
- A biblioteca e event-based e pode mudar conforme o WhatsApp Web muda.
- `useMultiFileAuthState` e aceitavel no MVP, mas nao e ideal para producao por volume de IO.
- Labels Business dependem do que a Baileys consegue receber/aplicar em cada versao.
- History sync e parcial e assinc; nao deve ser tratado como snapshot perfeito.
- Versao v7 possui breaking changes e deve ser migrada somente com plano separado.

## 11. Criterios de Aceite por Fase

Fase 0:

- QR aparece.
- Status e `lastError` sao confiaveis.
- Reset de sessao funciona.
- Reconnect nao entra em loop agressivo.

Fase 1:

- Chats, contatos e mensagens sao salvos sem envio por etiqueta.
- Reprocessamento nao duplica dados.
- Tela de conversas mostra dados reais.
- Labels seguem fora do escopo ate a proxima fase.

Fase 2:

- Duas contas podem conectar com sessoes isoladas.
- Worker nao mistura sockets.
- QR/status/logs sao por conta.

Fase 3:

- Campanha por etiqueta cria destinatarios corretos.
- Anti-repeticao bloqueia duplicados.
- Envio respeita intervalo, opt-out e janela.

Fase 4:

- Etiquetas sao aplicadas apos envio/resposta/falha.
- Regras podem ser ligadas/desligadas.

Fase 5:

- `/envios` e `/logs` permitem diagnosticar operacao.
- Retry manual e seguro.
- Metricas ajudam operacao.

## 12. Ordem Segura de Implementacao

1. Estabilizar conexao Baileys para 1 numero.
2. Adicionar logs/eventos persistidos.
3. Criar sync read-only sem alterar campanhas.
4. Adicionar `WhatsappAccount` e isolar sessoes.
5. Migrar campanhas para escolher remetente.
6. Implementar etiqueta como alvo.
7. Implementar anti-repeticao forte.
8. Implementar automacoes de etiquetas.
9. Implementar retry/manual e observabilidade avancada.

## 13. Fase 1 Read-Only Implementada

Migration criada:

- `20260706174000_whatsapp_sync_read_only`

Models criados:

- `WhatsappChat`
- `WhatsappContact`
- `WhatsappMessage`

Eventos tratados no worker:

- `messaging-history.set`
- `chats.upsert`
- `chats.update`
- `contacts.upsert`
- `contacts.update`
- `messages.upsert`
- `messages.update`

Telas criadas:

- `/conversas`
- `/conversas/[id]`

Limitacoes desta fase:

- Sem multiplos numeros.
- Sem accountId.
- Sem envio manual pela conversa.
- Sem etiquetas sincronizadas.
- Sem automacao de etiquetas.
- Sem alterar campanhas.
- `messages.update` persiste atualizacao simples em `rawJson`, sem modelar status dedicado.

Proximos passos para etiquetas:

1. Confirmar payload real de `labels.edit` e `labels.association` em producao.
2. Criar `WhatsappLabel` e `WhatsappChatLabel`.
3. Sincronizar labels em modo read-only.
4. Exibir labels na tela de conversas.
5. So depois usar labels como alvo de campanha.
