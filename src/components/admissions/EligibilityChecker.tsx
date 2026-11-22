import { useState } from "react";
import { Search, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdmissionType } from "@/hooks/useAdmission";

// ── Age eligibility criteria per class (official school standards) ────────
const AGE_CRITERIA: Record<string, { min: number; max: number }> = {
  "6": { min: 10, max: 11 },   // Class 6: 10–11 years
  "7": { min: 11, max: 12 },   // Class 7: 11–12 years
  "8": { min: 12, max: 13 },   // Class 8: 12–13 years
  "9": { min: 12, max: 14 },   // Class 9: 12–14 years
  "10": { min: 13, max: 15 },  // Class 10: 13–15 years
};

// ── Eligibility Checker Component ─────────────────────────────────────────────
export default function EligibilityChecker({ onApply }: { onApply: (cls: string, type: AdmissionType) => void }) {
  const [cls, setCls] = useState("");
  const [admissionType, setAdmissionType] = useState<AdmissionType>("fresh");
  const [dob, setDob] = useState("");
  const [result, setResult] = useState<{ eligible: boolean; reasons: string[] } | null>(null);

  const checkEligibility = () => {
    const reasons: string[] = [];
    if (!cls) { toast.error("Select a class"); return; }

    // Age check — per-class age eligibility as per school admission policy
    if (dob) {
      const ageMs = Date.now() - new Date(dob).getTime();
      const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
      const criteria = AGE_CRITERIA[cls];
      if (criteria) {
        if (age < criteria.min) {
          reasons.push(`Minimum age for Class ${cls} enrollment is ${criteria.min} years. Recorded age is ${age} years.`);
        } else if (age > criteria.max) {
          reasons.push(`Maximum age for Class ${cls} enrollment is ${criteria.max} years. Recorded age is ${age} years.`);
        }
      }
    } else {
      reasons.push(`Please enter your date of birth so the school can verify age eligibility for Class ${cls}.`);
    }

    // Migration class check
    if (admissionType === "migration" && !["9", "10"].includes(cls)) {
      reasons.push(`BISE Peshawar board-level migration (school-to-school) applies to Class 9 and Class 10 only. For Class 6–8, a school transfer is handled directly between schools, not through the BISE portal.`);
    }

    setResult({ eligible: reasons.length === 0, reasons });
  };

  // Thin, premium form: slim hint, two-up selects, one-line date field, pill button.
  const labelCls = "mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground";
  const triggerCls = "h-8 rounded-lg border-border/80 bg-background px-2.5 text-[12px]";

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <p className="mb-3 text-center text-[10.5px] leading-snug text-muted-foreground">
        Final eligibility depends on document verification by the school office.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Label className={labelCls}>Class <span className="text-red-500">*</span></Label>
          <Select value={cls} onValueChange={setCls}>
            <SelectTrigger className={triggerCls}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {["6","7","8","9","10"].map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <Label className={labelCls}>Type <span className="text-red-500">*</span></Label>
          <Select value={admissionType} onValueChange={v => setAdmissionType(v as AdmissionType)}>
            <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fresh">Fresh Admission</SelectItem>
              {["9", "10"].includes(cls) && <SelectItem value="migration">Migration / Transfer</SelectItem>}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!['9', '10'].includes(cls) && cls && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
          Class {cls}: Fresh Admission only — school-level transfers are handled directly between schools.
        </p>
      )}

      <div className="mt-2">
        <Label className={labelCls}>Date of Birth</Label>
        <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="h-8 rounded-lg border-border/80 bg-background px-2.5 text-[12px]" />
      </div>

      <Button onClick={checkEligibility} className="mt-3 h-8 w-full gap-1.5 rounded-full text-[12px] font-semibold">
        <Search className="h-3.5 w-3.5" /> Check Now
      </Button>

      {result && (
        <div
          className={`mt-3 rounded-xl border p-2.5 ${
            result.eligible
              ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
              : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
          }`}>
          {result.eligible ? (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                <p className="text-[12.5px] font-bold text-green-700 dark:text-green-400">Likely eligible — preliminary result</p>
              </div>
              <p className="mb-2.5 text-[11px] leading-snug text-green-700 dark:text-green-400">
                No obvious issue for Class {cls} ({admissionType} admission). This is not final — the school office confirms eligibility after reviewing your documents.
              </p>
              <Button onClick={() => onApply(cls, admissionType)} className="h-8 w-full gap-1.5 rounded-full text-[12px] font-semibold">
                <ArrowRight className="h-3.5 w-3.5" /> Apply for Class {cls}
              </Button>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                <p className="text-[12.5px] font-bold text-red-700 dark:text-red-400">Possible issue found</p>
              </div>
              <ul className="space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-red-700 dark:text-red-400">
                    <span>•</span> {r}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] leading-snug text-red-600/80 dark:text-red-400/70">
                You may still contact the school office directly — exceptional or hardship cases are handled case-by-case.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
