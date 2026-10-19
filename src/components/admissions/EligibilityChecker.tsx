import { useState } from "react";
import { Search, CheckCircle2, XCircle, ArrowRight, Sparkles } from "lucide-react";
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

  return (
    <div className="bg-card border border-border rounded-xl shadow-card p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <h3 className="font-bold text-foreground text-xs">Preliminary Eligibility Check</h3>
        <span className="text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full font-bold ml-auto">Quick Check</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2.5">
        Final eligibility always depends on document verification by the school office.
      </p>
      <div className="space-y-2">
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Applying for Class *</Label>
          <Select value={cls} onValueChange={setCls}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select class" /></SelectTrigger>
            <SelectContent>
              {["6","7","8","9","10"].map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Admission Type *</Label>
          <Select value={admissionType} onValueChange={v => setAdmissionType(v as AdmissionType)}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fresh">Fresh Admission</SelectItem>
              {["9", "10"].includes(cls) && <SelectItem value="migration">Migration / Transfer</SelectItem>}
            </SelectContent>
          </Select>
          {!['9', '10'].includes(cls) && cls && (
            <p className="text-[9px] text-muted-foreground mt-1">Note: For Class {cls}, only Fresh Admission is available. School-level transfers are handled directly between schools.</p>
          )}
        </div>
        <div>
          <Label className="text-[11px] font-semibold mb-1 block">Date of Birth</Label>
          <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="h-9 text-xs" />

        </div>
        <Button onClick={checkEligibility} className="w-full gap-2 rounded-xl h-9 text-xs">
          <Search className="w-3.5 h-3.5" /> Check Now
        </Button>
      </div>

      {result && (
        <div
          className={`mt-3 rounded-xl p-3 border ${
            result.eligible
              ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900"
              : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900"
          }`}>
          {result.eligible ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <p className="font-bold text-sm text-green-700 dark:text-green-400">Likely eligible — preliminary result</p>
              </div>
              <p className="text-xs text-green-700 dark:text-green-400 mb-3">
                Based on the information provided, there's no obvious issue for Class {cls} ({admissionType} admission). This is not final — the school office will confirm eligibility after reviewing your documents. Apply now to get started!
              </p>
              <Button onClick={() => onApply(cls, admissionType)} className="w-full gap-2 rounded-xl h-9 text-xs">
                <ArrowRight className="w-3.5 h-3.5" /> Apply for Class {cls}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <p className="font-bold text-sm text-red-700 dark:text-red-400">Possible issue found</p>
              </div>
              <ul className="space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-400 flex items-start gap-1.5">
                    <span className="mt-0.5">•</span> {r}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-red-600/80 dark:text-red-400/70 mt-2">
                You may still contact the school office directly, as exceptional or hardship cases are handled case-by-case per current policy.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

