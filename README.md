# WA Sender Simple

Command Center WhatsApp interno em evolucao para inbox, campanhas, labels e envios controlados.

## Funcionalidades atuais

- Login admin por `ADMIN_PASSWORD`.
- Conexao de 1 WhatsApp via QR com Baileys.
- QR Safe Mode para pareamento limpo em estabilizacao.
- Importacao Excel de contatos e mensagens.
- Contatos, opt-out e campanhas originais.
- Envio serializado via worker BullMQ.
- Inbox `/conversas`.
- Detalhe `/conversas/[id]`.
- Envio manual por conversa via fila `send-manual-message`.
- Sync read-only de chats, contatos e mensagens.
- Labels/envio por etiqueta implementados, dependentes de conexao estavel.
- `/envios` para auditoria operacional.

## Rotas principais

- `/dashboard`
- `/whatsapp`
- `/conversas`
- `/contatos`
- `/campanhas`
- `/etiquetas`
- `/envios`

## Avisos operacionais

- O projeto ainda e single WhatsApp.
- Multi-numeros ainda e futuro.
- QR/conexao devem estar estaveis antes de testar labels/envio por etiqueta.
- O worker precisa estar rodando para gerar QR, sincronizar eventos e enviar mensagens.
- Baileys nao e API oficial do WhatsApp; sessao, QR e envio podem falhar por mudancas externas.

## Variaveis de ambiente

Copie `.env.example` para `.env` e ajuste sem usar segredos reais no repositorio.

No Docker Compose local, use hosts internos `postgres` e `redis`.
No Docker Swarm producao, use hosts internos `wa_sender_simple_postgres` e `wa_sender_simple_redis`.

## Formato da planilha

A primeira linha deve ter estes cabecalhos:

```text
nome | telefone | mensagem | origem
```

## Documentacao

- [Estado atual](docs/CURRENT_PROJECT_STATUS.md)
- [QR e conexao](docs/WHATSAPP_QR_DEBUG.md)
- [Inbox, historico e UI](docs/INBOX_HISTORY_SYNC_AND_UI.md)
- [Envio manual](docs/INBOX_MANUAL_SEND.md)
- [Labels e envio por etiqueta](docs/WHATSAPP_LABELS_AND_BULK_SEND.md)
- [SDD macro](docs/COMMAND_CENTER_WHATSAPP_SDD.md)
- [Deploy](README_DEPLOY.md)
