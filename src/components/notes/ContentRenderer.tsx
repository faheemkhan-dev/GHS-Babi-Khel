/**
 * ContentRenderer.tsx
 * 
 * Simple HTML content renderer for Notes chapters.
 * NO KaTeX dependency — renders raw HTML pasted from admin panel.
 * 
 * ✅ RTL (Right-to-Left) SUPPORT:
 * Automatically detects RTL languages (Urdu, Arabic, Pashto, Persian, etc.)
 * and applies proper direction, text alignment, and font settings.
 */

import { useMemo } from "react";

// ─── RTL Language Detection ──────────────────────────────────────────────────

/**
 * List of RTL language names/keywords for detection
 */
const RTL_LANGUAGE_KEYWORDS = [
  'urdu', 'اردو', 'عربی', 'arabic', 'pashto', 'پښتو', 'persian', 'فارسی', 'farsi',
  'dari', 'دری', 'hebrew', 'עברית', 'yiddish', 'ייִדיש', 'sindhi', 'سنڌي',
  'uyghur', 'ئۇيغۇرچە'
];

/**
 * Unicode ranges for RTL script detection
 */
const RTL_UNICODE_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\uFB1D-\uFB4F\u0700-\u074F\u0780-\u07BF]/;

/**
 * Detects if text contains significant RTL characters
 */
export function containsRTLText(text: string, threshold: number = 0.15): boolean {
  if (!text) return false;
  
  const plainText = text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  
  if (plainText.length === 0) return false;
  
  const rtlMatches = plainText.match(RTL_UNICODE_REGEX);
  const rtlCharCount = rtlMatches ? rtlMatches.length : 0;
  
  return (rtlCharCount / plainText.length) >= threshold;
}

/**
 * Checks if a subject name indicates an RTL language
 */
export function isRTLLanguage(subjectName?: string): boolean {
  if (!subjectName) return false;
  
  const lowerName = subjectName.toLowerCase();
  
  return RTL_LANGUAGE_KEYWORDS.some(keyword => 
    lowerName.includes(keyword.toLowerCase())
  );
}

/**
 * Sanitize HTML content — removes dangerous tags but keeps formatting
 */
export function sanitizeContentHTML(html: string): string {
  if (!html) return html;
  let safe = html;
  
  // Remove <style>...</style> blocks (can leak global CSS)
  safe = safe.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  
  // Remove <script>...</script> blocks (security)
  safe = safe.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  
  // Strip inline event handlers
  safe = safe.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
  
  // Strip javascript: URLs
  safe = safe.replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "");
  
  return safe;
}

// ─── Scoped <style> SUPPORT ─────────────────────────────────────────────
// Pasted notes HTML almost always carries its colors/spacing inside <style>
// blocks. Previously those blocks were DELETED for safety — unscoped CSS
// would leak onto the whole admin page / site chrome — but that made every
// pasted note render as plain black text with zero formatting.
//
// Instead of deleting the CSS, we now REWRITE it so every selector is scoped
// under a per-content class (".nch-<hash>"):
//   • body / html / :root selectors map onto the notes container itself
//   • h2, .card, #x, * become .nch-<hash> h2, .nch-<hash> .card, …
//   • @media / @supports recurse; @keyframes / @font-face stay (harmless)
//   • @import / @charset are dropped (they can never be scoped + CSP anyway)
// The scoped CSS is injected as a <style> INSIDE the container, so pasted
// styles render exactly as authored but physically cannot affect anything
// outside the notes content box. <script> / event handlers / javascript:
// URLs are stripped exactly as before — security surface is unchanged.

/** Deterministic string hash → stable per-content scope suffix (djb2). */
function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Stable CSS class that scopes one piece of content's pasted <style> rules.
 * Deterministic (content-derived) so prerendered HTML and client hydration
 * always agree — never Math.random() here.
 */
export function contentScopeClass(content: string): string {
  return `nch-${hashContent(content || "")}`;
}

/** Strip CSS comments — avoids comment/brace parsing pitfalls below. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Strip leading html/body/:root tokens (plus any following combinator) from a
 * selector, so "html body h1" and "body > h1" both reduce to "h1".
 */
function trimRootTokens(sel: string): string {
  let s = sel.trim();
  for (;;) {
    const m = s.match(/^(html|body|:root)\b(?:\s*[>~+]\s*|\s+)*/i);
    if (!m || !m[0]) break;
    s = s.slice(m[0].length);
  }
  return s.trim();
}

