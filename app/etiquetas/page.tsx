import { Suspense } from "react";
import { AppShell } from "@/app/components/AppShell";
import { LabelsClient } from "./LabelsClient";

export default function LabelsPage() {
  return (
    <AppShell
      title="Segmentos WhatsApp"
      subtitle="Etiquetas sincronizadas, contatos individuais elegiveis e historico de campanha por segmento."
    >
      <Suspense fallback={<div>Carregando etiquetas...</div>}>
      <LabelsClient />
    </Suspense>
    </AppShell>
  );
}

