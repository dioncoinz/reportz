import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

// Use service role ONLY inside server routes
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;
  }
  return "Unknown error";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const reportId = formData.get("reportId") as string;

    if (!file || !reportId) {
      return NextResponse.json({ error: "Missing file or reportId" }, { status: 400 });
    }

    const fileData = await file.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileData);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("No worksheet found");

    const rows: { report_id: string; wo_number: string; title: string; display_order: number }[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const wo = String(row.getCell(1).value ?? "").trim();
      const title = String(row.getCell(2).value ?? "").trim();

      if (wo) {
        rows.push({
          report_id: reportId,
          wo_number: wo,
          title,
          display_order: rows.length + 1,
        });
      }
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid rows found" }, { status: 400 });
    }

    const { error } = await supabase.from("work_orders").insert(rows);

    if (error) {
      if (!isMissingColumnError(error, "display_order")) throw error;

      const fallbackRows = rows.map((row) => ({
        report_id: row.report_id,
        wo_number: row.wo_number,
        title: row.title,
      }));
      const { error: fallbackError } = await supabase.from("work_orders").insert(fallbackRows);
      if (fallbackError) throw fallbackError;
    }

    return NextResponse.json({ inserted: rows.length });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}
