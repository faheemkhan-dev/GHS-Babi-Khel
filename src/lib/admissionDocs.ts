import toast from "react-hot-toast";
import { supabasePublic } from "@/lib/supabase";

/**
 * Admission documents (printable forms + prospectus text).
 *
 * Perf: this module holds ~40 KB of static document text and three HTML
 * generators. It is loaded with a dynamic import() the moment a visitor taps
 * a download button — it is NOT part of the Admission page bundle, so the
 * portal opens fast even on slow connections.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchoolLike = Record<string, any> | null | undefined;

// ── Downloadable documents with colored icons & file size hints ─────────
export const DOWNLOAD_ITEMS = [
  {
    key: "prospectus",
    title: "Admission Prospectus",
    icon: "📖",
    iconBg: "bg-blue-500",
    desc: "Complete guide to admissions, programs & requirements",
    fileSize: "PDF, ~2 MB",
    pdfTitle: "Admission Prospectus",
    pdfSections: [
      { heading: "Welcome", body: `Welcome to our school's Admission Portal. We are committed to providing quality education and nurturing the future leaders of Pakistan. This prospectus contains general information to help you apply. Final eligibility, fees, and requirements are always confirmed by the school office and, where applicable, BISE Peshawar / the KP Elementary & Secondary Education Department.` },
      { heading: "Available Programs", body: `• Class 6–8: Fresh admission (school-level, not BISE-registered)\n• Class 9: Fresh admission — student is later enrolled with BISE Peshawar by the school\n• Class 9 & 10 Migration: For students already studying elsewhere who wish to transfer, processed as school-to-school migration on the BISE Peshawar portal\n• Class 6–8 transfer: Handled directly between schools; not a BISE board process` },
      { heading: "Preliminary Eligibility", body: `The online "Check Eligibility" tool on our website gives a preliminary, non-final indication only. It currently checks the one age rule officially published by BISE Peshawar (minimum age for Class 9 enrollment). Final eligibility for all classes depends on document verification by the school and, for Class 9/10, on BISE Peshawar's enrollment/migration rules for the relevant academic year.` },
      { heading: "Documents (where applicable)", body: `• B-Form (NADRA) — required for all applicants\n• Recent passport-size photograph — required for all applicants\n• Previous class result card / marksheet — required for all applicants where applicable\n• School Leaving Certificate (SLC) — required for ALL applicants (both Fresh Admission and Migration/Transfer), per GHS Babi Khel admission policy\n• Father's/Guardian's CNIC copy — required for all applicants\n• For Class 9/10 migration from another BISE-affiliated school ONLY: DMC, migration certificate from the previous Board, and enrollment/reference letter from the previous school's head — submitted by the schools to BISE Peshawar as part of the portal migration, per current BISEP notification requirements` },
      { heading: "How Admission Works", body: `Online:\n1. Fill the online eligibility application on our website\n2. Receive a reference number for tracking\n3. School reviews your application and documents\n4. If approved, download the printable form, fill it, attach documents, and bring them to the school office to complete enrollment\n\nOffline (at the school office):\n1. Download and print the Admission Application Form from our website\n2. Fill it by hand and attach photocopies of required documents\n3. Submit it in person at the school office\n\nFor Class 9/10 migration specifically: school-level approval of your application is separate from the BISE Peshawar school-to-school migration on their portal, which is carried out by the schools within BISEP's notified migration window for the academic year — it is not completed simply by submitting our online form.` },
      { heading: "Important Notes", body: `• Keep your reference number safe after submission\n• Ensure all documents are clear and legible\n• Admission is subject to availability of seats and school/BISE Peshawar approval\n• The school reserves the right to reject incomplete applications\n• All information provided must be accurate — false information may result in rejection or cancellation` },
    ],
  },
  {
    key: "fee_structure",
    title: "Fee Structure",
    icon: "💰",
    iconBg: "bg-green-500",
    desc: "Tuition fees, BISE charges & payment details",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "Fee Structure",
    pdfSections: [
      { heading: "School Fee Policy", body: `Government High Schools in KPK operate under the free education policy. There are generally no tuition fees for regular students. Any school-level charges (if applicable) are confirmed at the school office, as these can vary by session and are not fixed centrally.` },
      { heading: "BISE Peshawar Charges (Class 9 & 10)", body: `Any applicable BISE Peshawar fees (enrollment, migration, or related charges) are subject to the current Board notification/fee schedule for the academic session. Fee amounts can vary and are set by BISE Peshawar — please confirm the current amounts and deadlines with the school office or directly with BISEP before making any payment. Fees are paid through the Board's designated payment channels (e.g., bank/branchless banking), not to the school directly.` },
      { heading: "Migration / Related BISEP Charges", body: `Where BISE Peshawar migration or related processes apply (Class 9 & 10 only), any applicable Board fees are subject to the current BISEP notification for that academic session. These may include enrollment fees, migration processing fees, or correction charges as notified by the Board. Always confirm current amounts with the school office or BISEP before payment — this prospectus does not list specific amounts since they are set by the Board and may change each session.` },
      { heading: "Payment Method", body: `• BISE Peshawar charges: paid through the board's designated payment channels (e.g., bank/branchless banking, as notified by BISEP for the session) — computer-generated receipts only\n• Any school-level charges (if applicable): paid at the school office during working hours\n• Fee concessions, where available, are considered case-by-case by the school` },
    ],
  },
  {
    key: "migration_template",
    title: "School-to-School Transfer Reference Letter",
    icon: "✉️",
    iconBg: "bg-amber-500",
    desc: "Reference letter template to request transfer records from your current school",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "School-to-School Transfer Reference Letter",
    pdfSections: [
      { heading: "Important — please read first", body: `This is a reference/consent letter you can use to formally inform your current school of your intent to transfer, and to request your School Leaving Certificate. For Class 9 & 10, the actual migration is completed by the two schools directly on the BISE Peshawar portal, within BISEP's notified migration window for the academic year — this letter supports that process but does not itself complete migration. It does not need signatures from both principals unless your current school specifically requires it as part of its own internal process.` },
      { heading: "Reference Letter Template", body: `From: ___________________ (Parent/Guardian Name)\nFather/Guardian of: ___________________ (Student Name)\nCurrent Class: ___________________\nB-Form No: ___________________\n\nTo,\nThe Head of Institution,\n___________________ (Current School Name),\n___________________ (Current School Address)\n\nSubject: Request for School Leaving Certificate & Transfer Records\n\nRespected Sir/Madam,\n\nWith due respect, I wish to transfer my son/daughter ___________________ (B-Form No: ____________), currently studying in Class _____ at your institution, to ___________________ (New School Name, District Mohmand). I request that the School Leaving Certificate and relevant academic records be issued, and — where the class requires BISE Peshawar migration — that the school-to-school migration be initiated on the BISEP portal at your convenience within the current migration window.\n\nI shall be grateful for your cooperation.\n\nDate: _______________\n\nSignature of Parent/Guardian: _______________\n\n--- For School Office Use ---\nReceived by (Current School): _______________  Date: _______________\nSLC Issued: ☐ Yes ☐ Pending   BISEP Migration Initiated (if applicable): ☐ Yes ☐ N/A` },
    ],
  },
  {
    key: "rules",
    title: "Admission Rules",
    icon: "📏",
    iconBg: "bg-red-500",
    desc: "Admission policies, eligibility & procedures",
    fileSize: "PDF, ~1 MB",
    pdfTitle: "Admission Rules & Regulations",
    pdfSections: [
      { heading: "General Rules", body: `1. Admission is open to all eligible students regardless of gender, religion, or ethnicity.\n2. Applications can be submitted online through the school portal, or by downloading the admission form and submitting it in person at the school office.\n3. Incomplete applications will not be considered.\n4. All information provided must be accurate. False information may result in rejection or cancellation of admission.\n5. The school reserves the right to accept or reject any application, subject to seat availability and applicable rules.` },
      { heading: "Age Requirement", body: `The only numeric age rule we can currently confirm from an official source is BISE Peshawar's published minimum age for Class 9 enrollment: a candidate must be at least 12 years old (i.e. not "above 12 years" short of the minimum) as of the date specified in that session's enrollment notification. For Classes 6, 7, 8, and 10, age suitability is assessed by the school office according to current KP Elementary & Secondary Education Department policy at the time of admission — we do not publish a fixed age table for these classes here, since it can vary by policy/session; please confirm with the school office.` },
      { heading: "Migration / Transfer Rules (Class 9 & 10)", body: `1. Board-level migration on the BISE Peshawar portal applies to Class 9 and Class 10 students moving between BISE-Peshawar-affiliated institutions, or between boards.\n2. A valid School Leaving Certificate from the previous school is required.\n3. Migration (school-to-school) is carried out on the BISEP portal by the sending and receiving schools, within the board's notified migration window for the academic year (typically from declaration of the SSC Annual-I result through 31 December) — it is not completed by the parent/student submitting a form to BISEP directly.\n4. For students migrating from another Board, the receiving school submits the student's DMC, migration certificate, and a reference/enrollment letter from the previous school's head to BISE Peshawar, along with the prescribed fee.\n5. Any applicable BISEP fee is paid through the board's designated channels.\n6. For Class 6–8, a transfer between schools is handled at the school level and does not go through the BISE Peshawar portal.` },
      { heading: "Document Requirements", body: `• B-Form (NADRA) is required for all applicants.\n• Passport size photograph should be recent.\n• Result card from the previous class should be from a recognized board/school (where applicable).\n• School Leaving Certificate (SLC) is REQUIRED for ALL admissions — both Fresh Admission and Migration/Transfer — per GHS Babi Khel admission policy. This is our school's standard requirement.\n• Father's/Guardian's CNIC copy should be valid and legible.\n• For Class 9/10 migration from another Board ONLY: additionally requires DMC, migration certificate, and enrollment/reference letter as listed under Migration Rules above. These are BISE-specific requirements, separate from our school's SLC requirement.` },
      { heading: "Cancellation Policy", body: `• Admission can be cancelled if documents are found to be forged or inaccurate.\n• Admission can be cancelled if the student fails to attend classes within the period set by the school after confirmation.\n• A pending migration case may lapse if BISEP's portal procedures/window are not completed by the relevant deadline.\n• Any fee refund (where applicable) follows the school's or BISE Peshawar's own refund policy, as relevant.` },
    ],
  },
] as const;

export type DownloadItem = (typeof DOWNLOAD_ITEMS)[number];

export async function downloadAdmissionDoc(item: DownloadItem, libFile: { url: string; id: string } | undefined, school: SchoolLike): Promise<void> {
  try {
      if (libFile?.url) {
      try {
        const resp = await fetch(libFile.url);
        if (resp.ok) {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `${item.title}.pdf`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast.success(`Downloaded ${item.title}`);
          try { await supabasePublic.rpc("increment_download_count", { file_id: libFile.id }); } catch { /* intentional */ }
          return;
        }
      } catch { /* intentional */ }
      window.open(libFile.url, "_blank");
      toast.success(`Opening ${item.title}`);
      try { await supabasePublic.rpc("increment_download_count", { file_id: libFile.id }); } catch { /* intentional */ }
      return;
    }

    const schoolName = school?.school_name || "GHS Babi Khel";
    const tagline = school?.tagline || "Excellence in Education";
    const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
    const logoUrl = school?.logo_url || "";
    const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

    // Distinct accent color per document, echoing each card's icon color
    // on the site (blue = Prospectus, green = Fee Structure, amber =
    // Transfer template, red = Rules) so each PDF feels purpose-built
    // rather than a single generic template reused four times.
    const ACCENTS: Record<string, { main: string; dark: string; soft: string; text: string }> = {
      prospectus:         { main: "#3b82f6", dark: "#1d4ed8", soft: "#eff6ff", text: "#1e40af" },
      fee_structure:       { main: "#15803D", dark: "#14532D", soft: "#F0F7F1", text: "#14532D" },
      migration_template:  { main: "#f59e0b", dark: "#b45309", soft: "#fffbeb", text: "#92400e" },
      rules:               { main: "#ef4444", dark: "#b91c1c", soft: "#fef2f2", text: "#991b1b" },
    };
    const accent = ACCENTS[item.key] || { main: "#B8860B", dark: "#8A6508", soft: "#F5E6C4", text: "#14532D" };

    const sectionsHtml = item.pdfSections.map((s, i) => `
      <div style="margin-bottom:18px;page-break-inside:avoid;">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;">
          <span style="flex-shrink:0;width:22px;height:22px;border-radius:7px;background:${accent.main};color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;">${i + 1}</span>
          <h3 style="font-size:14.5px;font-weight:800;color:${accent.text};margin:0;letter-spacing:0.2px;">${s.heading}</h3>
        </div>
        <p style="font-size:12px;line-height:1.75;color:#334155;white-space:pre-wrap;margin:0 0 0 31px;padding:10px 14px;background:${accent.soft};border-left:3px solid ${accent.main};border-radius:0 8px 8px 0;">${s.body}</p>
      </div>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${item.pdfTitle}</title>
      <style>
        @page { margin: 18mm 16mm; size: A4; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.6; }

        .topband { height: 7px; background: linear-gradient(90deg, ${accent.dark} 0%, ${accent.main} 55%, #f0a55f 100%); border-radius: 0 0 4px 4px; margin-bottom: 16px; }

        .header { display: flex; align-items: center; gap: 13px; border-bottom: 3px solid ${accent.main}; padding-bottom: 13px; margin-bottom: 18px; }
        .logo-wrap { width: 54px; height: 54px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .logo-wrap img { width: 100%; height: 100%; object-fit: cover; }
        .header-text { flex: 1; }
        .school-name { font-size: 20px; font-weight: 800; color: #0E3B20; letter-spacing: 0.3px; font-family: Georgia, 'Times New Roman', serif; }
        .tagline { font-size: 10.5px; color: ${accent.text}; font-weight: 600; margin-top: 2px; letter-spacing: 0.4px; }
        .address { font-size: 9.5px; color: #94a3b8; margin-top: 3px; }

        .doc-title-wrap { text-align: center; margin: 6px 0 20px; }
        .doc-title { display: inline-block; font-size: 16.5px; font-weight: 800; color: #ffffff; padding: 9px 26px; background: linear-gradient(135deg, ${accent.dark}, ${accent.main}); border-radius: 999px; letter-spacing: 0.3px; }

        .footer { text-align: center; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 26px; font-size: 8.5px; color: #94a3b8; }
        .footer span { color: ${accent.text}; font-weight: 700; }
      </style></head><body>

      <div class="topband"></div>

      <div class="header">
        <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:20px;">🏫</span>`}</div>
        <div class="header-text">
          <div class="school-name">${schoolName}</div>
          <div class="tagline">${tagline}</div>
          <div class="address">${address}</div>
        </div>
      </div>

      <div class="doc-title-wrap"><span class="doc-title">${item.pdfTitle}</span></div>

      ${sectionsHtml}

      <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; ${window.location.origin}</div>
    </body></html>`;

    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.write(html); printWin.document.close();
      printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
      toast.success(`Generating ${item.title} — use Save as PDF in print dialog`);
    } else {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${item.title}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success(`Downloaded ${item.title}`);
    }
  } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
}

export function generateFilledForm(school: SchoolLike, form: Record<string, any>): void {
  try {
    const schoolName = school?.school_name || "GHS Babi Khel";
    const tagline = school?.tagline || "Excellence in Education";
    const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
    const logoUrl = school?.logo_url || "";
    const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Pre-filled underline field — shows the applicant's entered value instead of a blank line.
    // Plain block-level markup (no tables) so the print/PDF renderer can't
    // double-paint nested table rows — label sits above the underline.
    const line = (labelText: string, value: string, _widthPct?: number, required = false) =>
      `<div style="margin-bottom:10px;">
        <div style="font-size:9.5px;font-weight:600;color:#0E3B20;text-transform:uppercase;letter-spacing:0.2px;margin-bottom:3px;">${labelText}${required ? ' <span style="color:#B8860B;">*</span>' : ''}</div>
        <div style="font-size:11px;font-weight:600;color:#1e293b;border-bottom:1.5px solid #94a3b8;padding-bottom:3px;min-height:15px;">${esc(value) || "&nbsp;"}</div>
      </div>`;

    const lineRow = (fields: string[]) =>
      `<div style="display:flex;gap:16px;">${fields.map(f => `<div style="flex:1;min-width:0;">${f}</div>`).join("")}</div>`;
    // Checkbox that renders filled/checked when it matches the applicant's selection
    const checkbox = (labelText: string, checked = false) => `
      <span style="display:inline-flex;align-items:center;gap:7px;margin:0 20px 10px 0;font-size:12px;color:#1e293b;font-weight:500;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border:1.6px solid #0E3B20;border-radius:4px;flex-shrink:0;background:${checked ? "#0E3B20" : "transparent"};color:#fff;font-size:11px;font-weight:800;line-height:1;">${checked ? "✓" : ""}</span>${labelText}
      </span>`;

    const docChecklist = [
      "B-Form (NADRA) — Required for all applicants",
      "Recent Passport Size Photo — Required for all applicants",
      "Previous Result Card / Marksheet — Required where applicable",
      "School Leaving Certificate (SLC) — REQUIRED for all applicants (Fresh Admission & Migration/Transfer), per GHS Babi Khel policy",
      "Father's/Guardian's CNIC Copy — Required for all applicants",
      "DMC & Migration Certificate from previous Board — Class 9/10 migration from another Board only (BISE requirement), submitted by schools",
    ].map(d => `<li style="margin-bottom:6px;">${d}</li>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admission Application Form</title>
      <style>
        @page { margin: 14mm 16mm; size: A4; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; line-height: 1.5; }

        /* ── Decorative top band ── */
        .topband { height: 8px; background: linear-gradient(90deg, #0E3B20 0%, #14532D 45%, #B8860B 100%); border-radius: 0 0 4px 4px; margin-bottom: 16px; }

        /* ── Header ── */
        .header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #0E3B20; padding-bottom: 14px; margin-bottom: 18px; }
        .logo-wrap { width: 58px; height: 58px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
        .logo-wrap img { width: 100%; height: 100%; object-fit: cover; }
        .header-text { flex: 1; }
        .school-name { font-size: 22px; font-weight: 800; color: #0E3B20; letter-spacing: 0.3px; font-family: Georgia, 'Times New Roman', serif; }
        .tagline { font-size: 11px; color: #B8860B; font-weight: 600; margin-top: 2px; letter-spacing: 0.5px; }
        .address { font-size: 9.5px; color: #94a3b8; margin-top: 3px; }
        .header-badge { text-align: right; font-size: 9px; color: #64748b; }
        .header-badge .yr { font-size: 13px; font-weight: 800; color: #0E3B20; }

        .doc-title-wrap { text-align: center; margin: 4px 0 8px; }
        .doc-title { display: inline-block; font-size: 17px; font-weight: 800; color: #ffffff; padding: 9px 28px; background: linear-gradient(135deg, #0E3B20, #14532D); border-radius: 999px; letter-spacing: 0.4px; }
        .doc-sub { font-size: 10.5px; color: #64748b; text-align: center; margin: 8px 0 18px; font-style: italic; }
        .intro-row { display: flex; align-items: flex-start; justify-content: center; gap: 18px; margin: 8px 0 20px; flex-wrap: wrap; }
        .intro-text { flex: 1; min-width: 200px; max-width: 420px; }

        .section-title { font-size: 12.5px; font-weight: 800; color: #0E3B20; margin: 20px 0 10px; padding: 6px 12px; background: #F5E6C4; border-left: 4px solid #B8860B; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.4px; }

        .note { font-size: 10px; color: #475569; background: #FDFBF2; border: 1px dashed #f0a55f; border-radius: 6px; padding: 9px 12px; margin-top: 6px; }

        .photo-box { flex-shrink: 0; width: 92px; height: 110px; border: 1.6px dashed #94a3b8; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #94a3b8; text-align: center; padding: 6px; }

        .footer { text-align: center; border-top: 2px solid #e2e8f0; padding-top: 10px; margin-top: 24px; font-size: 8.5px; color: #94a3b8; }
        .footer span { color: #0E3B20; font-weight: 700; }

        .officebox { border: 1.6px dashed #B8860B; border-radius: 8px; padding: 12px 14px; margin-top: 16px; background: #FDFBF2; }
        .officebox .t { font-size: 10.5px; font-weight: 800; color: #B8860B; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.4px; }

        .declaration { font-size: 10px; color: #475569; border: 1px solid #e5d9c6; border-radius: 6px; padding: 10px 12px; margin-top: 16px; background: #fbf6ec; }

        .signrow { display: flex; justify-content: space-between; margin-top: 30px; }
        .signrow .sig { width: 46%; text-align: center; }
        .signrow .sig .l { border-top: 1.4px solid #64748b; padding-top: 5px; font-size: 9.5px; color: #64748b; }
      </style></head><body>

      <div class="topband"></div>

      <div class="header">
        <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:22px;">🏫</span>`}</div>
        <div class="header-text">
          <div class="school-name">${schoolName}</div>
          <div class="tagline">${tagline}</div>
          <div class="address">${address}</div>
        </div>
        <div class="header-badge">Session<br/><span class="yr">2026–27</span></div>
      </div>

      <div class="doc-title-wrap"><span class="doc-title">Admission Application Form</span></div>
      <div class="intro-row">
        <div class="intro-text"><div class="doc-sub" style="margin:0;">Pre-filled with the details you submitted online. Please review, sign, and submit it in person at the school office.</div></div>
        <div class="photo-box">Attach<br/>Passport<br/>Size Photo<br/>Here</div>
      </div>

      <div class="section-title">1&nbsp; &nbsp;Student Information</div>
      ${line("Full Name", form.full_name, undefined, true)}
      ${line("Father Name", form.father_name, undefined, true)}
      ${line("B-Form Number", form.b_form_no, undefined, true)}
      ${lineRow([line("Contact Number (WhatsApp)", form.contact_number, undefined, true), line("WhatsApp (if different)", form.whatsapp_number)])}
      ${line("Home Address (Village / Mohalla)", form.home_address)}
      ${line("Father's CNIC", form.father_cnic, undefined, true)}
      ${line("Occupation", form.occupation)}
      ${line("Date of Birth", form.date_of_birth)}
      <div style="margin:6px 0 16px;clear:both;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Gender <span style="color:#B8860B;">*</span></div>${checkbox("Male", form.gender === "male")}${checkbox("Female", form.gender === "female")}</div>

      <div class="section-title">2&nbsp; &nbsp;Academic Information</div>
      <div style="margin:6px 0 14px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Applying for Class <span style="color:#B8860B;">*</span></div>${["6","7","8","9","10"].map(c => checkbox(`Class ${c}`, form.applying_class === c)).join("")}</div>
      <div style="margin:6px 0 16px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Admission Type <span style="color:#B8860B;">*</span></div>${checkbox("Fresh Admission", form.admission_type === "fresh")}${checkbox("Migration / Transfer (Class 9 & 10 only)", form.admission_type === "migration")}</div>
      <div class="note" style="margin-bottom:14px;">Important: At GHS Babi Khel, School Leaving Certificate (SLC) AND previous-school information are required for BOTH Fresh Admission and Migration/Transfer. All four fields below are required for all applicants.</div>
      ${line("Previous School Name", form.previous_school)}
      ${lineRow([line("Previous Class", form.previous_class), line("Previous Marks / Grade (%)", form.previous_marks)])}
      ${line("Year of Passing", form.year_of_passing)}

      <div class="section-title">3&nbsp; &nbsp;Documents to Attach</div>
      <ul style="font-size:11.5px;color:#334155;padding-left:20px;line-height:1.6;">${docChecklist}</ul>
      <div class="note">📎 Attach photocopies of the above documents with this form. Originals may be asked for verification at the office. For Class 9/10 migration, board-level migration on the BISE Peshawar portal is completed by the schools separately and is not finished simply by submitting this form.</div>

      <div class="declaration">
        <strong>Declaration:</strong> I/We declare that the information provided in this form is true and correct to the best of my/our knowledge. I/We understand that admission may be cancelled if any information is found to be false, and that final admission is subject to verification of documents and applicable school/BISE Peshawar rules.
      </div>

      <div class="signrow">
        <div class="sig"><div class="l">Signature of Parent / Guardian</div></div>
        <div class="sig"><div class="l">Date</div></div>
      </div>

      <div class="officebox">
        <div class="t">✦ For Office Use Only</div>
        ${lineRow([line("Reference No.", ""), line("Received By", "")])}
        ${lineRow([line("Date Received", ""), line("Status", "")])}
      </div>

      <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; Submit this form in person at the school office &bull; ${window.location.origin}</div>
    </body></html>`;

    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.write(html); printWin.document.close();
      printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
      toast.success("Generating Admission Form — use Save as PDF in print dialog");
    } else {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "Admission Application Form.html";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("Downloaded Admission Application Form");
    }
  } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
}

export function generateEmptyForm(school: SchoolLike): void {
  try {
    const schoolName = school?.school_name || "GHS Babi Khel";
    const tagline = school?.tagline || "Excellence in Education";
    const address = school?.address || "Babi Khel, District Mohmand, KPK, Pakistan";
    const logoUrl = school?.logo_url || "";
    const date = new Date().toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });

    const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Helper functions for PDF layout — plain block markup (no tables) so
    // the print/PDF renderer can't double-paint nested rows.
    const line = (label: string, value?: string | null, _w?: number, req = false) =>
      `<div style="margin-bottom:10px;">
        <div style="font-size:9px;font-weight:600;color:#0E3B20;text-transform:uppercase;letter-spacing:0.2px;margin-bottom:3px;">${esc(label)}${req ? ' <span style="color:#B8860B;">*</span>' : ''}</div>
        <div style="font-size:10.5px;color:#1e293b;border-bottom:1px solid #94a3b8;padding-bottom:3px;min-height:14px;">${esc(value) || "&nbsp;"}</div>
      </div>`;

    const lineRow = (fields: string[]) =>
      `<div style="display:flex;gap:16px;">${fields.map(f => `<div style="flex:1;min-width:0;">${f}</div>`).join("")}</div>`;

    const checkbox = (label: string, checked: boolean) =>
      `<span style="display:inline-flex;align-items:center;margin-right:14px;font-size:10.5px;color:#334155;"><span style="width:13px;height:13px;border:2px solid #94a3b8;border-radius:3px;margin-right:5px;display:inline-flex;align-items:center;justify-content:center;background:${checked ? '#10B981' : 'transparent'};border-color:${checked ? '#059669' : '#94a3b8'};">${checked ? '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>' : ''}</span>${esc(label)}</span>`;

    const docChecklist = [
      "B-Form (NADRA) — Original + 2 photocopies",
      "Recent passport-size photographs (4 copies)",
      "Previous school result card / marksheet",
      "School Leaving Certificate (SLC) from previous school",
      "Father's / Guardian's CNIC photocopy",
      "Domicile (if available)",
      "Character Certificate from previous school (if available)",
    ].map(item => `<li>${esc(item)}</li>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Admission Application Form - ${esc(schoolName)}</title>
      <style>
        * { margin:0;padding:0;box-sizing:border-box; }
        body { font-family:'Segoe UI',Arial,sans-serif; background:#fff; color:#1e293b; padding:20px; line-height:1.5; }
        .page { max-width:210mm; margin:0 auto; border:1px solid #e2e8f0; padding:25mm 18mm 20mm; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
        .topband { height:6px; background:linear-gradient(90deg,#0E3B20,#10B981); margin:-25mm -18mm 20px; }
        .header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:16px;flex-wrap:wrap; }
        .logo-wrap { width:56px;height:56px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center; }
        .logo-wrap img { width:100%;height:100%;object-fit:cover; }
        .header-text { flex:1;min-width:200px; }
        .school-name { font-size:18px;font-weight:700;color:#0E3B20;line-height:1.2; }
        .tagline { font-size:11px;color:#64748b;margin-top:2px; }
        .address { font-size:10px;color:#94a3b8;margin-top:3px; }
        .header-badge { background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:8px 12px;text-align:center; }
        .header-badge .t { font-size:9px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1px; }
        .header-badge .yr { font-size:18px;font-weight:800;color:#B45309;display:block;margin-top:2px; }
        .doc-title-wrap { text-align:center;margin:18px 0 12px; }
        .doc-title { display:inline-block;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0E3B20,#059669);padding:10px 28px;border-radius:8px;letter-spacing:0.5px; }
        .doc-sub { text-align:center;font-size:11px;color:#64748b;margin-top:8px;font-style:italic; }
        .intro-row { display:flex;align-items:flex-start;justify-content:center;gap:18px;margin:14px 0 20px;flex-wrap:wrap; }
        .intro-text { flex:1;min-width:200px;max-width:420px; }
        .photo-box { flex-shrink:0;width:80px;height:100px;border:2px dashed #94a3b8;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9px;color:#94a3b8;padding:6px;line-height:1.3; }
        .section-title { font-size:12px;font-weight:700;color:#fff;background:linear-gradient(90deg,#0E3B20,#10B981);padding:7px 14px;border-radius:6px;margin:18px 0 10px;letter-spacing:0.3px; }
        .note { font-size:10px;color:#B45309;background:#FEF3C7;padding:8px 12px;border-radius:6px;border-left:3px solid #F59E0B;margin:8px 0;line-height:1.5; }
        .declaration { font-size:11px;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;padding:12px 16px;border-radius:8px;margin-top:20px;line-height:1.6; }
        .signrow { display:flex;gap:40px;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0; }
        .sig { flex:1; } .sig .l { font-size:10px;color:#64748b;border-top:1px solid #334155;padding-top:6px;height:30px; }
        .officebox { background:#fefce8;border:2px solid #eab308;border-radius:8px;padding:16px;margin-top:20px; }
        .officebox .t { font-size:12px;font-weight:700;color:#854d0e;text-align:center;margin-bottom:12px; }
        .footer { text-align:center;font-size:9px;color:#94a3b8;margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0; }
        @media print { body { padding:0; } .page { box-shadow:none;border:none;max-width:none; } .topband { -print-color-adjust:exact;-webkit-print-color-adjust:exact; } }
      </style>
    </head><body><div class="page">
      <div class="topband"></div>

      <div class="header">
        <div class="logo-wrap">${logoUrl ? `<img src="${logoUrl}" alt="logo" />` : `<span style="font-size:22px;">🏫</span>`}</div>
        <div class="header-text">
          <div class="school-name">${schoolName}</div>
          <div class="tagline">${tagline}</div>
          <div class="address">${address}</div>
        </div>
        <div class="header-badge">Session<br/><span class="yr">2026–27</span></div>
      </div>

      <div class="doc-title-wrap"><span class="doc-title">Admission Application Form</span></div>
      <div class="intro-row">
        <div class="intro-text"><div class="doc-sub" style="margin-top:0;">Blank form — Please print, fill in all fields by hand, attach required documents, and submit at the school office.</div></div>
        <div class="photo-box">Attach<br/>Passport<br/>Size Photo<br/>Here</div>
      </div>

      <div class="section-title">1&nbsp; &nbsp;Student Information</div>
      ${line("Full Name", "", undefined, true)}
      ${line("Father Name", "", undefined, true)}
      ${line("B-Form Number", "", undefined, true)}
      ${lineRow([line("Contact Number (WhatsApp)", "", undefined, true), line("WhatsApp (if different)", "")])}
      ${line("Home Address (Village / Mohalla)", "")}
      ${lineRow([line("Father's CNIC Number", "", undefined, true), line("Occupation", "")])}
      ${line("Date of Birth", "")}
      <div style="margin:6px 0 16px;clear:both;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Gender <span style="color:#B8860B;">*</span></div>${checkbox("Male", false)}${checkbox("Female", false)}</div>

      <div class="section-title">2&nbsp; &nbsp;Academic Information</div>
      <div style="margin:6px 0 14px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Applying for Class <span style="color:#B8860B;">*</span></div>${["6","7","8","9","10"].map(c => checkbox(`Class ${c}`, false)).join("")}</div>
      <div style="margin:6px 0 16px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.3px;color:#0E3B20;margin-bottom:8px;text-transform:uppercase;">Admission Type <span style="color:#B8860B;">*</span></div>${checkbox("Fresh Admission", false)}${checkbox("Migration / Transfer (Class 9 & 10 only)", false)}</div>
      <div class="note" style="margin-bottom:14px;">Important: At GHS Babi Khel, School Leaving Certificate (SLC) AND previous-school information are required for BOTH Fresh Admission and Migration/Transfer.</div>
      ${line("Previous School Name", "", undefined, true)}
      ${lineRow([line("Previous Class", "", undefined, true), line("Previous Marks / Grade", "", undefined, true)])}
      ${line("Year of Passing", "", undefined, true)}

      <div class="section-title">3&nbsp; &nbsp;Documents to Attach</div>
      <ul style="font-size:11.5px;color:#334155;padding-left:20px;line-height:1.6;">${docChecklist}</ul>
      <div class="note">📎 Attach photocopies of the above documents with this form. Originals may be asked for verification at the office.</div>

      <div class="declaration">
        <strong>Declaration:</strong> I/We declare that the information provided in this form is true and correct to the best of my/our knowledge. I/We understand that admission may be cancelled if any information is found to be false.
      </div>

      <div class="signrow">
        <div class="sig"><div class="l">Signature of Parent / Guardian</div></div>
        <div class="sig"><div class="l">Date</div></div>
      </div>

      <div class="officebox">
        <div class="t">✦ For Office Use Only</div>
        ${lineRow([line("Reference No.", ""), line("Received By", "")])}
        ${lineRow([line("Date Received", ""), line("Status", "")])}
      </div>

      <div class="footer"><span>${schoolName}</span> &bull; Generated on ${date} &bull; Blank Form</div>
    </div></body></html>`;

    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.write(html); printWin.document.close();
      printWin.onload = () => { setTimeout(() => { printWin.print(); }, 300); };
      toast.success("Generating blank Admission Form — use Save as PDF in print dialog");
    } else {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "Admission Application Form (Blank).html";
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("Downloaded blank Admission Form");
    }
  } catch (err) { toast.error(`Failed to download: ${err?.message || "Please try again"}`); }
}
