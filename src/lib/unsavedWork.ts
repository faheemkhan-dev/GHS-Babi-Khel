/**
 * unsavedWork.ts — a tiny global registry of "this screen has unsaved edits".
 *
 * WHY THIS EXISTS
 * ───────────────
 * The app used to have exactly one response to a slow/flaky network: reload
 * the document. That is the single most destructive thing a web app can do to
 * someone who is mid-sentence in an editor, and it is what made the site feel
 * "broken" on 2G/3G — work vanished with no warning and no undo.
 *
 * Reloads are now gone from the automatic paths (see src/main.tsx and
 * src/components/shared/RouteErrorBoundary.tsx). This module is the
 * belt-and-braces layer for the one case nobody can engineer away: the user
 * themselves swiping the app away, closing the tab, or the OS killing the
 * process to reclaim memory on a low-end Android phone.
 *
 * HOW IT WORKS
 * ────────────
 * An editor marks itself dirty while it holds unsaved changes and clears the
 * mark when the work is saved (or deliberately discarded). While at least one
 * mark is registered:
 *   • the service worker is NOT allowed to swap itself in (see main.tsx) —
 *     activating a new worker used to be what triggered the reload, so this
 *     keeps that guarantee even if a future change re-introduces a
 *     controllerchange handler,
 *   • the browser's own "leave site?" prompt fires if the user tries to close
 *     the tab or navigate away.
 *
 * NOTE ON beforeunload: browsers only show their built-in dialog if the
 * handler calls preventDefault() and sets returnValue. Custom message text is
 * ignored by modern browsers — this is intentional, not an oversight.
 */

type Listener = (pending: number) => void;

const dirtyKeys = new Set<string>();
const listeners = new Set<Listener>();
let unloadGuardInstalled = false;

// ── Automatic detection ("nobody wired markUnsaved yet") ───────────────────
// markUnsaved() is opt-in per editor, and at the time of writing no editor in
// the app calls it — which silently turned EVERY protection built on
// hasUnsavedWork() (the guarded stale-chunk reload in App.tsx, the service
// worker hand-over in main.tsx, the beforeunload prompt) into a no-op. So the
// registry also treats "the person typed into an editable field recently" as
// unsaved work. It needs no per-screen wiring, covers every admin form at
// once, and expires by itself so it can never block updates forever.
const TYPING_WINDOW_MS = 90 * 1000;
let lastTypedAt = 0;

function isGuardedEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-ghs-no-guard]")) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return false;
  if (target instanceof HTMLInputElement) {
    const t = (target.type || "text").toLowerCase();
    return !["search", "checkbox", "radio", "button", "submit", "range", "color"].includes(t);
  }
  return target.isContentEditable;
}

/** Current number of screens holding unsaved edits. */
export function unsavedCount(): number {
  return dirtyKeys.size;
}

/** True when at least one screen is holding unsaved edits. */
export function hasUnsavedWork(): boolean {
  return dirtyKeys.size > 0 || Date.now() - lastTypedAt < TYPING_WINDOW_MS;
}

/**
 * Mark a screen as holding unsaved edits. Safe to call on every keystroke —
 * adding an existing key is a no-op, so it does not spam listeners.
 */
export function markUnsaved(key: string): void {
  if (!key) return;
  if (dirtyKeys.has(key)) return;
  dirtyKeys.add(key);
  notify();
}

/** Clear a screen's unsaved edits — call this right after a successful save. */
export function clearUnsaved(key: string): void {
  if (!dirtyKeys.delete(key)) return;
  notify();
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeUnsaved(listener: Listener): () => void {
  listeners.add(listener);
  listener(unsavedCount());
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  const n = dirtyKeys.size;
  listeners.forEach((fn) => {
    try {
      fn(n);
    } catch {
      /* a broken listener must never break the editor that marked the work */
    }
  });
}

/**
 * Installs the browser-level "you have unsaved work" guard. Idempotent, so
 * it is safe to call from more than one place.
 */
export function installUnloadGuard(): void {
  if (unloadGuardInstalled) return;
  if (typeof window === "undefined") return;
  unloadGuardInstalled = true;

  // Capture phase + passive: observes every editor on the page, including
  // ones rendered later, without touching their own handlers.
  window.addEventListener(
    "input",
    (event) => {
      if (isGuardedEditable(event.target)) lastTypedAt = Date.now();
    },
    { capture: true, passive: true }
  );

  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedWork()) return;
    // Both lines are required. Modern browsers ignore the message text and
    // show their own generic wording; the important part is preventDefault.
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = "";
  });
}

/**
 * React hook helper: marks a screen dirty while `dirty` is true and clears it
 * on unmount. The cleanup on unmount matters — a component that unmounts
 * without clearing would block service-worker updates for the rest of the
 * session (a leak that would look like "updates never arrive").
 */
export function trackUnsaved(dirty: boolean, key: string): void {
  if (dirty) markUnsaved(key);
  else clearUnsaved(key);
}
