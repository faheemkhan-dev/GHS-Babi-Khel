import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary, type UploadProgress } from "@/lib/cloudinary";
import { useQueryClient } from "@tanstack/react-query";
const SchoolMap = lazy(() => import("@/components/SchoolMap"));
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Save, Loader2, ImageIcon, CheckCircle, AlertTriangle, RefreshCw, MapPin,
  Navigation, ExternalLink, X, Building2, BarChart3, Palette, UserRound,
  SlidersHorizontal, ChevronDown, Lightbulb,
} from "lucide-react";
import toast from "react-hot-toast";
import { useDropzone } from "react-dropzone";

/* ─── Field primitives ───────────────────────────────────────────
   One labelled field, used for every input on the page, so label /
   control / hint / counter always line up and the label is always
   programmatically tied to its control via htmlFor + id. */

const Field = ({
  id, label, hint, counter, children,
}: {
  id: string;
  label: string;
  hint?: string;
  counter?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-2">
      <Label htmlFor={id} className="text-[13px] font-semibold text-foreground">{label}</Label>
      {counter && <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">{counter}</span>}
    </div>
    {children}
    {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
  </div>
);

type InputFieldProps = React.ComponentProps<typeof Input> & {
  id: string; label: string; hint?: string; counter?: React.ReactNode;
};
const InputField = ({ id, label, hint, counter, className, ...props }: InputFieldProps) => (
  <Field id={id} label={label} hint={hint} counter={counter}>
    <Input id={id} className={cn("h-11", className)} {...props} />
  </Field>
);

type TextareaFieldProps = React.ComponentProps<typeof Textarea> & {
  id: string; label: string; hint?: string; counter?: React.ReactNode;
};
const TextareaField = ({ id, label, hint, counter, className, ...props }: TextareaFieldProps) => (
  <Field id={id} label={label} hint={hint} counter={counter}>
    <Textarea id={id} className={cn("leading-relaxed", className)} {...props} />
  </Field>
);

/* ─── Section card ────────────────────────────────────────────
   Numbered, icon-led header so the form reads as a sequence of
   clearly-bounded tasks instead of five identical grey boxes. */
const SectionCard = ({
  index, icon: Icon, title, description, aside, children, className,
}: {
  index: string;
  icon: React.ElementType;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section
    className={cn(
      "overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm",
      className,
    )}
  >
    <header className="flex items-start gap-2.5 border-b border-border/60 px-3.5 py-3 sm:px-4 sm:py-3.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-bold leading-tight tracking-tight text-foreground">
          <span className="truncate">{title}</span>
          <span className="shrink-0 rounded-full bg-gold px-1.5 py-0.5 text-[9px] font-extrabold leading-none tabular-nums text-gold-ink">
            {index}
          </span>
        </h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">{description}</p>
      </div>
      {aside}
    </header>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

/* ─── Save-error banner ─────────────────────────────────────────
   The raw Supabase message is genuinely useful for debugging, but it
   is developer output — so the headline states the problem in plain
   language and the technical detail collapses behind a disclosure. */
const SaveErrorPanel = ({ message, onDismiss }: { message: string; onDismiss: () => void }) => (
  <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/[0.07] p-4">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-foreground">We couldn't save your changes</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Nothing was lost — your edits are still on screen. This is usually a dropped connection or a
        session that expired, so try <strong className="font-semibold text-foreground">Save</strong> once
        more. If it keeps failing, sign out and back in.
      </p>
      <details className="group/error mt-2.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[11px] font-semibold text-destructive hover:underline">
          <ChevronDown className="h-3 w-3 transition-transform duration-200 group-open/error:rotate-180" aria-hidden="true" />
          Technical details
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-background/60 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {message}
        </p>
      </details>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss error"
      className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="h-4 w-4" />
    </button>
  </div>
);

const ImageUploader = ({
  label, currentUrl, folder, aspect = "aspect-[16/7]", onUploaded, onRemove,
  onUploadingChange, onUploadComplete, hint,
}: {
  label: string;
  currentUrl: string | null;
  folder: string;
  /** Frames the preview so a wide banner isn't cropped into a square. */
  aspect?: string;
  onUploaded: (url: string) => void;
  onRemove?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** Called after Cloudinary upload succeeds — parent can auto-save to Supabase */
  onUploadComplete?: (url: string) => void;
  hint?: string;
}) => {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const lastFileRef = useRef<File | null>(null);

  useEffect(() => { setPreview(currentUrl); }, [currentUrl]);

  const handleRemove = useCallback(() => {
    if (!window.confirm(`Remove ${label}? The website will use its default fallback until you upload a new one.`)) return;
    setPreview(null);
    setUploadError(null);
    lastFileRef.current = null;
    onRemove?.();
    toast.success(`${label} removed.`);
  }, [label, onRemove]);

  // Tell the parent (Save button) whenever this uploader's in-flight state changes,
  // so Save can never be clicked while an upload is still pending. This is the fix
  // for "Save shows success but the image never actually attached" — previously
  // Save had no idea an upload was in progress and just saved the OLD url.
  useEffect(() => { onUploadingChange?.(uploading); }, [uploading, onUploadingChange]);

  const doUpload = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setUploadProgress(null);
    try {
      // Hard ceiling: uploadToCloudinary can legitimately take a while (3 retries x
      // 120s each = up to ~6+ minutes), during which the UI just says "Processing..."
      // with no feedback. Cap it client-side so it can NEVER spin forever silently —
      // after 45s with no result we surface a real error instead of an endless spinner.
      const HARD_CEILING_MS = 45_000;
      const url = await Promise.race([
        uploadToCloudinary(file, folder, (p) => setUploadProgress(p)),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(
            `${label} upload is taking too long (over 45s).\n\n` +
            "This usually means Cloudinary isn't responding — most commonly because " +
            "VITE_CLOUDINARY_CLOUD_NAME or VITE_CLOUDINARY_UPLOAD_PRESET is missing/wrong " +
            "in your Vercel Environment Variables, or the upload preset isn't set to " +
            '"Unsigned". Check Vercel → Project Settings → Environment Variables, then ' +
            "redeploy. Tap Retry once fixed."
          )), HARD_CEILING_MS)
        ),
      ]);
      onUploaded(url);
      setPreview(url);
      lastFileRef.current = null;
      // Tell parent the Cloudinary upload is done so it can auto-save to Supabase
      onUploadComplete?.(url);
      toast.success(`${label} uploaded — saving to database...`);
    } catch (err) {
      setUploadError(err?.message || "Upload failed.");
      setPreview(currentUrl);
      toast.error(`${label} upload failed.`, { duration: 4000 });
    }
    setUploading(false);
    setUploadProgress(null);
  }, [folder, label, onUploaded, onUploadComplete, currentUrl]);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("File too large. Max 10MB."); return; }
    if (!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)) {
      toast.error("Invalid type. Use PNG, JPG, WEBP."); return;
    }
    setUploadError(null);
    lastFileRef.current = file;
    setPreview(URL.createObjectURL(file));
    await doUpload(file);
  }, [doUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { "image/*": [".png",".jpg",".jpeg",".webp",".gif"] },
    maxFiles: 1, disabled: uploading,
  });

  const phaseLabel =
    !uploadProgress ? "Preparing..." :
    uploadProgress.phase === "compressing" ? "Compressing..." :
    uploadProgress.phase === "uploading" ? `Uploading ${uploadProgress.percent}%...` :
    "⏳ Processing...";

  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-semibold text-foreground">{label}</Label>

      {preview && (
        <div className={cn("group relative overflow-hidden rounded-xl border border-border bg-secondary/40", aspect)}>
          <img
            src={preview}
            alt={label}
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          {!uploading && onRemove && (
            <button
              type="button"
              onClick={handleRemove}
              title={`Remove ${label}`}
              aria-label={`Remove ${label}`}
              className="absolute right-2 top-2 rounded-full bg-black/70 p-1.5 text-white shadow transition-colors hover:bg-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {uploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 px-4">
              <Loader2 className={`h-6 w-6 text-white ${uploadProgress?.phase === "processing" ? "animate-pulse" : "animate-spin"}`} />
              {uploadProgress ? (
                <div className="w-full max-w-[14rem]">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/25">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        uploadProgress.phase === "processing" ? "w-full bg-yellow-400" : "bg-white",
                      )}
                      style={{ width: `${uploadProgress.phase === "processing" ? 100 : uploadProgress.percent}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-center text-[11px] font-medium text-white">
                    {uploadProgress.phase === "compressing" && "Compressing image..."}
                    {uploadProgress.phase === "uploading" &&
                      `${uploadProgress.percent}% • ${(uploadProgress.loaded / 1024).toFixed(0)}/${(uploadProgress.total / 1024).toFixed(0)} KB`}
                    {uploadProgress.phase === "processing" && "⏳ Processing on Cloudinary..."}
                  </p>
                </div>
              ) : (
                <p className="text-xs font-medium text-white">Preparing image...</p>
              )}
            </div>
          )}
        </div>
      )}

      {uploadError && (
        <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/[0.07] p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="whitespace-pre-line break-words text-[11px] leading-relaxed text-muted-foreground">{uploadError}</p>
          </div>
          <Button
            size="sm" variant="outline" type="button"
            onClick={() => lastFileRef.current && doUpload(lastFileRef.current)}
            disabled={uploading} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60"
          >
            <RefreshCw className="h-3 w-3" /> Retry Upload
          </Button>
        </div>
      )}

      <div
        {...getRootProps()}
        role="button"
        tabIndex={0}
        aria-label={`Upload ${label}`}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors duration-200",
          uploading ? "cursor-not-allowed border-border opacity-50"
            : isDragActive ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/60 hover:bg-secondary/40",
        )}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-1.5 text-primary">
            <Loader2 className={`h-5 w-5 ${uploadProgress?.phase === "processing" ? "animate-pulse" : "animate-spin"}`} />
            <p className="text-xs font-medium">{phaseLabel}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-70" />
            <p className="text-xs font-semibold text-foreground">
              {isDragActive ? "Drop to upload" : "Click or drag to upload"}
            </p>
            <p className="text-[10px]">PNG, JPG, WEBP — auto-compressed</p>
          </div>
        )}
      </div>

      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
};

// ─── Map Location Picker ────────────────────────────────────────────────────
interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

const MapPicker = ({ lat, lng, onChange }: MapPickerProps) => {
  const [inputLat, setInputLat] = useState(lat?.toString() ?? "");
  const [inputLng, setInputLng] = useState(lng?.toString() ?? "");
  const [detecting, setDetecting] = useState(false);
  // Leaflet takes a pixel height, so the map is sized from state rather than a
  // class — a 320px canvas is fine on a desktop card but eats half a phone screen.
  const [mapHeight, setMapHeight] = useState(320);

  useEffect(() => {
    const sync = () => setMapHeight(window.innerWidth < 640 ? 240 : 320);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    setInputLat(lat?.toString() ?? "");
    setInputLng(lng?.toString() ?? "");
  }, [lat, lng]);

  const applyManual = () => {
    const parsedLat = parseFloat(inputLat);
    const parsedLng = parseFloat(inputLng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      toast.error("Enter valid latitude and longitude numbers.");
      return;
    }
    if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
      toast.error("Latitude must be -90 to 90, longitude -180 to 180.");
      return;
    }
    onChange(parsedLat, parsedLng);
    toast.success("Location updated!");
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser.");
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setInputLat(latitude.toFixed(6));
        setInputLng(longitude.toFixed(6));
        onChange(latitude, longitude);
        setDetecting(false);
        toast.success("Location detected! Click Save to keep it.");
      },
      (err) => {
        setDetecting(false);
        if (err.code === 1) {
          // PERMISSION_DENIED
          toast.error(
            "Location permission denied. Go to your browser Settings → Site Permissions → Location and allow this site.",
            { duration: 7000 }
          );
        } else if (err.code === 2) {
          // POSITION_UNAVAILABLE
          toast.error("Could not get your position. Check GPS/network and try again.", { duration: 5000 });
        } else {
          // TIMEOUT or unknown
          toast.error("Location request timed out. Try again or enter coordinates manually.", { duration: 5000 });
        }
      },
      { timeout: 12000, enableHighAccuracy: true }
    );
  };

  const hasLocation = lat !== null && lng !== null;
  const googleMapsUrl = hasLocation ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  const osmUrl = hasLocation ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}` : null;

  return (
    <div className="space-y-4">
      {/* Interactive Leaflet map — zoom, pan, street + satellite layers */}
      {hasLocation ? (
        <div className="overflow-hidden rounded-2xl border border-border/60 shadow-sm">
          <Suspense fallback={
            <div className="flex items-center justify-center bg-secondary/40 text-sm text-muted-foreground" style={{ height: mapHeight }}>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading map…
            </div>
          }>
            <SchoolMap lat={lat!} lng={lng!} label="School Location" height={mapHeight} zoom={16} />
          </Suspense>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-secondary/40 px-3.5 py-2.5 text-xs text-muted-foreground">
            <span className="rounded-md bg-background/70 px-2 py-1 font-mono text-[11px] text-foreground">
              {lat?.toFixed(6)}, {lng?.toFixed(6)}
            </span>
            <div className="flex gap-3">
              <a href={osmUrl!} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">OpenStreetMap ↗</a>
              <a href={googleMapsUrl!} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Google Maps ↗</a>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-secondary/30 text-muted-foreground">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-secondary">
            <MapPin className="h-5 w-5 opacity-60" />
          </span>
          <p className="text-sm font-semibold text-foreground">No location set yet</p>
          <p className="px-6 text-center text-xs leading-relaxed opacity-80">
            Detect your device position, or paste coordinates below, to pin the school.
          </p>
        </div>
      )}

      {/* Coordinate inputs */}
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField
          id="location-lat" label="Latitude" placeholder="e.g. 34.325461"
          value={inputLat} onChange={(e) => setInputLat(e.target.value)}
          inputMode="decimal" className="font-mono"
        />
        <InputField
          id="location-lng" label="Longitude" placeholder="e.g. 71.379518"
          value={inputLng} onChange={(e) => setInputLng(e.target.value)}
          inputMode="decimal" className="font-mono"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={applyManual} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60">
          <MapPin className="h-3.5 w-3.5" /> Apply Coordinates
        </Button>
        <Button type="button" size="sm" onClick={detectLocation} disabled={detecting} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
          {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
          {detecting ? "Detecting…" : "Use My Device Location"}
        </Button>
        {googleMapsUrl && (
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="outline" size="sm" className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-blue-300 px-3 text-xs font-semibold text-blue-700 shadow-none hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-950/30">
              <ExternalLink className="h-3.5 w-3.5" /> Verify on Google Maps
            </Button>
          </a>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        <Lightbulb className="mt-[1px] h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          <strong className="font-semibold text-foreground">To get coordinates:</strong> open{" "}
          <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">Google Maps</a>,
          find your school, long-press or right-click it — the coordinates appear at the top. Paste
          them above and press Apply.
        </span>
      </p>
    </div>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────
const AdminSchoolSettings = () => {
  const { data: settings, isLoading } = useSchoolSettings();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Tracks how many ImageUploader instances currently have an upload in flight.
  // Save is disabled while this is > 0, so it's no longer possible to click Save
  // before the new image URL has actually landed in `form` — the root cause of
  // "Save says success but the banner never actually updated."
  const [uploadsInFlight, setUploadsInFlight] = useState(0);
  const registerUploading = useCallback((isUploading: boolean) => {
    setUploadsInFlight((n) => Math.max(0, n + (isUploading ? 1 : -1)));
  }, []);

  const [form, setForm] = useState({
    school_name: "", tagline: "", description: "", about_text: "", emis_code: "",
    address: "", phone: "", email: "",
    established_year: 2018, total_students: 0, total_teachers: 0, pass_percentage: 0, board_results: "",
    logo_url: null as string | null,
    banner_url: null as string | null,
    location_lat: null as number | null,
    location_lng: null as number | null,
    principal_name: "",
    principal_message: "",
    principal_photo_url: null as string | null,
  });

  /* Snapshot of the last values we know are in the database. Kept as a string
     because the form is a flat, key-stable object — a JSON compare is both
     exact and cheaper than a deep-equal walk on every keystroke. */
  const [baseline, setBaseline] = useState("");
  const dirty = baseline !== "" && baseline !== JSON.stringify(form);
  const photo = useMemo(() => (form.description || "").length, [form.description]);
  const about = useMemo(() => (form.about_text || "").length, [form.about_text]);
  const message = useMemo(() => (form.principal_message || "").length, [form.principal_message]);

  useEffect(() => {
    if (settings) {
      const next = {
        school_name: settings.school_name || "",
        tagline: settings.tagline || "",
        description: settings.description || "",
        about_text: settings.about_text || "",
        emis_code: settings.emis_code || "",
        address: settings.address || "",
        phone: settings.phone || "",
        email: settings.email || "",
        established_year: settings.established_year || 2018,
        total_students: settings.total_students || 0,
        total_teachers: settings.total_teachers || 0,
        pass_percentage: settings.pass_percentage || 0,
        board_results: settings.board_results || "",
        logo_url: settings.logo_url || null,
        banner_url: settings.banner_url || null,
        location_lat: settings.location_lat ?? null,
        location_lng: settings.location_lng ?? null,
        principal_name: settings.principal_name || "",
        principal_message: settings.principal_message || "",
        principal_photo_url: settings.principal_photo_url || null,
      };
      setForm(next);
      setBaseline(JSON.stringify(next));
    }
  }, [settings]);

  const set = (k: string, v: string | number | null) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (uploadsInFlight > 0) {
      const msg = "An image is still uploading. Please wait for it to finish before saving.";
      setSaveError(msg);
      toast.error(msg, { duration: 5000 });
      return;
    }

    setSaving(true);
    setSaved(false);
    setSaveError(null);

    try {
      // Check session first — refresh if expired
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) {
          const msg = "Session expired. Please Sign Out and Sign In again, then retry.";
          setSaveError(msg);
          toast.error(msg, { duration: 8000 });
          setSaving(false);
          return;
        }
      }

      const { error } = await Promise.race([
        supabase.from("school_settings").upsert({ ...form, id: 1 }, { onConflict: "id" }),
        new Promise<{ error: Error }>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out after 15s. Check internet.")), 15000)
        ),
      ]) as { error: any };

      if (error) {
        // Show the FULL error — code, message, hint — so we know exactly what Supabase says
        const full = [
          `Message: ${error.message}`,
          error.code    ? `Code: ${error.code}`       : null,
          error.details ? `Details: ${error.details}` : null,
          error.hint    ? `Hint: ${error.hint}`        : null,
        ].filter(Boolean).join("\n");
        setSaveError(full);
        toast.error(`Save failed: ${error.message}`, { duration: 8000 });
      } else {
        setSaved(true);
        setSaveError(null);
        setBaseline(JSON.stringify(form));
        toast.success("Settings saved!");
        await queryClient.invalidateQueries({ queryKey: ["school-settings"] });
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      setSaveError(err?.message || "Unknown error.");
      toast.error(err?.message || "Save failed.", { duration: 8000 });
    }

    setSaving(false);
  };

  // ─── Auto-save after Cloudinary upload ──────────────────────────────
  // When a Cloudinary upload succeeds, we auto-save the entire form to
  // Supabase immediately. This fixes the #1 user complaint: "it says
  // uploaded successfully but the banner never appears on the site" —
  // because previously the user had to click Save separately after the
  // upload toast, which was confusing.
  const autoSaveAfterUpload = useCallback(async (field: string, url: string) => {
    // Build the form with the new URL already applied
    const formToSave = { ...form, [field]: url, id: 1 };

    try {
      // Ensure session is valid
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr) {
          toast.error("Session expired — please sign in again, then re-upload.", { duration: 8000 });
          return;
        }
      }

      const { error } = await supabase
        .from("school_settings")
        .upsert(formToSave, { onConflict: "id" });

      if (error) {
        const full = [
          `Message: ${error.message}`,
          error.code    ? `Code: ${error.code}`       : null,
          error.details ? `Details: ${error.details}` : null,
          error.hint    ? `Hint: ${error.hint}`        : null,
        ].filter(Boolean).join("\n");
        console.error("[AutoSave] Supabase upsert failed:", full);
        toast.error(`Save failed: ${error.message}`, { duration: 8000 });
        setSaveError(full);
      } else {
        toast.success("Saved to database!");
        setSaveError(null);
        setBaseline(JSON.stringify({ ...form, [field]: url }));
        await queryClient.invalidateQueries({ queryKey: ["school-settings"] });
      }
    } catch (err) {
      console.error("[AutoSave] Error:", err);
      toast.error(err?.message || "Auto-save failed.", { duration: 8000 });
    }
  }, [form, queryClient]);

  const handleDiscard = () => {
    if (!window.confirm("Discard your unsaved changes and go back to the last saved values?")) return;
    if (baseline) setForm(JSON.parse(baseline));
    setSaveError(null);
    toast("Unsaved changes discarded.", { icon: "↩︎" });
  };

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-16 rounded-2xl" />
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
    </div>
  );

  const saveLabel = uploadsInFlight > 0 ? "Uploading…"
    : saving ? "Saving…"
    : saved ? "Saved"
    : "Save All Changes";

  return (
    <div className="pb-20 md:pb-0">
      {/* ── Sticky command bar ──────────────────────────────────────────
          The form is long. Keeping Save reachable at all scroll depths is
          the single biggest usability win here, and the dirty badge tells
          the admin whether there is anything to save at all. Sits directly
          under the admin layout's own h-14 sticky header. */}
      <div className="sticky top-14 z-30 mx-auto mb-5 max-w-6xl">
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-3.5 shadow-sm backdrop-blur sm:p-4">
          {/* soft glow decoration */}
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />

          <div className="relative flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
              <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-heading text-[15px] font-bold leading-tight tracking-tight text-foreground sm:text-xl">
                School Settings
              </h2>
              <p className="truncate text-[11px] leading-snug text-muted-foreground sm:text-sm">
                {dirty ? "You have unsaved changes" : "All changes saved to the database"}
              </p>
            </div>

            <span
              className={cn(
                "hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors sm:inline-flex",
                dirty
                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} />
              {dirty ? "Unsaved" : "Synced"}
            </span>

            {dirty && (
              <Button type="button" variant="outline" size="sm" onClick={handleDiscard} className="hidden h-9 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none md:inline-flex">
                Discard
              </Button>
            )}

            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || uploadsInFlight > 0 || !dirty}
              className={cn("h-9 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:px-4", !dirty && !saving && "opacity-70")}
            >
              {uploadsInFlight > 0 ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="hidden sm:inline">Uploading…</span></>
                : saving ? <><Loader2 className="h-4 w-4 animate-spin" /><span className="hidden sm:inline">Saving…</span></>
                : saved ? <><CheckCircle className="h-4 w-4" /><span className="hidden sm:inline">Saved</span></>
                : <><Save className="h-4 w-4" /><span className="hidden sm:inline">Save All Changes</span><span className="sm:hidden">Save</span></>}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
        {saveError && <SaveErrorPanel message={saveError} onDismiss={() => setSaveError(null)} />}

        {/* ── 01 · Identity ── */}
        <SectionCard
          index="01"
          icon={Building2}
          title="School Identity"
          description="The name, tagline and copy that appear in the navbar, hero and page headers."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              id="school-name" label="School Name" value={form.school_name}
              onChange={(e) => set("school_name", e.target.value)} placeholder="GHS Babi Khel"
            />
            <InputField
              id="tagline" label="Tagline" value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)} placeholder="Excellence in Education"
              hint="One short line, used under the school name."
            />
            <div className="sm:col-span-2">
              <TextareaField
                id="description" label="Description" rows={3} value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="A short summary of the school used across the site."
                counter={`${photo} characters`}
              />
            </div>
            <div className="sm:col-span-2">
              <TextareaField
                id="about-text" label="About the School" rows={5} value={form.about_text}
                onChange={(e) => set("about_text", e.target.value)}
                placeholder="Write a detailed description of the school's history, values, achievements, and community..."
                hint="Shown on the About page."
                counter={`${about} characters`}
              />
            </div>
          </div>
        </SectionCard>

        {/* ── 02 · Registration & Contact ── */}
        <SectionCard
          index="02"
          icon={BarChart3}
          title="Registration & Contact"
          description="Official identifiers and the public contact details shown in the footer and on the About page."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              id="emis-code" label="EMIS Code" value={form.emis_code}
              onChange={(e) => set("emis_code", e.target.value)} placeholder="60673"
              hint="Education Management Information System code."
            />
            <InputField
              id="established-year" label="Established Year" type="number" inputMode="numeric" value={form.established_year}
              onChange={(e) => set("established_year", +e.target.value)}
            />
            <div className="sm:col-span-2">
              <InputField
                id="address" label="Address" value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Babi Khel, District Mohmand, KPK, Pakistan"
              />
            </div>
            <InputField
              id="phone" label="Phone" type="tel" inputMode="tel" value={form.phone}
              onChange={(e) => set("phone", e.target.value)} placeholder="+92 3XX XXXXXXX"
            />
            <InputField
              id="email" label="Email" type="email" inputMode="email" value={form.email}
              onChange={(e) => set("email", e.target.value)} placeholder="ghsbabikhel@gmail.com"
            />
          </div>
        </SectionCard>

        {/* ── 03 · Public Statistics ── */}
        <SectionCard
          index="03"
          icon={BarChart3}
          title="Public Statistics"
          description="The headline figures rendered on the home page and used by search engines."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <InputField
              id="total-students" label="Total Students" type="number" inputMode="numeric" value={form.total_students}
              onChange={(e) => set("total_students", +e.target.value)}
            />
            <InputField
              id="total-teachers" label="Total Teachers" type="number" inputMode="numeric" value={form.total_teachers}
              onChange={(e) => set("total_teachers", +e.target.value)}
            />
            <Field
              id="pass-percentage" label="Pass Percentage"
              hint="Shown as a ring on the admin Overview."
            >
              <div className="relative">
                <Input
                  id="pass-percentage" type="number" inputMode="numeric" value={form.pass_percentage}
                  onChange={(e) => set("pass_percentage", +e.target.value)}
                  className="h-11 pr-9"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">%</span>
              </div>
            </Field>
            <InputField
              id="board-results" label="Board Results" value={form.board_results}
              onChange={(e) => set("board_results", e.target.value)} placeholder="e.g. A+, A1, A++"
              hint="Overall result headline, e.g. A+."
            />
          </div>
        </SectionCard>

        {/* ── 04 · Location ── */}
        <SectionCard
          index="04"
          icon={MapPin}
          title="School Location"
          description="Pin the school on the map — visitors see it on the About page and in the contact section."
        >
          <MapPicker
            lat={form.location_lat}
            lng={form.location_lng}
            onChange={(lat, lng) => setForm(p => ({ ...p, location_lat: lat, location_lng: lng }))}
          />
        </SectionCard>

        {/* ── 05 · Branding ── */}
        <SectionCard
          index="05"
          icon={Palette}
          title="Branding"
          description="Logo and hero banner. Uploads are compressed and saved to the database immediately."
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <ImageUploader
              label="School Logo" currentUrl={form.logo_url} folder="branding" aspect="aspect-square"
              onUploaded={(url) => set("logo_url", url)} onRemove={() => set("logo_url", null)}
              onUploadComplete={(url) => autoSaveAfterUpload("logo_url", url)}
              onUploadingChange={registerUploading}
              hint="Square works best — used in the navbar and footer."
            />
            <ImageUploader
              label="Hero Banner" currentUrl={form.banner_url} folder="branding" aspect="aspect-[16/7]"
              onUploaded={(url) => set("banner_url", url)} onRemove={() => set("banner_url", null)}
              onUploadComplete={(url) => autoSaveAfterUpload("banner_url", url)}
              onUploadingChange={registerUploading}
              hint="A wide image (about 16:7) fills the hero without cropping."
            />
          </div>
        </SectionCard>

        {/* ── 06 · Principal ── */}
        <SectionCard
          index="06"
          icon={UserRound}
          title="Principal's Message"
          description="Shown on the About page — the name, photo and welcome message."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <InputField
                id="principal-name" label="Principal's Name" value={form.principal_name}
                onChange={(e) => set("principal_name", e.target.value)} placeholder="e.g. Mr. John Doe"
              />
              <TextareaField
                id="principal-message" label="Principal's Message" rows={6} value={form.principal_message}
                onChange={(e) => set("principal_message", e.target.value)}
                placeholder="Write the Principal's welcome message to students, parents, and visitors..."
                counter={`${message} characters`}
              />
            </div>
            <ImageUploader
              label="Principal's Photo" currentUrl={form.principal_photo_url} folder="principal" aspect="aspect-[4/5]"
              onUploaded={(url) => set("principal_photo_url", url)}
              onUploadComplete={(url) => autoSaveAfterUpload("principal_photo_url", url)}
              onUploadingChange={registerUploading}
              hint="A portrait crop (about 4:5) fills the frame cleanly."
            />
          </div>
        </SectionCard>

        {/* Desktop-only footer CTA — on mobile the sticky bar handles saving. */}
        <div className="hidden flex-wrap items-center justify-between gap-3 pt-1 lg:flex">
          <p className="text-xs text-muted-foreground">
            Images save themselves the moment they finish uploading. Use{" "}
            <strong className="font-semibold text-foreground">Save All Changes</strong> for everything else.
          </p>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button type="button" variant="outline" onClick={handleDiscard} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold text-muted-foreground shadow-none">
                Discard changes
              </Button>
            )}
            <Button
              type="button" onClick={handleSave}
              disabled={saving || uploadsInFlight > 0 || !dirty}
              className="h-9 min-w-[170px] gap-2 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"
            >
              {uploadsInFlight > 0 ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</>
                : saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                : saved ? <><CheckCircle className="h-4 w-4" />Saved</>
                : <><Save className="h-4 w-4" />{saveLabel}</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSchoolSettings;
