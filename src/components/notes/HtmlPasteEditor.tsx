/**
 * HtmlPasteEditor.tsx
 *
 * A fast alternative to the toolbar-driven RichTextEditor: paste raw HTML
 * (e.g. copied from another doc, or hand-written)
 * and it renders live using the exact same ContentRenderer that students see on
 * the chapter page — so what's previewed here is what gets published.
 *
 * Fully independent of RichTextEditor — it does not import, wrap, or modify
 * it in any way. Both modes write to the same plain HTML string (`value`),
 * so switching between them never loses or corrupts content; only the
 * *editing tool* changes, not the underlying chapter content.
 *
 * Designed mobile-first: large tap targets, a sticky Apply bar, and a
 * collapsible preview so a small phone screen isn't fighting with itself
 * to show a giant textarea + a giant preview at once.
 */

import { useState, useEffect } from "react";
import { Code2, Eye, EyeOff, Check, Clipboard, Trash2 } from "lucide-react";
import ContentRenderer from "@/components/notes/ContentRenderer";

interface HtmlPasteEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function HtmlPasteEditor({ value, onChange, placeholder, minHeight = 380 }: HtmlPasteEditorProps) {
  // Local draft so typing/pasting doesn't push a re-render + re-parse of the
  // (potentially large) preview on every keystroke. The draft is
  // committed to the real `value` via the explicit "Apply" button, or
  // automatically after a short pause in typing.
  const [draft, setDraft] = useState(value);
  const [showPreview, setShowPreview] = useState(true);
  const [applied, setApplied] = useState(true);

  // Keep draft in sync if the parent value changes from elsewhere
  // (e.g. switching chapters, or loading initial data).
  useEffect(() => { setDraft(value); setApplied(true); }, [value]);

  // Auto-apply after the user pauses typing/pasting for a moment, so the
  // preview updates without forcing a manual tap every single time —
  // but the manual "Apply" button still exists for instant confidence.
  useEffect(() => {
    if (draft === value) return;
    setApplied(false);
    const t = setTimeout(() => { onChange(draft); setApplied(true); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // IMPORTANT: the 600ms debounce above means `value` (the parent's saved
  // form.content) can lag a few hundred ms behind what's in this textarea.
  // If the user pastes HTML and immediately hits the page's "Save" button,
  // the debounce timer may not have fired yet — and the parent would save
  // the OLD content (e.g. leftover Rich Text HTML) instead of what's on
  // screen here. To prevent that, flush the draft to the parent the moment
  // the user leaves this field (blur) or the tab/app loses focus, so by the
  // time any Save button is clicked, `value` is always current.
  const flushNow = () => {
    if (draft !== value) { onChange(draft); setApplied(true); }
  };
  useEffect(() => {
    document.addEventListener("visibilitychange", flushNow);
    return () => document.removeEventListener("visibilitychange", flushNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, value]);

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setDraft(text);
    } catch {
      // Clipboard API can be blocked (permissions/HTTP) — input stays focused
      // so the person can still use the native long-press → Paste menu.
    }
  };

  const handleClear = () => {
    if (draft && !confirm("Clear all pasted HTML? This can't be undone.")) return;
    setDraft("");
  };

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      {/* Header / mode hint */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-secondary/60 border-b border-border">
        <Code2 className="w-4 h-4 text-primary shrink-0" />
        <p className="text-xs font-semibold text-foreground flex-1">Paste HTML — renders live below</p>
        <button
          type="button"
          onClick={() => setShowPreview(v => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground shrink-0"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? "Hide Preview" : "Show Preview"}
        </button>
      </div>

      {/* Textarea */}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={flushNow}
        placeholder={placeholder || "Paste your HTML here, e.g. <h2>Simple Harmonic Motion</h2><p>...</p>"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full px-3 py-3 font-mono text-[13px] leading-relaxed bg-background text-foreground outline-none resize-y border-b border-border"
        style={{ minHeight: `${Math.max(160, Math.round(minHeight * 0.45))}px` }}
      />

      {/* Sticky-feeling action bar — big tap targets for mobile */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/40 border-b border-border">
        <button
          type="button"
          onClick={handlePasteFromClipboard}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-card border border-border text-foreground hover:bg-secondary active:scale-95 transition-transform"
        >
          <Clipboard className="w-3.5 h-3.5" /> Paste from Clipboard
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!draft}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-red-600 hover:border-red-300 disabled:opacity-40 active:scale-95 transition-transform"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold">
          {applied ? (
            <span className="flex items-center gap-1 text-green-600"><Check className="w-3.5 h-3.5" /> Applied</span>
          ) : (
            <span className="text-muted-foreground">Applying…</span>
          )}
        </div>
      </div>

      {/* Live preview, using the exact renderer students will see */}
      {showPreview && (
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {draft.trim() ? (
            <ContentRenderer content={draft} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nothing pasted yet — paste HTML above to see a live preview here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
