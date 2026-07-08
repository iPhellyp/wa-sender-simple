# WA Sender Simple

Sistema WhatsApp multi-numero para contatos, conversas, etiquetas, campanhas e envios controlados.

## Funcionalidades atuais

- Login admin por `ADMIN_PASSWORD`.
- Multi-instancia WhatsApp com QR por numero.
- Estado zero instancias: o sistema pode ficar sem numeros cadastrados ate o operador criar a primeira instancia.
- Instancia ativa persistente por URL, localStorage e cookie.
- Retomada de sessao salva apos deploy/restart sem exigir QR quando a pasta Baileys ainda existe.
- Importacao Excel de contatos e mensagens.
- Listas/origens de importacao com remocao segura do vinculo sem apagar contatos.
- Contatos, opt-out e campanhas originais.
- Envio serializado via worker BullMQ.
- Inbox `/conversas`.
- Detalhe `/conversas/[id]`.
- Envio manual por conversa via fila `send-manual-message`.
- Sync read-only de chats, contatos e mensagens.
- Labels/envio por etiqueta por instancia.
- `/envios` para auditoria operacional.
- Reset, desconexao e delete de instancia com confirmacao.
- Campanhas com spintax simples, variaveis, preview, envio de teste, delay avancado, limite de lote e lock por instancia.

## Rotas principais

- `/dashboard`
- `/whatsapp`
- `/instancias`
- `/conversas`
- `/contatos`
- `/campanhas`
- `/etiquetas`
- `/envios`

## Avisos operacionais

- Confira sempre a instancia ativa antes de enviar.
- Use `Retomar sessao` quando ja existe sessao salva e o painel ficou desconectado apos deploy/restart.
- Use `Gerar QR` apenas quando nao existe sessao local para a instancia.
- Use `Resetar sessao` somente quando for necessario apagar a sessao local e parear de novo.
- Comece campanhas com baixo volume e aumente gradualmente.
- Nao rode campanhas simultaneas no mesmo numero.
- Respeite opt-out, consentimento e qualidade da base.
- O worker precisa estar rodando para gerar QR, sincronizar eventos e enviar mensagens.
- Baileys nao e API oficial do WhatsApp; sessao, QR e envio podem falhar por mudancas externas.
- O produto melhora controle operacional e entregabilidade, mas nao promete antiban nem disparo ilimitado.

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
- [Runtime multi-instancia](docs/specs/multi-instance-runtime.md)
- [Entrega cliente v1 beta](docs/production/ENTREGA_CLIENTE.md)
- [Manual rapido](docs/production/MANUAL_RAPIDO.md)
- [Checklist de operacao](docs/production/CHECKLIST_OPERACAO.md)
- [Suporte e rollback](docs/production/SUPORTE_ROLLBACK.md)
- [Boas praticas anti-spam](docs/production/BOAS_PRATICAS_ANTISPAM.md)
- [SDD macro](docs/COMMAND_CENTER_WHATSAPP_SDD.md)
- [Deploy](README_DEPLOY.md)
