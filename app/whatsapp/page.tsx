import { AppShell } from "@/app/components/AppShell";
import { WhatsappClient } from "./WhatsappClient";

export default function WhatsappPage() {
  return (
    <AppShell title="WhatsApp" subtitle="Conexao, catalogo e manutencao da instancia principal.">
      <WhatsappClient />
    </AppShell>
  );
}

