import { randomUUID } from "crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../prisma/client";

export type CampaignMediaKind = "IMAGE" | "VIDEO" | "DOCUMENT";

type AllowedMediaDefinition = {
  kind: CampaignMediaKind;
  extensions: readonly string[];
  maxSizeBytes: number;
  signature: "JPEG" | "PNG" | "WEBP" | "MP4" | "PDF" | "ZIP" | "OLE" | "TEXT";
};

type CampaignMediaMetadata = {
  mediaKind: CampaignMediaKind;
  mediaPath: string;
  mediaOriginalName: string;
  mediaMimeType: string;
  mediaSizeBytes: number;
};

type PreparedCampaignMedia = CampaignMediaMetadata & {
  buffer: Buffer;
  temporaryAbsolutePath: string;
  finalAbsolutePath: string;
};

export type PublicCampaignMedia = {
  hasMedia: boolean;
  mediaKind: string | null;
  mediaOriginalName: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
};

type StoredCampaignMedia = {
  mediaKind: string | null;
  mediaPath: string | null;
  mediaOriginalName: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
};

export type ValidatedCampaignMedia = {
  kind: CampaignMediaKind;
  buffer: Buffer;
  mimetype: string;
  fileName: string;
  sizeBytes: number;
};

const MB = 1024 * 1024;
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const CAMPAIGN_UPLOAD_ROOT = path.resolve(UPLOADS_ROOT, "campaigns");
const TEMP_RELATIVE_DIR = "campaigns/tmp";
const FILES_RELATIVE_DIR = "campaigns/files";

const ALLOWED_MEDIA: Record<string, AllowedMediaDefinition> = {
  "image/jpeg": {
    kind: "IMAGE",
    extensions: [".jpg", ".jpeg"],
    maxSizeBytes: 10 * MB,
    signature: "JPEG"
  },
  "image/png": {
    kind: "IMAGE",
    extensions: [".png"],
    maxSizeBytes: 10 * MB,
    signature: "PNG"
  },
  "image/webp": {
    kind: "IMAGE",
    extensions: [".webp"],
    maxSizeBytes: 10 * MB,
    signature: "WEBP"
  },
  "video/mp4": {
    kind: "VIDEO",
    extensions: [".mp4"],
    maxSizeBytes: 20 * MB,
    signature: "MP4"
  },
  "application/pdf": {
    kind: "DOCUMENT",
    extensions: [".pdf"],
    maxSizeBytes: 25 * MB,
    signature: "PDF"
  },
  "application/msword": {
    kind: "DOCUMENT",
    extensions: [".doc"],
    maxSizeBytes: 25 * MB,
    signature: "OLE"
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "DOCUMENT",
    extensions: [".docx"],
    maxSizeBytes: 25 * MB,
    signature: "ZIP"
  },
  "application/vnd.ms-excel": {
    kind: "DOCUMENT",
    extensions: [".xls"],
    maxSizeBytes: 25 * MB,
    signature: "OLE"
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "DOCUMENT",
    extensions: [".xlsx"],
    maxSizeBytes: 25 * MB,
    signature: "ZIP"
  },
  "text/csv": {
    kind: "DOCUMENT",
    extensions: [".csv"],
    maxSizeBytes: 25 * MB,
    signature: "TEXT"
  },
  "text/plain": {
    kind: "DOCUMENT",
    extensions: [".txt"],
    maxSizeBytes: 25 * MB,
    signature: "TEXT"
  },
  "application/zip": {
    kind: "DOCUMENT",
    extensions: [".zip"],
    maxSizeBytes: 25 * MB,
    signature: "ZIP"
  }
};

export const CAMPAIGN_MEDIA_ACCEPT = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".zip"
].join(",");

export class CampaignMediaError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "CampaignMediaError";
  }
}

function resolveControlledUploadPath(relativePath: string) {
  const normalizedRelativePath = relativePath.replace(/\\/g, "/");
  const absolutePath = path.resolve(UPLOADS_ROOT, ...normalizedRelativePath.split("/"));
  const relativeToCampaignRoot = path.relative(CAMPAIGN_UPLOAD_ROOT, absolutePath);

  if (
    !normalizedRelativePath.startsWith("campaigns/") ||
    !relativeToCampaignRoot ||
    relativeToCampaignRoot.startsWith("..") ||
    path.isAbsolute(relativeToCampaignRoot)
  ) {
    throw new CampaignMediaError("Caminho interno de upload invalido", 500);
  }

  return absolutePath;
}

export function resolveCampaignMediaAbsolutePath(relativePath: string) {
  return resolveControlledUploadPath(relativePath);
}

function sanitizeOriginalName(filename: string) {
  const basename = path.basename(filename || "arquivo");
  const sanitized = basename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const extension = path.extname(sanitized).slice(0, 12);
  const stem = path.basename(sanitized, extension).slice(0, Math.max(1, 180 - extension.length));

  return `${stem || "arquivo"}${extension}`;
}

