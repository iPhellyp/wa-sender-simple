# Checklist de operacao

## Primeiro acesso

- Confirmar URL de producao.
- Confirmar login.
- Criar instancia.
- Conectar WhatsApp.
- Confirmar status conectado.
- Confirmar telefone conectado.
- Importar contatos.
- Enviar mensagem teste.
- Criar campanha teste com 2 a 5 contatos.
- Validar relatorio em `/envios`.
- Testar estado zero instancias em ambiente controlado.
- Importar uma lista com nome/origem/responsavel.
- Apagar lista com confirmacao e confirmar que contatos foram preservados.

## Smoke test final

1. Criar Instancia A.
2. Abrir `/whatsapp?instanceId=A`.
3. Clicar reconectar.
4. Confirmar QR da Instancia A.
5. Escanear com numero A.
6. Confirmar `connectedPhone` A.
7. Criar Instancia B.
8. Abrir `/whatsapp?instanceId=B`.
9. Clicar reconectar.
10. Confirmar QR da Instancia B.
11. Confirmar que QR de B nao altera A.
12. Escanear com numero B.
13. Confirmar A e B conectadas.
14. Trocar entre `/conversas`, `/etiquetas`, `/campanhas`, `/envios` e `/whatsapp`.
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

## Backlog recomendado

1. Aquecimento de numero por instancia.
2. Botao `Enviar teste para meu numero` antes de campanha.
3. Supressao automatica/opt-out centralizado.
4. Saude da instancia com falhas recentes, taxa de envio e ultima queda.
5. Duplicidade inteligente entre listas.
