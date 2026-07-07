import { AppShell } from "@/app/components/AppShell";
import { ContactsClient } from "./ContactsClient";

export default function ContactsPage() {
  return (
    <AppShell title="Contatos" subtitle="Base operacional para campanhas, etiquetas e importacoes.">
      <ContactsClient />
    </AppShell>
  );
}
