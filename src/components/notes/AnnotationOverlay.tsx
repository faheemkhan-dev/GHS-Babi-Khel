import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, Eye, Globe2, Lock, Trash2, ThumbsUp, ChevronDown, ChevronUp, Highlighter } from "lucide-react";
import {
  useAnnotations, useCreateAnnotation, useUpdateAnnotation,
  useDeleteAnnotation, useUpvoteAnnotation, NoteAnnotation, BADGES,
} from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import toast from "react-hot-toast";

// ─── Annotation Color Picker ──────────────────────────────────────────────────
const ANNOTATION_COLORS = [
  { id: "yellow", bg: "bg-yellow-200 dark:bg-yellow-900/40", border: "border-yellow-400", dot: "bg-yellow-400" },
  { id: "green",  bg: "bg-green-200 dark:bg-green-900/40",  border: "border-green-400",  dot: "bg-green-400" },
  { id: "blue",   bg: "bg-blue-200 dark:bg-blue-900/40",    border: "border-blue-400",   dot: "bg-blue-400" },
  { id: "pink",   bg: "bg-pink-200 dark:bg-pink-900/40",    border: "border-pink-400",   dot: "bg-pink-400" },
  { id: "orange", bg: "bg-orange-200 dark:bg-orange-900/40", border: "border-orange-400", dot: "bg-orange-400" },
];

function getColorClasses(colorId: string) {
  return ANNOTATION_COLORS.find(c => c.id === colorId) || ANNOTATION_COLORS[0];
}

