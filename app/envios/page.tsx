import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { InstanceNotFoundMessage } from "@/app/components/InstanceNotFoundMessage";
import {
  getActiveInstanceIdFromSearchOrDefault,
  isWhatsappInstanceNotFoundError
} from "@/src/lib/server/whatsapp-instances";
import { EnviosClient } from "./EnviosClient";

type EnviosPageProps = {
  searchParams?: Promise<{
    campaign?: string | string[];
    campaignId?: string | string[];
    instanceId?: string | string[];
  }>;
};

export default async function EnviosPage({ searchParams }: EnviosPageProps) {
  const resolved = await searchParams;
  const rawCampaign = resolved?.campaign ?? resolved?.campaignId;
  const selectedCampaignId = Array.isArray(rawCampaign) ? rawCampaign[0] : rawCampaign;
  let instanceId: string;

  try {
    instanceId = await getActiveInstanceIdFromSearchOrDefault(resolved);
  } catch (error) {
    if (isWhatsappInstanceNotFoundError(error)) {
      return (
        <AppShell title="Envios" subtitle="Auditoria de campanhas, destinatarios, falhas e pendencias.">
          <InstanceNotFoundMessage />
        </AppShell>
      );
    }

    throw error;
  }

  return (
    <AppShell
      title="Envios"
      subtitle="Auditoria de campanhas, destinatarios, falhas e pendencias."
      actions={
        <Link className="button" href={`/campanhas?instanceId=${instanceId}`}>
          Criar campanha
        </Link>
      }
    >
      <Suspense fallback={<div className="data-card empty-state compact">Carregando envios...</div>}>
        <EnviosClient selectedCampaignId={selectedCampaignId ?? null} />
      </Suspense>
    </AppShell>
  );
}
