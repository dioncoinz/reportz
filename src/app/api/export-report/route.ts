export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

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
  status: "open" | "complete" | "cancelled";
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function safe(name: string) {
  return name.replace(/[<>:"/\\|?*]/g, "").slice(0, 80);
}

function normalizeHex(raw: string | null | undefined, fallback = "C7662D") {
  const cleaned = (raw ?? "").trim().replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(cleaned) ? cleaned.toUpperCase() : fallback;
}

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };
}

function softBorder(color = "D8DEEA") {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color },
    bottom: { style: BorderStyle.SINGLE, size: 1, color },
    left: { style: BorderStyle.SINGLE, size: 1, color },
    right: { style: BorderStyle.SINGLE, size: 1, color },
  };
}

function divider(color = "D8DEEA") {
  return new Paragraph({
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 3,
        color,
      },
    },
    spacing: { after: 220 },
  });
}

function imgType(path: string): "png" | "jpg" {
  return path.toLowerCase().endsWith(".png") ? "png" : "jpg";
}

async function file(bucket: string, path: string) {
  const { data } = await supabase.storage.from(bucket).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function statusTheme(status: WorkOrderRow["status"]) {
  if (status === "complete") return { text: "1B8F5A", fill: "EAF8F0" };
  if (status === "cancelled") return { text: "B92C2C", fill: "FCEDEE" };
  return { text: "B67710", fill: "FFF7E4" };
}

function kpiCell(label: string, value: string, fill: string, color = "0F172A") {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill },
    borders: softBorder("D8DEEA"),
    margins: { top: 200, bottom: 200, left: 220, right: 220 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), size: 18, color: "5F6F88", bold: true })],
        spacing: { after: 120 },
      }),
      new Paragraph({
        children: [new TextRun({ text: value, size: 42, bold: true, color })],
      }),
    ],
  });
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function horizontalBar(value: number, max: number, fill = "1B8F5A", empty = "E7EDF7") {
  const percent = Math.max(0, Math.min(100, pct(value, max)));
  const remainder = 100 - percent;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: percent || 1, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill },
            borders: noBorders(),
            children: [new Paragraph({})],
          }),
          new TableCell({
            width: { size: remainder || 1, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: empty },
            borders: noBorders(),
            children: [new Paragraph({})],
          }),
        ],
      }),
    ],
  });
}

function statusBarRow(label: string, count: number, total: number, color: string) {
  const percent = pct(count, total);
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 26, type: WidthType.PERCENTAGE },
        borders: softBorder("E1E7F2"),
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, size: 19, color: "334155", bold: true })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: softBorder("E1E7F2"),
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(count), size: 19, bold: true, color })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: softBorder("E1E7F2"),
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [horizontalBar(count, total, color)],
      }),
      new TableCell({
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: softBorder("E1E7F2"),
        margins: { top: 90, bottom: 90, left: 120, right: 120 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `${percent}%`, size: 18, color, bold: true })],
          }),
        ],
      }),
    ],
  });
}

