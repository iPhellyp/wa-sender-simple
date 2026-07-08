# WA Sender Simple v1.0 Beta Producao

## Visao do produto

WA Sender Simple e um sistema de envio e gestao WhatsApp multi-numero. Cada instancia representa um numero operacional com QR, sessao, conversas, contatos, etiquetas, campanhas e envios isolados.

## Incluido na v1 beta

- Multi-instancia WhatsApp.
- QR por instancia.
- Retomada de sessao salva apos deploy/restart.
- Selecao de instancia ativa.
- Importacao de contatos.
- Etiquetas WhatsApp.
- Envio manual em conversa.
- Campanhas por etiqueta, contatos WhatsApp ou contatos importados.
- Pausa, retomada e cancelamento de campanhas.
- Auditoria de envios.
- Reset, desconexao e delete de instancia com confirmacao.
- Estado zero instancias com criacao da primeira instancia.
- Importacao organizada por lista/origem.
- Spintax, variaveis basicas e delay seguro em campanhas.
- Envio de teste antes da campanha.
- Bloqueio de campanha simultanea no mesmo numero.
- Opt-out e dedupe basico por campanha.

## Nao incluido ainda

- CRM avancado.
- IA.
- Kanban.
- Automacoes complexas.
- Funil avancado.
- Garantia contra bloqueio WhatsApp.
- Disparo ilimitado.
- Promessa de antiban.
- Rotacao automatica entre numeros.
- Campos extras persistidos da planilha sem migration.
- Exclusao destrutiva automatica de contatos de uma lista.

## Aviso de responsabilidade

O cliente e responsavel pela base de contatos, pelo conteudo enviado e pelo consentimento dos destinatarios. O sistema nao garante ausencia de bloqueio pelo WhatsApp. A v1 beta deve iniciar com volume baixo e crescer gradualmente.

## Uso recomendado

- Operar em beta controlado.
- Validar uma instancia por vez.
- Enviar teste antes de iniciar campanha.
- Pausar se houver muitas falhas ou respostas negativas.
- Fazer backup do banco e da sessao Baileys antes de deploy.
