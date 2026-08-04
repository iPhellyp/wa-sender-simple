import { execFileSync } from "node:child_process";
import { lstat, realpath, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import pino from "pino";
import type { BaileysEventMap } from "@whiskeysockets/baileys";

export type DiagnosticStats = {
  connectionUpdates: number;
  connectionOpen: number;
  connectionClose: number;
  qrObserved: number;
  credsUpdates: number;
  messagesUpsert: number;
  messagesCount: number;
  badMac: number;
  decryptionErrors: number;
};

export const CLEAN_MODE_ERROR = "CLEAN_MODE_REQUIRES_SEPARATE_QR_AUTHORIZATION";
export const UNEXPECTED_QR_ERROR = "UNEXPECTED_QR_FROM_SESSION_COPY";

const PRODUCTION_PATHS = [
  "/app/data/baileys-session",
  "/var/lib/docker/volumes/wa-sender-simple_baileys_session",
  "wa-sender-simple_baileys_session",
  "production-session"
];

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function isProductionPath(value: string) {
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  return PRODUCTION_PATHS.some((part) => normalized.includes(part));
}

export function validateExecutionFlags(input: {
  mode: "copy" | "clean";
  run: boolean;
  isolatedRun: boolean;
  isolatedPreflight: boolean;
}) {
  if (input.mode === "clean") throw new Error(CLEAN_MODE_ERROR);
  if (input.isolatedRun && !input.run) throw new Error("ISOLATED_RUN_REQUIRES_RUN");
  if (input.isolatedRun && input.isolatedPreflight) {
    throw new Error("ISOLATED_RUN_CANNOT_COMBINE_WITH_ISOLATED_PREFLIGHT");
  }
}

export function createStats(): DiagnosticStats {
  return {
    connectionUpdates: 0,
    connectionOpen: 0,
    connectionClose: 0,
    qrObserved: 0,
    credsUpdates: 0,
    messagesUpsert: 0,
    messagesCount: 0,
    badMac: 0,
    decryptionErrors: 0
  };
}

async function assertNoSymlinkPath(value: string) {
  const absolute = resolve(value);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("SYMLINK_PATH_REJECTED");
  }
}

async function countFiles(value: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(value, { withFileTypes: true })) {
    const child = join(value, entry.name);
    count += entry.isDirectory() ? await countFiles(child) : entry.isFile() ? 1 : 0;
  }
  return count;
}

export async function validateCopyDirectory(value: string) {
  if (!isAbsolute(value)) throw new Error("SESSION_PATH_MUST_BE_ABSOLUTE");
  if (isProductionPath(value)) throw new Error("PRODUCTION_SESSION_PATH_REJECTED");
  await assertNoSymlinkPath(value);
  const real = await realpath(value);
  if (isProductionPath(real)) throw new Error("PRODUCTION_SESSION_PATH_REJECTED");
  const info = await stat(real);
  if (!info.isDirectory()) throw new Error("SESSION_PATH_MUST_BE_DIRECTORY");
  const creds = await stat(join(real, "creds.json")).catch(() => null);
  if (!creds?.isFile()) throw new Error("CREDS_JSON_REQUIRED");
  return {
    path: value,
    realPath: real,
    fileCount: await countFiles(real),
    mode: (info.mode & 0o777).toString(8).padStart(3, "0"),
    uid: typeof info.uid === "number" ? info.uid : null,
    gid: typeof info.gid === "number" ? info.gid : null
  };
}

export function countBaileysProcesses(processTable: string, currentPid = process.pid) {
  return processTable.split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith(String(currentPid)))
    .filter((line) => !/receive-diagnostic|node_modules[\\/]tsx/i.test(line))
    .filter((line) => /sender-worker|node_modules[\\/]@whiskeysockets[\\/]baileys/i.test(line))
    .length;
}

class SanitizedSink extends Writable {
  private pending = "";
  readonly stats = { badMac: 0, decryptionErrors: 0 };

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.pending += chunk.toString("utf8");
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as { msg?: unknown; err?: { message?: unknown } };
        const text = [record.msg, record.err?.message].filter((v): v is string => typeof v === "string").join(" ");
        if (/bad mac/i.test(text)) this.stats.badMac += 1;
        if (/decrypt|decryption|cipher/i.test(text)) this.stats.decryptionErrors += 1;
      } catch {
        // Never print or retain library log content.
      }
    }
    done();
  }
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const output = (error as { output?: { statusCode?: unknown } }).output;
  return typeof output?.statusCode === "number" ? output.statusCode : null;
}

