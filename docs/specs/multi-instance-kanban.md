# Multi-instancia WhatsApp - Kanban tecnico

## Fase 1 - Fundacao

- [x] Criar entidade `WhatsappInstance`.
- [x] Adicionar `instanceId` nas tabelas operacionais de WhatsApp, contatos, campanhas, destinatarios e logs de envio.
- [x] Criar migration com backfill seguro para a instancia `default`.
- [x] Ajustar queries criticas para filtrar por `instanceId`.
- [x] Criar APIs basicas para listar, criar, editar, desconectar, resetar e definir instancia padrao.
- [x] Criar tela `/instancias` e seletor global de instancia ativa.

## Fase 2 - Sessoes independentes

- [ ] Separar diretórios de auth por `sessionKey`.
- [ ] Permitir sockets independentes por instancia.
- [ ] Enfileirar jobs de connect/disconnect/reset por instancia.
- [ ] Exibir QR code por instancia.
- [ ] Sincronizar historico, contatos e etiquetas por instancia.

## Fase 3 - Operacao

- [ ] Criar politicas de permissao por papel da instancia.
- [ ] Adicionar filtros de instancia em dashboards e relatorios.
- [ ] Melhorar observabilidade por instancia.
- [ ] Definir rotina operacional para inativar instancias antigas.

## Riscos e observacoes

- A Fase 1 cria isolamento de dados e interface de gestao, mas o socket Baileys atual ainda opera a instancia `default`.
- Instancias adicionais ficam preparadas no banco e na UI, mas precisam da Fase 2 para conectar com QR proprio.
- Antes de deploy em producao, rodar migration em ambiente controlado e revisar backup do banco.
