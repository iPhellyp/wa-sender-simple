# Runtime multi-instancia WhatsApp

## Visao

`/instancias` gerencia os numeros cadastrados. `/whatsapp` opera a instancia ativa indicada por `?instanceId=...`, pelo cookie `wa_sender_active_instance_id` ou pela instancia padrao quando nao existe escolha salva.

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

Reset e desconexao exigem `instanceId` explicito nas rotas perigosas e confirmacao visual na UI.

## Smoke test Fase 3

### Persistencia da instancia ativa

1. Escolher instancia secundaria em `/instancias`.
2. Ir para `/conversas`.
3. Ir para `/etiquetas`.
4. Ir para `/campanhas`.
5. Ir para `/envios`.
6. Ir para `/whatsapp`.
7. Confirmar que a mesma instancia permanece ativa.
8. Recarregar a pagina.
9. Confirmar que continua na mesma instancia.

### Principal/default

1. Abrir `/instancias`.
2. Escolher Principal.
3. Abrir `/whatsapp?instanceId=default`.
4. Conectar ou reconectar.
5. Confirmar QR.
6. Confirmar `connectedPhone`.

### Instancia secundaria

1. Criar instancia teste.
2. Marcar como ativa.
3. Abrir `/whatsapp?instanceId=ID`.
4. Gerar QR.
5. Confirmar pasta `data/baileys-session/{sessionKey}`.
6. Sincronizar.
7. Confirmar dados isolados.

### Protecao

1. Reset exige confirmacao.
2. Disconnect exige confirmacao.
3. Principal exige confirmacao forte: `RESETAR PRINCIPAL`.
4. Cancelar confirmacao nao executa acao.

### Envio

1. Conversa da Principal envia pela Principal.
2. Conversa da secundaria envia pela secundaria.
3. Trocar de pagina nao muda a instancia usada.

### Campanha

1. Campanha criada em uma instancia nao aparece nem envia pela outra.
2. Envio usa `campaign.instanceId`.
3. Sem conexao na instancia correta, falha claro.

## Limites conhecidos

- A Principal continua no client legado para preservar a sessao em producao.
- O reconnect automatico avancado e o QR safe mode completo continuam mais maduros na Principal.
- Instancias secundarias usam runtime multi-instancia simplificado, com isolamento real de socket e sessao.
