import { AppShell } from "@/app/components/AppShell";
import { LabelsClient } from "./LabelsClient";

export default function LabelsPage() {
  return (
    <AppShell
      title="Segmentos WhatsApp"
      subtitle="Etiquetas sincronizadas, contatos individuais elegiveis e historico de campanha por segmento."
    >
      <LabelsClient />
    </AppShell>
  );
}
