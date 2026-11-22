// src/components/admissions/AdmissionReviewTable.tsx — the premium label/value
// review table (GHSS Ghallanai AdmissionReviewTable, ported 1:1):
//   • green gradient header bar (white uppercase 12px) + gold bottom hairline
//   • optional white-on-glass "Edit" pill on the right of the header
//   • rows packed 1–2 per line (sm:grid-cols-2, `wide` rows span both)
//   • label cell 40% on a primary tint, value cell 60% centered bold
//   • null / empty values collapse to "N/A"
// ═══════════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { PencilLine } from "lucide-react";

export interface ReviewRow {
  label: string;
  value: ReactNode | string | null | undefined;
  /** Span the full width (addresses, long values). */
  wide?: boolean;
}

export default function AdmissionReviewTable({
  title,
  rows,
  onEdit,
  editLabel = "Edit",
  compact = false,
}: {
  title: string;
  rows: ReviewRow[];
  onEdit?: () => void;
  editLabel?: string;
  /** Thinner header and rows (admin views). */
  compact?: boolean;
}) {
  return (
    <div className={`overflow-hidden border border-border/70 ${compact ? "rounded-xl" : "rounded-2xl shadow-sm"}`}>
      {/* header */}
      <div className={`relative flex items-center justify-between gap-2 bg-gradient-to-r from-primary to-primary/90 px-4 ${compact ? "py-1.5" : "py-2.5"}`}>
        <h3 className={`font-bold uppercase text-primary-foreground ${compact ? "text-[10.5px] tracking-[0.16em]" : "text-[12px] tracking-widest"}`}>
          {title}
        </h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2.5 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <PencilLine className="h-3 w-3" />
            {editLabel}
          </button>
        )}
        {/* gold hairline */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gold/80" />
      </div>

      {/* rows */}
      <div className="grid sm:grid-cols-2">
        {rows.map((r, i) => {
          const empty = r.value === null || r.value === undefined || r.value === "" || r.value === "—";
          return (
            <div
              key={`${r.label}-${i}`}
              className={`grid grid-cols-[2fr_3fr] border-b border-border/50 sm:[&:not(:last-child)]:border-b ${r.wide ? "sm:col-span-2" : ""}`}
            >
              <div className={`bg-primary/[0.05] px-3 ${compact ? "py-1.5" : "py-2.5"}`}>
                <p className={`font-semibold uppercase leading-snug text-muted-foreground ${compact ? "text-[9.5px] tracking-[0.08em]" : "text-[10px] tracking-wider"}`}>
                  {r.label}
                </p>
              </div>
              <div className={`flex items-center justify-center px-3 text-center ${compact ? "py-1.5" : "py-2.5"}`}>
                {empty ? (
                  <span className={`font-semibold text-muted-foreground/70 ${compact ? "text-[12px]" : "text-[13px]"}`}>N/A</span>
                ) : (
                  <span className={`break-words font-semibold leading-snug text-foreground ${compact ? "text-[12px]" : "text-[13px] font-bold"}`}>
                    {r.value as ReactNode}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
