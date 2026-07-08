# Checklist Mobile/PWA - WA Sender Simple

## Android Chrome

- Abrir o dominio em Chrome Android.
- Confirmar que o manifest e reconhecido.
- Testar instalar o app quando o prompt aparecer.
- Abrir em modo standalone apos instalar.
- Conferir theme color no topo.
- Confirmar que a bottom nav fica visivel e nao cobre botoes.
- Testar safe area em aparelho com gesto de navegacao.

## iOS Safari

- Abrir o dominio em Safari.
- Usar compartilhar > Adicionar a Tela de Inicio.
- Abrir pelo icone criado.
- Conferir titulo WA Sender.
- Conferir safe areas superior e inferior.
- Confirmar que a bottom nav nao fica atras da barra do sistema.

## Navegacao

- Trocar instancia em `/instancias`.
- Navegar por Dashboard, Conversas, Campanhas, Instancias e Envios.
- Confirmar que `instanceId` permanece na URL.
- Confirmar que localStorage/cookie mantem instancia ativa ao recarregar.

## Conversas

- Abrir `/conversas` no celular.
- Confirmar ausencia de scroll horizontal.
- Confirmar cards compactos e touch-friendly.
- Confirmar que grupos `@g.us` nao aparecem.
- Confirmar que `status@broadcast`, broadcasts, newsletters/canais nao aparecem.
- Confirmar que membros capturados de grupos sem conversa direta real nao aparecem.
- Selecionar contatos e abrir campanha.

## Campanhas

- Criar campanha pelo celular.
- Testar etapas Publico, Mensagem, Seguranca e Revisao.
- Inserir variaveis por chips.
- Conferir preview estilo WhatsApp.
- Enviar mensagem de teste sem iniciar campanha.
- Criar rascunho.
- Ver campanhas recentes em cards.
- Testar Ver, Iniciar, Pausar/Retomar, Cancelar e Acompanhar.
- Confirmar que campanha nao envia para grupos ou membros inelegiveis.

## Offline

- Abrir app e desligar rede.
- Confirmar banner offline.
- Confirmar que o banner nao bloqueia a tela.
- Religar rede e confirmar que o banner some.

## Desktop apos alteracoes

- Conferir topbar/nav desktop.
- Conferir Dashboard.
- Conferir Conversas compactas.
- Conferir Campanhas em layout amplo.
- Conferir Instancias.
- Confirmar que sync rapido continua rapido.
- Confirmar que QR/conexao nao foram alterados.

## Validacao final manual

- Sem horizontal scroll no mobile.
- Touch targets principais com pelo menos 44px.
- Bottom nav preserva `instanceId`.
- PWA sem service worker customizado.
- Build manual deve passar.