function startsWithBytes(buffer: Buffer, expected: readonly number[]) {
  return expected.every((value, index) => buffer[index] === value);
}

function hasZipSignature(buffer: Buffer) {
  return (
    startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08])
  );
}

function hasExpectedSignature(buffer: Buffer, signature: AllowedMediaDefinition["signature"]) {
  if (signature === "JPEG") return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  if (signature === "PNG") {
    return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (signature === "WEBP") {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (signature === "MP4") {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (signature === "PDF") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (signature === "ZIP") return hasZipSignature(buffer);
  if (signature === "OLE") {
    return startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  return !buffer.includes(0x00);
}

export async function loadValidatedCampaignMedia(
  campaign: StoredCampaignMedia
): Promise<ValidatedCampaignMedia | null> {
  const hasAnyMediaMetadata = Boolean(
    campaign.mediaKind ||
    campaign.mediaPath ||
    campaign.mediaOriginalName ||
    campaign.mediaMimeType ||
    campaign.mediaSizeBytes
  );

  if (!hasAnyMediaMetadata) return null;

  if (
    !campaign.mediaKind ||
    !campaign.mediaPath ||
    !campaign.mediaOriginalName ||
    !campaign.mediaMimeType ||
    !campaign.mediaSizeBytes
  ) {
    throw new CampaignMediaError("Metadados do anexo estao incompletos", 422);
  }

  const definition = ALLOWED_MEDIA[campaign.mediaMimeType.toLowerCase()];
  const mediaKind = campaign.mediaKind.toUpperCase();

  if (!definition || definition.kind !== mediaKind) {
    throw new CampaignMediaError("Tipo do anexo armazenado e invalido", 422);
  }

  const physicalExtension = path.extname(campaign.mediaPath).toLowerCase();
  const originalExtension = path.extname(campaign.mediaOriginalName).toLowerCase();

  if (
    !definition.extensions.includes(physicalExtension) ||
    !definition.extensions.includes(originalExtension)
  ) {
    throw new CampaignMediaError("Extensao do anexo armazenado e invalida", 422);
  }

  const absolutePath = resolveCampaignMediaAbsolutePath(campaign.mediaPath);
  let fileStat: Awaited<ReturnType<typeof stat>>;

  try {
    fileStat = await stat(absolutePath);
  } catch {
    throw new CampaignMediaError("Arquivo da campanha nao foi encontrado", 422);
  }

  if (!fileStat.isFile()) {
    throw new CampaignMediaError("Anexo da campanha nao e um arquivo valido", 422);
  }

  if (
    fileStat.size !== campaign.mediaSizeBytes ||
    fileStat.size <= 0 ||
    fileStat.size > definition.maxSizeBytes
  ) {
    throw new CampaignMediaError("Tamanho do anexo armazenado e invalido", 422);
  }

  const buffer = await readFile(absolutePath);

  if (buffer.length !== fileStat.size || !hasExpectedSignature(buffer, definition.signature)) {
    throw new CampaignMediaError("Assinatura do anexo armazenado e invalida", 422);
  }

  return {
    kind: definition.kind,
    buffer,
    mimetype: campaign.mediaMimeType,
    fileName: campaign.mediaOriginalName,
    sizeBytes: buffer.length
  };
}

async function prepareCampaignMedia(file: File): Promise<PreparedCampaignMedia> {
  if (!file.name || file.size <= 0) {
    throw new CampaignMediaError("Arquivo de campanha vazio ou invalido");
  }

  const mimeType = file.type.trim().toLowerCase();
  const definition = ALLOWED_MEDIA[mimeType];

  if (!definition) {
    throw new CampaignMediaError("Tipo de arquivo nao permitido", 415);
  }

  if (file.size > definition.maxSizeBytes) {
    throw new CampaignMediaError(
      `Arquivo excede o limite de ${definition.maxSizeBytes / MB} MB`,
      413
    );
  }

  const originalName = sanitizeOriginalName(file.name);
  const extension = path.extname(originalName).toLowerCase();

  if (!definition.extensions.includes(extension)) {
    throw new CampaignMediaError("Extensao incompativel com o tipo do arquivo");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length !== file.size || !hasExpectedSignature(buffer, definition.signature)) {
    throw new CampaignMediaError("Assinatura do arquivo invalida ou incompativel");
  }

  const internalName = `${randomUUID()}${extension}`;
  const temporaryRelativePath = `${TEMP_RELATIVE_DIR}/${internalName}.tmp`;
  const finalRelativePath = `${FILES_RELATIVE_DIR}/${internalName}`;

  return {
    buffer,
    mediaKind: definition.kind,
    mediaPath: finalRelativePath,
    mediaOriginalName: originalName,
    mediaMimeType: mimeType,
    mediaSizeBytes: buffer.length,
    temporaryAbsolutePath: resolveControlledUploadPath(temporaryRelativePath),
    finalAbsolutePath: resolveControlledUploadPath(finalRelativePath)
  };
}

async function removeFileIfPresent(absolutePath: string | undefined) {
  if (!absolutePath) return;
  await unlink(absolutePath).catch(() => undefined);
}

export async function parseCampaignCreateRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      throw new CampaignMediaError("Formulario multipart invalido");
    }
    const payloadValue = formData.get("payload");
    const mediaValues = formData.getAll("media");

    if (typeof payloadValue !== "string" || !payloadValue.trim()) {
      throw new CampaignMediaError("Payload JSON da campanha obrigatorio");
    }

    const actualMediaValues = mediaValues.filter(
      (value) => !(value instanceof File && value.size === 0 && !value.name)
    );

    if (actualMediaValues.length > 1) {
      throw new CampaignMediaError("A campanha aceita apenas um anexo");
    }

    const mediaValue = actualMediaValues[0] ?? null;

    if (mediaValue !== null && !(mediaValue instanceof File)) {
      throw new CampaignMediaError("Campo media deve conter um arquivo");
    }

    try {
      const payload = JSON.parse(payloadValue) as unknown;

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("invalid payload");
      }

      return {
        payload: payload as Record<string, unknown>,
        mediaFile: mediaValue
      };
    } catch {
      throw new CampaignMediaError("Payload JSON da campanha invalido");
    }
  }

  if (!contentType.includes("application/json")) {
    throw new CampaignMediaError("Content-Type deve ser application/json ou multipart/form-data", 415);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new CampaignMediaError("Payload JSON da campanha invalido");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CampaignMediaError("Payload JSON da campanha invalido");
  }

  return {
    payload: payload as Record<string, unknown>,
    mediaFile: null
  };
}

