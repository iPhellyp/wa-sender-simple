import { AppShell } from "@/app/components/AppShell";
import { LabelSendClient } from "./LabelSendClient";

type LabelSendPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function LabelSendPage({ params }: LabelSendPageProps) {
  const { id } = await params;

  return (
    <AppShell title="Envio por etiqueta">
      <LabelSendClient labelId={id} />
    </AppShell>
  );
}
