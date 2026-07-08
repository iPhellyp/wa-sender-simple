# WA Sender Simple - Design System Mobile First + PWA

## Filosofia

O WA Sender Simple deve funcionar primeiro em telas pequenas, sem perder densidade operacional no desktop. A interface prioriza leitura rapida, acoes claras, baixo risco operacional e continuidade de instancia ativa por URL, localStorage e cookie.

PWA e uma camada progressiva: manifest, metadata, safe areas, bottom nav, banner offline e prompt de instalacao podem existir sem service worker complexo. Dependencias como next-pwa, Serwist, Vaul ou bibliotecas de gesto ficam como opcoes futuras, nao usadas nesta entrega.

## Paleta

- Primary: verde WhatsApp operacional `#0f766e`.
- Primary dark: `#115e59`.
- Background: claro `#f6f8fb` / `#f8fafc`.
- Surface: branco `#ffffff`.
- Border: slate claro `#d7e0ea`.
- Text primary: `#0f172a`.
- Text muted: `#64748b`.
- Success: `#059669`.
- Warning: `#d97706`.
- Error: `#dc2626`.
- Info: `#175cd3`.

## Tipografia

Usar stack de sistema com Inter quando disponivel. Tamanhos grandes ficam reservados para titulo de pagina. Cards, tabelas, filtros e wizard usam texto compacto, sem letter spacing negativo e sem escala por viewport.

## Layout

Mobile:
- Uma coluna.
- Conteudo com padding lateral reduzido.
- Bottom nav fixa com safe area.
- Topbar compacta.
- Cards e formularios com touch target minimo de 44px.
- Tabelas viram cards quando necessario.

Desktop:
- Topbar/nav existente preservada.
- Layouts split e wizard em duas colunas.
- Preview lateral sticky quando houver espaco.
- Tabelas continuam permitidas para auditoria.

## Navegacao

Bottom nav mobile:
- Dashboard.
- Conversas.
- Campanhas.
- Instancias.
- Envios.

Nav desktop:
- Mantem os links atuais.
- `NavLink` preserva `instanceId`.
- A instancia ativa nao deve escrever `isDefault` no banco.

## Componentes

Botoes:
- Primario verde para acao principal.
- Secundario para navegacao, preview e atualizacao.
- Danger apenas para cancelar/deletar.

Cards:
- Raio pequeno.
- Sem cards dentro de cards quando nao necessario.
- Conteudo compacto e escaneavel.

Tabelas:
- Desktop: tabelas compactas.
- Mobile: cards com status, metricas e botoes.

Bottom sheet:
- Opcao futura para filtros e acoes em massa.
- Nesta fase, usar paineis e cards responsivos sem dependencia externa.

Inputs:
- Altura minima de 44px no mobile.
- Labels sempre visiveis.
- Mensagens de erro locais quando possivel.

## Telas

Dashboard:
- Deve mostrar status consolidado igual a `/instancias`.
- Alertas devem ser compactos.

Conversas:
- Lista compacta.
- Sem grupos, broadcasts, status, newsletters/canais.
- Participantes capturados de grupos nao sao conversa individual elegivel.
- Selecao de campanha deve aceitar apenas conversa direta real.

Campanhas:
- Wizard: Publico, Mensagem, Seguranca, Revisao.
- Preview estilo WhatsApp.
- Chips de variaveis e spintax.
- Teste de mensagem sem iniciar campanha.
- Campanhas recentes compactas e em cards no mobile.

## PWA

Manifest:
- `name`: WA Sender Simple.
- `short_name`: WA Sender.
- `display`: standalone.
- `orientation`: any.
- `theme_color`: `#0f172a`.
- `background_color`: `#f8fafc`.

Meta:
- `viewport-fit=cover`.
- `theme-color`.
- Apple web app capable/title/status bar.

Splash/offline/install:
- Sem service worker complexo nesta fase.
- Offline banner informa perda de rede.
- Install prompt usa `beforeinstallprompt` quando suportado.
- iOS continua dependendo da acao manual "Adicionar a Tela de Inicio".

Safe areas:
- Usar `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`.
- Bottom nav e banners respeitam safe area.

## Checklist PWA

- Manifest servido.
- Icone local existe.
- Theme color configurado.
- Bottom nav nao cobre conteudo.
- Offline banner nao bloqueia operacao.
- Install prompt pode ser dispensado.
- Desktop continua com nav atual.

## Plano faseado

Fase A: tokens CSS + safe areas.

Fase B: AppShell mobile com bottom nav.

Fase C: Conversas mobile stack.

Fase D: Campanhas mobile cards.

Fase E: manifest/meta PWA.

Fase F: offline banner/install prompt.

Fase G: polish, acessibilidade e testes manuais em Android/iOS/desktop.
