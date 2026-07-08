import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
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
  const rawInstanceId = resolved?.instanceId;
  const instanceId = Array.isArray(rawInstanceId) ? rawInstanceId[0] : rawInstanceId;

  return (
    <AppShell
      title="Envios"
      subtitle="Auditoria de campanhas, destinatarios, falhas e pendencias."
      actions={
        <Link className="button" href={instanceId ? `/campanhas?instanceId=${instanceId}` : "/campanhas"}>
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

