import { AppShell } from "@/app/components/AppShell";
import { WhatsappClient } from "./WhatsappClient";

export default function WhatsappPage() {
  return (
    <AppShell title="WhatsApp">
      <WhatsappClient />
    </AppShell>
  );
}
