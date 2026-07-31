import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (relative: string) => readFile(new URL(relative, root), "utf8");

test("modo de conexão chega da API até o worker", async () => {
  const [services, queue, worker] = await Promise.all([
    read("src/lib/internal-api/services.ts"),
    read("src/lib/queue/campaign-queue.ts"),
    read("src/worker/sender-worker.ts")
  ]);
  assert.match(services, /enqueueWhatsappConnect\(instanceId, mode\)/);
  assert.match(queue, /\{ instanceId: normalizedInstanceId, mode \}/);
  assert.match(worker, /mode === "new_qr"/);
  assert.match(worker, /before\.hasRegisteredSession \|\| before\.hasMeId/);
});

test("exclusão interna é serializada no worker", async () => {
  const [route, services, worker, manager] = await Promise.all([
    read("app/api/internal/v1/instances/[id]/route.ts"),
    read("src/lib/internal-api/services.ts"),
    read("src/worker/sender-worker.ts"),
    read("src/lib/baileys/instance-manager.ts")
  ]);
  assert.match(route, /export async function DELETE/);
  assert.match(services, /enqueueWhatsappInstanceDelete/);
  assert.match(worker, /DELETE_WHATSAPP_INSTANCE_JOB/);
  assert.match(manager, /export async function deleteWhatsappInstance/);
});

test("new_qr preserva a proteção de sessão confirmada", async () => {
  const services = await read("src/lib/internal-api/services.ts");
  assert.match(services, /mode === "new_qr" && hasConfirmedSession/);
  assert.match(services, /INSTANCE_STATE_CONFLICT/);
  assert.match(services, /enqueueWhatsappConnect\(instanceId, mode\)/);
});
