# Deploy

Fluxo sugerido para VPS Linux usando Docker Compose.

## Preparar variaveis

Crie `.env` na VPS com:

```env
ADMIN_PASSWORD="uma_senha_forte"
DATABASE_URL="postgresql://wa_sender:wa_sender@postgres:5432/wa_sender_simple?schema=public"
REDIS_URL="redis://redis:6379"
BAILEYS_SESSION_DIR="/app/data/baileys-session"
BAILEYS_LOG_LEVEL="silent"
NEXT_PUBLIC_APP_URL="https://seu-dominio.com"
```

Troque as senhas padrao do Postgres no `docker-compose.yml` antes de usar em producao. Nao use a senha de exemplo em VPS.

No Docker, `DATABASE_URL` deve apontar para o host `postgres` e `REDIS_URL` para `redis`. `localhost` dentro do container apontaria para o proprio container, nao para o banco.

## Primeiro deploy manual

Comandos manuais:

```bash
docker compose build
docker compose up -d postgres redis
docker compose run --rm app npm run prisma:deploy
docker compose up -d app worker
```

## Atualizacao

Comandos manuais:

```bash
git pull
docker compose build
docker compose run --rm app npm run prisma:deploy
docker compose up -d app worker
```

O primeiro deploy e as atualizacoes devem ser executados manualmente e revisados antes de expor o servico.

## Volumes

- `postgres_data`: dados do banco.
- `baileys_session`: credenciais locais do Baileys.
- `uploads`: reservado para arquivos temporarios.

Nao remova esses volumes sem backup.

## Proxy reverso

Configure Traefik, Nginx ou outro proxy para apontar o dominio para o servico `app` na porta `3000`. Use HTTPS.

## Observacoes de producao

- Nao exponha `DATABASE_URL`, `ADMIN_PASSWORD` ou credenciais em logs.
- Use senha forte no Postgres e no `ADMIN_PASSWORD`.
- Mantenha apenas um worker ativo para evitar disputa de sessao Baileys neste MVP.
- Falhas de WhatsApp nao devem ser tratadas como confirmacao financeira ou evento critico externo.
- Baileys nao e API oficial do WhatsApp; trate queda de sessao, QR expirado e bloqueios como riscos operacionais.
- O worker precisa estar rodando para gerar QR Code, capturar opt-out e enviar mensagens.