/** Scope one comma-separated selector list under the given scope selector. */
function scopeSelectorList(selector: string, scope: string): string {
  return selector
    .split(",")
    .map(part => {
      const sel = part.trim();
      if (!sel) return "";
      // Defensive: already scoped → leave untouched
      if (sel === scope || sel.startsWith(`${scope} `) || sel.startsWith(`${scope}.`) ||
          sel.startsWith(`${scope}:`) || sel.startsWith(`${scope}#`) || sel.startsWith(`${scope}[`)) return sel;
      const inner = trimRootTokens(sel);
      if (!inner) return scope;        // selector was exactly html/body/:root
      return `${scope} ${inner}`;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * Rewrite every rule in a CSS string so it only matches inside the scope.
 * A tiny brace-depth tokenizer (not regex-splitting) so nested @media blocks
 * and braces inside values survive intact.
 */
function scopeCssRules(css: string, scope: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    const braceStart = css.indexOf("{", i);
    if (braceStart === -1) { out += css.slice(i); break; }
    const rawSelector = css.slice(i, braceStart).trim();
    // Find the matching close brace (brace-depth aware)
    let depth = 1;
    let j = braceStart + 1;
    while (j < n && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(braceStart + 1, depth === 0 ? j - 1 : j);
    if (rawSelector.startsWith("@")) {
      if (/^@(media|supports|container|scope|layer)\b/i.test(rawSelector)) {
        // Conditional group rules — recurse into their inner rules
        out += `${rawSelector}{${scopeCssRules(body, scope)}}`;
      } else if (/^@(import|charset|namespace)\b/i.test(rawSelector)) {
        // Unscopeable / pointless here — drop silently
      } else {
        // @keyframes / @font-face / @property … — body is not selectors, keep
        out += `${rawSelector}{${body}}`;
      }
    } else if (rawSelector) {
      out += `${scopeSelectorList(rawSelector, scope)}{${body}}`;
    }
    i = j;
  }
  return out;
}

/** Pull every <style> block out of pasted HTML. */
function extractStyleBlocks(html: string): { body: string; css: string } {
  const cssParts: string[] = [];
  const body = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => {
    cssParts.push(stripCssComments(String(css)));
    return "";
  });
  return { body, css: cssParts.join("\n") };
}

/**
 * Remove standalone-document scaffolding (doctype + html/head/body wrapper
 * tags) from pasted FULL documents. The head (meta/title/link) carries no
 * visible content, and html/body tags are inert when injected via innerHTML —
 * but stripping them keeps the container output clean. IMPORTANT: run this
 * AFTER extractStyleBlocks, never before (styles live inside <head>).
 */
function stripDocumentScaffold(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "");
}

/**
 * Full pipeline for dangerouslySetInnerHTML:
 * 1. pull <style> blocks out of the pasted HTML
 * 2. scope their CSS under scopeClass (generated from the content if omitted)
 * 3. sanitize the remaining HTML (script/handler/js: stripping — unchanged)
 * 4. prepend an in-container <style> the sanitizer never touches
 * Returns ONE string safe to hand to dangerouslySetInnerHTML.
 */
export function buildScopedContentHTML(content: string, scopeClass?: string): string {
  const { body: rawBody, css: rawCss } = extractStyleBlocks(content);
  // Drop unscopeable document-level statements FIRST (@import has no brace
  // block, so the rule tokenizer below can never see and drop it itself).
  // @import could also pull unscoped external CSS past the container — never
  // wanted here (CDN @font-face stays available via @font-face, untouched).
  const css = rawCss.replace(/@(import|charset|namespace)[^;]*;?/gi, "");
  const body = stripDocumentScaffold(rawBody);
  const safeHtml = sanitizeContentHTML(body);
  if (!css.trim()) return safeHtml;
  const scope = scopeClass || contentScopeClass(content);
  // Neutralize any stray "</style" inside the CSS so the injected block can
  // never be terminated early (belt & braces — extractStyleBlocks already
  // split on real closing tags).
  const scoped = scopeCssRules(css, `.${scope}`).replace(/<\/style/gi, "");
  if (!scoped.trim()) return safeHtml;
  return `<style>${scoped}</style>${safeHtml}`;
}

// ─── React Component ─────────────────────────────────────────────────────────

interface ContentRendererProps {
  /** Raw HTML content (pasted from admin) */
  content: string;
  /** Additional CSS classes */
  className?: string;
  /** Additional styles */
  style?: React.CSSProperties;
  /** Subject name for RTL auto-detection hint */
  subjectName?: string;
  /** Force RTL mode */
  forceRTL?: boolean;
  /** Force LTR mode */
  forceLTR?: boolean;
}

const ContentRenderer: React.FC<ContentRendererProps> = ({ 
  content, 
  className, 
  style,
  subjectName,
  forceRTL = false,
  forceLTR = false
}) => {
  // Determine RTL configuration
  const config = useMemo(() => {
    if (forceLTR) {
      return { dir: "ltr" as const, isRTL: false };
    }
    if (forceRTL) {
      return { dir: "rtl" as const, isRTL: true };
    }
    
    // Auto-detect based on subject name or content
    const subjectIsRTL = isRTLLanguage(subjectName);
    const contentHasRTL = containsRTLText(content);
    
    if (subjectIsRTL || contentHasRTL) {
      return { dir: "rtl" as const, isRTL: true };
    }
    
    return { dir: "ltr" as const, isRTL: false };
  }, [content, subjectName, forceRTL, forceLTR]);

  // Build styles
  const mergedStyle: React.CSSProperties = {
    ...style,
    ...(config.isRTL ? {
      direction: "rtl",
      textAlign: "right",
      fontFamily: "'Noto Nastaliq Urdu', 'Noto Naskh Arabic', 'Jameel Noori Nastaleeq', 'Arial', sans-serif",
      lineHeight: 2,
    } : {
      direction: "ltr",
      textAlign: "left",
    })
  };

  if (!content) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-4xl mb-3">📝</p>
        <p>Content coming soon...</p>
      </div>
    );
  }

  // Pasted <style> CSS is scoped under this class (see notes above) so the
  // note renders with its authored colors/spacing without leaking styles to
  // the rest of the page.
  const scopeClass = contentScopeClass(content);

  return (
    <div
      dir={config.dir}
      className={className ? `${className} ${scopeClass}` : scopeClass}
      style={mergedStyle}
      dangerouslySetInnerHTML={{ __html: buildScopedContentHTML(content, scopeClass) }}
    />
  );
};

export default ContentRenderer;
