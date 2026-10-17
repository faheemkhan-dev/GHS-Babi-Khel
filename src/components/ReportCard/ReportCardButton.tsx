// src/components/ReportCard/ReportCardButton.tsx
// The small button on the /results green hero banner. It is anchored to the
// banner's BOTTOM EDGE by PageBanner (absolute bottom-0, centred) — its
// bottom edge touches the banner's bottom edge line exactly, with no gap
// and no overlap with the subtitle text. Clicking it opens the
// password-gated ReportCardModal.
//
// Per spec:
//   • Small rectangle
//   • Same dark green as the hero banner (uses the same `gradient-hero`
//     background + `bg-primary` family) so it visually blends with the
//     banner instead of looking like a separate white pill.
//   • No border (borderless so it disappears into the banner)
//   • Rounded TOP corners only — the bottom edge sits flush on the banner's
//     edge line, so square bottom corners make it merge seamlessly into the
//     edge (rounded bottom corners would leak white slivers of the page
//     background through the corner radius).
//   • No drop shadow — a shadow would smear onto the white page below the
//     banner edge it is flush with.
//   • White text + white icon
//   • Label: "Report Card"
//   • On click → opens modal (which itself handles the password gate)
//   • Active/pressed state → shifts to `bg-primary-dark` so the tap
//     feedback reads against the banner.

import { useState } from "react";
import { FileText, ChevronRight } from "lucide-react";
import ReportCardModal from "./ReportCardModal";

// Compact, thin pill that sits half-over the hero's bottom edge.
export default function ReportCardButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary-dark text-white pl-2.5 pr-3 h-8 text-xs font-semibold border border-gold/50 shadow-md hover:border-gold active:scale-[0.97] transition-all"
      >
        <FileText className="w-3.5 h-3.5 text-gold" />
        Report Card
        <ChevronRight className="w-3 h-3 text-gold/80" />
      </button>
      <ReportCardModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
