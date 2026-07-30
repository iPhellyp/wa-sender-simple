import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runWhatsappWatchdogCycle } from "./watchdog";

test("watchdog retoma automaticamente sessão recuperável desconectada", async () => {
  const resumed: string[] = [];
  await runWhatsappWatchdogCycle({
    listInstances: async () => [{ id: "instance-1" }],
    getStatus: async () => ({
      status: "disconnected",
      isRecoverableSession: true,
      autoReconnectDisabled: false
    }),
    resume: async (id) => resumed.push(id)
  });
  assert.deepEqual(resumed, ["instance-1"]);
});

test("watchdog não duplica socket enquanto a verificação da instância está ativa", async () => {
  let releasesResume!: () => void;
  let resumes = 0;
  const dependencies = {
    listInstances: async () => [{ id: "instance-1" }],
    getStatus: async () => ({ status: "disconnected", isRecoverableSession: true }),
    resume: async () => {
      resumes += 1;
      await new Promise<void>((resolve) => {
        releasesResume = resolve;
      });
    }
  };
  const first = runWhatsappWatchdogCycle(dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  await runWhatsappWatchdogCycle(dependencies);
  assert.equal(resumes, 1);
  releasesResume();
  await first;
});

test("watchdog respeita logout/manual disconnect e backoff", async () => {
  let resumes = 0;
  await runWhatsappWatchdogCycle({
    listInstances: async () => [{ id: "logged-out" }, { id: "backoff" }],
    getStatus: async (id) => id === "logged-out"
      ? { status: "disconnected", isRecoverableSession: true, autoReconnectDisabled: true }
      : {
        status: "disconnected",
        isRecoverableSession: true,
        nextReconnectAt: new Date(20_000).toISOString()
      },
    resume: async () => {
      resumes += 1;
    },
    now: () => 10_000
  });
  assert.equal(resumes, 0);
});

test("reabertura solicita quick limitado e nunca envia mensagem", async () => {
  const source = await readFile(new URL("./instance-manager.ts", import.meta.url), "utf8");
  const openHandler = source.slice(
    source.indexOf('if (update.connection === "open")'),
    source.indexOf('if (update.connection === "close")')
  );
  assert.match(openHandler, /AUTO_QUICK_SYNC_COOLDOWN_MS/);
  assert.match(openHandler, /requestWhatsappCatalogSyncForInstance\(instance\.id\)/);
  assert.doesNotMatch(openHandler, /sendMessage|sendWhatsapp/);
});
