import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    const maybeDetails = (err as { details?: unknown }).details;
    const maybeHint = (err as { hint?: unknown }).hint;
    const parts = [maybeMessage, maybeDetails, maybeHint].filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(err);
    } catch {
      return "Unknown import error";
    }
  }
  return "Unknown import error";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes(`column`) && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const reportId = formData.get("reportId") as string;

    if (!file || !reportId) {
      return NextResponse.json({ error: "Missing file or reportId" }, { status: 400 });
    }

    const { data: reportRow, error: reportErr } = await supabase
      .from("reports")
      .select("id, tenant_id")
      .eq("id", reportId)
      .maybeSingle();

    if (reportErr) throw reportErr;
    if (!reportRow) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    let supportsTenantIdOnWorkOrders = true;
    let supportsDisplayOrderOnWorkOrders = true;
    {
      const probe = await supabase.from("work_orders").select("tenant_id").limit(1);
      if (probe.error) {
        if (isMissingColumnError(probe.error, "tenant_id")) supportsTenantIdOnWorkOrders = false;
        else throw probe.error;
      }
      const displayOrderProbe = await supabase.from("work_orders").select("display_order").limit(1);
      if (displayOrderProbe.error) {
        if (isMissingColumnError(displayOrderProbe.error, "display_order")) supportsDisplayOrderOnWorkOrders = false;
        else throw displayOrderProbe.error;
      }
    }

    const fileData = await file.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileData);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("No worksheet found");

    type ImportRow = {
      report_id: string;
      wo_number: string;
      title: string;
      tenant_id?: string | null;
      display_order?: number;
    };
    const parsedRows: ImportRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const wo = String(row.getCell(1).value ?? "").trim();
      const title = String(row.getCell(2).value ?? "").trim();

      if (wo) {
        const nextRow: ImportRow = {
          report_id: reportId,
          wo_number: wo,
          title,
        };
        if (supportsTenantIdOnWorkOrders) nextRow.tenant_id = reportRow.tenant_id;
        parsedRows.push(nextRow);
      }
    });

    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "No valid rows found" }, { status: 400 });
    }

    const dedupedByWo = new Map<string, ImportRow>();
    for (const row of parsedRows) {
      if (!dedupedByWo.has(row.wo_number)) dedupedByWo.set(row.wo_number, row);
    }
    let rows = Array.from(dedupedByWo.values());

    if (supportsDisplayOrderOnWorkOrders) {
      const { data: maxOrderRows, error: maxOrderErr } = await supabase
        .from("work_orders")
        .select("display_order")
        .eq("report_id", reportId)
        .order("display_order", { ascending: false })
        .limit(1);
      if (maxOrderErr) throw maxOrderErr;
      const currentMax = Number(maxOrderRows?.[0]?.display_order ?? 0);
      rows = rows.map((row, idx) => ({ ...row, display_order: currentMax + idx + 1 }));
    }

    const woNumbers = rows.map((r) => r.wo_number);
    const { data: existing, error: existingErr } = await supabase
      .from("work_orders")
      .select("wo_number")
      .eq("report_id", reportId)
      .in("wo_number", woNumbers);

    if (existingErr) throw existingErr;

    const existingSet = new Set((existing ?? []).map((r) => String(r.wo_number)));
    const newRows = rows.filter((r) => !existingSet.has(r.wo_number));
    const existingRows = rows.filter((r) => existingSet.has(r.wo_number));

    if (newRows.length) {
      const { error } = await supabase.from("work_orders").insert(newRows);
      if (error) throw error;
    }

    if (existingRows.length) {
      const { error: upsertErr } = await supabase.from("work_orders").upsert(existingRows, {
        onConflict: "report_id,wo_number",
      });
      if (upsertErr) throw upsertErr;
    }

    const skipped = rows.length - newRows.length;
    const refreshed = existingRows.length;
    return NextResponse.json({
      inserted: newRows.length,
      skipped,
      refreshed,
      message: skipped
        ? `Imported ${newRows.length}. Refreshed ${refreshed} existing WO number(s).`
        : `Imported ${newRows.length} work orders.`,
    });
  } catch (err: unknown) {
    console.error(err);
    const message = getErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
