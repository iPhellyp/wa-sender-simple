import { AppShell } from "@/app/components/AppShell";
import { CampaignsClient } from "./CampaignsClient";

export default function CampaignsPage() {
  return (
    <AppShell title="Campanhas">
      <CampaignsClient />
    </AppShell>
  );
}
