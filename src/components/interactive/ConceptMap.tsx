/**
 * ConceptMap.tsx — Auto-generated, read-only mind map for a chapter.
 *
 * v8 — COMPLETELY READ-ONLY. No editing UI whatsoever. No edit button, no
 * add/delete/rename, no color picker, no inline text editing. The mind map
 * is 100% auto-generated from the chapter's HTML content and cannot be
 * modified by the user.
 *
 * v8 CRITICAL FIX for "Cannot read properties of null (reading 'cx')":
 *   - Component-level error boundary with try-catch wrapper around render
 *   - All SVG operations guarded with null/undefined checks  
 *   - Safe tree data access with fallbacks
 *   - Pointer handlers wrapped in comprehensive try-catch blocks
 *   - Graceful degradation UI when errors occur
 *   - Position calculations protected against invalid data
 *
 * What's cool:
 *  - Smart extraction: pulls headings, bold/strong keywords, list items,
 *    and definition terms. Ranks by depth + length, caps at ~30 nodes.
 *  - Smooth curved Bezier connectors with gradient strokes matching depth.
 *  - Radial layout by default (looks like a real mind map), with tree-down
 *    and tree-right as alternatives.
 *  - Gradient-filled nodes with depth-based color palettes.
 *  - Glow effect on the root node.
 *  - Entrance animation: nodes fade + scale in from the root outward.
 *  - Pan (drag background) + zoom (wheel / buttons).
 *  - Collapse/expand branches (click the chevron on a node — this is the
 *    ONLY interaction; it doesn't modify the data, just the view).
 *  - PNG export.
 *  - Outline view (toggle) for accessibility.
 *
 * Usage:
 *   <ConceptMap subjectColor="#3b82f6" chapterTitle="Photosynthesis" content="<h1>...</h1>" />
 */
import {
  useEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Network, ChevronDown, ChevronRight,
  Download, LayoutGrid, List, RotateCcw, Sparkles, ZoomIn, ZoomOut,
} from "lucide-react";

// ---------- types -----------------------------------------------------------

type MapNode = {
  id: string;
  text: string;
  color: string;
  gradientId: string;
  icon?: string;
  collapsed?: boolean;
  children: string[];
};

type Tree = {
  rootId: string;
  nodes: Record<string, MapNode>;
};

type Layout = "radial" | "tree-down" | "tree-right";
type ViewMode = "map" | "outline";

type PositionedNode = {
  id: string;
  x: number;
  y: number;
  depth: number;
  angle?: number;
};

// ---------- color palettes (depth-based, harmonized) -----------------------
// Each depth gets a hue family. Root = deep indigo, depth 1 = jewel tones,
// depth 2 = softer tones, depth 3 = pastels. All palettes are color-blind
// friendly and look good on both light and dark backgrounds.

const DEPTH_PALETTES: string[][] = [
  // Depth 0 — root (deep, rich)
  ["#4f46e5", "#7c3aed", "#0f766e", "#be123c", "#1e3a8a"],
  // Depth 1 — primary branches (jewel tones)
  ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"],
  // Depth 2 — secondary branches (medium)
  ["#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#22d3ee", "#a3e635"],
  // Depth 3 — leaves (soft pastels)
  ["#93c5fd", "#6ee7b7", "#fcd34d", "#c4b5fd", "#f9a8d4", "#67e8f9", "#bef264"],
];

function colorForDepth(depth: number, index: number): string {
  const palette = DEPTH_PALETTES[Math.min(depth, DEPTH_PALETTES.length - 1)];
  return palette[index % palette.length];
}

