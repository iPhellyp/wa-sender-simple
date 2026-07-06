# Deploy Traefik/Swarm

Fluxo de producao para VPS com Docker Swarm e Traefik na rede overlay externa `iPHnet`.

Dominio configurado no stack:

```text
https://wa2.supereducarbrasil.com.br
```

## Variaveis

Crie `.env` na VPS a partir de `.env.example` e troque as senhas:

```env
POSTGRES_DB=wa_sender_simple
POSTGRES_USER=wa_sender
POSTGRES_PASSWORD=troque_essa_senha_do_postgres
DATABASE_URL=postgresql://wa_sender:troque_essa_senha_do_postgres@postgres:5432/wa_sender_simple?schema=public
REDIS_URL=redis://redis:6379
ADMIN_PASSWORD=troque_essa_senha_admin
BAILEYS_SESSION_DIR=/app/data/baileys-session
BAILEYS_LOG_LEVEL=silent
NEXT_PUBLIC_APP_URL=https://wa2.supereducarbrasil.com.br
```

No Docker/Swarm, `DATABASE_URL` usa o host interno `postgres` e `REDIS_URL` usa `redis`. Nao use `localhost` dentro dos containers.

## Rede e portas

Postgres, Redis, app e worker nao publicam portas no host.

O app roda internamente na porta `3000` e entra tambem na rede externa `iPHnet`. O Traefik roteia pelo dominio usando labels em `deploy.labels`.

Postgres e Redis ficam apenas na rede interna do stack, sem `ports`, evitando conflito com outros servicos da VPS em `5432`, `6379`, `3000`, `80` ou `443`.

O `certresolver` configurado e `letsencryptresolver`. Ajuste esse valor em `docker-stack.yml` se o seu Traefik usar outro nome.

## Primeiro deploy

Comandos manuais na VPS:

```bash
git pull
docker compose build
docker compose up -d postgres redis
docker compose run --rm app npm run prisma:deploy
docker compose down
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
```

`docker stack deploy` nao faz build de imagem. Por isso, `docker compose build` deve ser executado antes para criar as imagens locais:

- `wa-sender-simple-app:latest`
- `wa-sender-simple-worker:latest`

O uso de `--resolve-image never` evita tentativa de buscar essas imagens em registry externo.

## Atualizacao

Comandos manuais:

```bash
git pull
docker compose build
docker compose up -d postgres redis
docker compose run --rm app npm run prisma:deploy
docker compose down
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
```

## Volumes

Volumes persistentes usados por compose e stack:

- `wa-sender-simple_postgres_data`: dados do PostgreSQL.
- `wa-sender-simple_baileys_session`: sessao local do Baileys.
- `wa-sender-simple_uploads`: reservado para arquivos temporarios.

No `docker-stack.yml`, esses volumes sao marcados como externos para o stack usar os mesmos dados preparados antes da migration. Nao remova esses volumes sem backup.

## Observacoes

- Mantenha apenas um worker ativo neste MVP para evitar disputa de sessao Baileys.
- Baileys nao e API oficial do WhatsApp; trate queda de sessao, QR expirado e bloqueios como riscos operacionais.
- O worker precisa estar rodando para gerar QR Code, capturar opt-out e enviar mensagens.
- Nao exponha `DATABASE_URL`, `ADMIN_PASSWORD` ou credenciais em logs.
