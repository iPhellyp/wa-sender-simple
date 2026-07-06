import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const source = searchParams.get("source");
  const optedOutParam = searchParams.get("optedOut");
  const optedOut =
    optedOutParam === "true" ? true : optedOutParam === "false" ? false : undefined;

  const where = {
    ...(source ? { source } : {}),
    ...(typeof optedOut === "boolean" ? { optedOut } : {})
  };

  const [contacts, total, origins] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      take: 500
    }),
    prisma.contact.count({ where }),
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

  return NextResponse.json({
    contacts,
    total,
    origins: origins.map((origin) => origin.source)
  });
}
