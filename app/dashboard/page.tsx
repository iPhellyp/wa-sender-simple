import { CampaignRecipientStatus } from "@prisma/client";
import { AppShell } from "@/app/components/AppShell";
import { ButtonLink } from "@/app/components/ui/ButtonLink";
import { EmptyState } from "@/app/components/ui/EmptyState";
import { SectionCard } from "@/app/components/ui/SectionCard";
import { StatCard } from "@/app/components/ui/StatCard";
import { StatusBadge, statusToneFromValue } from "@/app/components/ui/StatusBadge";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

function formatDateTime(value: Date | null | undefined) {
  return value ? dateTimeFormatter.format(value) : "Sem registro";
}

function maxDate(...dates: Array<Date | null | undefined>) {
  return dates.reduce<Date | null>((latest, date) => {
    if (!date) {
      return latest;
    }

    return !latest || date > latest ? date : latest;
  }, null);
}

function getRecipientLabel(recipient: {
  jid: string | null;
  contact: { name: string; phoneNormalized: string } | null;
}) {
  return recipient.contact?.name ?? recipient.contact?.phoneNormalized ?? recipient.jid ?? "Contato";
}

export default async function DashboardPage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const recentFailureWindow = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    whatsappSession,
    x1Chats,
    activeLabels,
    labeledContacts,
    totalCampaigns,
    sentToday,
    recentFailures,
    latestMessage,
    latestChatUpdate,
    latestContactUpdate,
    latestLabelUpdate,
    latestAssociationUpdate,
    latestCampaigns,
    latestRecipients
  ] = await Promise.all([
    prisma.whatsappSession.findUnique({
      where: {
        id: "default"
      }
    }),
    prisma.whatsappChat.count({
      where: {
        isGroup: false
      }
    }),
    prisma.whatsappLabel.count({
      where: {
        deleted: false
      }
    }),
    prisma.whatsappChatLabel.findMany({
      distinct: ["chatId"],
      where: {
        chat: {
          isGroup: false
        }
      },
      select: {
        chatId: true
      }
    }),
    prisma.campaign.count(),
    prisma.campaignRecipient.count({
      where: {
        status: CampaignRecipientStatus.sent,
        sentAt: {
          gte: startOfToday
        }
      }
    }),
    prisma.campaignRecipient.count({
      where: {
        status: CampaignRecipientStatus.failed,
        updatedAt: {
          gte: recentFailureWindow
        }
      }
    }),
    prisma.whatsappMessage.findFirst({
      orderBy: [
        {
          timestamp: {
            sort: "desc",
            nulls: "last"
          }
        },
        {
          createdAt: "desc"
        }
      ],
      select: {
        timestamp: true,
        createdAt: true
      }
    }),
    prisma.whatsappChat.findFirst({
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        updatedAt: true
      }
    }),
    prisma.whatsappContact.findFirst({
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        updatedAt: true
      }
    }),
    prisma.whatsappLabel.findFirst({
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        updatedAt: true
      }
    }),
    prisma.whatsappChatLabel.findFirst({
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        updatedAt: true
      }
    }),
    prisma.campaign.findMany({
      orderBy: {
        updatedAt: "desc"
      },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        targetMode: true,
        createdAt: true,
        updatedAt: true,
        targetLabel: {
          select: {
            name: true
          }
        },
        _count: {
          select: {
            recipients: true
          }
        }
      }
    }),
    prisma.campaignRecipient.findMany({
      where: {
        status: {
          in: [CampaignRecipientStatus.sent, CampaignRecipientStatus.failed]
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 5,
      select: {
        id: true,
        status: true,
        jid: true,
        sentAt: true,
        updatedAt: true,
        error: true,
        contact: {
          select: {
            name: true,
            phoneNormalized: true
          }
        },
        campaign: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  const whatsappStatus = whatsappSession?.status ?? "disconnected";
  const latestCatalogUpdate = maxDate(
    whatsappSession?.updatedAt,
    latestChatUpdate?.updatedAt,
    latestContactUpdate?.updatedAt,
    latestLabelUpdate?.updatedAt,
    latestAssociationUpdate?.updatedAt
  );
  const latestMessageAt = latestMessage?.timestamp ?? latestMessage?.createdAt ?? null;
  const alerts = [
    whatsappStatus !== "connected"
      ? {
          tone: "danger" as const,
          title: "WhatsApp desconectado",
          text: "Envios e sincronizacao dependem da instancia conectada."
        }
      : null,
    labeledContacts.length === 0
      ? {
          tone: "warning" as const,
          title: "Nenhuma etiqueta com contato",
          text: "Conecte o WhatsApp para carregar contatos e etiquetas automaticamente."
        }
      : null,
    recentFailures > 0
      ? {
          tone: "warning" as const,
          title: "Campanhas com falhas recentes",
          text: `${recentFailures} falha(s) registradas nas ultimas 24 horas.`
        }
      : null
  ].filter(
    (
      alert
    ): alert is {
      tone: "danger" | "warning";
      title: string;
      text: string;
    } => Boolean(alert)
  );

  return (
    <AppShell
      title="Dashboard"
      subtitle="Visao operacional de conversas, etiquetas e campanhas."
    >
      <section className="dashboard-page">
        <div className="dashboard-hero">
          <div>
            <h2>Operacao de envio por etiquetas</h2>
            <p>
              Acompanhe conexao, contatos individuais, etiquetas e desempenho recente de campanhas em
              uma tela de trabalho.
            </p>
          </div>
          <div className="dashboard-hero-status">
            <StatusBadge tone={statusToneFromValue(whatsappStatus)}>{whatsappStatus}</StatusBadge>
            <span className="muted">Atualizado {formatDateTime(whatsappSession?.updatedAt)}</span>
          </div>
        </div>

        <section className="grid stats-grid">
          <StatCard
            label="WhatsApp status"
            value={whatsappStatus}
            helper={whatsappSession?.connectedPhone ?? "Instancia principal"}
            tone={statusToneFromValue(whatsappStatus)}
          />
          <StatCard label="Contatos WhatsApp" value={x1Chats} helper="Conversas individuais" />
          <StatCard label="Etiquetas ativas" value={activeLabels} helper="Disponiveis para campanha" />
          <StatCard
            label="Contatos etiquetados"
            value={labeledContacts.length}
            helper="Contatos individuais com ao menos uma etiqueta"
          />
          <StatCard label="Campanhas totais" value={totalCampaigns} helper="Criadas no sistema" />
          <StatCard label="Enviados hoje" value={sentToday} helper="Destinatarios enviados" tone="success" />
          <StatCard
            label="Falhas recentes"
            value={recentFailures}
            helper="Ultimas 24 horas"
            tone={recentFailures > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Ultima sincronizacao"
            value={formatDateTime(latestCatalogUpdate)}
            helper={`Ultima mensagem salva: ${formatDateTime(latestMessageAt)}`}
            tone="info"
          />
        </section>

        <SectionCard title="Acoes rapidas" description="Atalhos para as rotinas operacionais mais comuns.">
          <div className="quick-actions-grid">
            <ButtonLink href="/conversas" variant="secondary">
              Ver conversas
            </ButtonLink>
            <ButtonLink href="/campanhas" variant="secondary">
              Criar campanha
            </ButtonLink>
            <ButtonLink href="/contatos" variant="secondary">
              Importar contatos
            </ButtonLink>
          </div>
          <div className="message">
            A sincronizacao de contatos e etiquetas ocorre automaticamente ao conectar o WhatsApp.
          </div>
        </SectionCard>

        <div className="dashboard-panels">
          <SectionCard title="Ultimas campanhas">
            {latestCampaigns.length > 0 ? (
              <div className="list-stack">
                {latestCampaigns.map((campaign) => (
                  <article className="list-row" key={campaign.id}>
                    <div>
                      <div className="list-row-title">{campaign.name}</div>
                      <div className="row-meta">
                        <span>{campaign.targetMode === "label" ? "Por etiqueta" : "Manual"}</span>
                        {campaign.targetLabel ? <span>{campaign.targetLabel.name}</span> : null}
                        <span>{campaign._count.recipients} destinatarios</span>
                        <span>{formatDateTime(campaign.updatedAt)}</span>
                      </div>
                    </div>
                    <StatusBadge tone={statusToneFromValue(campaign.status)}>
                      {campaign.status}
                    </StatusBadge>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhuma campanha criada"
                description="Crie uma campanha manual ou por etiqueta para comecar."
                actions={<ButtonLink href="/campanhas">Criar campanha</ButtonLink>}
              />
            )}
          </SectionCard>

          <SectionCard title="Alertas operacionais">
            {alerts.length > 0 ? (
              <div className="alert-list">
                {alerts.map((alert) => (
                  <div className={`alert-item ${alert.tone}`} key={alert.title}>
                    <strong>{alert.title}</strong>
                    <span>{alert.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="alert-item success">
                <strong>Sem alertas crÃ­ticos</strong>
                <span>Conexao, etiquetas e campanhas nao indicam bloqueios operacionais agora.</span>
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard title="Ultimos envios">
          {latestRecipients.length > 0 ? (
            <div className="list-stack">
              {latestRecipients.map((recipient) => (
                <article className="list-row" key={recipient.id}>
                  <div>
                    <div className="list-row-title">{getRecipientLabel(recipient)}</div>
                    <div className="row-meta">
                      <span>{recipient.campaign.name}</span>
                      <span>{formatDateTime(recipient.sentAt ?? recipient.updatedAt)}</span>
                      {recipient.error ? <span>{recipient.error}</span> : null}
                    </div>
                  </div>
                  <StatusBadge tone={statusToneFromValue(recipient.status)}>
                    {recipient.status}
                  </StatusBadge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum envio recente"
              description="Os envios aparecerÃ£o aqui quando campanhas comecarem a rodar."
            />
          )}
        </SectionCard>
      </section>
    </AppShell>
  );
}