export async function GET(req: NextRequest) {
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

  const accent = normalizeHex(branding?.accent_hex, "C7662D");

  let logo: Buffer | null = null;
  if (branding?.logo_path) {
    logo = await file("branding-logos", branding.logo_path);
  }

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
  const open = total - complete - cancelled;
  const completePct = pct(complete, total);
  const openPct = pct(open, total);
  const cancelledPct = pct(cancelled, total);

  const updatesByDate = new Map<string, number>();
  for (const u of updates ?? []) {
    const d = new Date(u.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    updatesByDate.set(key, (updatesByDate.get(key) ?? 0) + 1);
  }

  const trendDays: Array<{ day: string; count: number }> = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    trendDays.push({ day: key, count: updatesByDate.get(key) ?? 0 });
  }
  const maxTrend = Math.max(...trendDays.map((x) => x.count), 1);
  const statusMixWidths = {
    complete: Math.max(completePct, complete > 0 ? 1 : 0),
    open: Math.max(openPct, open > 0 ? 1 : 0),
    cancelled: Math.max(cancelledPct, cancelled > 0 ? 1 : 0),
  };
  const mixSum = statusMixWidths.complete + statusMixWidths.open + statusMixWidths.cancelled;
  if (mixSum !== 100) {
    statusMixWidths.complete = Math.max(0, statusMixWidths.complete + (100 - mixSum));
  }

  const header = new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders(),
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 28, type: WidthType.PERCENTAGE },
                borders: noBorders(),
                children: [
                  new Paragraph({
                    children: logo
                      ? [new ImageRun({ data: logo, transformation: { width: 112, height: 38 }, type: "png" })]
                      : [new TextRun({ text: branding?.company_name ?? "Reportz", bold: true, size: 22, color: accent })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 72, type: WidthType.PERCENTAGE },
                borders: noBorders(),
                verticalAlign: VerticalAlign.CENTER,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: branding?.header_text ?? "Reportz", bold: true, size: 20, color: "0F172A" }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({ text: report.name, size: 18, color: "5F6F88" })],
                  }),
                ],
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({
                columnSpan: 2,
                borders: noBorders(),
                children: [divider("D8DEEA")],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      divider("D8DEEA"),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: branding?.footer_text ?? "Generated by Reportz", size: 17, color: "5F6F88" }),
          new TextRun({ text: " | Page ", size: 17, color: "5F6F88" }),
          new TextRun({ children: [PageNumber.CURRENT], size: 17, color: "5F6F88" }),
        ],
      }),
    ],
  });

  const title = [
    new Paragraph({ spacing: { after: 900 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: branding?.company_name ?? "Reportz", bold: true, size: 48, color: accent })],
      spacing: { after: 130 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Shutdown Completion Report", size: 30, color: "0F172A" })],
      spacing: { after: 180 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: report.name, bold: true, size: 36, color: "0F172A" })],
      spacing: { after: 320 },
    }),
    new Table({
      width: { size: 72, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      borders: softBorder("D8DEEA"),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Date Range", bold: true, size: 18, color: "5F6F88" })],
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: `${report.start_date ?? "N/A"} to ${report.end_date ?? "N/A"}`,
                      size: 22,
                      bold: true,
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const summary = [
    new Paragraph({
      children: [new TextRun({ text: "Executive Summary", bold: true, size: 34, color: "0F172A" })],
      spacing: { after: 150 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `This shutdown planned ${total} work orders: ${complete} completed, ${open} open, and ${cancelled} cancelled.`,
          size: 22,
          color: "334155",
        }),
      ],
      spacing: { after: 280 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      rows: [
        new TableRow({
          children: [
            kpiCell("Total", String(total), "F8FAFF"),
            kpiCell("Completed", String(complete), "EAF8F0", "1B8F5A"),
            kpiCell("Open", String(open), "FFF7E4", "B67710"),
            kpiCell("Cancelled", String(cancelled), "FCEDEE", "B92C2C"),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 220 } }),
    new Paragraph({
      children: [new TextRun({ text: "Visual Dashboard", bold: true, size: 30, color: "0F172A" })],
      spacing: { after: 120 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: softBorder("D8DEEA"),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              margins: { top: 140, bottom: 140, left: 180, right: 180 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: "Completion", size: 18, color: "5F6F88", bold: true })],
                  spacing: { after: 80 },
                }),
                horizontalBar(complete, Math.max(total, 1), "1B8F5A"),
                new Paragraph({
                  spacing: { before: 80 },
                  children: [new TextRun({ text: `${completePct}% complete`, size: 18, color: "1B8F5A", bold: true })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 100 } }),
    new Paragraph({
      children: [new TextRun({ text: "Status Mix", size: 22, bold: true, color: "334155" })],
      spacing: { after: 80 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: softBorder("D8DEEA"),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: statusMixWidths.complete || 1, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: "1B8F5A" },
              borders: noBorders(),
              children: [new Paragraph({})],
            }),
            new TableCell({
              width: { size: statusMixWidths.open || 1, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: "B67710" },
              borders: noBorders(),
              children: [new Paragraph({})],
            }),
            new TableCell({
              width: { size: statusMixWidths.cancelled || 1, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: "B92C2C" },
              borders: noBorders(),
              children: [new Paragraph({})],
            }),
          ],
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: noBorders(),
              children: [new Paragraph({ children: [new TextRun({ text: `Completed ${completePct}%`, color: "1B8F5A", bold: true, size: 17 })] })],
            }),
            new TableCell({
              borders: noBorders(),
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Open ${openPct}%`, color: "B67710", bold: true, size: 17 })] })],
            }),
            new TableCell({
              borders: noBorders(),
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Cancelled ${cancelledPct}%`, color: "B92C2C", bold: true, size: 17 })] })],
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 120 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      rows: [
        statusBarRow("Completed", complete, Math.max(total, 1), "1B8F5A"),
        statusBarRow("Open", open, Math.max(total, 1), "B67710"),
        statusBarRow("Cancelled", cancelled, Math.max(total, 1), "B92C2C"),
      ],
    }),
    new Paragraph({ spacing: { after: 120 } }),
    new Paragraph({
      children: [new TextRun({ text: "Update Activity (Last 7 Days)", size: 22, bold: true, color: "334155" })],
      spacing: { after: 80 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders(),
      rows: trendDays.map((row) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 22, type: WidthType.PERCENTAGE },
              borders: softBorder("E1E7F2"),
              margins: { top: 80, bottom: 80, left: 140, right: 140 },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: row.day, size: 17, color: "5F6F88" })] })],
            }),
            new TableCell({
              width: { size: 78, type: WidthType.PERCENTAGE },
              borders: softBorder("E1E7F2"),
              margins: { top: 80, bottom: 80, left: 140, right: 140 },
              children: [
                horizontalBar(row.count, maxTrend, accent, "E7EDF7"),
                new Paragraph({
                  spacing: { before: 80 },
                  children: [
                    new TextRun({
                      text: `${row.count} updates`,
                      size: 17,
                      color: "334155",
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      ),
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const detailBlocks: (Paragraph | Table)[] = [];

  for (const w of woRows) {
    const s = statusTheme(w.status);

    detailBlocks.push(
      new Paragraph({
        children: [new TextRun({ text: `${w.wo_number} | ${w.title ?? "Untitled work order"}`, bold: true, size: 28 })],
        spacing: { before: 100, after: 90 },
      }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: noBorders(),
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 35, type: WidthType.PERCENTAGE },
                borders: softBorder("D8DEEA"),
                shading: { type: ShadingType.CLEAR, fill: s.fill },
                margins: { top: 120, bottom: 120, left: 180, right: 180 },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: `Status: ${w.status.toUpperCase()}`, bold: true, color: s.text, size: 20 })],
                  }),
                ],
              }),
              new TableCell({
                width: { size: 65, type: WidthType.PERCENTAGE },
                borders: softBorder("D8DEEA"),
                margins: { top: 120, bottom: 120, left: 180, right: 180 },
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text:
                          w.status === "cancelled"
                            ? `Reason: ${w.cancelled_reason ?? "Not provided"}`
                            : w.status === "complete"
                            ? `Completed at: ${w.completed_at ? new Date(w.completed_at).toLocaleString() : "N/A"}`
                            : "In progress",
                        size: 20,
                        color: "334155",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { after: 130 } })
    );

    const list = updatesByWo.get(w.id) ?? [];

    if (!list.length) {
      detailBlocks.push(
        new Paragraph({
          children: [new TextRun({ text: "No updates were logged for this work order.", italics: true, color: "5F6F88", size: 20 })],
          spacing: { after: 180 },
        }),
        new Paragraph({ children: [new PageBreak()] })
      );
      continue;
    }

    for (const u of list) {
      detailBlocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: softBorder("D8DEEA"),
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  margins: { top: 120, bottom: 120, left: 180, right: 180 },
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: new Date(u.created_at).toLocaleString(), bold: true, size: 18, color: "5F6F88" })],
                      spacing: { after: 90 },
                    }),
                    new Paragraph({
                      children: [new TextRun({ text: u.comment || "No comment", size: 22, color: "0F172A" })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { after: 100 } })
      );

      for (const path of u.photo_urls ?? []) {
        const buf = await file("report-photos", path);
        if (!buf) continue;

        detailBlocks.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new ImageRun({ data: buf, transformation: { width: 520, height: 300 }, type: imgType(path) })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Site Photo", italics: true, size: 17, color: "5F6F88" })],
            spacing: { after: 130 },
          })
        );
      }
    }

    detailBlocks.push(new Paragraph({ children: [new PageBreak()] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 800, right: 800, bottom: 900, left: 800 } } },
        headers: { default: header },
        footers: { default: footer },
        children: [...title, ...summary, ...detailBlocks],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  const body = new Uint8Array(buf);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safe(report.name)}.docx"`,
    },
  });
}
