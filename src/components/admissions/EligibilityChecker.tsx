import { useState } from "react";
import { Search, CheckCircle2, XCircle, ArrowRight, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdmissionType } from "@/hooks/useAdmission";
import { checkAgeForClass, migrationAllowedForClass, CLASSES, MIGRATION_CLASSES } from "@/lib/admissionRules";

// ── Eligibility Checker (BISE Peshawar aligned) ────────────────────────────
// Class 9: board rules — above 12 years (DOB on/before 31-03-2014 for the
// 2026 enrollment) and at most 20 years (upper limit notification 10-06-2025).
// Other classes: school guidance only — WARN, never block, because the school
// handles exceptional cases and the board sets no age rule below class 9.
// A warning always keeps the "Apply" button available.
// ═══════════════════════════════════════════════════════════════════════════

interface CheckResult {
  canApply: boolean;          // an Apply button is shown
  boardBlock: boolean;        // a hard board-rule failure (class 9 age)
  reasons: string[];          // error messages (block only when boardBlock)
  warnings: string[];         // advisory messages
}

export default function EligibilityChecker({ onApply }: { onApply: (cls: string, type: AdmissionType) => void }) {
  const [cls, setCls] = useState("");
  const [admissionType, setAdmissionType] = useState<AdmissionType>("fresh");
  const [dob, setDob] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);

  const checkEligibility = () => {
    if (!cls) { toast.error("Select a class"); return; }

    const reasons: string[] = [];
    const warnings: string[] = [];

    // Age check (board rule for 9, guidance for the rest)
    const ageCheck = checkAgeForClass(dob, cls);
    if (ageCheck.level === "error") reasons.push(ageCheck.message);
    else if (ageCheck.level === "warn") warnings.push(ageCheck.message);

    // Migration class check (BISEP portal: class 9/10 only)
    if (admissionType === "migration" && !migrationAllowedForClass(cls)) {
      reasons.push(
        `BISE Peshawar migration (school-to-school on the board portal) applies to Class 9 and Class 10 only. ` +
        `For Class ${cls}, a transfer is handled directly between schools — apply as a Fresh Admission and the office will complete the transfer.`,
      );
    }

    // Class 9 fresh: note the board enrollment + fee
    if (cls === "9" && admissionType === "fresh" && reasons.length === 0) {
      warnings.push(
        "Class 9 students are enrolled with BISE Peshawar by the school after admission is confirmed " +
        "(enrollment fee Rs 1,300 by 30 Sep 2026 — late fees apply after that).",
      );
    }

    // Migration extras (board checklist)
    if (admissionType === "migration" && migrationAllowedForClass(cls) && reasons.length === 0) {
      warnings.push(
        "Migration needs the School Leaving Certificate and, from another board, the original Migration Certificate " +
        "and the verified 9th result card. The migration on the BISE Peshawar portal is completed by the schools — " +
        "the receiving school (our school) applies online.",
      );
    }

    // A class-9 age failure is the only hard block; everything else can still apply.
    const boardBlock = reasons.length > 0;
    setResult({ canApply: !boardBlock, boardBlock, reasons, warnings });
  };

  const onClassChange = (v: string) => {
    setCls(v);
    if (!MIGRATION_CLASSES.includes(v as (typeof MIGRATION_CLASSES)[number])) {
      setAdmissionType("fresh");
    }
    setResult(null);
  };

  // Thin, premium form: slim hint, two-up selects, one-line date field, slim button.
  const labelCls = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground";
  const triggerCls = "h-8 rounded-lg border-border/80 bg-background px-2.5 text-[12px]";

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <p className="mb-3 text-center text-[10.5px] leading-snug text-muted-foreground">
        Class 9 age rules follow BISE Peshawar. Final eligibility is confirmed by the school office after document verification.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Label className={labelCls}>Class <span className="text-red-500">*</span></Label>
          <Select value={cls} onValueChange={onClassChange}>
            <SelectTrigger className={triggerCls}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {CLASSES.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <Label className={labelCls}>Type <span className="text-red-500">*</span></Label>
          <Select value={admissionType} onValueChange={v => { setAdmissionType(v as AdmissionType); setResult(null); }}>
            <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fresh">Fresh Admission</SelectItem>
              {MIGRATION_CLASSES.includes(cls as (typeof MIGRATION_CLASSES)[number]) && (
                <SelectItem value="migration">Migration / Transfer</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!migrationAllowedForClass(cls) && cls && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          Class {cls}: Fresh Admission — transfers for this class are handled directly between schools, outside the BISE portal.
        </p>
      )}

      <div className="mt-2">
        <Label className={labelCls}>Date of Birth <span className="text-red-500">*</span></Label>
        <Input type="date" value={dob} onChange={e => { setDob(e.target.value); setResult(null); }} className="h-8 rounded-lg border-border/80 bg-background px-2.5 text-[12px]" />
      </div>

      <Button onClick={checkEligibility} className="mt-3 h-9 w-full gap-1.5 rounded-md text-[12.5px] font-semibold">
        <Search className="h-3.5 w-3.5" /> Check Now
      </Button>

      {result && (
        <div
          className={`mt-3 rounded-xl border p-2.5 ${
            result.boardBlock
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
              : result.warnings.length > 0
                ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"
                : "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
          }`}>
          {result.boardBlock ? (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                <p className="text-[12.5px] font-bold text-red-700 dark:text-red-400">Not eligible under the board rules</p>
              </div>
              <ul className="space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-red-700 dark:text-red-400">
                    <span>•</span> {r}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-snug text-red-600/80 dark:text-red-400/70">
                Only the Chairman of BISE Peshawar can relax the Class 9 age limit. Contact the school office for guidance.
              </p>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                <p className="text-[12.5px] font-bold text-green-700 dark:text-green-400">Likely eligible — preliminary result</p>
              </div>
              <p className="mb-2 text-[11px] leading-snug text-green-700 dark:text-green-400">
                No blocking issue for Class {cls} ({admissionType} admission). The school office confirms eligibility after reviewing your documents.
              </p>
              {result.warnings.map((w, i) => (
                <p key={i} className="mb-1.5 flex items-start gap-1.5 text-[10.5px] leading-snug text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                </p>
              ))}
              <Button onClick={() => onApply(cls, admissionType)} className="h-9 w-full gap-1.5 rounded-md text-[12.5px] font-semibold">
                <ArrowRight className="h-3.5 w-3.5" /> Apply for Class {cls}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
