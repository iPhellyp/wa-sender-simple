import { CampaignRecipientStatus } from "@prisma/client";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [whatsappSession, totalContacts, optedOutContacts, totalCampaigns, sentMessages, failedMessages] =
    await Promise.all([
      prisma.whatsappSession.findUnique({
        where: {
          id: "default"
        }
      }),
      prisma.contact.count(),
      prisma.contact.count({
        where: {
          optedOut: true
        }
      }),
      prisma.campaign.count(),
      prisma.campaignRecipient.count({
        where: {
          status: CampaignRecipientStatus.sent
        }
      }),
      prisma.campaignRecipient.count({
        where: {
          status: CampaignRecipientStatus.failed
        }
      })
    ]);

  return (
    <AppShell title="Dashboard">
      <section className="grid stats-grid">
        <article className="card">
          <div className="muted">WhatsApp</div>
          <div className="stat-value">{whatsappSession?.status ?? "disconnected"}</div>
        </article>
        <article className="card">
          <div className="muted">Total contatos</div>
          <div className="stat-value">{totalContacts}</div>
        </article>
        <article className="card">
          <div className="muted">Opt-out</div>
          <div className="stat-value">{optedOutContacts}</div>
        </article>
        <article className="card">
          <div className="muted">Campanhas</div>
          <div className="stat-value">{totalCampaigns}</div>
        </article>
        <article className="card">
          <div className="muted">Mensagens enviadas</div>
          <div className="stat-value">{sentMessages}</div>
        </article>
        <article className="card">
          <div className="muted">Mensagens com falha</div>
          <div className="stat-value">{failedMessages}</div>
        </article>
      </section>
    </AppShell>
  );
}
