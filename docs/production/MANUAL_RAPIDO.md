# Manual rapido

## 1. Acessar

1. Abra o dominio de producao.
2. Entre com a senha admin.
3. Confira a instancia ativa no topo antes de operar.

## 2. Criar uma instancia

1. Acesse `/instancias`.
2. Informe nome e funcao.
3. Clique em `Criar instancia`.
4. Clique em `Usar esta instancia`.
5. Gere QR ou retome sessao no proprio card.

Se nao houver nenhuma instancia cadastrada, `/instancias` mostra estado vazio e botao para criar a primeira.

## 3. Conectar WhatsApp

1. Abra `/instancias`.
2. Use o card da instancia desejada.
3. Se nao houver sessao salva, clique em `Gerar QR`.
4. Aguarde o QR no card.
5. Escaneie com o aparelho correto.
6. Confirme status conectado e telefone conectado.

## 4. Retomar sessao apos deploy ou queda

1. Abra `/instancias`.
2. Confirme se aparece `Sessao salva`.
3. Clique em `Retomar sessao`.
4. Aguarde o socket reabrir sem resetar.
5. Use `Resetar sessao` somente se o suporte orientar ou se a sessao estiver realmente corrompida.

## 5. Trocar numero ativo

Use o seletor de instancia ativa no topo ou clique em `Usar esta instancia` em `/instancias`. Sempre confira o nome da instancia antes de enviar.

## 6. Importar contatos

1. Abra `/contatos`.
2. Clique em `Importar contatos`.
3. Informe nome da lista, origem, responsavel, tags e observacao.
4. Envie planilha XLS/XLSX.
5. Confira total, inseridos, atualizados, duplicados e invalidos.

## 7. Apagar lista

1. Abra `/contatos`.
2. Filtre pela lista/origem.
3. Clique em `Apagar lista`.
4. Digite exatamente o nome da lista.
5. A v1 beta remove o vinculo/origem e preserva os contatos.

## 8. Enviar mensagem manual

1. Abra `/conversas`.
2. Confira a instancia ativa.
3. Abra uma conversa.
4. Envie uma mensagem teste.

## 9. Criar campanha

1. Escolha a instancia correta.
2. Abra `/campanhas`.
3. Escolha etiqueta ou contatos.
4. Escreva a mensagem.
5. Gere preview.
6. Envie teste para seu numero.
7. Comece com 2 a 5 contatos.
8. Revise seguranca.
9. Crie em rascunho e acompanhe em `/envios`.

## 10. Spintax e variaveis

Use spintax simples, por exemplo `{Ola|Oi}, {{nome}}`.

Variaveis disponiveis: `{{nome}}`, `{{telefone}}`, `{{email}}`, `{{cidade}}`, `{{estado}}`, `{{origem}}` e `{{lista}}`.

Campos extras de planilha ainda exigem evolucao de schema. Quando o valor nao existe, a variavel fica vazia para nao enviar placeholder cru.

## 11. Delay e pausas

Use delay fixo, faixa aleatoria, pausa a cada lote e limite de lote. Recomendacao inicial: 30 a 90 segundos, pausa a cada 25 a 40 mensagens e volume baixo.

## 12. Pausar ou cancelar campanha

Use `/campanhas` ou `/envios`. Antes de iniciar outra campanha no mesmo numero, pause, cancele ou aguarde a campanha atual finalizar.

## 13. Evitar bloqueio e denuncia

Use base com consentimento, mensagem util, opt-out respeitado, volume gradual e poucos links. O sistema nao promete antiban.

## 14. Deletar instancia

1. Desconecte a instancia antes.
2. Abra `/instancias`.
3. Clique em `Deletar`.
4. Digite exatamente o nome da instancia.
5. Confirme. Outras instancias nao sao afetadas.

E permitido deletar todas as instancias. Nesse caso, o sistema fica em estado vazio ate uma nova instancia ser criada.

## 15. Suporte

Ao pedir suporte, envie instancia afetada, horario, ultimo erro exibido, se existe sessao salva e se a acao foi Retomar, Gerar QR, Desconectar ou Resetar.
