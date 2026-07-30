import { prisma } from "../prisma/client";
import {
  getWhatsappInstanceRuntimeStatus,
  startWhatsappInstance
} from "./instance-manager";

const WATCHDOG_INTERVAL_MS = 30_000;
const activeChecks = new Set<string>();
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

type WatchdogInstance = { id: string };
type WatchdogStatus = {
  status: string;
  isRecoverableSession?: boolean;
  autoReconnectDisabled?: boolean;
  nextReconnectAt?: string | null;
};

export async function runWhatsappWatchdogCycle(dependencies: {
  listInstances: () => Promise<WatchdogInstance[]>;
  getStatus: (instanceId: string) => Promise<WatchdogStatus>;
  resume: (instanceId: string) => Promise<unknown>;
  now?: () => number;
}) {
  const instances = await dependencies.listInstances();
  const now = dependencies.now?.() ?? Date.now();

  await Promise.all(instances.map(async (instance) => {
    if (activeChecks.has(instance.id)) return;
    activeChecks.add(instance.id);
    try {
      const status = await dependencies.getStatus(instance.id);
      if (
        status.status === "connected" ||
        status.status === "connecting" ||
        status.autoReconnectDisabled ||
        !status.isRecoverableSession ||
        (status.nextReconnectAt && Date.parse(status.nextReconnectAt) > now)
      ) {
        return;
      }
      await dependencies.resume(instance.id);
    } finally {
      activeChecks.delete(instance.id);
    }
  }));
}

export function startWhatsappWatchdog() {
  if (watchdogTimer) return;
  const cycle = () => runWhatsappWatchdogCycle({
    listInstances: () => prisma.whatsappInstance.findMany({ select: { id: true } }),
    getStatus: getWhatsappInstanceRuntimeStatus,
    resume: startWhatsappInstance
  }).catch((error) => {
    console.warn("[watchdog] cycle failed", {
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  });
  void cycle();
  watchdogTimer = setInterval(cycle, WATCHDOG_INTERVAL_MS);
}
