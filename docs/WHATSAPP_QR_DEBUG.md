# WhatsApp QR Debug

Checklist para validar geracao de QR Code em producao.

## Fluxo esperado

1. Acesse:

```text
https://wa2.supereducarbrasil.com.br/whatsapp
```

2. Clique em `Reconectar`.

3. O app deve continuar sem o erro:

```text
Custom Id cannot contain :
```

4. Os logs do worker devem mostrar:

```text
[worker] connect-whatsapp job received
[baileys] fetched latest version
[baileys] creating socket
[baileys] qr received and saved
```

5. A tela deve mostrar:

- status `qr`
- QR Code visivel
- `lastError` vazio

## Se o QR nao aparecer

1. Veja `lastError` na tela `/whatsapp`.

2. Se `lastError` indicar status 405, clique em `Resetar sessao`, aguarde o worker processar e depois clique em `Reconectar`.

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
[baileys] creating socket
[baileys] session dir: /app/data/baileys-session
[baileys] fetched latest version
[baileys] connection.update
[baileys] qr received and saved
```

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