export async function createCampaignWithOptionalMedia<T extends { id: string; instanceId: string }>(
  mediaFile: File | null,
  createCampaign: () => Promise<T>
) {
  if (!mediaFile) {
    return {
      campaign: await createCampaign(),
      media: null as CampaignMediaMetadata | null
    };
  }

  const prepared = await prepareCampaignMedia(mediaFile);
  let campaign: T | null = null;
  let movedToFinal = false;

  try {
    await mkdir(path.dirname(prepared.temporaryAbsolutePath), { recursive: true });
    await mkdir(path.dirname(prepared.finalAbsolutePath), { recursive: true });
    await writeFile(prepared.temporaryAbsolutePath, prepared.buffer, { flag: "wx" });

    campaign = await createCampaign();
    await rename(prepared.temporaryAbsolutePath, prepared.finalAbsolutePath);
    movedToFinal = true;

    const updated = await prisma.campaign.updateMany({
      where: {
        id: campaign.id,
        instanceId: campaign.instanceId,
        mediaPath: null
      },
      data: {
        mediaKind: prepared.mediaKind,
        mediaPath: prepared.mediaPath,
        mediaOriginalName: prepared.mediaOriginalName,
        mediaMimeType: prepared.mediaMimeType,
        mediaSizeBytes: prepared.mediaSizeBytes
      }
    });

    if (updated.count !== 1) {
      throw new Error("Falha ao vincular anexo a campanha");
    }

    return {
      campaign,
      media: {
        mediaKind: prepared.mediaKind,
        mediaPath: prepared.mediaPath,
        mediaOriginalName: prepared.mediaOriginalName,
        mediaMimeType: prepared.mediaMimeType,
        mediaSizeBytes: prepared.mediaSizeBytes
      }
    };
  } catch (error) {
    await removeFileIfPresent(prepared.temporaryAbsolutePath);
    if (movedToFinal) await removeFileIfPresent(prepared.finalAbsolutePath);

    if (campaign) {
      await prisma.campaign.deleteMany({
        where: {
          id: campaign.id,
          instanceId: campaign.instanceId
        }
      }).catch((compensationError) => {
        console.error("[campaign-media] campaign compensation failed", {
          campaignId: campaign?.id,
          error: compensationError instanceof Error ? compensationError.message : "unknown"
        });
      });
    }

    throw error;
  } finally {
    await removeFileIfPresent(prepared.temporaryAbsolutePath);
  }
}

export function serializeCampaignForApi<
  T extends {
    mediaPath: string | null;
    mediaKind: string | null;
    mediaOriginalName: string | null;
    mediaMimeType: string | null;
    mediaSizeBytes: number | null;
  }
>(campaign: T) {
  const { mediaPath, ...safeCampaign } = campaign;

  return {
    ...safeCampaign,
    hasMedia: Boolean(mediaPath),
    mediaKind: campaign.mediaKind,
    mediaOriginalName: campaign.mediaOriginalName,
    mediaMimeType: campaign.mediaMimeType,
    mediaSizeBytes: campaign.mediaSizeBytes
  };
}
