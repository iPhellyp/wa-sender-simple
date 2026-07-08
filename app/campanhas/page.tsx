import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";
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
    instanceId?: string | string[];
  }>;
};

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CampaignsPage({ searchParams }: CampaignsPageProps) {
  const resolvedSearchParams = await searchParams;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(resolvedSearchParams);
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
          instanceId,
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
        instanceId,
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
            instanceId,
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
            instanceId,
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
    <AppShell
      title="Nova campanha"
      subtitle="Escolha o publico, escreva a mensagem e revise antes de enviar."
      actions={
        <Link className="button secondary" href={`/envios?instanceId=${instanceId}`}>
          Historico de envios
        </Link>
      }
    >
      <CampaignsClient
        prefillContext={{
          labelId: label?.id ?? (labelId || null),
          labelName: label?.name ?? null,
          instanceId,
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