function durationSeconds() {
  const value = Number(arg("--duration-sec") ?? "120");
  if (!Number.isInteger(value) || value < 1 || value > 3600) {
    throw new Error("duration-sec must be an integer between 1 and 3600");
  }
  return value;
}

async function run(sessionDir: string, isolated: boolean) {
  const copy = await validateCopyDirectory(sessionDir);
  if (!isolated) {
    const worker = execFileSync("docker", ["service", "ls", "--filter", "name=wa_sender_simple_worker", "--format", "{{.Replicas}}"], { encoding: "utf8" }).trim();
    if (worker !== "0/0") throw new Error("PRODUCTION_WORKER_MUST_BE_0_0");
  }

  const stats = createStats();
  const sink = new SanitizedSink();
  const logger = pino({ level: "trace" }, sink);
  const baileys = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await baileys.useMultiFileAuthState(copy.realPath);
  let socket: ReturnType<typeof baileys.default> | null = null;
  let finished = false;
  let exitCode = 0;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    exitCode = code;
    socket?.end(undefined);
  };

  socket = baileys.default({
    auth: state,
    browser: baileys.Browsers.ubuntu("Chrome"),
    connectTimeoutMs: 15_000,
    logger,
    printQRInTerminal: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false
  });

  socket.ev.on("creds.update", async () => {
    stats.credsUpdates += 1;
    try { await saveCreds(); } catch { /* sanitized counter intentionally omitted */ }
  });
  socket.ev.on("connection.update", (update: BaileysEventMap["connection.update"]) => {
    stats.connectionUpdates += 1;
    if (update.connection === "open") stats.connectionOpen += 1;
    if (update.connection === "close") stats.connectionClose += 1;
    if (update.qr) {
      stats.qrObserved += 1;
      console.log(UNEXPECTED_QR_ERROR);
      finish(10);
      return;
    }
    console.log(JSON.stringify({ event: "connection.update", connection: update.connection ?? null, statusCode: statusCode(update.lastDisconnect?.error) }));
    if (update.connection === "close") finish(11);
  });
  socket.ev.on("messages.upsert", ({ messages }: BaileysEventMap["messages.upsert"]) => {
    stats.messagesUpsert += 1;
    stats.messagesCount += messages.length;
  });

  const timer = setTimeout(() => finish(stats.connectionOpen ? 0 : 11), durationSeconds() * 1000);
  await new Promise<void>((resolveWait) => {
    const poll = setInterval(() => { if (finished) { clearInterval(poll); resolveWait(); } }, 100);
  });
  clearTimeout(timer);
  stats.badMac = sink.stats.badMac;
  stats.decryptionErrors = sink.stats.decryptionErrors;
  console.log(JSON.stringify({ event: "receive-only-summary", sessionDir: copy.realPath, ...stats, qr: "not printed", messageContent: "not recorded", credentials: "not printed", automaticReconnect: false, hostQuiescence: isolated ? "externally-verified" : "locally-verified", exitCode }));
  return exitCode;
}

async function main() {
  const mode = arg("--mode") ?? "copy";
  const runRequested = process.argv.includes("--run");
  const isolatedRun = process.argv.includes("--isolated-run");
  const isolatedPreflight = process.argv.includes("--isolated-preflight");
  validateExecutionFlags({ mode: mode as "copy" | "clean", run: runRequested, isolatedRun, isolatedPreflight });
  const sessionDir = arg("--session-dir");
  if (!sessionDir) throw new Error("SESSION_DIR_REQUIRED");
  if (!runRequested) {
    const result = await validateCopyDirectory(sessionDir);
    console.log(JSON.stringify({ event: "DIAGNOSTIC_COPY_PREFLIGHT_OK", ...result, socketStarted: false, qrObserved: false }));
    return 0;
  }
  if (isolatedPreflight) throw new Error("ISOLATED_PREFLIGHT_CANNOT_RUN_SOCKET");
  return run(sessionDir, isolatedRun);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { if (code !== 0) process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "diagnostic failed");
    process.exitCode = 20;
  });
}
