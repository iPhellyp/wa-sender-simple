# Deploy Traefik/Swarm

Fluxo de producao para VPS com Docker Swarm e Traefik na rede overlay externa `iPHnet`.

Dominio final:

```text
https://wa2.supereducarbrasil.com.br
```

## Documentacao relacionada

- Estado atual: `docs/CURRENT_PROJECT_STATUS.md`
- Inbox e historico: `docs/INBOX_HISTORY_SYNC_AND_UI.md`
- QR e conexao: `docs/WHATSAPP_QR_DEBUG.md`
- Etiquetas e envio por etiqueta: `docs/WHATSAPP_LABELS_AND_BULK_SEND.md`

## Ambientes e variaveis

### Docker Compose local

Dentro dos containers do Compose, use os hosts internos:

```env
DATABASE_URL=postgresql://wa_sender:wa_sender@postgres:5432/wa_sender_simple?schema=public
REDIS_URL=redis://redis:6379
```

### Docker Swarm producao

No Swarm, use os hosts internos unicos do stack:

```env
DATABASE_URL=postgresql://wa_sender:SENHA@wa_sender_simple_postgres:5432/wa_sender_simple?schema=public
REDIS_URL=redis://wa_sender_simple_redis:6379
```

Crie `.env` na VPS a partir de `.env.example` e troque as senhas:

```env
POSTGRES_DB=wa_sender_simple
POSTGRES_USER=wa_sender
POSTGRES_PASSWORD=SENHA_FORTE_AQUI
DATABASE_URL=postgresql://wa_sender:SENHA_FORTE_AQUI@wa_sender_simple_postgres:5432/wa_sender_simple?schema=public
REDIS_URL=redis://wa_sender_simple_redis:6379
ADMIN_PASSWORD=SUA_SENHA_ADMIN_AQUI
BAILEYS_SESSION_DIR=/app/data/baileys-session
BAILEYS_LOG_LEVEL=silent
APP_URL=https://wa2.supereducarbrasil.com.br
NEXT_PUBLIC_APP_URL=https://wa2.supereducarbrasil.com.br
```

Nao use `localhost` dentro dos containers.

Antes de `docker stack deploy`, carregue o `.env` no shell:

```bash
set -a
. ./.env
set +a
```

## Rede e portas

Postgres, Redis, app e worker nao publicam portas no host.

O app roda internamente na porta `3000`, entra na rede interna do stack e tambem na rede externa `iPHnet`. O Traefik roteia pelo dominio usando labels em `deploy.labels`.

Postgres, Redis e worker ficam apenas na rede interna. Nao exponha `3000`, `3010`, `5432` ou `6379`.

O `certresolver` configurado e `letsencryptresolver`. Ajuste esse valor em `docker-stack.yml` apenas se o Traefik da VPS usar outro nome.

## Primeiro deploy

Comandos manuais na VPS:

```bash
git pull
set -a
. ./.env
set +a
docker compose build
docker volume create wa-sender-simple_postgres_data
docker volume create wa-sender-simple_baileys_session
docker volume create wa-sender-simple_uploads
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
APP_CID=$(docker ps -q --filter "name=wa_sender_simple_app" | head -n 1)
docker exec -it "$APP_CID" npm run prisma:deploy
```

`docker stack deploy` nao faz build de imagem. Por isso, rode `docker compose build` antes para criar as imagens locais:

- `wa-sender-simple-app:latest`
- `wa-sender-simple-worker:latest`

O uso de `--resolve-image never` evita tentativa de buscar essas imagens em registry externo.

Nao use `docker run` para migration em rede overlay nao attachable. Rode a migration dentro do container do app criado pelo stack.

## Atualizacao

Comandos manuais:

```bash
git pull
set -a
. ./.env
set +a
docker compose build
docker volume create wa-sender-simple_postgres_data
docker volume create wa-sender-simple_baileys_session
docker volume create wa-sender-simple_uploads
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
APP_CID=$(docker ps -q --filter "name=wa_sender_simple_app" | head -n 1)
docker exec -it "$APP_CID" npm run prisma:deploy
```

## Migrations

Quando houver migration, rode dentro do container do app criado pelo stack:

```bash
APP_CID=$(docker ps -q --filter "name=wa_sender_simple_app" | head -n 1)
docker exec -it "$APP_CID" npm run prisma:deploy
```

Nao use em producao:

- `prisma db push`
- `prisma migrate reset`
- reset, drop ou truncate manual

## Logs importantes

Para acompanhar o QR Code:

```bash
docker service logs wa_sender_simple_worker --tail 300 --no-trunc
```

Logs esperados ao clicar em Reconectar:

```text
[worker] connect-whatsapp job received
[baileys] session files before start { files: 0 }
[baileys] creating socket
[baileys] qr safe mode enabled { sessionFiles: 0, syncFullHistory: false, versionSource: "local-default" }
[baileys] qr received and saved
```

O log do app nao deve mostrar:

```text
Custom Id cannot contain :
```

## QR Safe Mode

Quando a pasta de sessao esta vazia (`session files = 0`), o worker deve iniciar em QR_SAFE_MODE.

Valide nos logs:

```text
[baileys] session files before start { files: 0 }
[baileys] latest version skipped for qr safe mode
[baileys] qr safe mode enabled { sessionFiles: 0, syncFullHistory: false, versionSource: "local-default" }
```

Se aparecer 428 com `files=0` antes do QR, o problema provavel e config/version/browser, nao sessao antiga.

Fluxo correto:

1. Acesse `/whatsapp`.
2. Clique `Resetar sessao` uma vez.
3. Aguarde o worker finalizar.
4. Clique `Reconectar` uma vez.
5. Escaneie o QR.

Nao clique repetidamente em `Reconectar`; o sistema nao deve voltar a loop infinito 428.

## Volumes

Volumes persistentes usados pelo stack:

- `wa-sender-simple_postgres_data`: dados do PostgreSQL.
- `wa-sender-simple_baileys_session`: sessao local do Baileys.
- `wa-sender-simple_uploads`: reservado para arquivos temporarios.

No `docker-stack.yml`, esses volumes sao externos para o stack usar os mesmos dados preparados antes. Nao remova esses volumes sem backup.

O `docker-compose.yml` tambem usa esses mesmos nomes para evitar migrar um banco e subir outro no stack.

## Debug do QR

Checklist detalhado em [docs/WHATSAPP_QR_DEBUG.md](docs/WHATSAPP_QR_DEBUG.md).

## Checklist pos-deploy

- App rodando.
- Worker rodando.
- Migrations aplicadas quando houver migration nova.
- `/whatsapp` acessivel.
- QR gera em QR_SAFE_MODE quando `session files = 0`.
- `/conversas` abre.
- `/etiquetas` so testada depois do WhatsApp conectado.
- Worker logs sem 428 em loop.
- Postgres e Redis continuam sem portas publicas.

## Observacoes

- Mantenha apenas um worker ativo neste MVP para evitar disputa de sessao Baileys.
- Baileys nao e API oficial do WhatsApp; trate queda de sessao, QR expirado e bloqueios como riscos operacionais.
- O worker precisa estar rodando para gerar QR Code, capturar opt-out e enviar mensagens.
- Nao exponha `DATABASE_URL`, `ADMIN_PASSWORD` ou credenciais em logs.
