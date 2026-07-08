# Suporte e rollback

## Checklist de suporte

- Verificar instancia ativa.
- Verificar status da instancia.
- Verificar QR.
- Verificar telefone conectado.
- Verificar ultimo erro.
- Verificar logs do app e worker.
- Verificar fila Redis.
- Verificar Postgres.
- Confirmar que a acao recebeu `instanceId` correto.

## Rollback manual sugerido

Nao executar sem validar backup e janela de manutencao.

```bash
cd /root/wa-sender-simple
git log -1
git checkout <commit-estavel>
./deploy-safe.sh
```

Antes de rollback, validar backup do banco e backup da pasta de sessoes WhatsApp.
