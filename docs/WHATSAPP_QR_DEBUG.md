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
[baileys] creating socket
[baileys] qr received and saved
```

5. A tela deve mostrar:

- status `qr`
- QR Code visivel
- `lastError` vazio

## Se o QR nao aparecer

1. Veja `lastError` na tela `/whatsapp`.

2. Veja os logs do worker:

```bash
docker service logs wa_sender_simple_worker --tail 300 --no-trunc
```

3. Teste permissao do volume dentro do container:

```bash
touch /app/data/baileys-session/.write-test
rm /app/data/baileys-session/.write-test
```

4. Confirme que o worker esta rodando:

```bash
docker service ps wa_sender_simple_worker
```

5. Confirme que Redis e Postgres estao internos no stack, sem portas publicas.

## Logs uteis

Logs de fila:

```text
[worker] sender-worker started
[worker] job received
[worker] connect-whatsapp job received
```

Logs de Baileys:

```text
[baileys] creating socket
[baileys] session dir: /app/data/baileys-session
[baileys] connection.update
[baileys] qr received and saved
```

Nunca cole QR Code, token, senha ou `DATABASE_URL` completo em chamados de suporte.
