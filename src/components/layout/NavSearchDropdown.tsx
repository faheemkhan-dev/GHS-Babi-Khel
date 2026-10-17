// src/components/layout/NavSearchDropdown.tsx
// Live, as-you-type suggestion dropdown shown under the navbar search box
// (both the desktop inline search and the mobile slide-down search). Mirrors
// the "type a letter, see results immediately" behaviour of Google's search
// box — no need to press Go first.

import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SearchHit } from "@/hooks/useSiteSearch";
import { Search as SearchIcon } from "lucide-react";

const GROUP_LABEL: Record<SearchHit["group"], string> = {
  pages: "Pages",
  notices: "Notices",
  news: "News",
  teachers: "Teachers",
};

interface NavSearchDropdownProps {
  query: string;
  hits: SearchHit[];
  onSelect: () => void;
  onViewAll: () => void;
  className?: string;
}

const NavSearchDropdown = ({ query, hits, onSelect, onViewAll, className = "" }: NavSearchDropdownProps) => {
  const show = query.trim().length > 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className={`absolute left-0 right-0 top-full mt-1.5 rounded-xl border border-border bg-card shadow-xl overflow-hidden z-50 ${className}`}
        >
          {hits.length === 0 ? (
            <div className="px-3.5 py-4 text-xs text-muted-foreground text-center">
              No quick matches for "{query.trim()}" — press Go to search the whole site.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1.5">
              {hits.map((h) => {
                const Icon = h.icon;
                return (
                  <Link
                    key={`${h.group}-${h.id}`}
                    to={h.href}
                    onClick={onSelect}
                    className="flex items-start gap-2.5 px-3.5 py-2 hover:bg-primary/5 transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">{h.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {GROUP_LABEL[h.group]}{h.snippet ? ` · ${h.snippet}` : ""}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={onViewAll}
            className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-primary border-t border-border hover:bg-primary/5 transition-colors"
          >
            <SearchIcon className="w-3.5 h-3.5" />
            View all results for "{query.trim()}"
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NavSearchDropdown;
