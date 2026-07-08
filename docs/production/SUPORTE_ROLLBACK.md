# Suporte e rollback

## Checklist de suporte

- Verificar instancia ativa.
- Verificar status da instancia.
- Verificar QR.
- Verificar telefone conectado.
- Verificar ultimo erro.
- Verificar se existe sessao salva.
- Se houver sessao salva, usar Retomar sessao em `/instancias` antes de reset.
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

## Backup e restauracao

- Banco: criar backup antes do deploy e antes de rollback.
- Sessao Baileys: copiar a pasta `data/baileys-session` ou volume equivalente antes de resetar.
- Para restaurar sessao, parar servicos, restaurar pasta/volume e subir novamente com deploy seguro.

## Nao fazer em producao

- Nao resetar sessao sem backup quando o numero ainda aparece conectado no celular.
- Nao usar `docker volume prune`.
- Nao usar `docker system prune --volumes`.
- Nao usar `prisma migrate reset`.
- Nao usar `prisma db push`.
- Nao apagar `data/baileys-session`.
- Nao apagar `/app/data`.
