import { prisma } from "@/src/lib/prisma/client";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { getInternalApiRedis } from "@/src/lib/internal-api/redis";
import { internalJson } from "@/src/lib/internal-api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalApi(async (_request, context) => {
  let database: "healthy" | "unavailable" = "healthy";
  let redis: "healthy" | "unavailable" = "healthy";

  await prisma.$queryRaw`SELECT 1`.catch(() => {
    database = "unavailable";
  });
  await getInternalApiRedis().ping().catch(() => {
    redis = "unavailable";
  });

  const status = database === "healthy" && redis === "healthy" ? "healthy" : "unavailable";
  return internalJson(
    {
      status,
      application: "healthy",
      database,
      redis,
      worker: "unknown",
      timestamp: new Date().toISOString(),
      requestId: context.requestId
    },
    status === "healthy" ? 200 : 503
  );
});