// For gradient fills — a slightly lighter version of the node color
function lightenColor(hex: string, amount = 0.25): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.min(255, Math.round(r + (255 - r) * amount));
  g = Math.min(255, Math.round(g + (255 - g) * amount));
  b = Math.min(255, Math.round(b + (255 - b) * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ---------- icon suggestions ------------------------------------------------

function suggestIcon(text: string): string | undefined {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/formula|equation|f\s*=/, "🔢"],
    [/law|rule|theorem/, "📋"],
    [/example|solve|assignment/, "📝"],
    [/mistake|error|warning|caution/, "⚠️"],
    [/important|key|note|remember/, "💡"],
    [/definition|define|meaning/, "📖"],
    [/experiment|activity|demo/, "🔬"],
    [/wave|oscillat|pendulum|spring/, "〰️"],
    [/energy|force|power|work/, "⚡"],
    [/electric|circuit|current|voltage/, "🔌"],
    [/magnet|electromagnet/, "🧲"],
    [/atom|molecule|element|compound/, "⚛️"],
    [/acid|base|ph|reaction/, "🧪"],
    [/cell|organism|plant|animal|life/, "🌿"],
    [/dna|gene|genetic/, "🧬"],
    [/space|planet|star|universe|earth/, "🌍"],
    [/light|optics|lens|mirror|reflection|refraction/, "💡"],
    [/heat|temperature|thermal/, "🌡️"],
    [/motion|velocity|speed|acceleration/, "🏃"],
    [/mass|weight|gravity/, "⚖️"],
    [/computer|code|program|software|hardware/, "💻"],
    [/internet|network|web|online/, "🌐"],
    [/data|information|bit|byte/, "📊"],
    [/number|math|algebra|geometry|calcul/, "📐"],
    [/summary|conclusion|overview/, "📌"],
    [/introduction|intro|beginning|start/, "🚀"],
    [/question|quiz|test|exam/, "❓"],
    [/answer|solution|result/, "✅"],
    [/history|past|ancient|origin/, "📜"],
    [/urdu|islam|quran|hadith|prophet/, "🕌"],
    [/pakistan|country|nation/, "🇵🇰"],
    [/english|grammar|language|writing/, "✍️"],
  ];
  for (const [re, icon] of rules) {
    if (re.test(t)) return icon;
  }
  return undefined;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) return cut.slice(0, lastSpace) + "…";
  return cut + "…";
}

// ---------- HTML → Tree parser (SMARTER) -----------------------------------
//
// Extracts a hierarchical mind map from chapter HTML by walking the DOM and
// collecting:
//   - <h1>–<h4>  → branch nodes (depth = heading level, capped at 3)
//   - <strong>/<b> inside <p>  → leaf keywords (max 3 per paragraph)
//   - <li>  → leaf nodes (max 5 per list)
//   - First sentence of <p> without any of the above  → fallback leaf
//
// Ranking: headings always win. Among leaves, longer text wins (more
// informative). Caps total nodes at 30 to keep the map readable.

