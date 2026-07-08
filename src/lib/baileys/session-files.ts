import { mkdir, readdir, readFile } from "fs/promises";
import { join, resolve } from "path";

export type BaileysSessionFilesInfo = {
  sessionDir: string;
  sessionFilesCount: number;
  hasCredsJson: boolean;
  hasRegisteredSession: boolean;
  hasMeId: boolean;
  hasMe: boolean;
  isPairingPartial: boolean;
};

type BaileysCredsFile = {
  registered?: unknown;
  me?: {
    id?: unknown;
  } | null;
};

async function scanSessionDir(dir: string): Promise<{ count: number; credsJsonPath: string | null }> {
  const entries = await readdir(dir, { withFileTypes: true });
  let count = 0;
  let credsJsonPath: string | null = null;

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const child = await scanSessionDir(fullPath);
      count += child.count;
      credsJsonPath = credsJsonPath ?? child.credsJsonPath;
    } else if (entry.isFile()) {
      count += 1;

      if (entry.name === "creds.json") {
        credsJsonPath = fullPath;
      }
    }
  }

  return { count, credsJsonPath };
}

async function readCredsMetadata(credsJsonPath: string | null) {
  if (!credsJsonPath) {
    return {
      hasRegisteredSession: false,
      hasMe: false,
      hasMeId: false
    };
  }

  try {
    const parsed = JSON.parse(await readFile(credsJsonPath, "utf8")) as BaileysCredsFile;
    const hasMe = Boolean(parsed.me);
    const hasMeId = typeof parsed.me?.id === "string" && parsed.me.id.trim().length > 0;

    return {
      hasRegisteredSession: parsed.registered === true,
      hasMe,
      hasMeId
    };
  } catch {
    return {
      hasRegisteredSession: false,
      hasMe: false,
      hasMeId: false
    };
  }
}

export async function getBaileysSessionFilesInfo(sessionDirInput: string): Promise<BaileysSessionFilesInfo> {
  const sessionDir = resolve(sessionDirInput);
  await mkdir(sessionDir, { recursive: true });

  const result = await scanSessionDir(sessionDir);
  const metadata = await readCredsMetadata(result.credsJsonPath);
  const hasCredsJson = Boolean(result.credsJsonPath);

  return {
    sessionDir,
    sessionFilesCount: result.count,
    hasCredsJson,
    hasRegisteredSession: metadata.hasRegisteredSession,
    hasMe: metadata.hasMe,
    hasMeId: metadata.hasMeId,
    isPairingPartial: hasCredsJson && !metadata.hasRegisteredSession && !metadata.hasMeId
  };
}
