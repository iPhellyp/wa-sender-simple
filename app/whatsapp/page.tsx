import { AppShell } from "@/app/components/AppShell";
import { WhatsappClient } from "./WhatsappClient";

export default function WhatsappPage() {
  return (
    <AppShell title="WhatsApp" subtitle="Conexão, catálogo e manutenção da instância principal.">
      <WhatsappClient />
    </AppShell>
  );
}
