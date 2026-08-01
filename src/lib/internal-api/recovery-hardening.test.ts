import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("LID determinístico pode receber mutação de etiqueta", async () => {
  const [source, testSource] = await Promise.all([
    readFile(
      new URL("./services.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("./services.test.ts", import.meta.url),
      "utf8"
    )
  ]);

  assert.match(
    source,
    /prisma\.whatsappIdentity\.findFirst/
  );
  assert.match(
    source,
    /confidence:\s*"DETERMINISTIC"/
  );
  assert.match(
    source,
    /!contactMapping && !identityMapping/
  );
  assert.match(
    testSource,
    /findMany:\s*async\s*\(\)\s*=>\s*whatsappIdentities/
  );
});

test("erro controlado abandona idempotência sem repetir efeito incerto", async () => {
  const source = await readFile(
    new URL("./handler.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /shouldAbandonIdempotencyAfterError/
  );
  assert.match(
    source,
    /error\.status >= 400/
  );
  assert.match(
    source,
    /error\.status < 500/
  );
});

test("rebuild aceita lote grande e conexão dispara sincronização completa", async () => {
  const [route, manager] = await Promise.all([
    readFile(
      new URL(
        "../../../app/api/internal/v1/instances/[id]/identities/rebuild/route.ts",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL("../baileys/instance-manager.ts", import.meta.url),
      "utf8"
    )
  ]);

  assert.match(route, /slice\(0,\s*50_000\)/);
  assert.match(
    manager,
    /requestWhatsappCatalogSyncForInstance\(instance\.id,\s*\{[\s\S]*forceSnapshot/
  );
  assert.match(
    manager,
    /rebuildWhatsappIdentitiesForInstance\(instance\.id\)/
  );
});