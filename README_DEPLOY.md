# Deploy Traefik/Swarm

Fluxo de producao para VPS com Docker Swarm e Traefik na rede overlay externa `iPHnet`.

Dominio final:

```text
https://wa2.supereducarbrasil.com.br
```

## Variaveis

Crie `.env` na VPS a partir de `.env.example` e troque as senhas:

```env
POSTGRES_DB=wa_sender_simple
POSTGRES_USER=wa_sender
POSTGRES_PASSWORD=wa_sender
DATABASE_URL=postgresql://wa_sender:wa_sender@wa_sender_simple_postgres:5432/wa_sender_simple?schema=public
REDIS_URL=redis://wa_sender_simple_redis:6379
ADMIN_PASSWORD=SUA_SENHA_ADMIN_AQUI
BAILEYS_SESSION_DIR=/app/data/baileys-session
BAILEYS_LOG_LEVEL=silent
APP_URL=https://wa2.supereducarbrasil.com.br
NEXT_PUBLIC_APP_URL=https://wa2.supereducarbrasil.com.br
```

No Swarm, use os hosts internos unicos do stack:

- `wa_sender_simple_postgres`
- `wa_sender_simple_redis`

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

## Logs importantes

Para acompanhar o QR Code:

```bash
docker service logs wa_sender_simple_worker --tail 300 --no-trunc
```

Logs esperados ao clicar em Reconectar:

```text
[worker] connect-whatsapp job received
[baileys] creating socket
[baileys] qr received and saved
```

O log do app nao deve mostrar:

```text
Custom Id cannot contain :
```

## Volumes

Volumes persistentes usados pelo stack:

- `wa-sender-simple_postgres_data`: dados do PostgreSQL.
- `wa-sender-simple_baileys_session`: sessao local do Baileys.
- `wa-sender-simple_uploads`: reservado para arquivos temporarios.

No `docker-stack.yml`, esses volumes sao externos para o stack usar os mesmos dados preparados antes. Nao remova esses volumes sem backup.

O `docker-compose.yml` tambem usa esses mesmos nomes para evitar migrar um banco e subir outro no stack.

## Debug do QR

Checklist detalhado em [docs/WHATSAPP_QR_DEBUG.md](docs/WHATSAPP_QR_DEBUG.md).

## Observacoes

- Mantenha apenas um worker ativo neste MVP para evitar disputa de sessao Baileys.
- Baileys nao e API oficial do WhatsApp; trate queda de sessao, QR expirado e bloqueios como riscos operacionais.
- O worker precisa estar rodando para gerar QR Code, capturar opt-out e enviar mensagens.
- Nao exponha `DATABASE_URL`, `ADMIN_PASSWORD` ou credenciais em logs.
