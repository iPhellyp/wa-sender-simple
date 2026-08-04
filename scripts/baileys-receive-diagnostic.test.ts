import assert from "node:assert/strict";
import test from "node:test";
import { countBaileysProcesses, createStats, isProductionPath, validateExecutionFlags } from "./baileys-receive-diagnostic";

test("v6 diagnostic rejects clean mode and isolated misuse", () => {
  assert.throws(() => validateExecutionFlags({ mode: "clean", run: false, isolatedRun: false, isolatedPreflight: false }), /CLEAN_MODE/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: false, isolatedRun: true, isolatedPreflight: false }), /ISOLATED_RUN_REQUIRES_RUN/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: true, isolatedRun: true, isolatedPreflight: true }), /ISOLATED_RUN_CANNOT_COMBINE/);
});

test("production session paths are rejected by the same guard used by the copy", () => {
  assert.equal(isProductionPath("/app/data/baileys-session"), true);
  assert.equal(isProductionPath("/root/lab/session-copy"), false);
});

test("process scan excludes the diagnostic itself and tsx", () => {
  const table = [
    "10 node sender-worker.ts",
    "11 node_modules/@whiskeysockets/baileys/lib/index.js",
    "12 node --import tsx scripts/baileys-receive-diagnostic.ts",
    "13 node app.js"
  ].join("\n");
  assert.equal(countBaileysProcesses(table, 999), 2);
});

test("stats begin empty and do not retain message content", () => {
  const stats = createStats();
  assert.deepEqual(stats, {
    connectionUpdates: 0,
    connectionOpen: 0,
    connectionClose: 0,
    qrObserved: 0,
    credsUpdates: 0,
    messagesUpsert: 0,
    messagesCount: 0,
    badMac: 0,
    decryptionErrors: 0
  });
});
