import type { WhatsappInstanceRole } from "@prisma/client";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { parseCreateInstanceBody } from "@/src/lib/internal-api/schemas";
import {
  createInternalInstance,
  listInternalInstances
} from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalApi(async () =>
  internalJson({ instances: await listInternalInstances() })
);

export const POST = withInternalApi(
  async (request) => {
    const payload = parseCreateInstanceBody(await request.json().catch(() => null));
    const result = await createInternalInstance(
      payload.name,
      payload.role as WhatsappInstanceRole
    );
    return internalJson(result, result.created ? 201 : 200);
  },
  { idempotent: true }
);
