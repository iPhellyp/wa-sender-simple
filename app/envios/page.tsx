import { AppShell } from "@/app/components/AppShell";
import { EnviosClient } from "./EnviosClient";

type EnviosPageProps = {
  searchParams?: Promise<{
    campaign?: string | string[];
  }>;
};

export default async function EnviosPage({ searchParams }: EnviosPageProps) {
  const resolved = await searchParams;
  const rawCampaign = resolved?.campaign;
  const selectedCampaignId = Array.isArray(rawCampaign) ? rawCampaign[0] : rawCampaign;

  return (
    <AppShell title="Envios">
      <EnviosClient selectedCampaignId={selectedCampaignId ?? null} />
    </AppShell>
  );
}
