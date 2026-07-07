import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSendStatsByContact } from "@/src/lib/server/contact-stats";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const source = searchParams.get("source");
  const optedOutParam = searchParams.get("optedOut");
  const search = searchParams.get("search")?.trim();
  const sendStatus = searchParams.get("sendStatus") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 25)));
  const optedOut =
    optedOutParam === "true" ? true : optedOutParam === "false" ? false : undefined;

  const where: Prisma.ContactWhereInput = {
    ...(source ? { source } : {}),
    ...(typeof optedOut === "boolean" ? { optedOut } : {}),
    ...(search
      ? {
          OR: [
            {
              name: {
                contains: search,
                mode: "insensitive"
              }
            },
            {
              phoneRaw: {
                contains: search,
                mode: "insensitive"
              }
            },
            {
              phoneNormalized: {
                contains: search,
                mode: "insensitive"
              }
            }
          ]
        }
      : {})
  };

  const [matchingContacts, origins] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        optedOut: true,
        phoneNormalized: true
      }
    }),
    prisma.contact.findMany({
      select: {
        source: true
      },
      distinct: ["source"],
      orderBy: {
        source: "asc"
      }
    })
  ]);
  const lastSendByContact = await getSendStatsByContact(
    matchingContacts.map((contact) => contact.id)
  );
  const matchingWithStatus = matchingContacts.map((contact) => {
    const lastSend = lastSendByContact.get(contact.id) ?? null;
    return {
      ...contact,
      sendStatus: lastSend?.status ?? "never_sent"
    };
  });
  const filteredContacts = sendStatus
    ? matchingWithStatus.filter((contact) => contact.sendStatus === sendStatus)
    : matchingWithStatus;
  const total = filteredContacts.length;
  const pageIds = filteredContacts
    .slice((page - 1) * pageSize, page * pageSize)
    .map((contact) => contact.id);
  const pageContacts = pageIds.length
    ? await prisma.contact.findMany({
        where: {
          id: {
            in: pageIds
          }
        }
      })
    : [];
  const pageOrder = new Map(pageIds.map((id, index) => [id, index]));
  const contacts = pageContacts
    .sort((left, right) => (pageOrder.get(left.id) ?? 0) - (pageOrder.get(right.id) ?? 0))
    .map((contact) => ({
      ...contact,
      lastSend: lastSendByContact.get(contact.id) ?? null
    }));
  const summary = filteredContacts.reduce(
    (accumulator, contact) => {
      accumulator.total += 1;
      if (contact.optedOut) accumulator.optedOut += 1;
      else accumulator.eligible += 1;
      if (contact.sendStatus === "sent") accumulator.sent += 1;
      if (contact.sendStatus === "failed") accumulator.failed += 1;
      if (contact.sendStatus === "pending") accumulator.pending += 1;
      if (contact.sendStatus === "never_sent") accumulator.neverSent += 1;
      return accumulator;
    },
    {
      total: 0,
      optedOut: 0,
      eligible: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      neverSent: 0
    }
  );

  return NextResponse.json({
    contacts,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    summary,
    origins: origins.map((origin) => origin.source)
  });
}
