/**
 * MoleculeViewer.tsx - ROBUST VERSION
 * 3D molecule viewer using 3Dmol.js (loaded from CDN to avoid bundle bloat).
 * Search by name (via PubChem) or load directly from a SMILES / PDB / URL.
 *
 * v2 — Fixed for slow internet & removeChild errors:
 * ✅ Proper React-compatible DOM management (no more removeChild crashes)
 * ✅ Timeout handling for slow CDN/API loads
 * ✅ Graceful fallback when offline or slow connection
 * ✅ Retry logic with exponential backoff
 * ✅ Safe cleanup that doesn't conflict with React
 *
 * Usage: <MoleculeViewer subjectColor="#10b981" />
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Atom, Search, Loader2, ExternalLink, WifiOff, AlertCircle, RotateCcw } from "lucide-react";

declare global {
  interface Window { $3Dmol: any; }
}

const CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.0.5/3Dmol.min.js";
const CDN_TIMEOUT = 15000; // 15s timeout for CDN
const API_TIMEOUT = 20000; // 20s timeout for PubChem API
const MAX_RETRIES = 3;

// Singleton load promise with timeout
let loadPromise: Promise<any> | null = null;
let loadResolved = false;

function load3Dmol(): Promise<any> {
  // Already loaded
  if (window.$3Dmol) {
    loadResolved = true;
    return Promise.resolve(window.$3Dmol);
  }
  
  // Return existing promise if loading
  if (loadPromise) return loadPromise;
  
  loadPromise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!loadResolved) {
        reject(new Error("CDN load timed out. Check your internet connection."));
      }
    }, CDN_TIMEOUT);
    
    // Check if script already exists in head
    const existingScript = document.querySelector(`script[src="${CDN_URL}"]`);
    if (existingScript) {
      // Script exists but not loaded yet, wait for it
      const checkLoaded = setInterval(() => {
        if (window.$3Dmol) {
          clearInterval(checkLoaded);
          clearTimeout(timeoutId);
          loadResolved = true;
          resolve(window.$3Dmol);
        }
      }, 200);
      return;
    }
    
    const script = document.createElement("script");
    script.src = CDN_URL;
    script.async = true;
    script.onload = () => {
      clearTimeout(timeoutId);
      loadResolved = true;
      resolve(window.$3Dmol);
    };
    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("Failed to load 3Dmol.js from CDN."));
    };
    
    document.head.appendChild(script);
  });
  
  return loadPromise;
}

const POPULAR_MOLECULES = [
  { name: "Water", query: "O" },
  { name: "Methane", query: "C" },
  { name: "Ethanol", query: "CCO" },
  { name: "Benzene", query: "c1ccccc1" },
  { name: "Glucose", query: "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O" },
  { name: "Aspirin", query: "CC(=O)OC1=CC=CC=C1C(=O)O" },
  { name: "Caffeine", query: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C" },
  { name: "NaCl", query: "[Na+].[Cl-]" },
];

// Timeout wrapper for fetch
function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out (${timeout/1000}s). Try again or check connection.`));
    }, timeout);
    
    fetch(url, { signal: controller.signal })
      .then(response => {
        clearTimeout(timer);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export default function MoleculeViewer({ subjectColor = "#10b981" }: { subjectColor?: string }) {
  // Use a ref for the outer container (React-managed)
  const containerRef = useRef<HTMLDivElement>(null);
  // Use a separate ref for the inner viewer div (3Dmol-managed)
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);
  
  const [query, setQuery] = useState("c1ccccc1");
  const [inputValue, setInputValue] = useState("benzene");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<"stick" | "sphere" | "cartoon" | "line">("stick");
  const [cdnLoading, setCdnLoading] = useState(false);
  const [cdnError, setCdnError] = useState<string | null>(null);

  // Convert a name to SMILES via PubChem with enhanced error handling
  const nameToSmiles = useCallback(async (name: string): Promise<string | null> => {
    try {
      console.log(`[MoleculeViewer] Looking up molecule: ${name}`);
      
      // Try direct SMILES lookup first
      const res = await fetchWithTimeout(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/CanonicalSMILES,IsomericSMILES/JSON`,
        API_TIMEOUT
      );
      
      if (!res.ok) {
        console.warn(`[MoleculeViewer] PubChem API returned status: ${res.status}`);
        
        // Fallback: try CID-based lookup
        try {
          const cidRes = await fetchWithTimeout(
            `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/cids/JSON`,
            API_TIMEOUT
          );
          if (cidRes.ok) {
            const cidJson = await cidRes.json();
            const cid = cidJson?.IdentifierList?.CID?.[0];
            if (cid) {
              // Now get SMILES using CID
              const smilesRes = await fetchWithTimeout(
                `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/CanonicalSMILES/JSON`,
                API_TIMEOUT
              );
              if (smilesRes.ok) {
                const smilesJson = await smilesRes.json();
                const smiles = smilesJson?.PropertyTable?.Properties?.[0]?.CanonicalSMILES;
                if (smiles) {
                  console.log(`[MoleculeViewer] Found SMILES via CID: ${smiles}`);
                  return smiles;
                }
              }
            }
          }
        } catch (fallbackErr) {
          console.warn(`[MoleculeViewer] CID fallback failed:`, fallbackErr);
        }
        
        return null;
      }
      
      const json = await res.json();
      
      // Try IsomericSMILES first (more detailed), then CanonicalSMILES
      const smiles = json?.PropertyTable?.Properties?.[0]?.IsomericSMILES || 
                   json?.PropertyTable?.Properties?.[0]?.CanonicalSMILES;
      
      if (smiles) {
        console.log(`[MoleculeViewer] Found SMILES: ${smiles}`);
        return smiles;
      }
      
      console.warn(`[MoleculeViewer] No SMILES found in response`);
      return null;
    } catch (err) {
      console.error(`[MoleculeViewer] Error looking up molecule:`, err);
      return null;
    }
  }, []);

  // Safe cleanup function that doesn't conflict with React
  const safeCleanup = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.clear();
      } catch (e) {
        // Ignore cleanup errors - viewer may already be destroyed
        console.warn("[MoleculeViewer] Cleanup warning:", e);
      }
      viewerRef.current = null;
    }
    // Don't use innerHTML="" as it conflicts with React
    // Instead, just let React handle the DOM
  }, []);

  const renderMolecule = useCallback(async (smiles: string, attempt = 0) => {
    if (!mountedRef.current) return;
    if (!viewerContainerRef.current) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Step 1: Load 3Dmol library with timeout
      setCdnLoading(true);
      setCdnError(null);
      
      let $3Dmol;
      try {
        $3Dmol = await load3Dmol();
      } catch (cdnErr) {
        setCdnLoading(false);
        setCdnError(cdnErr.message || "Failed to load 3D molecule library.");
        throw new Error(`Library load failed: ${cdnErr.message}`);
      }
      
      setCdnLoading(false);
      
      if (!mountedRef.current) return;
      
      // Step 2: Clean up previous viewer safely
      safeCleanup();
      
      if (!mountedRef.current) return;
      
      // Step 3: Fetch 3D structure from PubChem with timeout
      const sdfUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/SDF?record_type=3d`;
      
      let resp;
      try {
        resp = await fetchWithTimeout(sdfUrl, API_TIMEOUT);
      } catch (fetchErr) {
        throw new Error(`Network error: ${fetchErr.message}. Check your internet connection.`);
      }
      
      if (!resp.ok) {
        throw new Error("Could not fetch molecule data. Try a simpler molecule like Water or Methane.");
      }
      
      const sdf = await resp.text();
      
      if (!mountedRef.current) return;
      if (!viewerContainerRef.current) return;
      
      // Step 4: Create a fresh container for 3Dmol
      // This avoids React's DOM management conflicts
      const element = viewerContainerRef.current;
      
      // Clear only our inner container, not React's DOM
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
      
      // Step 5: Create viewer
      const config = { backgroundColor: "white" };
      const viewer = $3Dmol.createViewer(element, config);
      viewerRef.current = viewer;
      
      // Step 6: Load and render model
      viewer.addModel(sdf, "sdf");
      viewer.setStyle({}, {
        stick: style === "stick" ? { radius: 0.15 } : undefined,
        sphere: style === "sphere" ? { scale: 0.3 } : undefined,
        line: style === "line" ? {} : undefined,
      } as any);
      
      if (style === "cartoon") {
        viewer.setStyle({}, { cartoon: {} } as any);
      }
      
      viewer.zoomTo();
      viewer.render();
      viewer.zoom(1.5, 200);
      
      retryCountRef.current = 0; // Reset retry count on success
      
    } catch (e) {
      console.error("[MoleculeViewer] Render error:", e);
      
      // Auto-retry with backoff for transient errors
      const errorMsg = e?.message || String(e);
      const isTransient = errorMsg.includes("timed out") || 
                          errorMsg.includes("network") || 
                          errorMsg.includes("Failed to fetch") ||
                          errorMsg.includes("load failed");
      
      if (isTransient && attempt < MAX_RETRIES && mountedRef.current) {
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        console.log(`[MoleculeViewer] Retrying in ${delay}ms... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        
        setTimeout(() => {
          if (mountedRef.current) {
            renderMolecule(smiles, attempt + 1);
          }
        }, delay);
        return; // Keep loading state
      }
      
      if (mountedRef.current) {
        setError(errorMsg);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setCdnLoading(false);
      }
    }
  }, [style, safeCleanup]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      safeCleanup();
    };
  }, [safeCleanup]);

  const load = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    
    setLoading(true);
    setError(null);
    
    // If input looks like SMILES (contains C, O, N, brackets, etc.) use it directly
    const looksLikeSmiles = /^[A-Za-z0-9[\]()\\/@+=\-#.:]+$/.test(trimmed) && /[CNOScnos[\]]/.test(trimmed);
    let smiles = trimmed;
    
    if (!looksLikeSmiles) {
      const result = await nameToSmiles(trimmed);
      if (!result) {
        setError(`Could not find molecule "${trimmed}". Try: Water, Methane, Benzene, Glucose, Caffeine`);
        setLoading(false);
        return;
      }
      smiles = result;
    }
    
    setQuery(smiles);
    await renderMolecule(smiles);
  };

  // Manual retry for CDN errors
  const retryCdnLoad = () => {
    // Reset the singleton to force reload
    loadPromise = null;
    loadResolved = false;
    setCdnError(null);
    setError(null);
    
    // Remove old script if exists
    const oldScript = document.querySelector(`script[src="${CDN_URL}"]`);
    if (oldScript) {
      oldScript.remove();
    }
    
    // Retry current molecule
    if (query) {
      renderMolecule(query);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border bg-secondary/30">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: subjectColor + "20" }}>
          <Atom className="w-4 h-4" style={{ color: subjectColor }} />
        </div>
        <span className="font-bold text-sm text-foreground">3D Molecule Viewer</span>
        <a href="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/" target="_blank" rel="noreferrer"
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          PubChem <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      <div className="p-3 space-y-3">
        {/* Search Input */}
        <div className="flex gap-2">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Molecule name (e.g. benzene) or SMILES"
            disabled={loading}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          <button
            onClick={load}
            disabled={loading}
            className="shrink-0 px-4 py-2 rounded-lg text-white text-sm font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: subjectColor }}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Load</span>
          </button>
        </div>

        {/* Popular Molecules */}
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_MOLECULES.map((m) => (
            <button
              key={m.name}
              onClick={() => { 
                setInputValue(m.name); 
                setQuery(m.query); 
                renderMolecule(m.query); 
              }}
              disabled={loading}
              className="text-[10px] px-2.5 py-1.5 rounded-lg bg-secondary hover:bg-secondary/70 text-foreground font-medium disabled:opacity-50 transition-all"
            >
              {m.name}
            </button>
          ))}
        </div>

        {/* Style Switcher */}
        <div className="flex gap-1.5">
          {(["stick", "sphere", "line", "cartoon"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStyle(s); if (query) renderMolecule(query); }}
              disabled={loading}
              className={`text-[10px] px-2 py-1 rounded-md capitalize font-medium transition-all ${
                style === s ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-secondary/70"
              } disabled:opacity-50`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Viewer Container - Nested div for 3Dmol isolation */}
        <div
          ref={containerRef}
          className="relative w-full rounded-xl bg-white overflow-hidden touch-none border border-border/50"
          style={{ aspectRatio: "1 / 1", minHeight: "300px" }}
        >
          {/* Inner container for 3Dmol - this isolates it from React's DOM */}
          <div
            ref={viewerContainerRef}
            className="absolute inset-0"
          />

          {/* Loading Overlay */}
          {(loading || cdnLoading) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-10 backdrop-blur-sm">
              <Loader2 className="w-8 h-8 animate-spin mb-2" style={{ color: subjectColor }} />
              <p className="text-xs text-muted-foreground font-medium">
                {cdnLoading ? "Loading 3D library..." : "Rendering molecule..."}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                This may take a moment on slow connections
              </p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && !cdnLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-white/95 z-10">
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
                {error.includes("timed out") || error.includes("network") || error.includes("internet") ? (
                  <WifiOff className="w-6 h-6 text-red-500" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-red-500" />
                )}
              </div>
              <p className="text-xs text-red-600 font-semibold mb-2 max-w-xs">
                Couldn't load molecule
              </p>
              <p className="text-[10px] text-red-500/80 mb-4 max-w-xs break-words">
                {error}
              </p>
              <button
                onClick={() => { setError(null); if (query) renderMolecule(query); }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-semibold hover:opacity-90 transition-all"
                style={{ backgroundColor: subjectColor }}
              >
                <RotateCcw className="w-3 h-3" /> Try Again
              </button>
            </div>
          )}

          {/* CDN Error State */}
          {cdnError && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-white/95 z-10">
              <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center mb-3">
                <WifiOff className="w-6 h-6 text-orange-500" />
              </div>
              <p className="text-xs text-orange-700 font-semibold mb-2">
                Library couldn't load
              </p>
              <p className="text-[10px] text-orange-600/80 mb-4 max-w-xs">
                {cdnError}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={retryCdnLoad}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-semibold hover:opacity-90 transition-all"
                  style={{ backgroundColor: subjectColor }}
                >
                  <RotateCcw className="w-3 h-3" /> Reload Library
                </button>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && !cdnError && !query && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
              <div>
                <Atom className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  Pick a molecule above or search by name
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Works best with: Water, Methane, Benzene, Caffeine
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-[10px] text-muted-foreground text-center">
          Drag to rotate • Scroll/pinch to zoom • Powered by 3Dmol.js + PubChem
        </p>
      </div>
    </div>
  );
}
