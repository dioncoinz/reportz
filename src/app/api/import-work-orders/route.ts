import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

// Use service role ONLY inside server routes
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const reportId = formData.get("reportId") as string;

    if (!file || !reportId) {
      return NextResponse.json({ error: "Missing file or reportId" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("No worksheet found");

    const rows: { report_id: string; wo_number: string; title: string }[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const wo = String(row.getCell(1).value ?? "").trim();
      const title = String(row.getCell(2).value ?? "").trim();

      if (wo) {
        rows.push({
          report_id: reportId,
          wo_number: wo,
          title,
        });
      }
    });

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid rows found" }, { status: 400 });
    }

    const { error } = await supabase.from("work_orders").insert(rows);

    if (error) throw error;

    return NextResponse.json({ inserted: rows.length });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
