import { NextRequest, NextResponse } from "next/server";
import { CampaignRecipientStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function countRecipientsByStatus(
  recipients: Array<{
    status: CampaignRecipientStatus;
  }>
) {
  return recipients.reduce<Record<string, number>>((accumulator, recipient) => {
    accumulator[recipient.status] = (accumulator[recipient.status] ?? 0) + 1;
    return accumulator;
  }, {});
}

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    include: {
      recipients: {
        select: {
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      recipientCount: campaign.recipients.length,
      recipientStatusCounts: countRecipientsByStatus(campaign.recipients)
    }))
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    name?: string;
    defaultMessage?: string | null;
    intervalMinutes?: number;
    contactIds?: string[];
  };

  const name = String(payload.name ?? "").trim();
  const defaultMessage = String(payload.defaultMessage ?? "").trim();
  const intervalMinutes = Number(payload.intervalMinutes ?? 0);
  const contactIds = Array.isArray(payload.contactIds) ? payload.contactIds : [];

  if (!name) {
    return NextResponse.json({ error: "Nome da campanha obrigatorio" }, { status: 400 });
  }

  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    return NextResponse.json(
      { error: "Intervalo deve ser inteiro e maior ou igual a 1 minuto" },
      { status: 400 }
    );
  }

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um contato" }, { status: 400 });
  }

  const contacts = await prisma.contact.findMany({
    where: {
      id: {
        in: contactIds
      },
      optedOut: false
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (contacts.length === 0) {
    return NextResponse.json(
      { error: "Nenhum contato valido selecionado ou todos estao opt-out" },
      { status: 400 }
    );
  }

  if (!defaultMessage && contacts.some((contact) => !contact.message?.trim())) {
    return NextResponse.json(
      {
        error:
          "Informe mensagem padrao ou selecione apenas contatos com mensagem individual na planilha"
      },
      { status: 400 }
    );
  }

  const campaign = await prisma.campaign.create({
    data: {
      name,
      defaultMessage: defaultMessage || null,
      intervalMinutes,
      recipients: {
        create: contacts.map((contact) => ({
          contactId: contact.id,
          messageFinal: defaultMessage || contact.message?.trim() || ""
        }))
      }
    },
    include: {
      recipients: true
    }
  });

  return NextResponse.json(campaign, { status: 201 });
}
