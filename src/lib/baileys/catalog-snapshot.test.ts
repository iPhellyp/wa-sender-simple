import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("catalog-full limpa versões app-state da instância secundária antes do resync", async () => {
  const source = await readFile(
    new URL("./instance-manager.ts", import.meta.url),
    "utf8"
  );

  const start = source.indexOf(
    "export async function requestWhatsappCatalogSyncForInstance"
  );
  const end = source.indexOf(
    "\nexport async function",
    start + 1
  );
  const block = source.slice(
    start,
    end > start ? end : source.length
  );

  const resetIndex = block.indexOf(
    "clearInstanceCatalogAppStateVersionsForSnapshot"
  );
  const resyncIndex = block.indexOf(
    "await resyncAppState(CATALOG_APP_STATE_COLLECTIONS, true)"
  );

  assert.ok(resetIndex >= 0);
  assert.ok(resyncIndex >= 0);
  assert.ok(resetIndex < resyncIndex);
  assert.match(
    source,
    /"app-state-sync-version": resetVersions/
  );
});