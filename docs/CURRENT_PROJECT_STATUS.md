# Estado Atual do wa-sender-simple

## Status operacional atual

- O projeto opera com um unico WhatsApp conectado.
- QR/428 ainda esta em estabilizacao.
- Pareamento limpo (`session files = 0`) deve usar QR Safe Mode.
- O worker e responsavel pelo socket Baileys.
- O app Next nao deve enviar mensagens diretamente pelo Baileys.

## Implementado

- Login admin.
- Importacao Excel, contatos e campanhas originais.
- Conexao de 1 WhatsApp via QR.
- Inbox `/conversas`.
- Detalhe `/conversas/[id]`.
- Envio manual via fila `send-manual-message`.
- Sync read-only de chats, contatos e mensagens.
- Labels e envio por etiqueta implementados com migration, ainda dependentes de conexao estavel.
- `/etiquetas` para labels.
- `/envios` para auditoria operacional de envios.

## Parcial/pendente

- QR Safe Mode precisa ser validado em producao.
- Labels dependem dos eventos entregues pelo WhatsApp/Baileys.
- Historico completo antigo nao e garantido.
- `SendLog` existe para auditoria de envios, mas logs por `accountId` ainda sao futuros.
- Multi-numeros ainda nao foi implementado.

## Futuro

- `WhatsappAccount`.
- `accountId` em chats, mensagens, labels, campanhas e logs.
- Multiplos sockets isolados.
- Automacao de etiquetas.
- Logs tecnicos avancados.
- Retry manual seguro.

## Regras para proximos agentes

- Primeiro estabilizar QR/428.
- Nao testar envio em massa antes de QR conectado.
- Nao mexer em multi-numeros junto com QR.
- Nao misturar feature nova com hotfix de conexao.
- Nao reintroduzir `syncFullHistory=true` no QR_SAFE_MODE.
- Nao reativar `fetchLatestBaileysVersion` obrigatorio no QR_SAFE_MODE.
- Sync-history e read-only/informativo.
