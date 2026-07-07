import { AppShell } from "@/app/components/AppShell";
import { LabelsClient } from "./LabelsClient";

export default function LabelsPage() {
  return (
    <AppShell title="Etiquetas WhatsApp">
      <LabelsClient />
    </AppShell>
  );
}
