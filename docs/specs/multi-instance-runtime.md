# Runtime multi-instancia WhatsApp

## Visao

`/instancias` e a central unica de operacao WhatsApp. Ela gerencia os numeros cadastrados, a instancia ativa, QR, retomada de sessao, reset, disconnect, delete, sincronizacao e erros. A rota `/whatsapp` redireciona para `/instancias`.

Cada instancia possui status, QR, telefone conectado, pasta de sessao e dados operacionais isolados por `instanceId`.

## Sessao Baileys

A instancia tecnica inicial preserva o caminho legado por compatibilidade com producao existente:

```text
data/baileys-session
```

Instancias secundarias usam subpastas por `sessionKey`:

```text
data/baileys-session/{sessionKey}
```

O produto nao trata essa instancia como superior. Todas as instancias devem conectar, gerar QR, sincronizar, enviar mensagens e criar campanhas com o proprio `instanceId`.

## Status e QR

`GET /api/whatsapp/status?instanceId=...` retorna o status da instancia solicitada.

Para a instancia tecnica inicial, o manager delega ao client legado para preservar compatibilidade. Para as demais, o manager le o runtime em memoria e o registro `WhatsappSession` da propria instancia.

O status tambem expoe metadados de sessao quando possivel: `hasSessionFiles`, `sessionFilesCount`, `hasCredsJson`, `lastOpenAt` e `isRecoverableSession`.

Quando o socket fecha com status 428 e existe sessao local, o sistema trata como queda recuperavel:

1. nao apaga arquivos;
2. nao limpa `connectedPhone`;
3. nao gera QR automaticamente;
4. agenda retomada leve em 5s, 15s e 30s;
5. se esgotar, mostra sessao salva e permite `Retomar sessao`.

`Gerar QR` e usado apenas quando nao ha sessao local. `Resetar sessao` e a acao destrutiva que remove a sessao e pode exigir QR novo.

## Campanhas e envio manual

Campanhas usam `campaign.instanceId`. O worker envia pelo socket da mesma instancia e falha com erro claro se ela nao estiver conectada.

Antes de iniciar ou retomar campanha, o backend bloqueia outra campanha `running` na mesma instancia. A mensagem esperada e: `Ja existe uma campanha ativa nesta instancia. Pause, cancele ou aguarde finalizar.`

Configuracoes avancadas de campanha sao mantidas sem migration usando campos existentes: `maxRecipients` para limite de lote e payload interno em `sendWindowStart` para delay/pausa. O worker verifica o fim do lote antes de aplicar pausa.

Envio manual de conversa busca `WhatsappChat` por `id + instanceId`, enfileira `send-manual-message` com `instanceId` e persiste a mensagem outbound no mesmo escopo.

## Sync

Eventos de chats, contatos, mensagens, etiquetas e associacoes recebem `instanceId` e gravam usando os uniques compostos do schema.

`sync-whatsapp-catalog` usa jobId por instancia:

```text
sync-whatsapp-catalog:{instanceId}
```

## Reset e desconexao

Disconnect para apenas o socket da instancia solicitada.

Reset da instancia tecnica inicial usa o fluxo legado. Reset das demais remove apenas:

```text
data/baileys-session/{sessionKey}
```

A limpeza operacional recebe `instanceId` e nao toca outras instancias.

Reset e desconexao exigem `instanceId` explicito nas rotas perigosas e confirmacao visual na UI.

Delete de instancia exige o nome exato da instancia, bloqueia instancia conectada/conectando/QR e remove apenas dados com o `instanceId` selecionado.
Na Fase 5, o produto permite zero instancias: deletar a ultima instancia deixa o sistema em estado vazio e nao recria default automaticamente.

## Smoke test final

### Persistencia da instancia ativa

1. Escolher instancia secundaria em `/instancias`.
2. Ir para `/conversas`.
3. Ir para `/etiquetas`.
4. Ir para `/campanhas`.
5. Ir para `/envios`.
6. Ir para `/instancias`.
7. Confirmar que a mesma instancia permanece ativa.
8. Recarregar a pagina.
9. Confirmar que continua na mesma instancia.

### QR multi-instancia

1. Criar Instancia A.
2. Usar Instancia A em `/instancias`.
3. Clicar reconectar.
4. Confirmar QR da Instancia A.
5. Escanear com numero A.
6. Confirmar `connectedPhone` A.
7. Criar Instancia B.
8. Usar Instancia B em `/instancias`.
9. Clicar reconectar.
10. Confirmar QR da Instancia B.
11. Confirmar que QR de B nao altera A.
12. Escanear com numero B.
13. Confirmar A e B conectadas.

### Protecao

1. Reset exige confirmacao.
2. Disconnect exige confirmacao.
3. Reset exige digitar o nome exato da instancia.
4. Cancelar confirmacao nao executa acao.
5. Delete exige digitar o nome exato da instancia.
6. Delete de instancia conectada deve pedir desconectar antes.
7. Delete da ultima instancia deve deixar o sistema sem instancias e sem recriar default automaticamente.

### Envio

1. Conversa da Instancia A envia pela A.
2. Conversa da Instancia B envia pela B.
3. Trocar de pagina nao muda a instancia usada.

### Campanha

1. Campanha criada em uma instancia nao aparece nem envia pela outra.
2. Envio usa `campaign.instanceId`.
3. Sem conexao na instancia correta, falha claro.
4. Duas campanhas simultaneas no mesmo `instanceId` devem ser bloqueadas.
5. Campanha com `{Oi|Ola}, {{nome}}` nao deve enviar placeholders crus.
6. Limite de lote deve encerrar antes de aplicar pausa.

### Retomada de sessao

1. Manter numero conectado no celular.
2. Reiniciar/deployar app e worker.
3. Abrir `/instancias`.
4. Confirmar `Sessao salva`.
5. Clicar `Retomar sessao`.
6. Confirmar reconexao sem QR.

### URL invalida

1. Abrir `/conversas?instanceId=nao-existe`.
2. Confirmar erro de instancia nao encontrada.
3. Confirmar que dados de outra instancia nao aparecem.

## Limites conhecidos

- A instancia tecnica inicial continua no client legado para preservar a sessao em producao.
- `isDefault` existe apenas para compatibilidade interna e nao deve aparecer como privilegio operacional.
- Instancias secundarias usam runtime multi-instancia simplificado, com isolamento real de socket e sessao.
