import { AppShell } from "@/app/components/AppShell";
import { LabelDetailClient } from "./LabelDetailClient";

type LabelDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function LabelDetailPage({ params }: LabelDetailPageProps) {
  const { id } = await params;

  return (
    <AppShell title="Segmento WhatsApp" subtitle="Contatos individuais vinculados a etiqueta e prontos para campanha.">
      <LabelDetailClient labelId={id} />
    </AppShell>
  );
}
