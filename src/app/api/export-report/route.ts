export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import PptxGenJS from "pptxgenjs";
import { requireEnv } from "@/lib/env";

type ReportRow = {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  key_personnel: string | null;
  safety_injuries: number | null;
  safety_incidents: number | null;
  status: string;
};

type BrandingRow = {
  company_name: string | null;
  header_text: string | null;
  footer_text: string | null;
  logo_path: string | null;
  accent_hex: string | null;
};

type WorkOrderRow = {
  id: string;
  wo_number: string;
  title: string | null;
  status: "open" | "complete" | "cancelled" | "archived";
  emergent_work: boolean;
  cancelled_reason: string | null;
  display_order?: number | null;
  created_at?: string | null;
};

type UpdateRow = {
  id: string;
  work_order_id: string;
  comment: string | null;
  photo_urls: string[] | null;
  created_at: string;
};

const ISSUE_PREFIX = "__ISSUE__:";
const NEXT_SHUT_PREFIX = "__NEXT_SHUT__:";
const EMERGENT_PREFIX = "__EMERGENT__:";

function safe(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, "").slice(0, 80);
}

function normalizeHex(raw: string | null | undefined, fallback = "C7662D") {
  const cleaned = (raw ?? "").trim().replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? cleaned.toUpperCase() : fallback;
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function imageMimeFromPath(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function file(bucket: string, path: string) {
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function asDataUri(buf: Buffer, mime: string) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function jpegOrientation(buf: Buffer) {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return 1;
  let offset = 2;

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if (size < 2 || offset + 2 + size > buf.length) break;

    if (marker === 0xe1) {
      const exifStart = offset + 4;
      if (exifStart + 6 > buf.length) break;
      if (buf.toString("ascii", exifStart, exifStart + 6) !== "Exif\0\0") break;

      const tiff = exifStart + 6;
      if (tiff + 8 > buf.length) break;

      const little = buf.toString("ascii", tiff, tiff + 2) === "II";
      const read16 = (p: number) => (little ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
      const read32 = (p: number) => (little ? buf.readUInt32LE(p) : buf.readUInt32BE(p));

      const ifd0 = tiff + read32(tiff + 4);
      if (ifd0 + 2 > buf.length) break;
      const entries = read16(ifd0);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > buf.length) break;
        if (read16(entry) === 0x0112) {
          return read16(entry + 8);
        }
      }
      break;
    }

    offset += 2 + size;
  }

  return 1;
}

function exifRotationDegrees(buf: Buffer, path: string) {
  if (!path.toLowerCase().endsWith(".jpg") && !path.toLowerCase().endsWith(".jpeg")) return 0;
  const orientation = jpegOrientation(buf);
  if (orientation === 3) return 180;
  if (orientation === 6) return 90;
  if (orientation === 8) return 270;
  return 0;
}

function statusColor(status: WorkOrderRow["status"]) {
  if (status === "complete") return "1B8F5A";
  if (status === "cancelled") return "B92C2C";
  if (status === "archived") return "64748B";
  return "B67710";
}

function getEntryKind(comment: string | null): "comments" | "issues" | "next" {
  if (!comment) return "comments";
  if (comment.startsWith(EMERGENT_PREFIX)) return "next";
  if (comment.startsWith(ISSUE_PREFIX)) return "issues";
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return "next";
  return "comments";
}

function cleanComment(comment: string | null) {
  if (!comment) return "";
  if (comment.startsWith(EMERGENT_PREFIX)) return "";
  if (comment.startsWith(ISSUE_PREFIX)) return comment.slice(ISSUE_PREFIX.length).trim();
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return comment.slice(NEXT_SHUT_PREFIX.length).trim();
  return comment.trim();
}

function toBulletLines(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[\-\*\u2022]\s*/, "").trim())
    .filter(Boolean);
  if (!lines.length) return ["No comment"];
  return lines;
}

function startMonthYear(dateStr: string | null) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;
  }
  return "";
}

function isMissingColumnError(err: unknown, column: string) {
  const msg = getErrorMessage(err).toLowerCase();
  return msg.includes("column") && msg.includes(column.toLowerCase()) && msg.includes("does not exist");
}

