# WA Sender Simple

MVP para envio controlado de mensagens WhatsApp com Baileys, planilha Excel, PostgreSQL, Redis e BullMQ.

## Funcionalidades

- Login simples por `ADMIN_PASSWORD`.
- Conexao de 1 WhatsApp via QR Code com Baileys.
- Importacao de Excel `.xlsx` com colunas `nome`, `telefone`, `mensagem`, `origem`.
- Normalizacao de telefones brasileiros.
- Dedupe por telefone normalizado.
- Tabela de contatos com filtros por origem e opt-out.
- Criacao de campanhas com contatos selecionados.
- Mensagem padrao opcional ou mensagem individual da planilha.
- Envio serializado via worker BullMQ.
- Pausar, retomar e cancelar campanha.
- Captura de respostas de opt-out: `PARAR`, `SAIR`, `STOP`, `CANCELAR`.

## Variaveis de ambiente

Copie `.env.example` para `.env` e ajuste:

```env
# Local fora do Docker
DATABASE_URL="postgresql://wa_sender:wa_sender@localhost:5432/wa_sender_simple?schema=public"
REDIS_URL="redis://localhost:6379"
ADMIN_PASSWORD="troque_essa_senha"
BAILEYS_SESSION_DIR="./data/baileys-session"
BAILEYS_LOG_LEVEL="silent"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

No Docker Compose, `app` e `worker` sobrescrevem `DATABASE_URL` para `postgres` e `REDIS_URL` para `redis`. Nao use `localhost` dentro dos containers.

## Rodar localmente

Comandos manuais:

```powershell
npm install
docker compose up -d postgres redis
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Em outro terminal:

```powershell
npm run worker
```

Abra `http://localhost:3000`, entre com `ADMIN_PASSWORD`, conecte o WhatsApp e importe a planilha.
O worker precisa estar rodando para gerar QR Code, capturar opt-out e enviar mensagens.

## Docker local

Comandos manuais:

```powershell
docker compose build
docker compose up -d postgres redis
docker compose run --rm app npm run prisma:deploy
docker compose up -d app worker
```

## Formato da planilha

A primeira linha deve ter exatamente estes cabecalhos e nesta ordem:

```text
nome | telefone | mensagem | origem
```

Telefones aceitos:

- Com DDD nacional: `11999999999`
- Com codigo do Brasil: `5511999999999`
- Com caracteres de mascara: `+55 (11) 99999-9999`

## Envio

Ao iniciar uma campanha, os destinatarios pendentes sao agendados com intervalo em minutos. O worker processa um job por vez, verifica se a campanha segue `running`, se o contato nao esta opt-out e atualiza o status do destinatario.

## Rotas principais

- `/dashboard`
- `/whatsapp`
- `/contatos`
- `/campanhas`

APIs:

- `POST /api/import/excel`
- `GET /api/contacts`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/reconnect`
- `POST /api/whatsapp/disconnect`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/[id]`
- `POST /api/campaigns/[id]/start`
- `POST /api/campaigns/[id]/pause`
- `POST /api/campaigns/[id]/resume`
- `POST /api/campaigns/[id]/cancel`
- `GET /api/campaigns/[id]/recipients`

## Limites do MVP

- Apenas uma sessao WhatsApp.
- Sem multi-tenant.
- Sem CRM avancado.
- Sem envio para grupos.
- Sem retry avancado de falha de envio.
- Sem rate-limit por provedor alem do intervalo configurado por campanha.
- Baileys nao e API oficial do WhatsApp; sessao, QR e envio podem falhar por mudancas externas do WhatsApp.
