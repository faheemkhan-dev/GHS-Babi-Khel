/**
 * AdmitCard.tsx
 * Auto-generated PDF admit card with embedded QR for verification.
 *
 * Uses jspdf (already in deps) for PDF generation + qrcode (already in deps)
 * for QR encoding. The QR contains a verification URL like:
 *   https://ghsbabikhel.dpdns.org/admission/verify?ref=OHS-2026-0001
 *
 * The card includes:
 *  - School logo + name header
 *  - "ADMIT CARD" title + session year
 *  - Applicant photo placeholder (left), details (right)
 *  - QR code (right side)
 *  - Verification URL at bottom
 *  - Auto-generated pass/fail-style digital signature
 *
 * Anti-forgery: the QR encodes the reference_no — admin can scan to verify
 * instantly without revealing student data to passersby.
 */
import { useState } from "react";
import { Download, FileText, Loader2, ShieldCheck, Award } from "lucide-react";
// PROBLEM 6 FIX (lazy PDF): jspdf is no longer statically imported — the
// QR code lib (qrcode) is small and stays static, but the PDF library is
// dynamically imported inside generatePDF so it only downloads when a
// user actually generates an admit card.
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";

interface Admission {
  id: string;
  reference_no: string;
  full_name: string;
  father_name: string;
  contact_number: string;
  applying_class: string;
  admission_type: string;
  status: string;
  date_of_birth: string | null;
  b_form_no: string;
  gender: string | null;
  created_at: string;
}

const SITE_URL = "https://ghsbabikhel.dpdns.org";
const SCHOOL_NAME = "GHS Babi Khel";
const SCHOOL_SUB = "Government High School, District Mohmand, KPK";
const LOGO_PATH = "/icon-512.png"; // the school's real logo, served from /public

// Fetches the logo once and caches it as a base64 data URL for embedding in
// the PDF. Falls back to null if it can't be loaded (e.g. offline) — in that
// case we skip drawing the logo entirely rather than showing a fake "GHS"
// placeholder circle.
let cachedLogoDataUrl: string | null | undefined; // undefined = not attempted yet
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
  try {
    const res = await fetch(LOGO_PATH);
    const blob = await res.blob();
    cachedLogoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    cachedLogoDataUrl = null;
  }
  return cachedLogoDataUrl;
}

