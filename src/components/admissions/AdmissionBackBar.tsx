// src/components/admissions/AdmissionBackBar.tsx — the small pill back button
// at the top of every admission step (GHSS Ghallanai AdmissionBackBar,
// ported 1:1). Renders nothing when there is nothing to go back to.
// ═══════════════════════════════════════════════════════════════════════════

import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

export default function AdmissionBackBar({
  to = "/admission",
  label = "Back to Admission",
}: {
  to?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-xs font-semibold text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
