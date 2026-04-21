export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PptxGenJS from "pptxgenjs";

type ReportRow = {
  id: string;
  tenant_id: string;
  name: string;
  client_name: string | null;
  site_name: string | null;
  shutdown_name: string | null;
  start_date: string | null;
  end_date: string | null;
  key_personnel: string | null;
  vendor_key_contacts: string | null;
  client_key_contacts: string | null;
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
  cancelled_reason: string | null;
  completed_at: string | null;
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
const MAX_PHOTOS_PER_WORK_ORDER = 6;
const PHOTO_MAX_WIDTH = 1600;
const PHOTO_MAX_HEIGHT = 1200;
const PHOTO_JPEG_QUALITY = 82;
const LOGO_MAX_WIDTH = 1200;
const LOGO_MAX_HEIGHT = 400;
const LOGO_JPEG_QUALITY = 85;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function safe(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, "").slice(0, 80);
}

function isMissingColumn(error: { message?: string; code?: string } | null, column: string) {
  return Boolean(error?.message?.includes(column) || error?.code === "PGRST204");
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
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function optimizeImage(
  buf: Buffer,
  path: string,
  options?: {
    width?: number;
    height?: number;
    jpegQuality?: number;
    preservePng?: boolean;
    preserveWebp?: boolean;
  }
) {
  try {
    const { default: sharp } = await import("sharp");
    const ext = path.toLowerCase();
    const base = sharp(buf, { failOn: "none" }).rotate().resize({
      width: options?.width ?? PHOTO_MAX_WIDTH,
      height: options?.height ?? PHOTO_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    });

    if (ext.endsWith(".png") && options?.preservePng) {
      return {
        buffer: await base.png({ compressionLevel: 9, palette: true }).toBuffer(),
        mime: "image/png",
      };
    }

    if (ext.endsWith(".webp") && options?.preserveWebp) {
      return {
        buffer: await base.webp({ quality: options?.jpegQuality ?? PHOTO_JPEG_QUALITY }).toBuffer(),
        mime: "image/webp",
      };
    }

    return {
      buffer: await base.jpeg({ quality: options?.jpegQuality ?? PHOTO_JPEG_QUALITY, mozjpeg: true }).toBuffer(),
      mime: "image/jpeg",
    };
  } catch {
    return {
      buffer: buf,
      mime: imageMimeFromPath(path),
    };
  }
}

function asDataUri(buf: Buffer, mime: string) {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function statusColor(status: WorkOrderRow["status"]) {
  if (status === "complete") return "1B8F5A";
  if (status === "cancelled") return "B92C2C";
  if (status === "archived") return "64748B";
  return "B67710";
}

function getEntryKind(comment: string | null): "comments" | "issues" | "next" {
  if (!comment) return "comments";
  if (comment.startsWith(ISSUE_PREFIX)) return "issues";
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return "next";
  return "comments";
}

function cleanComment(comment: string | null) {
  if (!comment) return "";
  if (comment.startsWith(ISSUE_PREFIX)) return comment.slice(ISSUE_PREFIX.length).trim();
  if (comment.startsWith(NEXT_SHUT_PREFIX)) return comment.slice(NEXT_SHUT_PREFIX.length).trim();
  return comment.trim();
}

function contactText(value: string | null | undefined) {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function titleParts(report: ReportRow) {
  const client = report.client_name?.trim();
  const site = report.site_name?.trim();
  const shutdown = report.shutdown_name?.trim();

  if (client || shutdown) {
    return {
      clientSite: [client, site].filter(Boolean).join(" - ") || report.name,
      shutdown: shutdown || "",
    };
  }

  if (site) {
    const normalized = report.name.replace(/\s+/g, " ").trim();
    const siteIndex = normalized.toLowerCase().indexOf(site.toLowerCase());
    if (siteIndex >= 0) {
      const siteEnd = siteIndex + site.length;
      return {
        clientSite: normalized.slice(0, siteEnd).trim(),
        shutdown: normalized.slice(siteEnd).trim(),
      };
    }
  }

  return {
    clientSite: report.name,
    shutdown: "",
  };
}

function asBulletRuns(rows: UpdateRow[]) {
  const nonEmptyRows = rows
    .map((u) => ({ ...u, cleanedComment: cleanComment(u.comment) }))
    .filter((u) => u.cleanedComment.length > 0)
    .slice(0, 2);

  return nonEmptyRows.map((u, index, arr) => ({
    text: u.cleanedComment,
    options: {
      bullet: { indent: 14 },
      breakLine: index < arr.length - 1,
    },
  }));
}

function startMonthYear(dateStr: string | null) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function formatCompletedDate(dateStr: string | null) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
  }

  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: userRes, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userRes.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const userId = userRes.user.id;

  const id = req.nextUrl.searchParams.get("reportId");
  if (!id) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });

  const optionalReportColumns = [
    "client_name",
    "site_name",
    "shutdown_name",
    "key_personnel",
    "vendor_key_contacts",
    "client_key_contacts",
  ] as const;
  const missingReportColumns = new Set<(typeof optionalReportColumns)[number]>();
  let report: ReportRow | null = null;
  let reportErr: { message?: string; code?: string } | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selectColumns = [
      "id",
      "tenant_id",
      "name",
      missingReportColumns.has("client_name") ? null : "client_name",
      missingReportColumns.has("site_name") ? null : "site_name",
      missingReportColumns.has("shutdown_name") ? null : "shutdown_name",
      "start_date",
      "end_date",
      missingReportColumns.has("key_personnel") ? null : "key_personnel",
      missingReportColumns.has("vendor_key_contacts") ? null : "vendor_key_contacts",
      missingReportColumns.has("client_key_contacts") ? null : "client_key_contacts",
      "safety_injuries",
      "safety_incidents",
      "status",
    ].filter(Boolean);

    const result = await supabase
      .from("reports")
      .select(selectColumns.join(", "))
      .eq("id", id)
      .single<ReportRow>();

    report = result.data
      ? {
          ...result.data,
          client_name: result.data.client_name ?? null,
          site_name: result.data.site_name ?? null,
          shutdown_name: result.data.shutdown_name ?? null,
          key_personnel: result.data.key_personnel ?? null,
          vendor_key_contacts: result.data.vendor_key_contacts ?? null,
          client_key_contacts: result.data.client_key_contacts ?? null,
        }
      : null;
    reportErr = result.error;

    if (!reportErr) break;

    let foundMissingOptional = false;
    for (const column of optionalReportColumns) {
      if (!missingReportColumns.has(column) && isMissingColumn(reportErr, column)) {
        missingReportColumns.add(column);
        foundMissingOptional = true;
      }
    }
    if (!foundMissingOptional) break;
  }

  if (reportErr || !report) {
    return NextResponse.json({ error: reportErr?.message ?? "Report not found" }, { status: 404 });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .single<{ tenant_id: string | null }>();
  if (profileErr || !profile?.tenant_id) {
    return NextResponse.json({ error: "Profile tenant not set." }, { status: 403 });
  }
  if (profile.tenant_id !== report.tenant_id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { data: branding } = await supabase
    .from("tenant_branding")
    .select("company_name, header_text, footer_text, logo_path, accent_hex")
    .eq("tenant_id", report.tenant_id)
    .maybeSingle<BrandingRow>();

  const { data: wos } = await supabase
    .from("work_orders")
    .select("id, wo_number, title, status, cancelled_reason, completed_at")
    .eq("report_id", id)
    .order("wo_number")
    .returns<WorkOrderRow[]>();

  const woRows = wos ?? [];
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

  const total = woRows.length;
  const complete = woRows.filter((w) => w.status === "complete").length;
  const cancelled = woRows.filter((w) => w.status === "cancelled").length;
  const open = woRows.filter((w) => w.status === "open").length;
  const safetyInjuries = Math.max(report.safety_injuries ?? 0, 0);
  const safetyIncidents = Math.max(report.safety_incidents ?? 0, 0);

  const accent = normalizeHex(branding?.accent_hex, "C7662D");
  const company = branding?.company_name ?? "Reportz";
  const vendorContacts = contactText(report.vendor_key_contacts || report.key_personnel);
  const clientContacts = contactText(report.client_key_contacts);
  const title = titleParts(report);

  let logoData: string | null = null;
  if (branding?.logo_path) {
    const logo = await file("branding-logos", branding.logo_path);
    if (logo) {
      const optimizedLogo = await optimizeImage(logo, branding.logo_path, {
        width: LOGO_MAX_WIDTH,
        height: LOGO_MAX_HEIGHT,
        jpegQuality: LOGO_JPEG_QUALITY,
        preservePng: true,
        preserveWebp: true,
      });
      logoData = asDataUri(optimizedLogo.buffer, optimizedLogo.mime);
    }
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Reportz";
  pptx.company = company;
  pptx.subject = `Shutdown report: ${title.clientSite}`;
  pptx.title = `${title.clientSite} - Shutdown Report`;

  // Slide 1: Title
  {
    const slide = pptx.addSlide();
    slide.background = { color: "F6F7FB" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.35, fill: { color: accent }, line: { color: accent } });
    if (logoData) {
      slide.addImage({
        data: logoData,
        x: 0.6,
        y: 0.55,
        w: 2.2,
        h: 0.8,
        sizing: { type: "contain", w: 2.2, h: 0.8 },
      });
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
    slide.addText(title.clientSite, {
      x: 0.6,
      y: 3.05,
      w: 12,
      h: 0.45,
      fontFace: "Aptos",
      fontSize: 28,
      bold: true,
      color: "0F172A",
    });
    if (title.shutdown) {
      slide.addText(title.shutdown, {
        x: 0.6,
        y: 3.82,
        w: 12,
        h: 0.32,
        fontFace: "Aptos",
        fontSize: 16,
        bold: true,
        color: "334155",
      });
    }
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y: 4.35,
      w: 6.9,
      h: 1.15,      fill: { color: "FFFFFF" },
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
      x: 7.8,
      y: 4.35,
      w: 4.9,
      h: 1.15,
      fill: { color: "FFFFFF" },
      line: { color: "D8DEEA", pt: 1 },
    });
    slide.addText("Key Personnel", {
      x: 8.1,
      y: 4.52,
      w: 4.3,
      h: 0.25,
      fontFace: "Aptos",
      fontSize: 11,
      bold: true,
      color: "64748B",
    });
    slide.addText("Vendor", {
      x: 8.1,
      y: 4.78,
      w: 2,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 8,
      bold: true,
      color: "64748B",
    });
    slide.addText("Client", {
      x: 10.25,
      y: 4.78,
      w: 2,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 8,
      bold: true,
      color: "64748B",
    });
    slide.addText(vendorContacts || "Not provided", {
      x: 8.1,
      y: 4.98,
      w: 2,
      h: 0.32,
      fontFace: "Aptos",
      fontSize: 8,
      color: "334155",
      fit: "shrink",
    });
    slide.addText(clientContacts || "Not provided", {
      x: 10.25,
      y: 4.98,
      w: 2.2,
      h: 0.32,
      fontFace: "Aptos",
      fontSize: 8,
      color: "334155",
      fit: "shrink",
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

    const kpi = [
      { label: "Total", val: total, bg: "F8FAFF", color: "0F172A" },
      { label: "Completed", val: complete, bg: "EAF8F0", color: "1B8F5A" },
      { label: "Open", val: open, bg: "FFF7E4", color: "B67710" },
      { label: "Cancelled", val: cancelled, bg: "FCEDEE", color: "B92C2C" },
    ];

    kpi.forEach((k, i) => {
      const x = 0.6 + i * 3.1;
      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y: 1.1,
        w: 2.85,
        h: 1.25,        fill: { color: k.bg },
        line: { color: "D8DEEA", pt: 1 },
      });
      slide.addText(k.label, { x: x + 0.2, y: 1.3, w: 2.4, h: 0.25, fontFace: "Aptos", fontSize: 11, color: "5F6F88", bold: true });
      slide.addText(String(k.val), { x: x + 0.2, y: 1.58, w: 2.4, h: 0.55, fontFace: "Aptos", fontSize: 28, color: k.color, bold: true });
    });

    // Status composition bar
    const mix = [
      { label: "Completed", value: complete, color: "1B8F5A" },
      { label: "Open", value: open, color: "B67710" },
      { label: "Cancelled", value: cancelled, color: "B92C2C" },
    ];
    const mixTotal = Math.max(total, 1);
    let cursor = 0.6;
    const width = 12.1;

    slide.addText("Status Mix", { x: 0.6, y: 2.75, w: 3, h: 0.3, fontFace: "Aptos", fontSize: 14, bold: true, color: "334155" });
    mix.forEach((m) => {
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
    mix.forEach((m) => {
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
    const remaining = Math.max(total - complete, 0);
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
        { name: "Compliance", labels: ["Completed", "Remaining"], values: [complete, remaining] },
      ],
      {
        x: complianceX + 0.18,
        y: 4.1,
        w: 1.95,
        h: 2.45,
        showLegend: false,
        holeSize: 68,
        chartColors: ["1B8F5A", "E2E8F0"],
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

    slide.addText(
      [
        { text: "Injuries: ", options: { color: "334155" } },
        { text: String(safetyInjuries), options: { color: safetyInjuries > 0 ? "B92C2C" : "1B8F5A" } },
      ],
      {
        x: safetyTextX,
        y: 4.45,
        w: safetyTextW,
        h: 0.34,
        fontFace: "Aptos",
        fontSize: 22,
        bold: true,
        align: "center",
      }
    );
    slide.addText(
      [
        { text: "Incidents: ", options: { color: "334155" } },
        { text: String(safetyIncidents), options: { color: safetyIncidents > 0 ? "B92C2C" : "1B8F5A" } },
      ],
      {
        x: safetyTextX,
        y: 5.0,
        w: safetyTextW,
        h: 0.34,
        fontFace: "Aptos",
        fontSize: 22,
        bold: true,
        align: "center",
      }
    );
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
  for (const w of woRows) {
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

    const list = updatesByWo.get(w.id) ?? [];
    const statusMeta =
      w.status === "cancelled"
        ? `Reason: ${w.cancelled_reason ?? "Not provided"}`
        : w.status === "complete"
        ? `Completed: ${formatCompletedDate(w.completed_at)}`
        : "In progress";

    slide.addText(statusMeta, {
      x: 3.2,
      y: 1.36,
      w: 6.8,
      h: 0.22,
      fontFace: "Aptos",
      fontSize: 11,
      color: "334155",
    });

    const comments = list.filter((u) => getEntryKind(u.comment) === "comments");
    const issues = list.filter((u) => getEntryKind(u.comment) === "issues");
    const next = list.filter((u) => getEntryKind(u.comment) === "next");
    const allPhotoPaths = [...new Set(list.flatMap((u) => u.photo_urls ?? []))].slice(0, MAX_PHOTOS_PER_WORK_ORDER);

    const sections = [
      { title: "Comments", rows: comments, y: 2.05 },
      { title: "Issues", rows: issues, y: 3.78 },
      { title: "Emergent Work", rows: next, y: 5.51 },
    ] as const;

    for (const section of sections) {
      const bulletRuns = asBulletRuns(section.rows);

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: section.y,
        w: 7.35,
        h: 1.45,
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

      slide.addText(bulletRuns.length ? bulletRuns : "No entries.", {
        x: 0.9,
        y: section.y + 0.42,
        w: 6.8,
        h: 0.9,
        fontFace: "Aptos",
        fontSize: 11,
        color: "334155",
      });

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
      x: galleryX + 0.23,
      y: galleryY + 0.11,
      w: 4.1,
      h: 0.24,
      fontFace: "Aptos",
      fontSize: 12,
      bold: true,
      color: "0F172A",
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

      const optimizedPhoto = await optimizeImage(pbuf, path);
      const photoData = asDataUri(optimizedPhoto.buffer, optimizedPhoto.mime);
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = galleryX + 0.23 + col * 2.1;
      const y = galleryContentY + 0.08 + row * 1.56;
      const w = 1.98;
      const h = 1.44;

      slide.addImage({
        data: photoData,
        x,
        y,
        w,
        h,
        sizing: { type: "contain", w, h },
      });
    }
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