export default function AdmitCard({ admission }: { admission: Admission }) {
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const generatePDF = async (download: boolean = false) => {
    setGenerating(true);
    try {
      // 1. Generate QR code as data URL
      const verifyUrl = `${SITE_URL}/admission/verify?ref=${admission.reference_no}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        width: 200,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });

      // 2. Create PDF (A4 portrait, but we'll use a custom admit-card size: 210×148mm landscape)
      // PROBLEM 6 FIX: lazy-load jspdf only at card-generation time.
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [210, 148] });

      // ── Border ──────────────────────────────────────────────────────────
      doc.setDrawColor(30, 64, 175);
      doc.setLineWidth(1.5);
      doc.roundedRect(5, 5, 200, 138, 3, 3);

      // Inner accent border
      doc.setLineWidth(0.3);
      doc.setDrawColor(30, 64, 175);
      doc.roundedRect(8, 8, 194, 132, 2, 2);

      // ── Header band ─────────────────────────────────────────────────────
      doc.setFillColor(30, 64, 175);
      doc.rect(8, 8, 194, 18, "F");

      // Logo — the school's real logo image (falls back to a plain white
      // circle with no text if it fails to load, rather than a fake "GHS"
      // placeholder that isn't the actual logo).
      const logoDataUrl = await loadLogoDataUrl();
      if (logoDataUrl) {
        // Clip to a circle by drawing a white circle behind, then the image
        // on top sized to fit within it (jsPDF has no native clipping, so a
        // small square image reads fine inside the circular badge area).
        doc.setFillColor(255, 255, 255);
        doc.circle(20, 17, 6.2, "F");
        try {
          doc.addImage(logoDataUrl, 14, 11, 12, 12);
        } catch {
          // If the format can't be embedded, just leave the white circle.
        }
      } else {
        doc.setFillColor(255, 255, 255);
        doc.circle(20, 17, 6, "F");
      }

      // School name
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(SCHOOL_NAME, 32, 16);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(SCHOOL_SUB, 32, 21);

      // "ADMIT CARD" right side
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("ADMIT CARD", 195, 17, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(`Session ${new Date().getFullYear()}`, 195, 22, { align: "right" });

      // ── Applicant section ───────────────────────────────────────────────
      let y = 36;

      // Photo placeholder (top-left)
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.5);
      doc.rect(14, y, 28, 35);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text("PHOTO", 28, y + 19, { align: "center" });

      // Details (right of photo)
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(admission.full_name, 47, y + 5);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const detailRow = (label: string, value: string, yy: number) => {
        doc.setTextColor(100, 116, 139);
        doc.text(label, 47, yy);
        doc.setTextColor(15, 23, 42);
        doc.setFont("helvetica", "bold");
        doc.text(value, 80, yy);
        doc.setFont("helvetica", "normal");
      };

      detailRow("Father:",       admission.father_name, y + 12);
      detailRow("Class:",        `Class ${admission.applying_class}`, y + 18);
      detailRow("B-Form:",       admission.b_form_no, y + 24);
      detailRow("Date of Birth:", admission.date_of_birth || "—", y + 30);

      // Reference number (top right, prominent)
      doc.setFillColor(254, 243, 199);
      doc.rect(140, y - 4, 60, 12, "F");
      doc.setTextColor(120, 53, 15);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("REFERENCE NO.", 142, y);
      doc.setFontSize(11);
      doc.text(admission.reference_no, 142, y + 6);

      // QR code (right side, below reference)
      doc.addImage(qrDataUrl, "PNG", 152, y + 12, 36, 36);

      // Verification URL below QR
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text("Scan to verify", 170, y + 51, { align: "center" });

      // ── Bottom info section ─────────────────────────────────────────────
      y = 90;
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(14, y, 196, y);

      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text("Instructions:", 14, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      const instructions = [
        "1. Bring this admit card to the school office on the date and time of your interview.",
        "2. Carry original B-Form, previous result card, and 2 passport-size photos.",
        "3. Reach at least 15 minutes before your scheduled time.",
        "4. This card is non-transferable. Tampering will result in disqualification.",
        "5. For queries, call 0346-9898295 or visit ghsbabikhel.dpdns.org",
      ];
      y += 4;
      instructions.forEach(line => {
        doc.text(line, 14, y);
        y += 4;
      });

      // ── Footer with signature line ──────────────────────────────────────
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.4);
      doc.line(140, 132, 190, 132);
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text("Authorized Signature", 165, 136, { align: "center" });
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated on ${new Date().toLocaleString("en-PK")}`, 14, 136);

      // ── Output ──────────────────────────────────────────────────────────
      const filename = `admit-card-${admission.reference_no}.pdf`;
      if (download) {
        doc.save(filename);
        toast.success("Admit card downloaded");
      } else {
        // Open in a new tab instead of an embedded iframe. Many mobile
        // browsers (and in-app webviews) block blob: URLs inside iframes
        // with a generic "content is blocked" message, but opening the
        // same blob URL as a full tab works fine.
        const blob = doc.output("blob");
        const url = URL.createObjectURL(blob);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(url);
        const opened = window.open(url, "_blank");
        if (!opened) {
          toast.error("Preview blocked by browser — allow pop-ups, or use Download PDF instead.");
        } else {
          toast.success("Admit card preview opened in a new tab");
        }
      }
    } catch (e) {
      console.error("PDF generation failed:", e);
      toast.error("Failed to generate admit card: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Award className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground text-sm">Admit Card</h3>
        <span className="ml-auto text-[10px] bg-green-500/15 text-green-600 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Ready
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Your admit card is ready! Download the PDF and bring it to your interview. Each card has a unique QR code for instant verification by school staff.
      </p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => generatePDF(false)}
          disabled={generating}
          variant="outline"
          className="flex-1 gap-1.5"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          Preview
        </Button>
        <Button
          onClick={() => generatePDF(true)}
          disabled={generating}
          className="flex-1 gap-1.5"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download PDF
        </Button>
      </div>

      {/* Fallback link, shown only if the auto-opened preview tab was blocked */}
      {previewUrl && (
        <div className="mt-4">
          <div className="text-[10px] text-muted-foreground mb-1 font-semibold uppercase tracking-wide">
            Preview
          </div>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline break-all"
          >
            Open admit card preview
          </a>
        </div>
      )}

      {/* Card preview (visual representation in the page) */}
      <div className="mt-4 border-2 border-primary/30 rounded-xl overflow-hidden">
        <div className="bg-primary text-white px-4 py-2 flex items-center justify-between">
          <div>
            <p className="font-bold text-sm">{SCHOOL_NAME}</p>
            <p className="text-[10px] opacity-80">{SCHOOL_SUB}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-sm">ADMIT CARD</p>
            <p className="text-[10px] opacity-80">Session {new Date().getFullYear()}</p>
          </div>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <p className="font-bold text-sm text-foreground">{admission.full_name}</p>
            <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
              <p><span className="opacity-70">Father:</span> <span className="text-foreground font-medium">{admission.father_name}</span></p>
              <p><span className="opacity-70">Class:</span> <span className="text-foreground font-medium">Class {admission.applying_class}</span></p>
              <p><span className="opacity-70">B-Form:</span> <span className="text-foreground font-mono">{admission.b_form_no}</span></p>
            </div>
          </div>
          <div className="text-right">
            <div className="inline-block bg-amber-50 dark:bg-amber-950/30 px-2 py-1 rounded">
              <p className="text-[9px] text-amber-700 dark:text-amber-300 font-semibold">REFERENCE</p>
              <p className="font-mono font-bold text-xs text-amber-900 dark:text-amber-100">{admission.reference_no}</p>
            </div>
            <div className="mt-2 inline-block bg-white p-1.5 rounded border">
              <svg viewBox="0 0 100 100" className="w-12 h-12">
                {/* Faux QR pattern for visual preview */}
                {Array.from({ length: 100 }).map((_, i) => {
                  const x = (i % 10) * 10;
                  const y = Math.floor(i / 10) * 10;
                  const fill = (i * 7 + admission.reference_no.length) % 3 === 0;
                  return fill ? <rect key={i} x={x} y={y} width="10" height="10" fill="#0f172a" /> : null;
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
