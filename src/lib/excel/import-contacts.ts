import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import { normalizeBrazilPhone } from "../phone/normalize";

const REQUIRED_HEADERS = ["nome", "telefone", "mensagem", "origem"];

export type ImportContactsResult = {
  batchId: string;
  filename: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicatedRows: number;
  invalidRows: number;
};

function cleanCell(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeHeader(value: unknown) {
  return cleanCell(value).toLowerCase();
}

function isHeaderValid(headers: unknown[]) {
  if (headers.length !== REQUIRED_HEADERS.length) {
    return false;
  }

  return REQUIRED_HEADERS.every((expectedHeader, index) => {
    return normalizeHeader(headers[index]) === expectedHeader;
  });
}

function isKnownUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function importContactsFromExcel(
  buffer: Buffer,
  filename: string,
  options: { importLabel?: string | null } = {}
) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("Planilha sem abas");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false
  });

  if (rows.length === 0) {
    throw new Error("Planilha vazia");
  }

  const [headers, ...dataRows] = rows;

  if (!isHeaderValid(headers)) {
    throw new Error("A planilha deve ter exatamente as colunas: nome, telefone, mensagem, origem");
  }

  let insertedRows = 0;
  let updatedRows = 0;
  let duplicatedRows = 0;
  let invalidRows = 0;
  const importLabel = options.importLabel?.trim() || null;

  for (const row of dataRows) {
    const [nameCell, phoneCell, messageCell, sourceCell] = row;
    const phoneRaw = cleanCell(phoneCell);
    const normalizedPhone = normalizeBrazilPhone(phoneRaw);

    if (!normalizedPhone.ok) {
      invalidRows += 1;
      continue;
    }

    const name = cleanCell(nameCell) || normalizedPhone.normalized;
    const message = cleanCell(messageCell) || null;
    const source = importLabel ?? (cleanCell(sourceCell) || "planilha");

    const existingContact = await prisma.contact.findUnique({
      where: {
        phoneNormalized: normalizedPhone.normalized
      },
      select: {
        id: true,
        name: true
      }
    });

    if (existingContact) {
      const updateData: Prisma.ContactUpdateInput = {};

      if (name && name !== existingContact.name) {
        updateData.name = name;
      }

      if (message) {
        updateData.message = message;
      }

      if (importLabel) {
        updateData.source = importLabel;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.contact.update({
          where: {
            id: existingContact.id
          },
          data: updateData
        });
        updatedRows += 1;
      } else {
        duplicatedRows += 1;
      }

      continue;
    }

    try {
      await prisma.contact.create({
        data: {
          name,
          phoneRaw,
          phoneNormalized: normalizedPhone.normalized,
          message,
          source
        }
      });

      insertedRows += 1;
    } catch (error) {
      if (isKnownUniqueError(error)) {
        duplicatedRows += 1;
        continue;
      }

      throw error;
    }
  }

  const batch = await prisma.importBatch.create({
    data: {
      filename,
      totalRows: dataRows.length,
      insertedRows,
      duplicatedRows,
      invalidRows
    }
  });

  return {
    batchId: batch.id,
    filename,
    totalRows: dataRows.length,
    insertedRows,
    updatedRows,
    duplicatedRows,
    invalidRows
  } satisfies ImportContactsResult;
}
