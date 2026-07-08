# Runtime multi-instancia WhatsApp

## Visao

`/instancias` gerencia os numeros cadastrados. `/whatsapp` opera a instancia ativa indicada por `?instanceId=...` ou pela instancia padrao quando o parametro nao existe.

Cada instancia possui status, QR, telefone conectado, pasta de sessao e dados operacionais isolados por `instanceId`.

## Sessao Baileys

A instancia Principal preserva o caminho legado:

```text
data/baileys-session
```

Instancias secundarias usam subpastas por `sessionKey`:

```text
data/baileys-session/{sessionKey}
```

A Fase 2 nao move nem apaga a pasta da Principal.

## Status e QR

`GET /api/whatsapp/status?instanceId=...` retorna o status da instancia solicitada.

Para a Principal, o manager delega ao client legado. Para instancias secundarias, o manager le o runtime em memoria e o registro `WhatsappSession` da propria instancia.

## Campanhas e envio manual

Campanhas usam `campaign.instanceId`. O worker envia pelo socket da mesma instancia e falha com erro claro se ela nao estiver conectada.

Envio manual de conversa busca `WhatsappChat` por `id + instanceId`, enfileira `send-manual-message` com `instanceId` e persiste a mensagem outbound no mesmo escopo.

## Sync

Eventos de chats, contatos, mensagens, etiquetas e associacoes recebem `instanceId` e gravam usando os uniques compostos do schema.

`sync-whatsapp-catalog` usa jobId por instancia:

```text
sync-whatsapp-catalog:{instanceId}
```

## Reset e desconexao

Disconnect para apenas o socket da instancia solicitada.

Reset da Principal usa o fluxo legado. Reset de instancia secundaria remove apenas:

```text
data/baileys-session/{sessionKey}
```

A limpeza operacional recebe `instanceId` e nao toca outras instancias.

## Limites conhecidos

- A Principal continua no client legado para preservar a sessao em producao.
- O reconnect automatico avancado e o QR safe mode completo continuam mais maduros na Principal.
- Instancias secundarias usam runtime multi-instancia simplificado, com isolamento real de socket e sessao.
- A Fase 3 pode adicionar Kanban/CRM em cima de `WhatsappInstance`, `WhatsappChat`, etiquetas e campanhas ja isoladas.
