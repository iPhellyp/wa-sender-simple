# Manual rapido

## Criar uma instancia

1. Acesse `/instancias`.
2. Informe nome e funcao.
3. Clique em `Criar instancia`.
4. Clique em `Usar esta instancia`.
5. Clique em `Abrir WhatsApp`.

Se nao houver nenhuma instancia cadastrada, `/instancias` mostra estado vazio e botao para criar a primeira.

## Conectar WhatsApp

1. Abra `/whatsapp?instanceId=ID`.
2. Clique em `Conectar/Reconectar esta instancia`.
3. Aguarde o QR.
4. Escaneie com o aparelho correto.
5. Confirme status conectado e telefone conectado.

## Trocar numero ativo

Use o seletor de instancia ativa no topo ou clique em `Usar esta instancia` em `/instancias`. Sempre confira o nome da instancia antes de enviar.

## Importar contatos

1. Abra `/contatos`.
2. Clique em `Importar contatos`.
3. Informe nome da lista, origem, responsavel, tags e observacao.
4. Envie planilha XLS/XLSX.
5. Confira total, inseridos, atualizados, duplicados e invalidos.

## Apagar lista

1. Abra `/contatos`.
2. Filtre pela lista/origem.
3. Clique em `Apagar lista`.
4. Digite exatamente o nome da lista.
5. A v1 beta remove o vinculo/origem e preserva os contatos.

## Enviar mensagem manual

1. Abra `/conversas`.
2. Confira a instancia ativa.
3. Abra uma conversa.
4. Envie uma mensagem teste.

## Criar campanha pequena

1. Escolha a instancia correta.
2. Abra `/campanhas`.
3. Escolha etiqueta ou contatos.
4. Comece com 2 a 5 contatos.
5. Revise mensagem e seguranca.
6. Crie em rascunho e acompanhe em `/envios`.

## Spintax e variaveis

Use spintax simples, por exemplo `{Ola|Oi}, {{nome}}`. Variaveis disponiveis na v1 beta: `{{nome}}`, `{{telefone}}`, `{{origem}}` e `{{lista}}`. Campos extras de planilha ainda exigem evolucao de schema.

## Delay seguro

Use intervalo fixo em segundos/minutos ou faixa aleatoria. Mesmo quando o painel mostra segundos, a v1 beta salva o equivalente em minutos para manter compatibilidade com o schema atual.

## Deletar instancia

1. Desconecte a instancia antes.
2. Abra `/instancias`.
3. Clique em `Deletar`.
4. Digite exatamente o nome da instancia.
5. Confirme. Outras instancias nao sao afetadas.

E permitido deletar todas as instancias. Nesse caso, o sistema fica em estado vazio ate uma nova instancia ser criada.
