import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import { CampaignsClient } from "./CampaignsClient";

type CampaignsPageProps = {
  searchParams?: Promise<{
    labelId?: string | string[];
    chatIds?: string | string[];
  }>;
};

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CampaignsPage({ searchParams }: CampaignsPageProps) {
  const resolvedSearchParams = await searchParams;
  const labelId = pickSingle(resolvedSearchParams?.labelId)?.trim() ?? "";
  const chatIds = (pickSingle(resolvedSearchParams?.chatIds) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const label = labelId
    ? await prisma.whatsappLabel.findFirst({
        where: {
          id: labelId,
          deleted: false
        },
        select: {
          id: true,
          name: true
        }
      })
    : null;

  return (
    <AppShell title="Campanhas">
      <CampaignsClient
        prefillContext={{
          labelId: label?.id ?? (labelId || null),
          labelName: label?.name ?? null,
          chatIds
        }}
      />
    </AppShell>
  );
}
