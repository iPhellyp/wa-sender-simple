import { NextRequest, NextResponse } from "next/server";
import { importContactsFromExcel } from "@/src/lib/excel/import-contacts";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo .xlsx obrigatorio" }, { status: 400 });
    }

    const filename = file.name.toLowerCase();

    if (!filename.endsWith(".xlsx") && !filename.endsWith(".xls")) {
      return NextResponse.json({ error: "Envie um arquivo .xls ou .xlsx" }, { status: 400 });
    }

    const listName = String(formData.get("listName") ?? "").trim();
    const importOrigin = String(formData.get("importOrigin") ?? "").trim();
    const importLabel = listName || String(formData.get("importLabel") ?? "").trim() || importOrigin || null;
    const instanceId = await getActiveInstanceIdFromSearchOrDefault({
      instanceId: String(formData.get("instanceId") ?? "").trim() || undefined
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importContactsFromExcel(buffer, file.name, { importLabel, instanceId });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao importar planilha"
      },
      { status: 400 }
    );
  }
}
