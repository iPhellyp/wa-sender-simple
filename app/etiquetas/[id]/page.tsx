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
    <AppShell title="Detalhe da etiqueta">
      <LabelDetailClient labelId={id} />
    </AppShell>
  );
}
