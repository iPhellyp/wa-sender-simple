import { AppShell } from "@/app/components/AppShell";
import { InstancesClient } from "./InstancesClient";

export default function InstancesPage() {
  return (
    <AppShell
      title="Instancias"
      subtitle="Gerencie numeros WhatsApp separados por funcao operacional."
    >
      <InstancesClient />
    </AppShell>
  );
}
