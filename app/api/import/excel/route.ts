import { NextRequest, NextResponse } from "next/server";
import { importContactsFromExcel } from "@/src/lib/excel/import-contacts";

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

    const importLabel = String(formData.get("importLabel") ?? "").trim() || null;
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importContactsFromExcel(buffer, file.name, { importLabel });

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
