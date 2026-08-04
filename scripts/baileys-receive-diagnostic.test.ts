import assert from "node:assert/strict";
import test from "node:test";
import {
  countBaileysProcesses,
  createSocketWithLatestVersion,
  createStats,
  formatWebVersion,
  isProductionPath,
  resolveWebVersion,
  runVersionProbe,
  validateExecutionFlags,
  VERSION_PROBE_FAILURE_ERROR,
  VERSION_PROBE_TIMEOUT_ERROR
} from "./baileys-receive-diagnostic";

test("v6 diagnostic rejects clean mode and isolated misuse", () => {
  assert.throws(() => validateExecutionFlags({ mode: "clean", run: false, isolatedRun: false, isolatedPreflight: false }), /CLEAN_MODE/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: false, isolatedRun: true, isolatedPreflight: false }), /ISOLATED_RUN_REQUIRES_RUN/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: true, isolatedRun: true, isolatedPreflight: true }), /ISOLATED_RUN_CANNOT_COMBINE/);
  assert.doesNotThrow(() => validateExecutionFlags({ mode: "copy", run: false, isolatedRun: false, isolatedPreflight: false, versionProbeOnly: true }));
  assert.throws(() => validateExecutionFlags({ mode: "clean", run: false, isolatedRun: false, isolatedPreflight: false, versionProbeOnly: true }), /CLEAN_MODE/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: true, isolatedRun: false, isolatedPreflight: false, versionProbeOnly: true }), /VERSION_PROBE_CANNOT_RUN_SOCKET/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: false, isolatedRun: true, isolatedPreflight: false, versionProbeOnly: true }), /VERSION_PROBE_CANNOT_ISOLATE_RUN/);
  assert.throws(() => validateExecutionFlags({ mode: "copy", run: false, isolatedRun: false, isolatedPreflight: true, versionProbeOnly: true }), /VERSION_PROBE_CANNOT_ISOLATE_PREFLIGHT/);
});

test("version is fetched once, before socket creation, and passed through", async () => {
  let calls = 0;
  const order: string[] = [];
  const result = await createSocketWithLatestVersion({
    fetcher: async () => {
      calls += 1;
      order.push("fetch");
      return { version: [2, 24, 5], isLatest: true };
    },
    makeSocket: (version) => {
      order.push("socket");
      return version;
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.resolved.version, [2, 24, 5]);
  assert.deepEqual(result.socket, [2, 24, 5]);
  assert.deepEqual(order, ["fetch", "socket"]);
});

test("version failure prevents socket creation and has no fallback", async () => {
  let socketCalls = 0;
  await assert.rejects(
    createSocketWithLatestVersion({
      fetcher: async () => { throw new Error("network details must not escape"); },
      makeSocket: () => { socketCalls += 1; return true; }
    }),
    new RegExp(VERSION_PROBE_FAILURE_ERROR)
  );
  assert.equal(socketCalls, 0);
});

test("version timeout prevents socket creation", async () => {
  let socketCalls = 0;
  await assert.rejects(
    createSocketWithLatestVersion({
      fetcher: () => new Promise(() => undefined),
      timeoutMs: 100,
      makeSocket: () => { socketCalls += 1; return true; }
    }),
    new RegExp(VERSION_PROBE_TIMEOUT_ERROR)
  );
  assert.equal(socketCalls, 0);
});

test("version probe is network-only logic and never creates a socket", async () => {
  let calls = 0;
  const output: string[] = [];
  const code = await runVersionProbe(async () => {
    calls += 1;
    return { version: [2, 24, 5], isLatest: false };
  }, (line) => output.push(line), 1000);
  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.equal(output.length, 1);
  assert.match(output[0], /WA_WEB_VERSION_RESOLVED/);
  assert.match(output[0], /2\.24\.5/);
  assert.doesNotMatch(output[0], /creds|session|jid|phone|token|credential/i);
});

test("version formatting accepts only numeric triples", () => {
  assert.equal(formatWebVersion([2, 24, 5]), "2.24.5");
  assert.throws(() => formatWebVersion([2, -1, 5]), /WA_VERSION_FETCH_FAILED/);
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
