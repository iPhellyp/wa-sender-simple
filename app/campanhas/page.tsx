import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import { CampaignsClient } from "./CampaignsClient";

type ChatPreview = {
  id: string;
  jid: string;
  name: string | null;
};

type ContactPreview = {
  id: string;
  name: string;
  phoneNormalized: string;
  source: string;
  optedOut: boolean;
};

type CampaignsPageProps = {
  searchParams?: Promise<{
    labelId?: string | string[];
    chatIds?: string | string[];
    contactIds?: string | string[];
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
  const contactIds = (pickSingle(resolvedSearchParams?.contactIds) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
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
  const [labels, chatPreview, contactPreview] = await Promise.all([
    prisma.whatsappLabel.findMany({
      where: {
        deleted: false
      },
      orderBy: {
        name: "asc"
      },
      select: {
        id: true,
        name: true,
        color: true
      }
    }),
    chatIds.length
      ? prisma.whatsappChat.findMany({
          where: {
            id: {
              in: chatIds
            },
            isGroup: false
          },
          orderBy: {
            name: "asc"
          },
          select: {
            id: true,
            jid: true,
            name: true
          }
        })
      : Promise.resolve([] as ChatPreview[]),
    contactIds.length
      ? prisma.contact.findMany({
          where: {
            id: {
              in: contactIds
            },
            optedOut: false
          },
          orderBy: {
            name: "asc"
          },
          select: {
            id: true,
            name: true,
            phoneNormalized: true,
            source: true,
            optedOut: true
          }
        })
      : Promise.resolve([] as ContactPreview[])
  ]);

  return (
    <AppShell title="Campanhas">
      <CampaignsClient
        prefillContext={{
          labelId: label?.id ?? (labelId || null),
          labelName: label?.name ?? null,
          chatIds,
          chatPreview,
          contactIds,
          contactPreview
        }}
        labels={labels}
      />
    </AppShell>
  );
}
