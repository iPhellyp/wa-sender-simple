import { AppShell } from "@/app/components/AppShell";
import { LabelsClient } from "./LabelsClient";

export default function LabelsPage() {
  return (
    <AppShell
      title="Segmentos WhatsApp"
      subtitle="Etiquetas sincronizadas, contatos X1 elegíveis e histórico de campanha por segmento."
    >
      <LabelsClient />
    </AppShell>
  );
}
