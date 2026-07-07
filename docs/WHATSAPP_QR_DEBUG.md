# WhatsApp QR Debug

Checklist para validar geracao de QR Code em producao.

## Fluxo esperado

1. Acesse:

```text
https://wa2.supereducarbrasil.com.br/whatsapp
```

2. Para sessao limpa, clique em `Resetar sessao`, aguarde o worker finalizar e depois clique em `Reconectar` uma vez.

3. O app deve continuar sem o erro:

```text
Custom Id cannot contain :
```

4. Os logs do worker devem mostrar:

```text
[worker] connect-whatsapp job received
[baileys] session files before start { files: 0 }
[baileys] creating socket
[baileys] qr safe mode enabled { sessionFiles: 0, syncFullHistory: false, versionSource: "local-default" }
[baileys] qr received and saved
```

5. A tela deve mostrar:

- status `qr`
- QR Code visivel
- `lastError` vazio

## Se o QR nao aparecer

1. Veja `lastError` na tela `/whatsapp`.

2. Se `lastError` indicar status 405, 428 ou falha de QR, clique em `Resetar sessao` uma vez, aguarde o worker processar e depois clique em `Reconectar` uma vez.

3. Veja os logs do worker:

```bash
docker service logs wa_sender_simple_worker --tail 300 --no-trunc
```

4. Teste permissao do volume dentro do container:

```bash
touch /app/data/baileys-session/.write-test
rm /app/data/baileys-session/.write-test
```

5. Confirme que o worker esta rodando:

```bash
docker service ps wa_sender_simple_worker
```

6. Confirme que Redis e Postgres estao internos no stack, sem portas publicas.

## QR Safe Mode

Quando `session files = 0`, o sistema entra em `QR_SAFE_MODE`.

Nesse modo:

1. `syncFullHistory` fica desativado durante o pareamento.
2. `shouldSyncHistoryMessage` retorna `false` antes do QR.
3. `fetchLatestBaileysVersion` nao e obrigatorio; o modo seguro pula esse fetch para evitar latest quebrando o QR com 428 antes de `update.qr`.
4. O socket usa a versao default local da Baileys.
5. Depois de conectado, os eventos normais de mensagens, chats, contatos e labels continuam sendo processados.

Historico antigo completo fica fora do pareamento limpo. A prioridade do `QR_SAFE_MODE` e gerar QR e conectar.

Diagnostico importante:

```text
session files = 0 + 428 antes de QR = problema de config/version/browser, nao de reset.
```

Se isso acontecer, nao clique repetidamente em `Reconectar`. Registre os logs, confirme que o sistema nao entrou em loop e ajuste config/version/browser em hotfix separado.

## Logs uteis

Logs de fila:

```text
[worker] sender-worker started
[worker] job received
[worker] connect-whatsapp job received
[worker] reset-whatsapp job received
```

Logs de Baileys:

```text
[baileys] session files before start { files: 0 }
[baileys] creating socket
[baileys] session dir: /app/data/baileys-session
[baileys] latest version skipped for qr safe mode
[baileys] qr safe mode enabled { sessionFiles: 0, syncFullHistory: false, versionSource: "local-default" }
[baileys] normal socket mode enabled
[baileys] fetched latest version
[baileys] connection.update
[baileys] qr received and saved
```

`qr safe mode enabled` aparece quando a pasta esta vazia. `normal socket mode enabled` aparece quando ja existem arquivos de sessao.

Nunca cole QR Code, token, senha ou `DATABASE_URL` completo em chamados de suporte.

## Status 428 — sessao removida no celular

Se o usuario removeu o dispositivo no celular, o Baileys pode fechar com:

```text
[baileys] connection.update { connection: "close", statusCode: 428, error: "Connection Terminated" }
[baileys] connection terminated 428; reconnect disabled
```

Nesse cenario:

1. O sistema **nao** reconecta em loop.
2. A tela `/whatsapp` deve mostrar `disconnected` ou `error`, com `lastError` orientando reset.
3. Pare o worker se ainda estiver em loop (versao antiga).
4. Aplique o hotfix e faca deploy.
5. Clique em `Resetar sessao`, depois `Reconectar`, e escaneie o QR novo.

Nao espere QR novo sem resetar a sessao apos 428.

Fluxo manual recomendado:

1. Abra `/whatsapp`.
2. Clique `Resetar sessao` uma vez.
3. Aguarde o worker finalizar.
4. Clique `Reconectar` uma vez.
5. Escaneie o QR.