// ─── Create Annotation Popup ──────────────────────────────────────────────────
// On phones, anchoring this popup to the exact selection coordinates fights
// with the native OS text-selection toolbar (Copy/Share/Select all), which
// occupies that same area and can overlap or push our popup off-screen.
// Instead: on narrow screens (<768px) render as a fixed bottom sheet that
// always has a stable, fully-visible position regardless of where the
// selection was made. On wider screens (tablet/desktop) keep the anchored
// popup near the selection, since there's no competing native toolbar there.
const CreateAnnotationPopup = ({
  selectedText, position, onClose, onSubmit,
}: {
  selectedText: string; position: { x: number; y: number };
  onClose: () => void; onSubmit: (data: { comment: string; visibility: NoteAnnotation["visibility"]; color: string }) => void;
}) => {
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] = useState<NoteAnnotation["visibility"]>("private");
  const [color, setColor] = useState("yellow");
  const [expanded, setExpanded] = useState(true);
  const popupRef = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [style, setStyle] = useState<{ left: number; top: number; maxHeight: number } | null>(
    isMobile ? null : {
      left: Math.max(10, Math.min(position.x, window.innerWidth - 340)),
      top: Math.max(10, position.y),
      maxHeight: window.innerHeight - 20,
    }
  );

  useEffect(() => {
    if (isMobile) return; // bottom sheet on mobile — no coordinate math needed
    const el = popupRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    const left = Math.max(margin, Math.min(position.x, viewportW - rect.width - margin));
    let top = position.y;
    if (top + rect.height > viewportH - margin) {
      top = Math.max(margin, viewportH - rect.height - margin);
    }
    top = Math.max(margin, top);

    setStyle({ left, top, maxHeight: viewportH - top - margin });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const content = (
    <>
      <div className="flex items-center justify-between p-3 border-b border-border bg-secondary/50">
        <span className="text-sm font-bold text-foreground flex items-center gap-2">
          <Highlighter className="w-4 h-4 text-primary" /> New Annotation
        </span>
        <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Selected text preview */}
      <div className="px-3 py-2">
        <div className="bg-muted rounded-lg p-2.5 text-xs text-foreground italic line-clamp-3 border-l-4 border-primary">
          "{selectedText}"
        </div>
      </div>

      {/* Color picker */}
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-muted-foreground">Color:</span>
        {ANNOTATION_COLORS.map(c => (
          <button
            key={c.id}
            onClick={() => setColor(c.id)}
            className={`w-6 h-6 rounded-full ${c.dot} transition-all ${color === c.id ? "ring-2 ring-offset-2 ring-primary scale-110" : "opacity-60 hover:opacity-100"}`}
            title={c.id}
          />
        ))}
      </div>

      {/* Comment */}
      <div className="px-3 py-1">
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          placeholder="Add a note or comment..."
          className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* Visibility */}
      <div className="px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Visibility: {visibility === "private" ? "Private" : visibility === "shared" ? "Classmates" : "Public"}
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 mt-2">
                {([
                  { val: "private" as const, icon: Lock, label: "Private", desc: "Only you" },
                  { val: "shared" as const, icon: Eye, label: "Shared", desc: "Classmates" },
                  { val: "public" as const, icon: Globe2, label: "Public", desc: "Everyone" },
                ]).map(v => (
                  <button
                    key={v.val}
                    onClick={() => setVisibility(v.val)}
                    className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl text-[10px] font-semibold border transition-all ${
                      visibility === v.val
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <v.icon className="w-3.5 h-3.5" />
                    {v.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Submit */}
      <div className="p-3 border-t border-border">
        <button
          onClick={() => onSubmit({ comment, visibility, color })}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
        >
          <MessageSquare className="w-4 h-4" /> Save Annotation
        </button>
      </div>
    </>
  );

  if (isMobile) {
    // Bottom sheet — fixed position, never anchored to the (unreliable on
    // mobile) selection coordinates, never competes with the native OS
    // text-selection toolbar for space, and always fully reachable.
    return (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/40"
          onClick={onClose}
        />
        <motion.div
          ref={popupRef}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "tween", duration: 0.25 }}
          className="fixed left-0 right-0 bottom-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-2xl overflow-y-auto"
          style={{ maxHeight: "85vh" }}
        >
          {content}
          {/* Safe-area padding for phones with a gesture bar */}
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
        </motion.div>
      </>
    );
  }

  return (
    <motion.div
      ref={popupRef}
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      className="fixed z-50 w-80 max-w-[calc(100vw-1.5rem)] bg-card border border-border rounded-2xl shadow-2xl overflow-y-auto"
      style={style ? { left: style.left, top: style.top, maxHeight: style.maxHeight } : undefined}
    >
      {content}
    </motion.div>
  );
};

// ─── Annotation View Popup ────────────────────────────────────────────────────
const AnnotationViewPopup = ({
  annotation, onClose, onUpvote, onDelete, currentUserId,
}: {
  annotation: NoteAnnotation; onClose: () => void;
  onUpvote: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
  currentUserId: string;
}) => {
  const isOwner = annotation.user_id === currentUserId;
  const colorClasses = getColorClasses(annotation.color);
  const VisIcon = annotation.visibility === "private" ? Lock : annotation.visibility === "shared" ? Eye : Globe2;
  const visLabel = annotation.visibility === "private" ? "Private" : annotation.visibility === "shared" ? "Shared" : "Public";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden w-72 max-w-[calc(100vw-2rem)]"
    >
      <div className={`px-3 py-2 ${colorClasses.bg} border-b ${colorClasses.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/50 dark:bg-black/30 flex items-center justify-center text-xs font-bold">
              {(annotation.profiles?.full_name || "?")[0]?.toUpperCase()}
            </div>
            <div>
              <span className="text-xs font-bold text-foreground">{annotation.profiles?.full_name || "Student"}</span>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <VisIcon className="w-2.5 h-2.5" /> {visLabel}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/30 dark:hover:bg-black/20 rounded-lg">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="bg-muted rounded-lg p-2 text-xs text-foreground italic mb-2 border-l-4 border-primary line-clamp-4">
          "{annotation.highlighted_text}"
        </div>
        {annotation.comment && (
          <p className="text-sm text-foreground mb-3">{annotation.comment}</p>
        )}

        <div className="flex items-center gap-2">
          {annotation.visibility !== "private" && (
            <button
              onClick={() => onUpvote(annotation.id)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors px-2.5 py-1.5 rounded-lg hover:bg-secondary"
            >
              <ThumbsUp className="w-3.5 h-3.5" /> {annotation.upvotes || 0}
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => onDelete(annotation.id)}
              className="flex items-center gap-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ─── Annotation Marker (inline highlight on text) ─────────────────────────────
const AnnotationMarker = ({
  annotation, onClick, isOwner,
}: {
  annotation: NoteAnnotation; onClick: () => void; isOwner: boolean;
}) => {
  const colorClasses = getColorClasses(annotation.color);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`inline ${colorClasses.bg} ${colorClasses.border} border-b-2 cursor-pointer rounded-sm px-0.5 transition-all hover:brightness-110 hover:shadow-sm ${isOwner ? "" : "opacity-80"}`}
      title={annotation.comment || "Click to view annotation"}
    >
      {annotation.highlighted_text}
    </span>
  );
};

// ─── Main AnnotationOverlay Component ─────────────────────────────────────────
interface AnnotationOverlayProps {
  chapterId: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  /**
   * When true, the floating action button (FAB) is NOT rendered. Parent
   * component (e.g. ChapterPage) renders its own annotation trigger button
   * in a unified FAB stack instead.
   *
   * Controlled open state via `open` + `onOpenChange` lets the parent toggle
   * the annotation sidebar from its own FAB.
   */
  hideFab?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AnnotationOverlay = ({ chapterId, contentRef, hideFab = false, open: controlledOpen, onOpenChange }: AnnotationOverlayProps) => {
  const { user } = useAuth();
  const { data: annotations = [], error: annotationsError } = useAnnotations(chapterId, user?.id);
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();
  const upvoteAnnotation = useUpvoteAnnotation();

  const [selectedText, setSelectedText] = useState("");
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [viewingAnnotation, setViewingAnnotation] = useState<NoteAnnotation | null>(null);
  const [viewPopupPos, setViewPopupPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [internalShowList, setShowAnnotationList] = useState(false);
  const showAnnotationList = controlledOpen !== undefined ? controlledOpen : internalShowList;
  const handleSetShowList = (v: boolean) => {
    setShowAnnotationList(v);
    onOpenChange?.(v);
  };
  const [highlightedContent, setHighlightedContent] = useState(false);

  // Handle text selection
  const handleSelectionEnd = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }
    const text = selection.toString().trim();
    if (text.length < 3) return; // Minimum 3 chars to annotate

    // Make sure the selection is actually inside the chapter content area —
    // otherwise selecting text elsewhere on the page (nav, footer, etc.)
    // would also trigger the popup.
    const el = contentRef.current;
    if (!el) return;
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !el.contains(anchorNode)) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setSelectedText(text);
    setPopupPos({
      x: Math.max(10, rect.left + window.scrollX),
      y: Math.max(10, rect.top + window.scrollY - 10),
    });

    // Clear the native browser selection now that we've captured the text
    // and position we need. This also dismisses the native OS text-selection
    // toolbar (Copy/Share/Select all on Android, the iOS equivalent) so it
    // doesn't visually overlap our own popup.
    selection.removeAllRanges();
  }, [contentRef]);

  // Listen for text selections on the content area.
  // mouseup alone is unreliable on mobile: touch-based selection (long-press +
  // drag handles) frequently doesn't fire a mouseup event in the same way a
  // mouse click-drag does, especially on Android Chrome. We additionally
  // listen for touchend on the content element and selectionchange on the
  // document (debounced) so the popup reliably appears after a touch
  // selection is finalized.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    el.addEventListener("mouseup", handleSelectionEnd);
    el.addEventListener("touchend", handleSelectionEnd);

    let selectionChangeTimeout: ReturnType<typeof setTimeout> | null = null;
    const onSelectionChange = () => {
      if (selectionChangeTimeout) clearTimeout(selectionChangeTimeout);
      // Debounce — selectionchange fires repeatedly while dragging handles;
      // wait a moment after the last change before treating it as "final".
      selectionChangeTimeout = setTimeout(handleSelectionEnd, 250);
    };
    document.addEventListener("selectionchange", onSelectionChange);

    return () => {
      el.removeEventListener("mouseup", handleSelectionEnd);
      el.removeEventListener("touchend", handleSelectionEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      if (selectionChangeTimeout) clearTimeout(selectionChangeTimeout);
    };
  }, [contentRef, handleSelectionEnd]);

  // Handle annotation creation
  const handleCreate = async (data: { comment: string; visibility: NoteAnnotation["visibility"]; color: string }) => {
    if (!user || !selectedText) return;
    const selection = window.getSelection();
    let positionData: Record<string, any> = {};
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const contentEl = contentRef.current;
      if (contentEl) {
        const contentRect = contentEl.getBoundingClientRect();
        positionData = {
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          startX: rect.left - contentRect.left,
          startY: rect.top - contentRect.top,
          width: rect.width,
          height: rect.height,
          textBefore: range.startContainer.textContent?.slice(Math.max(0, range.startOffset - 30), range.startOffset) || "",
          textAfter: range.endContainer.textContent?.slice(range.endOffset, range.endOffset + 30) || "",
        };
      }
    }

    try {
      await createAnnotation.mutateAsync({
        user_id: user.id,
        chapter_id: chapterId,
        highlighted_text: selectedText,
        comment: data.comment || null,
        position_data: positionData,
        visibility: data.visibility,
        color: data.color,
      });

      // Clear selection
      window.getSelection()?.removeAllRanges();
      setSelectedText("");
      setPopupPos(null);
      toast.success("Annotation saved");
    } catch (err) {
      toast.error(err?.message || "Couldn't save annotation. Please try again.");
      // Keep the popup open on failure so the user doesn't lose their note.
    }
  };

  const handleUpvote = async (annotationId: string) => {
    if (!user) return;
    await upvoteAnnotation.mutateAsync({ annotationId, userId: user.id, chapterId });
    // Refresh the viewing annotation
    const updated = annotations.find(a => a.id === annotationId);
    if (updated) {
      setViewingAnnotation({ ...updated, upvotes: updated.upvotes + 1 });
    }
  };

  const handleDelete = async (annotationId: string) => {
    await deleteAnnotation.mutateAsync({ id: annotationId, chapterId });
    setViewingAnnotation(null);
  };

  // Filter visible annotations
  const visibleAnnotations = annotations.filter(a =>
    a.user_id === user?.id || a.visibility === "shared" || a.visibility === "public"
  );

  const myAnnotations = visibleAnnotations.filter(a => a.user_id === user?.id);
  const peerAnnotations = visibleAnnotations.filter(a => a.user_id !== user?.id);

  return (
    <>
      {/* Annotation toggle button — only rendered when parent hasn't hidden it.
          When hideFab=true, the parent (ChapterPage) renders its own annotation
          trigger in a unified FAB stack to avoid overlap. */}
      {!hideFab && (
        <button
          onClick={() => handleSetShowList(!showAnnotationList)}
          className={`fixed bottom-40 right-4 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all lg:bottom-28 lg:right-16 ${
            showAnnotationList ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground hover:bg-secondary"
          }`}
          title="Annotations"
        >
          <MessageSquare className="w-5 h-5" />
          {visibleAnnotations.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {visibleAnnotations.length}
            </span>
          )}
        </button>
      )}

      {/* Annotation sidebar/list — slides up on mobile, right panel on desktop */}
      <AnimatePresence>
        {showAnnotationList && (
          <motion.div
            initial={{ y: typeof window !== 'undefined' && window.innerWidth < 640 ? 400 : 0, x: typeof window !== 'undefined' && window.innerWidth < 640 ? 0 : 300, opacity: 0 }}
            animate={{ y: 0, x: 0, opacity: 1 }}
            exit={{ y: typeof window !== 'undefined' && window.innerWidth < 640 ? 400 : 0, x: typeof window !== 'undefined' && window.innerWidth < 640 ? 0 : 300, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed top-14 sm:top-14 right-0 bottom-0 w-full sm:w-96 z-40 bg-card border-l border-border shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Highlighter className="w-4 h-4 text-primary" /> Annotations
                <span className="text-xs font-normal text-muted-foreground">({visibleAnnotations.length})</span>
              </h3>
              <button onClick={() => handleSetShowList(false)} className="p-1.5 hover:bg-secondary rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Error state — distinct from "no annotations yet" so a real
                  failure (broken query, RLS denial, etc.) is visible instead
                  of looking identical to having none. */}
              {annotationsError && (
                <div className="text-center py-8">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 text-destructive opacity-60" />
                  <p className="text-sm font-semibold text-destructive">Couldn't load annotations</p>
                  <p className="text-xs text-muted-foreground mt-1 px-4">
                    {(annotationsError as any)?.message || "Something went wrong fetching annotations."}
                  </p>
                </div>
              )}

              {/* Hint */}
              {!annotationsError && visibleAnnotations.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm font-medium">No annotations yet</p>
                  <p className="text-xs mt-1">Select text in the chapter to create one</p>
                </div>
              )}

              {/* My annotations */}
              {!annotationsError && myAnnotations.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">My Notes ({myAnnotations.length})</h4>
                  <div className="space-y-2">
                    {myAnnotations.map(a => (
                      <AnnotationCard key={a.id} annotation={a} onClick={() => {
                        setViewingAnnotation(a);
                        setViewPopupPos({ x: window.innerWidth / 2 - 140, y: 100 });
                      }} onDelete={handleDelete} isOwner />
                    ))}
                  </div>
                </div>
              )}

              {/* Peer annotations */}
              {!annotationsError && peerAnnotations.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Eye className="w-3 h-3" /> Classmates ({peerAnnotations.length})
                  </h4>
                  <div className="space-y-2">
                    {peerAnnotations
                      .sort((a, b) => b.upvotes - a.upvotes) // Top annotations first
                      .map(a => (
                      <AnnotationCard key={a.id} annotation={a} onClick={() => {
                        setViewingAnnotation(a);
                        setViewPopupPos({ x: window.innerWidth / 2 - 140, y: 100 });
                      }} onUpvote={handleUpvote} currentUserId={user?.id || ""} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create annotation popup */}
      <AnimatePresence>
        {popupPos && selectedText && (
          <CreateAnnotationPopup
            selectedText={selectedText}
            position={popupPos}
            onClose={() => { setSelectedText(""); setPopupPos(null); window.getSelection()?.removeAllRanges(); }}
            onSubmit={handleCreate}
          />
        )}
      </AnimatePresence>

      {/* View annotation popup */}
      <AnimatePresence>
        {viewingAnnotation && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-20 p-4" onClick={() => setViewingAnnotation(null)}>
            <div onClick={e => e.stopPropagation()}>
              <AnnotationViewPopup
                annotation={viewingAnnotation}
                onClose={() => setViewingAnnotation(null)}
                onUpvote={handleUpvote}
                onDelete={handleDelete}
                currentUserId={user?.id || ""}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

// ─── Annotation Card (compact card for sidebar list) ──────────────────────────
const AnnotationCard = ({
  annotation, onClick, onDelete, onUpvote, isOwner, currentUserId,
}: {
  annotation: NoteAnnotation; onClick: () => void;
  onDelete?: (id: string) => void; onUpvote?: (id: string) => void;
  isOwner?: boolean; currentUserId?: string;
}) => {
  const colorClasses = getColorClasses(annotation.color);
  const VisIcon = annotation.visibility === "private" ? Lock : annotation.visibility === "shared" ? Eye : Globe2;

  return (
    <div
      onClick={onClick}
      className={`bg-background border border-border rounded-xl p-3 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all ${colorClasses.border} border-l-4`}
    >
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0 mt-0.5">
          {(annotation.profiles?.full_name || "?")[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-foreground">{annotation.profiles?.full_name || "Student"}</span>
            <VisIcon className="w-3 h-3 text-muted-foreground" />
            {isOwner && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete?.(annotation.id); }}
                className="ml-auto p-1 hover:bg-destructive/10 rounded text-destructive"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className={`text-xs ${colorClasses.bg} rounded px-1.5 py-0.5 italic line-clamp-2 mb-1`}>
            "{annotation.highlighted_text}"
          </p>
          {annotation.comment && (
            <p className="text-xs text-foreground line-clamp-2">{annotation.comment}</p>
          )}
          {annotation.visibility !== "private" && annotation.upvotes > 0 && (
            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
              <ThumbsUp className="w-3 h-3" /> {annotation.upvotes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationOverlay;