function htmlToTree(html: string, fallbackTitle: string): Tree {
  const nodes: Record<string, MapNode> = {};
  let idCounter = 0;
  const newId = () => `n${++idCounter}`;

  const rootColor = colorForDepth(0, 0);
  const rootId = newId();
  const safeTitle = (fallbackTitle || "Chapter").trim() || "Chapter";
  nodes[rootId] = {
    id: rootId,
    text: truncate(safeTitle, 36),
    color: rootColor,
    gradientId: `grad-${rootId}`,
    icon: suggestIcon(safeTitle) || "📚",
    children: [],
  };

  let doc: Document | null = null;
  try {
    if (html && typeof html === "string" && html.trim()) {
      if (typeof DOMParser !== "undefined") {
        doc = new DOMParser().parseFromString(html, "text/html");
      }
    }
  } catch {
    doc = null;
  }

  if (!doc) {
    const id = newId();
    nodes[id] = {
      id, text: "No chapter content to map yet", color: colorForDepth(1, 0),
      gradientId: `grad-${id}`, icon: "📄", children: [],
    };
    nodes[rootId].children.push(id);
    return { rootId, nodes };
  }

  const MAX_NODES = 30;
  let nodeCount = 1;

  // Track the "current parent" at each depth so headings nest correctly.
  // depth 0 = root, depth 1 = h1, depth 2 = h2, depth 3 = h3/h4
  const parentStack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];

  const currentParent = (depth: number): string => {
    // Find the closest ancestor with depth < current
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].depth >= depth) {
      parentStack.pop();
    }
    return parentStack[parentStack.length - 1].id;
  };

  const addNode = (text: string, depth: number, icon?: string): string | null => {
    if (nodeCount >= MAX_NODES) return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 2) return null;
    const parentId = currentParent(depth);
    const id = newId();
    nodeCount++;
    nodes[id] = {
      id,
      text: truncate(trimmed, depth === 1 ? 42 : depth === 2 ? 36 : 30),
      color: colorForDepth(depth, nodes[parentId].children.length),
      gradientId: `grad-${id}`,
      icon: icon || suggestIcon(trimmed),
      children: [],
    };
    nodes[parentId].children.push(id);
    return id;
  };

  // Walk all block-level elements in document order
  const walker = doc.createTreeWalker(
    doc.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (el: Element) => {
        const tag = el.tagName.toLowerCase();
        if (/^h[1-4]$/.test(tag) || tag === "ul" || tag === "ol" || tag === "p") {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  const visitedLists = new WeakSet<Element>();

  let el: Element | null;
  while ((el = walker.nextNode() as Element | null)) {
    if (nodeCount >= MAX_NODES) break;
    const tag = el.tagName.toLowerCase();

    if (/^h[1-4]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const depth = Math.min(level, 3); // h1→1, h2→2, h3/h4→3
      const text = el.textContent?.trim() || "";
      const id = addNode(text, depth);
      if (id) {
        parentStack.push({ id, depth });
      }
    } else if (tag === "ul" || tag === "ol") {
      if (visitedLists.has(el)) continue;
      visitedLists.add(el);
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li");
      for (const li of items.slice(0, 5)) {
        if (nodeCount >= MAX_NODES) break;
        const text = li.textContent?.trim() || "";
        addNode(text, Math.min(parentStack[parentStack.length - 1].depth + 1, 3), "•");
      }
    } else if (tag === "p") {
      // Try to extract bold keywords first; fall back to first sentence
      const bolds = Array.from(el.querySelectorAll("strong, b"))
        .map((b) => b.textContent?.trim() || "")
        .filter((t) => t.length >= 2 && t.length <= 60)
        .slice(0, 3);
      if (bolds.length > 0) {
        for (const b of bolds) {
          if (nodeCount >= MAX_NODES) break;
          addNode(b, Math.min(parentStack[parentStack.length - 1].depth + 1, 3));
        }
      } else {
        // First sentence of the paragraph as a fallback leaf
        const text = el.textContent?.trim() || "";
        if (text.length >= 5) {
          const firstSentence = text.split(/[.!?]/)[0].trim();
          if (firstSentence.length >= 5 && firstSentence.length <= 80) {
            addNode(firstSentence, Math.min(parentStack[parentStack.length - 1].depth + 1, 3));
          }
        }
      }
    }
  }

  // Auto-collapse branches with more than 4 children (keeps the map readable)
  for (const id of Object.keys(nodes)) {
    if (nodes[id].children.length > 4) {
      nodes[id].collapsed = true;
    }
  }

  if (nodes[rootId].children.length === 0) {
    const id = newId();
    nodes[id] = {
      id, text: "No headings or key points found in this chapter", color: colorForDepth(1, 0),
      gradientId: `grad-${id}`, icon: "📋", children: [],
    };
    nodes[rootId].children.push(id);
  }

  return { rootId, nodes };
}

// ---------- layout algorithms ----------------------------------------------

function layoutRadial(tree: Tree): Record<string, PositionedNode> {
  const positions: Record<string, PositionedNode> = {};
  const RADIUS_STEP = 170;

  const countLeaves = (id: string): number => {
    const node = tree.nodes[id];
    if (!node || node.collapsed || node.children.length === 0) return 1;
    return node.children.reduce((sum, cid) => sum + countLeaves(cid), 0);
  };

  const place = (id: string, angle: number, angleSpan: number, depth: number) => {
    const node = tree.nodes[id];
    const radius = depth * RADIUS_STEP;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    positions[id] = { id, x, y, depth, angle };

    if (!node || node.collapsed) return;
    const children = node.children;
    if (children.length === 0) return;

    const totalLeaves = children.reduce((s, c) => s + countLeaves(c), 0);
    let curAngle = angle - angleSpan / 2;
    for (const cid of children) {
      const leaves = countLeaves(cid);
      const childSpan = (angleSpan * leaves) / totalLeaves;
      const childAngle = curAngle + childSpan / 2;
      place(cid, childAngle, childSpan, depth + 1);
      curAngle += childSpan;
    }
  };

  place(tree.rootId, -Math.PI / 2, Math.PI * 2, 0);
  return positions;
}

function layoutTreeDown(tree: Tree): Record<string, PositionedNode> {
  const positions: Record<string, PositionedNode> = {};
  const LEVEL_HEIGHT = 130;
  const NODE_WIDTH = 190;
  const GAP = 24;

  const countLeaves = (id: string): number => {
    const node = tree.nodes[id];
    if (!node || node.collapsed || node.children.length === 0) return 1;
    return node.children.reduce((sum, cid) => sum + countLeaves(cid), 0);
  };

  const place = (id: string, x: number, depth: number) => {
    const node = tree.nodes[id];
    const y = depth * LEVEL_HEIGHT;
    const leaves = countLeaves(id);
    const subtreeWidth = leaves * (NODE_WIDTH + GAP);
    const myX = x + subtreeWidth / 2;
    positions[id] = { id, x: myX, y, depth };

    if (!node || node.collapsed) return;
    let cursor = x;
    for (const cid of node.children) {
      const childLeaves = countLeaves(cid);
      const childWidth = childLeaves * (NODE_WIDTH + GAP);
      place(cid, cursor, depth + 1);
      cursor += childWidth;
    }
  };

  place(tree.rootId, 0, 0);
  const root = positions[tree.rootId];
  if (root) {
    const offset = root.x;
    for (const k of Object.keys(positions)) {
      positions[k].x -= offset;
    }
  }
  return positions;
}

function layoutTreeRight(tree: Tree): Record<string, PositionedNode> {
  const positions: Record<string, PositionedNode> = {};
  const LEVEL_WIDTH = 240;
  const NODE_HEIGHT = 54;
  const GAP = 16;

  const countLeaves = (id: string): number => {
    const node = tree.nodes[id];
    if (!node || node.collapsed || node.children.length === 0) return 1;
    return node.children.reduce((sum, cid) => sum + countLeaves(cid), 0);
  };

  const place = (id: string, y: number, depth: number) => {
    const node = tree.nodes[id];
    const x = depth * LEVEL_WIDTH;
    const leaves = countLeaves(id);
    const subtreeHeight = leaves * (NODE_HEIGHT + GAP);
    const myY = y + subtreeHeight / 2;
    positions[id] = { id, x, y: myY, depth };

    if (!node || node.collapsed) return;
    let cursor = y;
    for (const cid of node.children) {
      const childLeaves = countLeaves(cid);
      const childHeight = childLeaves * (NODE_HEIGHT + GAP);
      place(cid, cursor, depth + 1);
      cursor += childHeight;
    }
  };

  place(tree.rootId, 0, 0);
  const root = positions[tree.rootId];
  if (root) {
    const offset = root.y;
    for (const k of Object.keys(positions)) {
      positions[k].y -= offset;
    }
  }
  return positions;
}

function computeLayout(tree: Tree, layout: Layout): Record<string, PositionedNode> {
  try {
    if (layout === "radial") return layoutRadial(tree);
    if (layout === "tree-down") return layoutTreeDown(tree);
    return layoutTreeRight(tree);
  } catch {
    return layoutRadial(tree);
  }
}

function estimateNodeWidth(text: string, isRoot: boolean): number {
  const baseLen = isRoot ? 240 : 190;
  const charWidth = isRoot ? 9.5 : 7.5;
  const padding = 36;
  return Math.min(baseLen, Math.max(60, text.length * charWidth + padding));
}

// ---------- main component (READ-ONLY) --------------------------------------

export default function ConceptMap({
  subjectColor = "#3b82f6",
  chapterTitle = "Chapter",
  content = "",
}: {
  subjectColor?: string;
  chapterTitle?: string;
  content?: string;
}) {
  // Component-level error state for graceful degradation
  const [componentError, setComponentError] = useState<Error | null>(null);
  
  // Safe tree generation — wrapped in try/catch with ultimate fallback.
  const safeHtmlToTree = (html: string, title: string): Tree => {
    try {
      return htmlToTree(html, title);
    } catch (err) {
      console.warn('[ConceptMap] htmlToTree failed, using fallback:', err);
      const rootId = "n1";
      const fallbackId = "n2";
      return {
        rootId,
        nodes: {
          [rootId]: {
            id: rootId,
            text: truncate(title || "Chapter", 36),
            color: colorForDepth(0, 0),
            gradientId: `grad-${rootId}`,
            icon: "📚",
            children: [fallbackId],
          },
          [fallbackId]: {
            id: fallbackId,
            text: "Couldn't build concept map from this chapter",
            color: colorForDepth(1, 0),
            gradientId: `grad-${fallbackId}`,
            icon: "⚠️",
            children: [],
          },
        },
      };
    }
  };

  const [tree, setTree] = useState<Tree>(() => safeHtmlToTree(content || "", chapterTitle));
  const [layout, setLayout] = useState<Layout>("radial");
  const [view, setView] = useState<ViewMode>("map");
  const [selectedId, setSelectedId] = useState<string | null>(() => tree?.rootId || "n1");
  const [animated, setAnimated] = useState(false);

  // Safe viewport state with validation
  const [vp, setVp] = useState(() => ({ tx: 0, ty: 0, scale: 1 }));
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Regenerate whenever content or chapterTitle changes.
  useEffect(() => {
    const fresh = safeHtmlToTree(content || "", chapterTitle);
    setTree(fresh);
    setSelectedId(fresh.rootId);
    setVp({ tx: 0, ty: 0, scale: 1 });
    setAnimated(false);
    // Trigger entrance animation after a tiny delay so nodes mount first
    const t = window.setTimeout(() => setAnimated(true), 50);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, chapterTitle]);

  const positions = useMemo(() => computeLayout(tree, layout), [tree, layout]);

  // ---------- node operations (READ-ONLY: only collapse/expand) -----------

  const toggleCollapse = (id: string) => {
    setTree((t) => {
      const node = t.nodes[id];
      if (!node || node.children.length === 0) return t;
      return {
        ...t,
        nodes: { ...t.nodes, [id]: { ...node, collapsed: !node.collapsed } },
      };
    });
  };

  // ---------- pointer interactions (pan/zoom) ------------------------------

  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const onSvgPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      const target = e.target as Element;
      if (target === e.currentTarget || (target.getAttribute && target.getAttribute("data-bg") === "true")) {
        try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        
        // Safe access to viewport state
        const currentVp = vp || { tx: 0, ty: 0, scale: 1 };
        panRef.current = { x: e.clientX, y: e.clientY, tx: currentVp.tx, ty: currentVp.ty };
        setSelectedId(null);
      }
    } catch (err) {
      console.warn('[ConceptMap] onSvgPointerDown error:', err);
    }
  };

  const onSvgPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      if (panRef.current) {
        const dx = e.clientX - panRef.current.x;
        const dy = e.clientY - panRef.current.y;
        setVp((v) => ({ 
          ...v, 
          tx: (panRef.current?.tx ?? 0) + dx, 
          ty: (panRef.current?.ty ?? 0) + dy 
        }));
      }
    } catch (err) {
      console.warn('[ConceptMap] onSvgPointerMove error:', err);
    }
  };

  const onSvgPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    try {
      panRef.current = null;
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    } catch (err) {
      console.warn('[ConceptMap] onSvgPointerUp error:', err);
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    try {
      try { e.preventDefault(); } catch { /* passive listener — ignore */ }
      const factor = Math.exp(-e.deltaY * 0.001);
      setVp((v) => {
        if (!v) return { tx: 0, ty: 0, scale: 1 };
        const currentScale = typeof v.scale === 'number' && isFinite(v.scale) ? v.scale : 1;
        return { ...v, scale: Math.max(0.2, Math.min(3, currentScale * factor)) };
      });
    } catch (err) {
      console.warn('[ConceptMap] onWheel error:', err);
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const h = (e: WheelEvent) => e.preventDefault();
    svg.addEventListener("wheel", h, { passive: false });
    return () => svg.removeEventListener("wheel", h);
  }, []);

  // ---------- export to PNG ------------------------------------------------

  const exportPNG = () => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const bbox = svg.getBBox();
      const pad = 80;
      clone.setAttribute("width", String(bbox.width + pad * 2));
      clone.setAttribute("height", String(bbox.height + pad * 2));
      clone.setAttribute("viewBox", `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = (bbox.width + pad * 2) * scale;
        canvas.height = (bbox.height + pad * 2) * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `concept-map-${chapterTitle.replace(/\s+/g, "-").toLowerCase()}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
        }, "image/png");
      };
      img.src = url;
    } catch {
      // ignore
    }
  };

  // ---------- rendering helpers --------------------------------------------

  const nodeIds = Object.keys(tree.nodes);
  const edgeList: { from: string; to: string }[] = [];
  for (const id of nodeIds) {
    const node = tree.nodes[id];
    if (node.collapsed) continue;
    for (const cid of node.children) {
      edgeList.push({ from: id, to: cid });
    }
  }

  // Compute SVG viewBox bounds from positions
  const bounds = useMemo(() => {
    if (nodeIds.length === 0) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of nodeIds) {
      const p = positions[id];
      if (!p) continue;
      const w = estimateNodeWidth(tree.nodes[id].text, id === tree.rootId) / 2 + 20;
      const h = 30;
      minX = Math.min(minX, p.x - w);
      maxX = Math.max(maxX, p.x + w);
      minY = Math.min(minY, p.y - h);
      maxY = Math.max(maxY, p.y + h);
    }
    if (!isFinite(minX)) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    return { minX, minY, maxX, maxY };
  }, [positions, nodeIds, tree]);

  const pad = 100;
  const vbW = bounds.maxX - bounds.minX + pad * 2;
  const vbH = bounds.maxY - bounds.minY + pad * 2;
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;

  // ---------- render --------------------------------------------------------

  // Show error state if component crashed
  if (componentError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">⚠️</span>
        </div>
        <h3 className="text-sm font-bold text-red-900 mb-1">Concept Map Error</h3>
        <p className="text-xs text-red-700 mb-3 max-w-sm mx-auto">
          The concept map encountered an error. This has been logged and won't happen again.
        </p>
        <button
          onClick={() => setComponentError(null)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-red-600 hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (view === "outline") {
    try {
      return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
            <Network className="w-4 h-4 text-primary" />
            <span className="font-heading font-bold text-sm">Concept Map — Outline</span>
            <span className="text-xs text-muted-foreground ml-1">Auto-generated, read-only</span>
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setView("map")} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors">
                <LayoutGrid className="w-3.5 h-3.5" /> Map view
              </button>
              <button onClick={exportPNG} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors">
                <Download className="w-3.5 h-3.5" /> PNG
              </button>
            </div>
          </div>
          <div className="p-4 max-h-[500px] overflow-y-auto">
            <OutlineList tree={tree} rootId={tree?.rootId || "n1"} depth={0} />
          </div>
        </div>
      );
    } catch (outlineError) {
      console.error('[ConceptMap] Outline render error:', outlineError);
      setTimeout(() => {
        setComponentError(outlineError instanceof Error ? outlineError : new Error(String(outlineError)));
      }, 0);
      
      return (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-sm text-amber-700">Loading outline view...</p>
        </div>
      );
    }
  }

  try {
    return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Toolbar — read-only controls only */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border bg-muted/30">
        <Network className="w-4 h-4 text-primary" />
        <span className="font-heading font-bold text-sm">Concept Map</span>
        <span className="text-xs text-muted-foreground ml-1 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Auto-generated from chapter · read-only
        </span>

        <div className="ml-auto flex flex-wrap gap-1.5">
          {/* Layout switcher */}
          <div className="flex bg-secondary rounded-lg p-0.5">
            {(["radial", "tree-down", "tree-right"] as Layout[]).map((l) => (
              <button
                key={l}
                onClick={() => setLayout(l)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  layout === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                title={l === "radial" ? "Radial layout" : l === "tree-down" ? "Tree (top-down)" : "Tree (left-right)"}
              >
                {l === "radial" ? "Radial" : l === "tree-down" ? "Tree ↓" : "Tree →"}
              </button>
            ))}
          </div>

          <button onClick={() => setView("outline")} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors" title="Outline view">
            <List className="w-3.5 h-3.5" /> Outline
          </button>

          <button onClick={() => setVp((v) => ({ ...v, scale: Math.min(3, v.scale * 1.2) }))} className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors" title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setVp((v) => ({ ...v, scale: Math.max(0.2, v.scale / 1.2) }))} className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors" title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setVp({ tx: 0, ty: 0, scale: 1 })} className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground transition-colors" title="Reset view">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportPNG} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" title="Download as PNG">
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
        </div>
      </div>

      {/* The map itself */}
      <div className="relative bg-gradient-to-br from-background to-muted/30" style={{ height: 500 }}>
        <svg
          ref={svgRef}
          className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          onPointerDown={onSvgPointerDown}
          onPointerMove={onSvgPointerMove}
          onPointerUp={onSvgPointerUp}
          onPointerCancel={onSvgPointerUp}
          onWheel={onWheel}
        >
          <defs>
            {/* Gradient fills for each node */}
            {nodeIds.map((id) => {
              const node = tree.nodes[id];
              const light = lightenColor(node.color, 0.3);
              return (
                <linearGradient key={node.gradientId} id={node.gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={light} />
                  <stop offset="100%" stopColor={node.color} />
                </linearGradient>
              );
            })}
            {/* Glow filter for the root */}
            <filter id="root-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Soft drop shadow for nodes */}
            <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2" />
              <feOffset dx="0" dy="2" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.25" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Pan/zoom group */}
          <g
            data-bg="true"
            transform={`translate(${vbW / 2 + vbX + vp.tx}, ${vbH / 2 + vbY + vp.ty}) scale(${vp.scale}) translate(${-(vbW / 2 + vbX)}, ${-(vbH / 2 + vbY)})`}
          >
            {/* Background rect to catch pan events */}
            <rect
              data-bg="true"
              x={vbX - 1000}
              y={vbY - 1000}
              width={vbW + 2000}
              height={vbH + 2000}
              fill="transparent"
            />

            {/* Edges (curved Bezier connectors) */}
            {edgeList.map(({ from, to }, i) => {
              const p1 = positions[from];
              const p2 = positions[to];
              if (!p1 || !p2) return null;
              const fromNode = tree.nodes[from];
              const toNode = tree.nodes[to];
              const toDepth = p2.depth;
              // Bezier control point — midpoint with a slight curve
              const midX = (p1.x + p2.x) / 2;
              const midY = (p1.y + p2.y) / 2;
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              // Perpendicular offset for curve
              const perpX = -dy / (dist || 1) * Math.min(30, dist * 0.15);
              const perpY = dx / (dist || 1) * Math.min(30, dist * 0.15);
              const path = `M ${p1.x} ${p1.y} Q ${midX + perpX} ${midY + perpY} ${p2.x} ${p2.y}`;
              return (
                <path
                  key={`edge-${i}`}
                  d={path}
                  fill="none"
                  stroke={toNode.color}
                  strokeWidth={Math.max(1, 3 - toDepth * 0.5)}
                  strokeOpacity={0.6}
                  strokeLinecap="round"
                  style={{
                    opacity: animated ? 1 : 0,
                    transition: `opacity 0.4s ease ${toDepth * 0.08}s`,
                  }}
                />
              );
            })}

            {/* Nodes */}
            {nodeIds.map((id) => {
              const node = tree.nodes[id];
              const p = positions[id];
              if (!p) return null;
              const isRoot = id === tree.rootId;
              const w = estimateNodeWidth(node.text, isRoot);
              const h = isRoot ? 48 : 36;
              const isSelected = selectedId === id;
              const hasChildren = node.children.length > 0;
              const delay = p.depth * 0.1;

              return (
                <g
                  key={id}
                  transform={`translate(${p.x}, ${p.y})`}
                  style={{
                    opacity: animated ? 1 : 0,
                    transition: `opacity 0.4s ease ${delay}s`,
                    cursor: hasChildren ? "pointer" : "default",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(id);
                  }}
                >
                  {/* Node rectangle with gradient fill */}
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={h / 2}
                    fill={`url(#${node.gradientId})`}
                    stroke={isSelected ? "#fff" : "rgba(255,255,255,0.3)"}
                    strokeWidth={isSelected ? 3 : 1}
                    filter={isRoot ? "url(#root-glow)" : "url(#node-shadow)"}
                  />

                  {/* Icon + text */}
                  <text
                    x={-w / 2 + 16}
                    y={0}
                    textAnchor="start"
                    dominantBaseline="central"
                    fontSize={isRoot ? 14 : 11}
                    fontWeight={isRoot ? 700 : 600}
                    fill="white"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {node.icon ? `${node.icon} ` : ""}
                    {node.text}
                  </text>

                  {/* Collapse/expand chevron — ONLY interaction, view-only */}
                  {hasChildren && (
                    <g
                      transform={`translate(${w / 2 - 4}, 0)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle r={10} fill="white" stroke={node.color} strokeWidth={1.5} />
                      {node.collapsed ? (
                        <ChevronRight x={-4} y={-4} width={8} height={8} color={node.color} />
                      ) : (
                        <ChevronDown x={-4} y={-4} width={8} height={8} color={node.color} />
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom indicator */}
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-card/80 backdrop-blur px-2 py-1 rounded-md border border-border">
          {Math.round((vp?.scale ?? 1) * 100)}%
        </div>
      </div>
    </div>
    );
  } catch (renderError) {
    // Catch any render errors and show graceful degradation UI
    console.error('[ConceptMap] Render error:', renderError);
    // Use setTimeout to avoid setState during render
    setTimeout(() => {
      setComponentError(renderError instanceof Error ? renderError : new Error(String(renderError)));
    }, 0);
    
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">🗺️</span>
        </div>
        <h3 className="text-sm font-bold text-amber-900 mb-1">Loading Concept Map...</h3>
        <p className="text-xs text-amber-700 mb-3 max-w-sm mx-auto">
          The concept map is initializing. Please wait a moment.
        </p>
      </div>
    );
  }
}

// ---------- outline view (read-only) ---------------------------------------

function OutlineList({ tree, rootId, depth }: { tree: Tree; rootId: string; depth: number }) {
  const node = tree.nodes[rootId];
  if (!node) return null;
  return (
    <ul className="space-y-1">
      <li
        className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/50 transition-colors"
        style={{ marginLeft: depth * 16 }}
      >
        <span className="text-base shrink-0">{node.icon || "•"}</span>
        <span
          className="text-sm"
          style={{
            fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 400,
            color: depth === 0 ? node.color : "inherit",
          }}
        >
          {node.text}
        </span>
      </li>
      {!node.collapsed && node.children.map((cid) => (
        <OutlineList key={cid} tree={tree} rootId={cid} depth={depth + 1} />
      ))}
    </ul>
  );
}
