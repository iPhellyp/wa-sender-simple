import { AppShell } from "@/app/components/AppShell";
import { ContactsClient } from "./ContactsClient";

export default function ContactsPage() {
  return (
    <AppShell title="Contatos">
      <ContactsClient />
    </AppShell>
  );
}
