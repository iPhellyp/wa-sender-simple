# Checklist de operacao

## Primeiro acesso

- Confirmar URL de producao.
- Confirmar login.
- Criar instancia.
- Conectar WhatsApp.
- Confirmar status conectado.
- Confirmar telefone conectado.
- Confirmar se ha sessao salva em `/instancias`.
- Se necessario, testar `Retomar sessao` sem reset.
- Importar contatos.
- Enviar mensagem teste.
- Criar campanha teste com 2 a 5 contatos.
- Validar relatorio em `/envios`.
- Testar estado zero instancias em ambiente controlado.
- Importar uma lista com nome/origem/responsavel.
- Apagar lista com confirmacao e confirmar que contatos foram preservados.

## Smoke test final

1. Criar Instancia A.
2. Usar Instancia A em `/instancias`.
3. Clicar reconectar.
4. Confirmar QR da Instancia A.
5. Escanear com numero A.
6. Confirmar `connectedPhone` A.
7. Criar Instancia B.
8. Usar Instancia B em `/instancias`.
9. Clicar reconectar.
10. Confirmar QR da Instancia B.
11. Confirmar que QR de B nao altera A.
12. Escanear com numero B.
13. Confirmar A e B conectadas.
14. Trocar entre `/conversas`, `/etiquetas`, `/campanhas`, `/envios` e `/instancias`.
15. Confirmar que a instancia ativa permanece.
16. Enviar mensagem manual pela A.
17. Enviar mensagem manual pela B.
18. Criar campanha pequena na A.
19. Criar campanha pequena na B.
20. Testar reset, desconectar e deletar com cancelamento.
21. Criar instancia teste C.
22. Deletar C com confirmacao correta.
23. Confirmar que A e B continuam intactas.
24. Abrir `/conversas?instanceId=nao-existe`.
25. Confirmar erro sem dados de outra instancia.
26. Deletar todas as instancias em ambiente teste.
27. Confirmar estado vazio e criar nova instancia.
28. Criar campanha com spintax e variaveis.
29. Confirmar preview e delay seguro.
30. Enviar teste para meu numero.
31. Tentar iniciar duas campanhas no mesmo numero e confirmar bloqueio.
32. Confirmar que opt-out nao entra na campanha.

## Checklist antes de campanha

- Verificar instancia ativa.
- Verificar status da sessao.
- Retomar sessao se necessario.
- Importar lista pequena primeiro.
- Limpar duplicados.
- Revisar opt-out.
- Enviar teste.
- Comecar com 2 a 5 contatos.
- Usar delay 30 a 90 segundos.
- Pausar a cada 25 a 40 mensagens.
- Nao rodar campanha simultanea no mesmo numero.
- Monitorar respostas negativas.
- Parar se houver muitas falhas.

## Backlog recomendado

1. Aquecimento de numero por instancia.
2. Supressao automatica/opt-out centralizado.
3. Saude da instancia com falhas recentes, taxa de envio e ultima queda.
4. Duplicidade inteligente entre listas.
5. Rotacao round-robin entre numeros, limite por instancia e balanceamento por menor carga.

## Plano de teste em producao

### A. Sessao

1. Manter numero ja conectado no celular.
2. Fazer deploy/restart com backup.
3. Abrir `/instancias`.
4. Confirmar que a sessao continua salva.
5. Se nao conectar sozinho, clicar `Retomar sessao`.
6. Confirmar reconexao sem QR.

### B. QR

1. Criar instancia A.
2. Gerar QR A.
3. Criar instancia B.
4. Gerar QR B.
5. Confirmar isolamento entre A e B.

### C. Delete

1. Deletar B desconectada.
2. Deletar A desconectada.
3. Confirmar estado zero.
4. Criar nova primeira instancia.

### D. Contatos

1. Importar lista pequena.
2. Conferir lista/origem.
3. Apagar lista preservando contatos.

### E. Campanha

1. Criar campanha com `{Oi|Ola}, {{nome}}`.
2. Gerar preview.
3. Enviar teste.
4. Rodar 2 a 5 contatos.
5. Confirmar delay.
6. Confirmar bloqueio de campanha concorrente no mesmo numero.
