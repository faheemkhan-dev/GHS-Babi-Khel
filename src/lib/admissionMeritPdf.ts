// src/lib/admissionMeritPdf.ts — printable PDF of one published merit list
// (admin download from the Merit Lists tab). One A4 page, grid-based, no
// overlapping text: header, class/list/session, dates, listed entries with
// position/marks/%/remarks. Not-listed applicants are printed only when the
// list's show_not_listed flag is on — with names hidden, only the count row
// appears.
// ═══════════════════════════════════════════════════════════════════════════

const INK = "#1A1A1A";
const SUB = "#5C5C5C";
const MUTED = "#808080";
const GREEN = "#14532D";
const GOLD = "#A88228";
const GOLD_TINT = "#FBF5E2";
const GRID = "#C9C9C4";

export interface MeritPdfList {
  class_label: string;
  list_no: number;
  session_year: string | null;
  admission_start_date: string | null;
  admission_last_date: string | null;
  instructions?: string | null;
  published_at?: string | null;
  show_not_listed?: boolean;
}

export interface MeritPdfEntry {
  position: number;
  reference_no: string;
  name: string;
  father_name: string | null;
  previous_marks: string | null;
  marks_pct: number | null;
  remarks: string | null;
  is_listed: boolean;
}

export async function downloadMeritListPdf(input: {
  list: MeritPdfList;
  entries: MeritPdfEntry[];
  listedCount: number;
  notListedCount: number;
}): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;

  const fmt = (v: string | null | undefined) => {
    if (!v) return "—";
    try {
      return new Date(v.length === 10 ? `${v}T00:00:00` : v)
        .toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
    } catch { return String(v); }
  };

  // Header band
  doc.setFillColor(GREEN);
  doc.roundedRect(10, 8, W - 20, 19, 2, 2, "F");
  doc.setFillColor(GOLD);
  doc.rect(10, 27, W - 20, 1.2, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("GOVERNMENT HIGH SCHOOL BABI KHEL", W / 2, 14.5, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.text("DISTRICT MOHMAND | KHYBER PAKHTUNKHWA", W / 2, 18.8, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(GOLD_TINT);
  doc.text(
    `${input.list.class_label.toUpperCase()} — MERIT LIST #${input.list.list_no} · SESSION ${input.list.session_year ?? ""}`,
    W / 2, 24.4, { align: "center" },
  );

  let y = 33;

  // Dates + counts strip
  autoTable(doc, {
    startY: y,
    body: [
      [
        { content: "ADMISSION START", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: fmt(input.list.admission_start_date), styles: { textColor: INK, fontSize: 9 } },
        { content: "JOIN BY", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: fmt(input.list.admission_last_date), styles: { textColor: INK, fontSize: 9 } },
        { content: "PUBLISHED", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: fmt(input.list.published_at ?? undefined), styles: { textColor: INK, fontSize: 9 } },
      ],
      [
        { content: "MERIT LISTED", styles: { textColor: GREEN, fontStyle: "bold", fontSize: 7 } },
        { content: String(input.listedCount), styles: { textColor: GREEN, fontStyle: "bold", fontSize: 9 } },
        { content: "NOT MERIT LISTED", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        {
          content: input.list.show_not_listed === false
            ? `${input.notListedCount} (names not published)`
            : String(input.notListedCount),
          styles: { textColor: INK, fontSize: 9 },
        },
        { content: "GOVERNMENT HIGH SCHOOL BABI KHEL", styles: { textColor: MUTED, fontStyle: "bold", fontSize: 7 } },
        { content: "Merit ranked on previous class marks", styles: { textColor: SUB, fontSize: 8 } },
      ],
    ],
    theme: "grid",
    styles: { cellPadding: 1.6, lineColor: GOLD, lineWidth: 0.25, minCellHeight: 6, fillColor: GOLD_TINT, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 30 }, 1: { cellWidth: 28 },
      2: { cellWidth: 30 }, 3: { cellWidth: 28 },
      4: { cellWidth: "auto" }, 5: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12 },
  });
  y = (doc as any).lastAutoTable.finalY + 5;

  // Entries table (listed first — they are the list; not-listed only if visible)
  const visible = input.list.show_not_listed === false
    ? input.entries.filter((e) => e.is_listed)
    : input.entries;

  const rows: any[][] = visible.map((e) => [
    { content: String(e.position), styles: { halign: "center", textColor: INK, fontStyle: "bold", fontSize: 8 } },
    { content: e.reference_no, styles: { textColor: SUB, fontSize: 7.6 } },
    { content: e.name, styles: { textColor: INK, fontSize: 8.4 } },
    { content: e.father_name || "—", styles: { textColor: SUB, fontSize: 8 } },
    { content: e.previous_marks || "—", styles: { halign: "center", textColor: SUB, fontSize: 8 } },
    { content: e.marks_pct != null ? Number(e.marks_pct).toFixed(2) : "—", styles: { halign: "center", textColor: INK, fontSize: 8 } },
    { content: e.is_listed ? (e.remarks || "—") : "Not Merit Listed", styles: { textColor: e.is_listed ? SUB : "#B91C1C", fontStyle: e.is_listed ? "normal" : "bold", fontSize: 7.6 } },
  ]);

  autoTable(doc, {
    startY: y,
    head: [[
      { content: "#", styles: { halign: "center" } },
      { content: "REFERENCE NO." },
      { content: "NAME" },
      { content: "FATHER NAME" },
      { content: "MARKS", styles: { halign: "center" } },
      { content: "%", styles: { halign: "center" } },
      { content: "REMARKS" },
    ]],
    body: rows,
    theme: "grid",
    headStyles: { fillColor: GREEN, textColor: "#FFFFFF", fontSize: 7.4, fontStyle: "bold", cellPadding: 1.8 },
    styles: { cellPadding: 1.6, lineColor: GRID, lineWidth: 0.2, minCellHeight: 6.2, valign: "middle" },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 30 },
      2: { cellWidth: 42 },
      3: { cellWidth: 38 },
      4: { cellWidth: 18 },
      5: { cellWidth: 14 },
      6: { cellWidth: "auto" },
    },
    margin: { left: 12, right: 12 },
    didParseCell: (d: any) => {
      if (d.section === "body" && d.column.index === 6) {
        const e = visible[d.row.index];
        if (e && !e.is_listed) d.cell.styles.fillColor = "#FDECEC";
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // Instructions (if any) — measured
  if (input.list.instructions) {
    const lines = String(input.list.instructions).split(/\n+/).filter(Boolean);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(INK);
    doc.text("INSTRUCTIONS", 12, y);
    y += 4.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(SUB);
    for (const l of lines) {
      const wrapped: string[] = doc.splitTextToSize(l.replace(/^\d+\.\s*/, ""), 186);
      for (const wl of wrapped) {
        if (y > 280) break;
        doc.text(wl, 12, y);
        y += 3.4;
      }
    }
  }

  // Signature line
  const sigY = Math.min(Math.max(y + 8, 268), 282);
  doc.setDrawColor(SUB);
  doc.setLineWidth(0.3);
  doc.line(120, sigY, 192, sigY);
  doc.setFontSize(7.4);
  doc.setTextColor(MUTED);
  doc.text("Principal's Signature & School Stamp", 156, sigY + 4, { align: "center" });

  doc.setFontSize(7);
  doc.text(
    `Government High School Babi Khel | ${input.list.class_label} Merit List #${input.list.list_no} | Session ${input.list.session_year ?? ""}`,
    W / 2, 291, { align: "center" },
  );

  doc.save(`Merit-List-Class${input.list.class_label.replace(/\D/g, "")}-${input.list.list_no}.pdf`);
}
