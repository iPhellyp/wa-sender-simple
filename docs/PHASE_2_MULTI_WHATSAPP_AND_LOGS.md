# Fase 2: Multiplos WhatsApps e Logs

Este documento e apenas planejamento. Nao implementar nesta fase de estabilizacao do QR.

Estado real atual:

- O projeto ainda usa um unico WhatsApp conectado.
- QR/428 e QR_SAFE_MODE devem ser estabilizados antes de multi-numeros.
- `SendLog` pode ja existir por causa de labels/envios.
- Ainda falta `accountId` e isolamento por numero em chats, mensagens, labels, campanhas e logs.
- Nao implementar multi-numeros junto com hotfix de QR.

## Objetivo futuro

- Permitir multiplos numeros WhatsApp.
- Cada numero com QR e sessao propria.
- Escolher qual numero/remetente envia uma campanha.
- Criar tela `/envios` ou `/logs` para acompanhar eventos e falhas.

## Modelagem proposta

Criar `WhatsappAccount`:

- `id`
- `name`
- `phone`
- `status`
- `qrCode`
- `sessionDir`
- `isDefault`
- `lastError`
- `createdAt`
- `updatedAt`

Adicionar em `Campaign`:

- `whatsappAccountId`

Adicionar em `CampaignRecipient`:

- `whatsappAccountId` usado no envio

Evoluir `SendLog` ou criar `EventLog`:

- `id`
- `type`
- `level`
- `message`
- `whatsappAccountId` opcional
- `accountId` quando `WhatsappAccount` existir
- `campaignId` opcional
- `recipientId` opcional
- `metadata` JSON opcional
- `createdAt`

## Telas futuras

`/whatsapp`:

- listar contas
- adicionar conta
- mostrar QR por conta
- reconectar/desconectar por conta

`/campanhas`:

- escolher remetente antes de iniciar

`/envios`:

- listar eventos/logs
- filtrar por campanha, remetente e status
- retry manual para destinatarios `failed`

## Worker futuro

- Gerenciar multiplos sockets por `accountId`.
- Enviar usando a conta escolhida na campanha.
- Isolar `sessionDir` por `accountId`.
- Registrar eventos em `SendLog` ou `EventLog`.

## Riscos a tratar

- Evitar dois workers abrindo a mesma sessao.
- Garantir uma sessao Baileys por conta.
- Evitar disparo simultaneo agressivo.
- Garantir retry idempotente para destinatario falho.
