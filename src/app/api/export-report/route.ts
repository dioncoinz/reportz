export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PptxGenJS from "pptxgenjs";

type ReportRow = {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
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
const exportOwnerUserId = process.env.EXPORT_OWNER_USER_ID?.trim() ?? "";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
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

function startMonthYear(dateStr: string | null) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "N/A";
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export async function GET(req: NextRequest) {
  if (!exportOwnerUserId) {
    return NextResponse.json({ error: "Export access is not configured." }, { status: 500 });
  }

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
  if (userRes.user.id !== exportOwnerUserId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("reportId");
  if (!id) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });

  const { data: report, error: reportErr } = await supabase
    .from("reports")
    .select("id, tenant_id, name, start_date, end_date, status")
    .eq("id", id)
    .single<ReportRow>();

  if (reportErr || !report) {
    return NextResponse.json({ error: reportErr?.message ?? "Report not found" }, { status: 404 });
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

    slide.addText("Schedule Compliance", {
      x: 5.3,
      y: 3.55,
      w: 4.8,
      h: 0.3,
      fontFace: "Aptos",
      fontSize: 14,
      bold: true,
      color: "334155",
    });

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 5.25,
      y: 3.9,
      w: 7.1,
      h: 3.05,
      fill: { color: "F8FAFF" },
      line: { color: "D8DEEA", pt: 1 },
    });

    slide.addChart(
      pptx.ChartType.doughnut,
      [
        { name: "Compliance", labels: ["Completed", "Remaining"], values: [complete, remaining] },
      ],
      {
        x: 5.5,
        y: 4.15,
        w: 3.4,
        h: 2.5,
        showLegend: false,
        holeSize: 68,
        chartColors: ["1B8F5A", "E2E8F0"],
        showValue: false,
      }
    );

    slide.addText(`${compliancePct}%`, {
      x: 8.95,
      y: 4.45,
      w: 2.9,
      h: 0.62,
      fontFace: "Aptos",
      fontSize: 40,
      bold: true,
      color: "1B8F5A",
      align: "center",
    });
    slide.addText("On-schedule completion", {
      x: 8.95,
      y: 5.08,
      w: 2.9,
      h: 0.28,
      fontFace: "Aptos",
      fontSize: 10,
      color: "64748B",
      align: "center",
    });
    slide.addText(`${complete} completed of ${total} total`, {
      x: 8.95,
      y: 5.42,
      w: 2.9,
      h: 0.25,
      fontFace: "Aptos",
      fontSize: 11,
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
        ? `Completed at: ${w.completed_at ? new Date(w.completed_at).toLocaleString() : "N/A"}`
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
    const allPhotoPaths = list.flatMap((u) => u.photo_urls ?? []).slice(0, 6);

    const sections = [
      { title: "Comments", rows: comments, y: 2.05 },
      { title: "Issues", rows: issues, y: 3.9 },
    ] as const;

    for (const section of sections) {
      const lines = section.rows.slice(0, 2).map((u) => `- ${cleanComment(u.comment) || "No comment"}`);

      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.6,
        y: section.y,
        w: 7.35,
        h: 1.6,
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

      slide.addText(lines.length ? lines.join("\n") : "No entries.", {
        x: 0.82,
        y: section.y + 0.42,
        w: 6.95,
        h: 1.04,
        fontFace: "Aptos",
        fontSize: 11,
        color: "334155",
        breakLine: true,
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

      const photoData = asDataUri(pbuf, imageMimeFromPath(path));
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

