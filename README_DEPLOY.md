# Deploy seguro — WA Sender 2

O app é publicado em `https://wa2.supereducarbrasil.com.br` pelo Traefik na
rede externa `iPHnet`. Postgres, Redis e worker ficam somente na rede overlay
interna. Nenhuma porta adicional é publicada.

## Variáveis

O app recebe `WA2_INTERNAL_API_SECRET`,
`WA2_INTERNAL_API_PREVIOUS_SECRET` (opcional),
`WA2_INTERNAL_API_RATE_LIMIT`, `WA2_INTERNAL_API_RATE_WINDOW_SECONDS` e
`WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS`. O worker não recebe esses segredos,
pois não os consome. Valores reais ficam em `.env` ou
`.env.production.docker`, nunca no Git.

## Ordem oficial

Execute somente em uma janela autorizada na VPS:

```bash
chmod +x deploy-safe.sh scripts/backup.sh scripts/rollback.sh
./deploy-safe.sh
```

O script valida as variáveis sem mostrar valores, exige Git limpo, registra
branch/commit, usa o SHA curto como `IMAGE_TAG` padrão, executa backup, constrói
a imagem imutável, pausa o worker antes do backup de sessão, pausa o app, roda
uma única migration controlada,
atualiza o app e depois o worker.

A migration é `npm run prisma:deploy` em serviço Swarm temporário, com uma
única tarefa no manager e sem exigir rede overlay attachable. O deploy exige
estado `complete`, exit code `0`, timeout de 300 segundos e remove o serviço em
sucesso ou falha. `MIGRATION_NETWORK` substitui a rede interna e
`MIGRATION_TIMEOUT_SECONDS` ajusta o timeout. O nome temporário usa
`w2m_<tag-sanitizada>_<epoch>_<pid>`, limita a tag a 12 caracteres e é validado
explicitamente para nunca ser enviado ao Swarm com mais de 63 caracteres. Com
epoch de 10 dígitos e PID Linux de até 7 dígitos, o máximo calculado é 35
caracteres. Falha interrompe o deploy. Nunca use `docker run`,
`prisma migrate dev`, `prisma db push`, reset, drop ou truncate em produção.

## Healthchecks

O app chama o health interno protegido por Bearer, que verifica aplicação,
PostgreSQL e Redis sem expor credenciais. O worker grava heartbeat no Redis; o
healthcheck exige heartbeat recente, PostgreSQL e Redis disponíveis.

## Backup

`scripts/backup.sh` cria:

- `pg_dump` custom, validado com `pg_restore --list`;
- arquivo da sessão Baileys, validado com `tar -tzf`;
- snapshot RDB do Redis, necessário porque BullMQ/idempotência usam persistência;
- `SHA256SUMS`.

O diretório usa permissão restrita, timestamp UTC e nunca é apagado
automaticamente. Por padrão, os artefatos ficam fora do repositório em
`/root/wa-sender-simple-backups`; a variável externa `BACKUP_ROOT` pode alterar
essa raiz. O deploy passa o valor explicitamente para `scripts/backup.sh`.

## Rollback

```bash
./scripts/rollback.sh TAG_ANTERIOR
```

Tag vazia ou inválida é rejeitada. O worker é pausado antes da troca. App e
worker são atualizados com `--no-healthcheck` para aceitar imagens antigas. O
app é escalado explicitamente para 1 e o rollback exige exatamente uma task e
um container `Running`; só então o worker é mantido em 0 ou escalado para 1 e
validado pelo mesmo critério.
Bindings/importações devem permanecer pausados até validação funcional quando
aplicável. Não há downgrade de schema. Restore de banco só ocorre com corrupção
comprovada e autorização explícita.

Para manter bindings/importações pausados durante a validação:

```bash
KEEP_WORKER_PAUSED=true ./scripts/rollback.sh TAG_ANTERIOR
```

## Inspeção

```bash
docker stack services wa_sender_simple
docker service ps wa_sender_simple_app --no-trunc
docker service ps wa_sender_simple_worker --no-trunc
docker service logs wa_sender_simple_app --tail 200
docker service logs wa_sender_simple_worker --tail 200
```

O deploy não importa leads automaticamente.