function sortEmergentLast<T extends { emergent_work: boolean; display_order?: number | null; created_at?: string | null }>(
  rows: T[]
) {
  return [...rows].sort((a, b) => {
    if (a.emergent_work !== b.emergent_work) return a.emergent_work ? 1 : -1;
    const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

async function fetchAllWorkOrders(
  supabase: SupabaseClient,
  reportId: string
): Promise<{ rows: WorkOrderRow[]; error: string | null }> {
  const pageSize = 1000;

  async function fetchPage(withEmergent: boolean, from: number, to: number) {
    const selectCols = withEmergent
      ? "id, wo_number, title, status, emergent_work, cancelled_reason, display_order, created_at"
      : "id, wo_number, title, status, cancelled_reason, display_order, created_at";
    const page = await supabase
      .from("work_orders")
      .select(selectCols)
      .eq("report_id", reportId)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .range(from, to);
    if (!page.error || !isMissingColumnError(page.error, "display_order")) return page;
    return supabase
      .from("work_orders")
      .select(withEmergent
        ? "id, wo_number, title, status, emergent_work, cancelled_reason, created_at"
        : "id, wo_number, title, status, cancelled_reason, created_at")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true })
      .range(from, to);
  }

  let withEmergent = true;
  let rows: WorkOrderRow[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const page = await fetchPage(withEmergent, from, to);

    if (page.error) {
      if (withEmergent && isMissingColumnError(page.error, "emergent_work")) {
        withEmergent = false;
        rows = [];
        from = 0;
        continue;
      }
      return { rows: [], error: page.error.message };
    }

    const chunk = (page.data ?? []) as unknown as Array<Omit<WorkOrderRow, "emergent_work"> & { emergent_work?: boolean }>;
    if (!chunk.length) break;

    rows.push(
      ...chunk.map((r) => ({
        ...r,
        emergent_work: withEmergent ? Boolean(r.emergent_work) : false,
      }))
    );

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return { rows, error: null };
}

export async function GET(req: NextRequest) {
  const supabase = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const id = req.nextUrl.searchParams.get("reportId");
  if (!id) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });

  const reportSelectWithKeyPersonnel = await supabase
    .from("reports")
    .select("id, tenant_id, name, start_date, end_date, key_personnel, safety_injuries, safety_incidents, status")
    .eq("id", id);

  let report: ReportRow | null = null;
  let reportErr: { message: string } | null = null;

  if (reportSelectWithKeyPersonnel.error) {
    const isFallbackNeeded =
      isMissingColumnError(reportSelectWithKeyPersonnel.error, "key_personnel") ||
      isMissingColumnError(reportSelectWithKeyPersonnel.error, "safety_injuries") ||
      isMissingColumnError(reportSelectWithKeyPersonnel.error, "safety_incidents");
    if (!isFallbackNeeded) {
      reportErr = { message: reportSelectWithKeyPersonnel.error.message };
    } else {
      const fallback = await supabase
        .from("reports")
        .select("id, tenant_id, name, start_date, end_date, status")
        .eq("id", id)
        .single<Omit<ReportRow, "key_personnel" | "safety_injuries" | "safety_incidents">>();
      if (fallback.error || !fallback.data) {
        reportErr = { message: fallback.error?.message ?? "Report not found" };
      } else {
        report = { ...fallback.data, key_personnel: null, safety_injuries: 0, safety_incidents: 0 };
      }
    }
  } else if (reportSelectWithKeyPersonnel.data?.length) {
    report = reportSelectWithKeyPersonnel.data[0] as ReportRow;
  }

  if (reportErr || !report) {
    return NextResponse.json({ error: reportErr?.message ?? "Report not found" }, { status: 404 });
  }

  const { data: branding } = await supabase
    .from("tenant_branding")
    .select("company_name, header_text, footer_text, logo_path, accent_hex")
    .eq("tenant_id", report.tenant_id)
    .maybeSingle<BrandingRow>();

  const woFetch = await fetchAllWorkOrders(supabase, id);
  if (woFetch.error) {
    return NextResponse.json({ error: woFetch.error }, { status: 500 });
  }
  const woRows = woFetch.rows;
  const woIds = woRows.map((w) => w.id);

  const { data: updates } = woIds.length
    ? await supabase
        .from("wo_updates")
        .select("id, work_order_id, comment, photo_urls, created_at")
        .in("work_order_id", woIds)
        .order("created_at", { ascending: true })
        .returns<UpdateRow[]>()
    : { data: [] as UpdateRow[] };

  const updatesByWo = new Map<string, UpdateRow[]>();
  for (const u of updates ?? []) {
    if (!updatesByWo.has(u.work_order_id)) updatesByWo.set(u.work_order_id, []);
    updatesByWo.get(u.work_order_id)?.push(u);
  }
  const emergentByMarker = new Set<string>();
  for (const u of updates ?? []) {
    if (typeof u.comment === "string" && u.comment.startsWith(EMERGENT_PREFIX)) {
      emergentByMarker.add(u.work_order_id);
    }
  }
  const woRowsWithEmergent = woRows.map((w) => ({
    ...w,
    emergent_work: w.emergent_work || emergentByMarker.has(w.id),
  }));
  const orderedWoRows = sortEmergentLast(woRowsWithEmergent);

  const total = orderedWoRows.length;
  const complete = orderedWoRows.filter((w) => w.status === "complete").length;
  const cancelled = orderedWoRows.filter((w) => w.status === "cancelled").length;
  const open = orderedWoRows.filter((w) => w.status === "open").length;
  const emergent = orderedWoRows.filter((w) => w.emergent_work).length;
  const safetyInjuries = Math.max(report.safety_injuries ?? 0, 0);
  const safetyIncidents = Math.max(report.safety_incidents ?? 0, 0);

  const accent = normalizeHex(branding?.accent_hex, "C7662D");
  const company = branding?.company_name ?? "Reportz";

  let logoData: string | null = null;
  if (branding?.logo_path) {
    const logo = await file("branding-logos", branding.logo_path);
    if (logo) logoData = asDataUri(logo, imageMimeFromPath(branding.logo_path));
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Reportz";
  pptx.company = company;
  pptx.subject = `Shutdown report: ${report.name}`;
  pptx.title = `${report.name} - Shutdown Report`;

  // Slide 1: Title
  {
    const slide = pptx.addSlide();
    slide.background = { color: "F6F7FB" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.35, fill: { color: accent }, line: { color: accent } });
    if (logoData) {
      slide.addImage({ data: logoData, x: 0.6, y: 0.55, w: 2.2, h: 0.8 });
    }
    slide.addText(company, {
      x: 0.6,
      y: 1.6,
      w: 12,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 22,
      bold: true,
      color: accent,
    });
    slide.addText("Shutdown Completion Report", {
      x: 0.6,
      y: 2.2,
      w: 12,
      h: 0.6,
      fontFace: "Aptos",
      fontSize: 34,
      bold: true,
      color: "0F172A",
    });
    slide.addText(report.name, {
      x: 0.6,
      y: 3.05,
      w: 12,
      h: 0.9,
      fontFace: "Aptos",
      fontSize: 28,
      bold: true,
      color: "0F172A",
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: 4.35,
      w: 6.9,
      h: 1.15,
      fill: { color: "FFFFFF" },
      line: { color: "D8DEEA", pt: 1 },
    });
    slide.addText(`${startMonthYear(report.start_date)}`, {
      x: 0.9,
      y: 4.8,
      w: 6.4,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 15,
      color: "334155",
      bold: true,
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 8.1,
      y: 4.35,
      w: 4.65,
      h: 1.65,
      fill: { color: "FFFFFF" },
      line: { color: "D8DEEA", pt: 1 },
    });
    slide.addText("Key Personnel", {
      x: 8.35,
      y: 4.52,
      w: 4.15,
      h: 0.24,
      fontFace: "Aptos",
      fontSize: 12,
      bold: true,
      color: "0F172A",
    });
    slide.addText(report.key_personnel?.trim() || "Not provided", {
      x: 8.35,
      y: 4.82,
      w: 4.15,
      h: 1.05,
      fontFace: "Aptos",
      fontSize: 10,
      color: "334155",
      breakLine: true,
      valign: "top",
    });
    slide.addText(branding?.footer_text ?? "Generated by Reportz", {
      x: 0.6,
      y: 7.1,
      w: 12,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 10,
      color: "64748B",
    });
  }

  // Slide 2: Dashboard
  {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.28, fill: { color: accent }, line: { color: accent } });
    slide.addText("Executive Dashboard", {
      x: 0.6,
      y: 0.45,
      w: 7,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 26,
      bold: true,
      color: "0F172A",
    });

    const emergentColor = "0F6CBD";

    const kpi = [
      { label: "Total", val: total, bg: "F8FAFF", color: "0F172A" },
      { label: "Completed", val: complete, bg: "EAF8F0", color: "1B8F5A" },
      { label: "Open", val: open, bg: "FFF7E4", color: "B67710" },
      { label: "Cancelled", val: cancelled, bg: "FCEDEE", color: "B92C2C" },
      { label: "Emergent", val: emergent, bg: "EAF4FF", color: emergentColor },
    ];

    kpi.forEach((k, i) => {
      const x = 0.6 + i * 2.45;
      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y: 1.1,
        w: 2.25,
        h: 1.25,        fill: { color: k.bg },
        line: { color: "D8DEEA", pt: 1 },
      });
      slide.addText(k.label, { x: x + 0.18, y: 1.3, w: 1.92, h: 0.25, fontFace: "Aptos", fontSize: 11, color: "5F6F88", bold: true });
      slide.addText(String(k.val), { x: x + 0.18, y: 1.58, w: 1.92, h: 0.55, fontFace: "Aptos", fontSize: 24, color: k.color, bold: true });
    });

    // Status composition bar
    const statusMix = [
      { label: "Completed", value: complete, color: "1B8F5A" },
      { label: "Open", value: open, color: "B67710" },
      { label: "Cancelled", value: cancelled, color: "B92C2C" },
      { label: "Emergent", value: emergent, color: emergentColor },
    ];
    const mixTotal = Math.max(statusMix.reduce((sum, m) => sum + m.value, 0), 1);
    let cursor = 0.6;
    const width = 12.1;

    slide.addText("Status Mix", { x: 0.6, y: 2.75, w: 3, h: 0.3, fontFace: "Aptos", fontSize: 14, bold: true, color: "334155" });
    statusMix.forEach((m) => {
      const w = Math.max((m.value / mixTotal) * width, m.value > 0 ? 0.08 : 0);
      slide.addShape(pptx.ShapeType.rect, {
        x: cursor,
        y: 3.05,
        w,
        h: 0.35,
        fill: { color: m.color },
        line: { color: m.color, pt: 0 },
      });
      cursor += w;
    });

    let legendY = 3.55;
    statusMix.forEach((m) => {
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: legendY + 0.05, w: 0.14, h: 0.14, fill: { color: m.color }, line: { color: m.color, pt: 0 } });
      slide.addText(`${m.label}: ${m.value} (${pct(m.value, mixTotal)}%)`, {
        x: 0.8,
        y: legendY,
        w: 4,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 11,
        color: "334155",
      });
      legendY += 0.27;
    });

    // Schedule compliance (completed vs total)
    const compliancePct = pct(complete, Math.max(total, 1));

    const complianceX = 3.95;
    const safetyX = 8.25;
    const panelY = 3.9;
    const panelW = 4.1;
    const panelH = 3.35;

    slide.addText("Schedule Compliance", {
      x: complianceX,
      y: 3.55,
      w: panelW,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 14,
      bold: true,
      color: "334155",
      align: "center",
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: complianceX,
      y: panelY,
      w: panelW,
      h: panelH,
      fill: { color: "F8FAFF" },
      line: { color: "D8DEEA", pt: 1 },
    });

    slide.addChart(
      pptx.ChartType.doughnut,
      [
        { name: "Status", labels: ["Completed", "Open", "Cancelled", "Emergent"], values: [complete, open, cancelled, emergent] },
      ],
      {
        x: complianceX + 0.18,
        y: 4.1,
        w: 1.95,
        h: 2.45,
        showLegend: false,
        holeSize: 68,
        chartColors: ["1B8F5A", "B67710", "B92C2C", emergentColor],
        showValue: false,
      }
    );

    slide.addText(`${compliancePct}%`, {
      x: complianceX + 2.18,
      y: 4.5,
      w: 1.42,
      h: 0.52,
      fontFace: "Aptos",
      fontSize: 30,
      bold: true,
      color: "1B8F5A",
      align: "center",
    });
    slide.addText("On-schedule completion", {
      x: complianceX + 2.12,
      y: 5.12,
      w: 1.5,
      h: 0.28,
      fontFace: "Aptos",
      fontSize: 8,
      color: "64748B",
      align: "center",
    });
    slide.addText(`${complete} completed of ${total} total`, {
      x: complianceX + 2.12,
      y: 5.45,
      w: 1.5,
      h: 0.25,
      fontFace: "Aptos",
      fontSize: 9,
      color: "334155",
      bold: true,
      align: "center",
    });

    slide.addText("Safety Compliance", {
      x: safetyX,
      y: 3.55,
      w: panelW,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 14,
      bold: true,
      color: "334155",
      align: "center",
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: safetyX,
      y: panelY,
      w: panelW,
      h: panelH,
      fill: { color: "F8FAFF" },
      line: { color: "D8DEEA", pt: 1 },
    });

    const safetyTextW = 2.95;
    const safetyTextX = safetyX + (panelW - safetyTextW) / 2;

    slide.addText(`Injuries: ${safetyInjuries}`, {
      x: safetyTextX,
      y: 4.45,
      w: safetyTextW,
      h: 0.34,
      fontFace: "Aptos",
      fontSize: 22,
      bold: true,
      color: safetyInjuries > 0 ? "B92C2C" : "1B8F5A",
      align: "center",
    });
    slide.addText(`Incidents: ${safetyIncidents}`, {
      x: safetyTextX,
      y: 5.0,
      w: safetyTextW,
      h: 0.34,
      fontFace: "Aptos",
      fontSize: 22,
      bold: true,
      color: safetyIncidents > 0 ? "B92C2C" : "1B8F5A",
      align: "center",
    });
    slide.addText("Details in report", {
      x: safetyTextX,
      y: 5.95,
      w: safetyTextW,
      h: 0.28,
      fontFace: "Aptos",
      fontSize: 12,
      color: "334155",
      bold: true,
      align: "center",
    });
  }

  // Work order detail slides
  for (const w of orderedWoRows) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.2, fill: { color: accent }, line: { color: accent } });

    slide.addText(`${w.wo_number} | ${w.title ?? "Untitled work order"}`, {
      x: 0.6,
      y: 0.45,
      w: 11.8,
      h: 0.65,
      fontFace: "Aptos",
      fontSize: 24,
      bold: true,
      color: "0F172A",
    });

    const sColor = statusColor(w.status);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: 1.25,
      w: 2.4,
      h: 0.46,      fill: { color: "F8FAFC" },
      line: { color: sColor, pt: 1 },
    });
    slide.addText(`Status: ${w.status.toUpperCase()}`, {
      x: 0.78,
      y: 1.39,
      w: 2,
      h: 0.2,
      fontFace: "Aptos",
      fontSize: 11,
      bold: true,
      color: sColor,
    });
    if (w.emergent_work) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 3.1,
        y: 1.25,
        w: 1.75,
        h: 0.46,
        fill: { color: "EEF6FF" },
        line: { color: "0F6CBD", pt: 1 },
      });
      slide.addText("EMERGENT", {
        x: 3.3,
        y: 1.39,
        w: 1.35,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 10,
        bold: true,
        color: "0F6CBD",
      });
    }

    const list = updatesByWo.get(w.id) ?? [];
    const statusMeta =
      w.status === "cancelled"
        ? `Reason: ${w.cancelled_reason ?? "Not provided"}`
        : w.status === "complete"
        ? "Completed"
        : "In progress";

    slide.addText(statusMeta, {
      x: 0.6,
      y: 1.78,
      w: 7.35,
      h: 0.22,
      fontFace: "Aptos",
      fontSize: 11,
      color: "334155",
    });

    const comments = list.filter((u) => getEntryKind(u.comment) === "comments");
    const issues = list.filter((u) => getEntryKind(u.comment) === "issues");
    const allPhotoPaths = list.flatMap((u) => u.photo_urls ?? []).slice(0, 6);

    const leftTop = 2.05;
    const leftBottom = 7.35;
    const leftGap = 0.3;
    const leftSectionHeight = (leftBottom - leftTop - leftGap) / 2;
    const sections = [
      { title: "Completion Comments", rows: comments, y: leftTop, h: leftSectionHeight },
      { title: "Issues/Recommendations", rows: issues, y: leftTop + leftSectionHeight + leftGap, h: leftSectionHeight },
    ] as const;

    for (const section of sections) {
      const lines = section.rows
        .slice(0, 2)
        .flatMap((u) => toBulletLines(cleanComment(u.comment)))
        .slice(0, 6);

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: section.y,
        w: 7.35,
        h: section.h,
        fill: { color: "F8FAFF" },
        line: { color: "D8DEEA", pt: 1 },
      });

      slide.addText(section.title, {
        x: 0.82,
        y: section.y + 0.12,
        w: 6.9,
        h: 0.24,
        fontFace: "Aptos",
        fontSize: 13,
        bold: true,
        color: "0F172A",
      });

      if (lines.length) {
        const bulletRuns = lines.map((line, idx) => ({
          text: line,
          options: {
            bullet: { indent: 14 },
            breakLine: idx < lines.length - 1,
          },
        }));
        slide.addText(bulletRuns as unknown as never, {
          x: 0.82,
          y: section.y + 0.42,
          w: 6.95,
          h: Math.max(section.h - 0.55, 0.7),
          fontFace: "Aptos",
          fontSize: 11,
          color: "334155",
        });
      } else {
        slide.addText("No entries.", {
          x: 0.82,
          y: section.y + 0.42,
          w: 6.95,
          h: Math.max(section.h - 0.55, 0.7),
          fontFace: "Aptos",
          fontSize: 11,
          color: "334155",
        });
      }

    }

    const galleryX = 8.15;
    const galleryY = 2.05;
    const galleryW = 4.55;
    const galleryH = 5.3;
    const galleryContentY = galleryY + 0.42;

    slide.addShape(pptx.ShapeType.roundRect, {
      x: galleryX,
      y: galleryY,
      w: galleryW,
      h: galleryH,
      fill: { color: "F8FAFC" },
      line: { color: "D8DEEA", pt: 1 },
    });
    slide.addText("Photos", {
      x: galleryX,
      y: galleryY + 0.11,
      w: galleryW,
      h: 0.24,
      fontFace: "Aptos",
      fontSize: 12,
      bold: true,
      color: "0F172A",
      align: "center",
    });

    if (!allPhotoPaths.length) {
      slide.addText("No photos logged.", {
        x: galleryX + 0.23,
        y: galleryY + 2.65,
        w: galleryW - 0.46,
        h: 0.3,
        align: "center",
        fontFace: "Aptos",
        fontSize: 11,
        color: "64748B",
        italic: true,
      });
    }

    for (let i = 0; i < allPhotoPaths.length; i += 1) {
      const path = allPhotoPaths[i];
      const pbuf = await file("report-photos", path);
      if (!pbuf) continue;

      const photoData = asDataUri(pbuf, imageMimeFromPath(path));
      const rotate = exifRotationDegrees(pbuf, path);
      const col = i % 2;
      const row = Math.floor(i / 2);
      const frameX = galleryX + 0.23 + col * 2.1;
      const frameY = galleryContentY + 0.08 + row * 1.56;
      const frameW = 1.98;
      const frameH = 1.44;
      const quarterTurn = rotate === 90 || rotate === 270;
      const w = quarterTurn ? frameH : frameW;
      const h = quarterTurn ? frameW : frameH;
      const x = frameX + (frameW - w) / 2;
      const y = frameY + (frameH - h) / 2;

      slide.addImage({
        data: photoData,
        x,
        y,
        w,
        h,
        sizing: { type: "contain", w, h },
        rotate,
      });
    }
  }

  // Final slide: Feedback
  {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.2, fill: { color: accent }, line: { color: accent } });
    if (logoData) {
      slide.addImage({ data: logoData, x: 0.6, y: 0.32, w: 2.2, h: 0.8 });
    }

    slide.addText("Feedback", {
      x: 3.0,
      y: 0.45,
      w: 9.7,
      h: 0.5,
      fontFace: "Aptos",
      fontSize: 26,
      bold: true,
      color: "0F172A",
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: 1.1,
      w: 12.1,
      h: 6.0,
      fill: { color: "F8FAFF" },
      line: { color: "D8DEEA", pt: 1 },
    });

    slide.addText("Enter additional feedback here...", {
      x: 0.88,
      y: 1.1,
      w: 11.55,
      h: 6.0,
      fontFace: "Aptos",
      fontSize: 14,
      color: "64748B",
      italic: true,
      breakLine: true,
      align: "center",
      valign: "middle",
    });
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  const body = new Uint8Array(out as Buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safe(report.name)}.pptx"`,
    },
  });
}


