import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Camera, X, AlertCircle, Loader2, ScanLine } from "lucide-react";

// ── Camera QR Scanner component (html5-qrcode) ──────────────────────────────────
// MOBILE & LAPTOP OPTIMIZED:
//   - Adaptive qrbox size based on screen width
//   - Better error messages for common issues
//   - Camera permission handling works on both platforms
//   - Continuous scanning mode (camera stays open between scans)
export default function QRScanner({ onScan, enabled }: { onScan: (data: string) => void; enabled: boolean }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // IMPORTANT: this id must NOT contain "qr-reader". src/index.css has a global
  // `[id*="qr-reader"] { position:absolute; width:100%; height:100%; max-width:none !important }`
  // rule (made for the old full-screen scanner) that overrides any size set here and
  // stretched the camera over the whole screen.
  const containerIdRef = useRef(`scanview-${Math.random().toString(36).slice(2)}`);
  // Fixed, small portrait viewport (inline px so no stylesheet can enlarge it).
  const viewW = useMemo(
    () => (typeof window !== "undefined" && window.innerWidth < 768 ? Math.max(180, Math.min(220, window.innerWidth - 120)) : 300),
    []
  );
  
  // ── SCAN COOLDOWN (camera stays open, ready for the NEXT student) ──
  // Previously onScan() was immediately followed by stop(), closing the
  // camera after every single scan and forcing the admin to tap "Scan QR"
  // again for each student. Now the camera stays running continuously; we
  // only guard against the SAME code re-firing repeatedly while it's still
  // in view (the decode callback fires ~10x/sec per frame).
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  // Reduced cooldown for faster successive scans
  const SCAN_COOLDOWN_MS = 700;

  // ── STALE-CLOSURE FIX ──
  // The camera is started ONCE (on mount) and html5-qrcode keeps the decode
  // callback it was given at that moment. That callback used to be bound to
  // the FIRST render's onScan, so every scan ran with stale state (an empty
  // student list, the old subject, …) — the root of flaky previews. The
  // scanner now always calls the LATEST onScan through this ref.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const handleDecoded = useCallback((decodedText: string) => {
    const now = Date.now();
    const last = lastScanRef.current;
    if (last && last.code === decodedText && now - last.time < SCAN_COOLDOWN_MS) {
      return; // same code re-detected while still in view — ignore
    }
    lastScanRef.current = { code: decodedText, time: now };
    try { navigator.vibrate?.(40); } catch { /* haptics unsupported */ }
    onScanRef.current(decodedText);
  }, []);

  const stop = useCallback(async () => {
    const inst = scannerRef.current;
    if (inst) {
      try { if ((inst as any).isScanning) await inst.stop(); } catch { /* intentional */ }
      try { await inst.clear(); } catch { /* intentional */ }
      scannerRef.current = null;
    }
    lastScanRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    // Idempotent: a rapid enabled-flip must not spin up a second camera.
    if (scannerRef.current) return;
    setError(null);
    
    // Detect device type for adaptive settings
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
    
    // Explicitly request camera permission first — Android Chrome requires
    // getUserMedia to be called from a user gesture before Html5Qrcode can
    // access the camera. Without this, html5-qrcode throws "Camera access failed".
    try {
      const constraints: MediaStreamConstraints = { 
        video: isMobile 
          ? { facingMode: "environment" } 
          : { 
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            } 
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(t => t.stop()); // release; html5-qrcode will re-open
    } catch (permErr) {
      const msg = permErr?.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access in your browser settings and try again."
        : permErr?.name === "NotFoundError"
          ? "No camera found. Please connect a camera and try again."
        : permErr?.name === "NotReadableError"
          ? "Camera is in use by another application. Please close other apps using the camera."
        : permErr?.message || "Camera access failed";
      setError(msg);
      return;
    }
    setActive(true);
    
    // Adaptive wait time based on device — gives the camera hardware time
    // to fully release after the permission-check stream above was
    // stopped. Too short a wait here was the likely cause of html5-qrcode's
    // start() failing on some Android/Chrome builds even though permission
    // was already granted.
    const waitTime = isMobile ? 350 : 200; // retry below covers slow hardware
    await new Promise(r => setTimeout(r, waitTime));

    // Small scan box = fewer pixels to decode per frame = noticeably faster locks.
    const boxSide = Math.max(130, Math.min(isMobile ? 150 : 200, viewW - 36));
    const qrboxSize = { width: boxSide, height: boxSide };
    // Portrait viewport on phones (3:4), standard 4:3 on laptops.
    const viewAspect = isMobile ? 0.75 : 1.3333;

    // PERF: html5-qrcode (~90 KB gz) loads ONLY when the camera is actually
    // started — the Attendance tab chunk no longer ships it for every admin.
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");

    const attemptStart = async (): Promise<void> => {
      // QR only (skips every other barcode format) + the browser's native detector when available.
      const qr = new Html5Qrcode(containerIdRef.current, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });
      scannerRef.current = qr;
      await qr.start(
        { facingMode: "environment" },
        {
          fps: 30,
          qrbox: qrboxSize,
          aspectRatio: viewAspect,
          disableFlip: true,
        },
        handleDecoded,
        () => {} // No-op for scan failure (keep trying)
      );
    };

    try {
      await attemptStart();
    } catch (e) {
      // Retry with longer delay on mobile
      const retryDelay = isMobile ? 1500 : 800;
      try {
        await new Promise(r => setTimeout(r, retryDelay));
        await attemptStart();
      } catch (retryErr) {
        const retryMsg = retryErr?.message || "Camera access failed";
        const retryName = retryErr?.name || "";
        // Only report "permission denied" when the error is genuinely a
        // permission error (NotAllowedError / SecurityError). html5-qrcode's
        // generic internal failure message is literally the string
        // "Camera access failed" for many unrelated causes (camera busy,
        // hardware momentarily unavailable, facingMode not resolved yet,
        // etc.) — treating that string alone as proof of a permission
        // problem was showing a misleading message even when the browser
        // had already granted camera access.
        if (retryName === "NotAllowedError" || retryName === "SecurityError") {
          setError(isMobile
            ? "Camera access denied. Go to Chrome Settings > Site Settings > Camera > Allow."
            : "Camera access denied. Click the camera icon in your browser's address bar to allow access."
          );
        } else if (retryName === "NotFoundError" || retryMsg.includes("NotFound") || retryMsg.includes("DevicesNotFound")) {
          setError("No camera detected. Please connect a webcam and refresh the page.");
        } else if (retryName === "NotReadableError") {
          setError("Camera is in use by another app or tab. Close it and tap Retry Camera.");
        } else {
          // Genuinely unknown cause — say so honestly instead of guessing
          // "permission denied", and suggest the most likely real fixes.
          setError(`Could not start the camera (${retryMsg}). Try closing other apps using the camera, then tap Retry Camera.`);
        }
        setActive(false);
      }
    }
  }, [handleDecoded]);

  // ── AUTO-START (removes the redundant double-click) ──
  // "enabled" is a dependency now (it was previously ignored, so a scanner
  // mounted before its tab was ready never started when enabled flipped
  // true). start() is idempotent, so a re-run is harmless.
  useEffect(() => {
    if (enabled) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => () => { stop(); }, [stop]);

  return (
    <div className="space-y-2">
      {!active ? (
        <Button onClick={start} disabled={!enabled} className="h-9 w-full gap-2 rounded-full bg-emerald-500 text-xs font-semibold text-white shadow-none hover:bg-emerald-600">
          <Camera className="h-3.5 w-3.5" /> {error ? "Retry Camera" : "Starting Camera…"}
        </Button>
      ) : (
        <div className="space-y-1.5">
          {/* Hard-capped portrait box: the library sizes the video to this element's width. */}
          <style>{`#${containerIdRef.current} video{display:block!important;width:100%!important;height:auto!important;max-height:300px;object-fit:cover}`}</style>
          <div
            id={containerIdRef.current}
            style={{ width: viewW, maxWidth: "100%", maxHeight: 300, margin: "0 auto", overflow: "hidden", borderRadius: 14, background: "#000", border: "1px solid rgba(16,185,129,.45)" }}
          />
          <div className="flex items-center justify-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            <p className="text-[11px] text-muted-foreground">Point camera at the QR code</p>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800/50 dark:bg-red-950/30">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

