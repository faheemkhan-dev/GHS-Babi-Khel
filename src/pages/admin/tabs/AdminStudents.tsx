import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Plus, Pencil, Trash2, Loader2, Upload, Search, FileUp, Download, GraduationCap, ArrowRight, User, ChevronLeft, ChevronRight, Eye } from "lucide-react";
// PERF (chunk size): exceljs (937 kB) now loads only when the template
// download is clicked — it was previously bundled into this tab's chunk.
import type ExcelJSTypes from "exceljs";
import toast from "react-hot-toast";
import { StudentProfileDrawer } from "@/components/admin/StudentProfileDrawer";
import { examTypeLabel } from "@/utils/examTypeLabel";

// ─── StudentAvatar (extracted to avoid hook-in-loop) ──────────────────────
function StudentAvatar({ photoUrl, fullName, size = "sm" }: { photoUrl: string | null; fullName: string; size?: "sm" | "lg" }) {
  const [imgError, setImgError] = useState(false);
  const isLg = size === "lg";
  const dim = isLg ? "w-11 h-11" : "w-8 h-8";
  const textSize = isLg ? "text-sm" : "text-xs";
  const border = isLg ? "border-2 border-background shadow-sm" : "";
  return photoUrl && !imgError ? (
    <img src={photoUrl} alt={`${fullName}'s photo`} className={`${dim} rounded-full object-cover shrink-0 ${border}`} loading="lazy" decoding="async" onError={() => setImgError(true)} />
  ) : (
    <div className={`${dim} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white ${textSize} font-bold shrink-0 ${border}`}>
      {fullName.charAt(0)}
    </div>
  );
}

interface Student {
  id: string;
  full_name: string;
  roll_number: string;
  class: string;
  father_name: string | null;
  father_cnic: string | null;
  contact_number: string | null;
  photo_url: string | null;
  is_active: boolean;
  created_at: string;
}

const classes = ["6", "7", "8", "9", "10"];

// All exam types shown for all classes
const ALL_EXAM_TYPES = ["1st Semester", "2nd Semester", "Annual-I", "Annual-II"];

const emptyStudent = {
  full_name: "",
  roll_number: "",
  class: "6",
  father_name: "",
  father_cnic: "",
  contact_number: "",
  photo_url: null as string | null,
  is_active: true,
};

const AdminStudents = () => {
  const qc = useQueryClient();
  const [classFilter, setClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(emptyStudent);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionFrom, setPromotionFrom] = useState("6");
  const [promotionTo, setPromotionTo] = useState("7");
  const [promotionExamType, setPromotionExamType] = useState("Annual-I");
  const [promotionYear, setPromotionYear] = useState<number>(new Date().getFullYear());
  const [promoting, setPromoting] = useState(false);
  const [promotionPreview, setPromotionPreview] = useState<{
    pass: { id: string; full_name: string; roll_number: string }[];
    fail: { id: string; full_name: string; roll_number: string }[];
    noResult: { id: string; full_name: string; roll_number: string }[];
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  // Available years fetched from actual results in DB
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const pageSize = 20;

  // ── Fetch available years from results table when promotionFrom changes ──
  useEffect(() => {
    if (!promotionOpen) return;
    const fetchAvailableYears = async () => {
      setLoadingYears(true);
      setAvailableYears([]);
      setPromotionYear(new Date().getFullYear());
      setPromotionPreview(null);
      const { data, error } = await supabase
        .from("results")
        .select("year")
        .eq("class", promotionFrom)
        .order("year", { ascending: false });
      if (!error && data) {
        // Deduplicate years
        const unique = [...new Set((data as { year: number }[]).map(r => r.year))].sort((a, b) => b - a);
        setAvailableYears(unique);
        if (unique.length > 0) setPromotionYear(unique[0]);
      }
      setLoadingYears(false);
    };
    fetchAvailableYears();
  }, [promotionFrom, promotionOpen]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-students", classFilter, search, page],
    queryFn: async () => {
      let query = supabase
        .from("students")
        .select(
          "id, full_name, roll_number, class, father_name, father_cnic, contact_number, photo_url, is_active, created_at",
          { count: "exact" }
        )
        .order("roll_number")
        .range(page * pageSize, (page + 1) * pageSize - 1);
      if (classFilter !== "all") query = query.eq("class", classFilter);
      if (search) query = query.or(`full_name.ilike.%${search}%,roll_number.ilike.%${search}%`);
      const { data, error, count } = await query;
      if (error) throw error;
      return { students: (data ?? []) as Student[], total: count ?? 0 };
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["admin-students"] }); },
    onError: () => toast.error("Delete failed"),
  });

  const openAdd = () => { setEditing(null); setForm(emptyStudent); setPhotoFile(null); setModalOpen(true); };
  const openProfile = (s: Student) => { setProfileStudent(s); setProfileOpen(true); };
  const openEdit = (s: Student) => {
    setEditing(s);
    setForm({
      full_name: s.full_name,
      roll_number: s.roll_number,
      class: s.class,
      father_name: s.father_name || "",
      father_cnic: s.father_cnic || "",
      contact_number: s.contact_number || "",
      photo_url: s.photo_url,
      is_active: s.is_active,
    });
    setPhotoFile(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name || !form.roll_number) { toast.error("Name and Roll No required"); return; }
    setSaving(true);
    try {
      let dupQuery = supabase
        .from("students")
        .select("id")
        .eq("roll_number", form.roll_number)
        .eq("class", form.class);
      if (editing) dupQuery = dupQuery.neq("id", editing.id);
      const { data: existing } = await dupQuery;
      if (existing && existing.length > 0) {
        toast.error(`Roll number ${form.roll_number} already exists in Class ${form.class}. Each class has its own roll numbers.`);
        setSaving(false);
        return;
      }

      let photo_url = form.photo_url;
      if (photoFile) {
        photo_url = await uploadToCloudinary(photoFile, "students");
      }
      const payload = { ...form, photo_url };
      const { error } = editing
        ? await supabase.from("students").update(payload).eq("id", editing.id)
        : await supabase.from("students").insert(payload);
      if (error) toast.error(error.message);
      else {
        toast.success(editing ? "Updated" : "Added");
        qc.invalidateQueries({ queryKey: ["admin-students"] });
        setModalOpen(false);
      }
    } catch (err) {
      toast.error(err?.message || "Save failed. Check Cloudinary env vars.");
    }
    setSaving(false);
  };

  const downloadCSVTemplate = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook() as ExcelJSTypes.Workbook;
    const ws = wb.addWorksheet("Students Template");

    const headers = ["full_name", "roll_number", "class", "father_name", "father_cnic", "contact_number"];
    const exampleRows = [
      ["Ali Khan", "001", "9", "Muhammad Khan", "35202-1234567-1", "03001234567"],
      ["Sara Ahmed", "002", "10", "Ahmed Ali", "35202-7654321-2", "03217654321"],
    ];

    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(h.length + 4, 18) }));

    const thinBorder = {
      top: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    } as const;

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E7145" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
    });
    headerRow.height = 22;

    exampleRows.forEach((row, i) => {
      const r = ws.addRow(row);
      r.eachCell((cell) => {
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = thinBorder;
        cell.font = { name: "Calibri", size: 11 };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: i % 2 === 0 ? "FFF3FBF6" : "FFFFFFFF" },
        };
      });
    });

    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students_template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCSVImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportProgress(0);
    const text = await file.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) { toast.error("CSV is empty"); setImporting(false); return; }

    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
    const nameIdx = headers.indexOf("full_name");
    const rollIdx = headers.indexOf("roll_number");
    const classIdx = headers.indexOf("class");
    const fatherIdx = headers.indexOf("father_name");
    const cnicIdx = headers.indexOf("father_cnic");
    const contactIdx = headers.indexOf("contact_number");

    if (nameIdx === -1 || rollIdx === -1 || classIdx === -1) {
      toast.error("CSV must have full_name, roll_number, class columns");
      setImporting(false);
      return;
    }

    const dataLines = lines.slice(1).filter(l => l.trim());
    const validClasses = ["6", "7", "8", "9", "10"];
    const rows: Array<{
      full_name: string; roll_number: string; class: string;
      father_name: string | null; father_cnic: string | null;
      contact_number: string | null; is_active: boolean;
    }> = [];
    let skipped = 0;

    for (const line of dataLines) {
      const cols = line.split(",").map(s => s.trim().replace(/['"]/g, ""));
      const full_name = cols[nameIdx];
      const roll_number = cols[rollIdx];
      const cls = cols[classIdx];
      const father_name = fatherIdx !== -1 ? cols[fatherIdx] || null : null;
      const father_cnic = cnicIdx !== -1 ? cols[cnicIdx] || null : null;
      const contact_number = contactIdx !== -1 ? cols[contactIdx] || null : null;

      if (!full_name || !roll_number || !cls || !validClasses.includes(cls)) {
        skipped++;
        continue;
      }

      rows.push({ full_name, roll_number, class: cls, father_name, father_cnic, contact_number, is_active: true });
    }

    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await supabase.from("students").upsert(batch, { onConflict: "roll_number,class" });
      setImportProgress(Math.round(((i + batchSize) / rows.length) * 100));
    }

    toast.success(`✅ ${rows.length} students imported, ${skipped} skipped`);
    qc.invalidateQueries({ queryKey: ["admin-students"] });
    setImporting(false);
    e.target.value = "";
  }, [qc]);

  // Fetch all active students in the from-class, cross-reference results for pass/fail
  const loadPromotionPreview = async () => {
    if (promotionFrom === promotionTo) { toast.error("From and To classes must be different"); return; }
    setLoadingPreview(true);
    setPromotionPreview(null);

    // 1. All active students in the source class
    const { data: allStudents, error: stuErr } = await supabase
      .from("students")
      .select("id, full_name, roll_number")
      .eq("class", promotionFrom)
      .eq("is_active", true)
      .order("roll_number");
    if (stuErr) { toast.error(stuErr.message); setLoadingPreview(false); return; }
    if (!allStudents || allStudents.length === 0) {
      toast.error(`No active students in Class ${promotionFrom}`);
      setLoadingPreview(false); return;
    }

    // 2. Results for this class/exam/year
    const { data: results, error: resErr } = await supabase
      .from("results")
      .select("student_id, is_pass")
      .eq("class", promotionFrom)
      .eq("exam_type", promotionExamType)
      .eq("year", promotionYear);
    if (resErr) { toast.error(resErr.message); setLoadingPreview(false); return; }

    // Build a lookup: student_id → is_pass
    const resultMap = new Map<string, boolean>();
    (results ?? []).forEach((r: { student_id: string; is_pass: boolean }) => {
      resultMap.set(r.student_id, r.is_pass);
    });

    const pass: typeof allStudents = [];
    const fail: typeof allStudents = [];
    const noResult: typeof allStudents = [];

    for (const s of allStudents) {
      if (!resultMap.has(s.id)) noResult.push(s);
      else if (resultMap.get(s.id)) pass.push(s);
      else fail.push(s);
    }

    setPromotionPreview({ pass, fail, noResult });
    setLoadingPreview(false);
  };

  const handlePromotion = async () => {
    if (!promotionPreview || promotionPreview.pass.length === 0) {
      toast.error("No passing students to promote"); return;
    }
    setPromoting(true);
    const ids = promotionPreview.pass.map(s => s.id);

    // Move students: update class to new class (removes from old, adds to new logically)
    const { error: updateErr } = await supabase
      .from("students")
      .update({ class: promotionTo })
      .in("id", ids);
    if (updateErr) { toast.error(updateErr.message); setPromoting(false); return; }

    toast.success(`✅ ${ids.length} passing students promoted from Class ${promotionFrom} → ${promotionTo}!`);
    qc.invalidateQueries({ queryKey: ["admin-students"] });
    setPromotionOpen(false);
    setPromotionPreview(null);
    setPromoting(false);
  };

  const set = (k: string, v: string | boolean | null) => setForm((p) => ({ ...p, [k]: v }));
  const totalPages = Math.ceil((data?.total ?? 0) / pageSize);
  const students = data?.students ?? [];

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* ── Premium header + action toolbar ────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <GraduationCap className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Manage Students</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              <span className="font-semibold text-foreground">{data?.total ?? 0}</span> enrolled · search, promote &amp; import
            </p>
          </div>
        </div>
        {/* Action buttons — thin pills, grid on phones */}
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button variant="outline" size="sm" className="h-9 min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none" onClick={downloadCSVTemplate}>
            <Download className="w-3.5 h-3.5 shrink-0" /> CSV Template
          </Button>
          <label className="inline-flex min-w-0">
            <Button variant="outline" size="sm" className="h-9 w-full min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full border-border/60 px-3 text-xs font-semibold shadow-none" disabled={importing} asChild>
              <span className="inline-flex items-center gap-1.5"><FileUp className="w-3.5 h-3.5 shrink-0" /> Import CSV
                <input type="file" accept=".csv,text/csv,application/vnd.ms-excel,text/plain,application/octet-stream" className="hidden" onChange={handleCSVImport} />
              </span>
            </Button>
          </label>
          <Button variant="outline" size="sm" className="h-9 min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full border-blue-300 px-3 text-xs font-semibold text-blue-700 shadow-none hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-950/30" onClick={() => setPromotionOpen(true)}>
            <GraduationCap className="w-3.5 h-3.5 shrink-0" /> Promote
          </Button>
          <Button size="sm" className="h-9 min-w-0 justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90" onClick={openAdd}><Plus className="w-3.5 h-3.5 shrink-0" /> Add Student</Button>
        </div>
      </div>

      {importing && <Progress value={importProgress} className="h-2" />}

      {/* ── Search + Class Filter (mobile-friendly) ────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search name or roll no..." className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex h-10 items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
            {["all", ...classes].map((c) => {
              const active = classFilter === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setClassFilter(c); setPage(0); }}
                  className={`h-8 shrink-0 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-all ${
                    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
                  }`}
                >
                  {c === "all" ? "All" : `Class ${c}`}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Student List — Mobile Cards + Desktop Table ────────────────────── */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : students.length === 0 ? (
        <div className="text-center py-12">
          <User className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No students found</p>
          <p className="text-muted-foreground text-xs mt-1">Add students or adjust your search filter</p>
        </div>
      ) : (
        <>
          {/* ── Mobile Card Layout (< 640px) ── */}
          <div className="sm:hidden space-y-2.5">
            {students.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <CardContent className="p-3.5">
                  <div className="flex items-start gap-3">
                    {/* Photo / Avatar with error handling */}
                    <StudentAvatar photoUrl={s.photo_url} fullName={s.full_name} size="lg" />
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{s.full_name}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${s.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      {/* Roll + Class */}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground font-mono">#{s.roll_number}</span>
                        <span className="bg-primary/10 text-primary text-[10px] font-semibold px-2 py-0.5 rounded-full">Class {s.class}</span>
                      </div>
                      {/* Father Name */}
                      {s.father_name && (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          <span className="font-medium">Father:</span> {s.father_name}
                        </p>
                      )}
                      {/* Father CNIC */}
                      {s.father_cnic && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          <span className="font-medium">CNIC:</span> {s.father_cnic}
                        </p>
                      )}
                      {/* Contact Number */}
                      {s.contact_number && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          <span className="font-medium">Contact:</span> {s.contact_number}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Action buttons — full width, easy to tap */}
                  <div className="flex gap-2 mt-3 pt-2.5 border-t border-border/60">
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs h-9" onClick={() => openProfile(s)}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs h-9" onClick={() => openEdit(s)}>
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="flex-1 gap-1.5 text-xs h-9 text-destructive hover:bg-destructive/10 border-destructive/30">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {s.full_name}?</AlertDialogTitle>
                          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteMut.mutate(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Desktop Table Layout (≥ 640px) ── */}
          <Card className="hidden sm:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Photo</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Roll No</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Name</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Class</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Father</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Father CNIC</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Contact</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Status</th>
                      <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wide px-4 py-3 border border-slate-200">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => (
                      <tr key={s.id} className={`hover:bg-blue-50/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}>
                        <td className="px-4 py-2.5 border border-slate-200 text-center">
                          <div className="flex justify-center"><StudentAvatar photoUrl={s.photo_url} fullName={s.full_name} size="sm" /></div>
                        </td>
                        <td className="px-4 py-2.5 border border-slate-200 font-mono text-sm text-center">{s.roll_number}</td>
                        <td className="px-4 py-2.5 border border-slate-200 font-medium text-sm text-center">{s.full_name}</td>
                        <td className="px-4 py-2.5 border border-slate-200 text-center">
                          <span className="bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full">Class {s.class}</span>
                        </td>
                        <td className="px-4 py-2.5 border border-slate-200 text-sm text-muted-foreground text-center">{s.father_name || "—"}</td>
                        <td className="px-4 py-2.5 border border-slate-200 text-sm text-muted-foreground font-mono text-center">{s.father_cnic || "—"}</td>
                        <td className="px-4 py-2.5 border border-slate-200 text-sm text-muted-foreground text-center">{s.contact_number || "—"}</td>
                        <td className="px-4 py-2.5 border border-slate-200 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.is_active ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                            {s.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 border border-slate-200 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="View profile" onClick={() => openProfile(s)}><Eye className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button></AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Delete {s.full_name}?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Pagination (mobile-friendly) ───────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
            {page + 1} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="gap-1">
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ── Add/Edit Student Dialog ────────────────────────────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Student" : "Add Student"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {/* Full Name */}
            <div>
              <Label>Full Name *</Label>
              <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} placeholder="Student full name" />
            </div>
            {/* Roll Number + Class */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Roll Number *</Label>
                <Input value={form.roll_number} onChange={(e) => set("roll_number", e.target.value)} placeholder="e.g. 001" />
              </div>
              <div>
                <Label>Class</Label>
                <Select value={form.class} onValueChange={(v) => set("class", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{classes.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {/* Father Name */}
            <div>
              <Label>Father Name</Label>
              <Input value={form.father_name} onChange={(e) => set("father_name", e.target.value)} placeholder="Father's full name" />
            </div>
            {/* Father CNIC */}
            <div>
              <Label>Father CNIC</Label>
              <Input
                value={form.father_cnic}
                onChange={(e) => set("father_cnic", e.target.value)}
                placeholder="e.g. 35202-1234567-1"
                className="font-mono"
              />
            </div>
            {/* Contact Number */}
            <div>
              <Label>Contact Number</Label>
              <Input
                value={form.contact_number}
                onChange={(e) => set("contact_number", e.target.value)}
                placeholder="e.g. 03001234567"
                type="tel"
              />
            </div>
            {/* Active toggle */}
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
              <Label>Active</Label>
            </div>
            {/* Photo */}
            <div>
              <Label>Photo</Label>
              <div className="flex items-center gap-3 mt-1">
                {(form.photo_url || photoFile) && (
                  <img 
                    src={photoFile ? URL.createObjectURL(photoFile) : form.photo_url!} 
                    alt="Student photo preview" 
                    className="w-10 h-10 rounded-full object-cover" 
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} 
                  />
                )}
                <label className="flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
                  <Upload className="w-4 h-4" /> Choose Photo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Promote Students Dialog ────────────────────────────────────────── */}
      <Dialog open={promotionOpen} onOpenChange={(open) => { setPromotionOpen(open); if (!open) setPromotionPreview(null); }}>
        <DialogContent className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-blue-500" /> Promote Students
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Only <strong className="text-foreground">passing students</strong> will be promoted. Failing students stay in their current class.
            </p>

            {/* From → To */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">From Class</Label>
                <Select value={promotionFrom} onValueChange={v => {
                  setPromotionFrom(v);
                  const idx = classes.indexOf(v);
                  setPromotionTo(classes[Math.min(idx + 1, classes.length - 1)]);
                  setPromotionPreview(null);
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground mt-5 shrink-0" />
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">To Class</Label>
                <Select value={promotionTo} onValueChange={v => { setPromotionTo(v); setPromotionPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{classes.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Exam Type + Year — year auto-loaded from DB */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">Exam</Label>
                <Select value={promotionExamType} onValueChange={v => { setPromotionExamType(v); setPromotionPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_EXAM_TYPES.map(e => <SelectItem key={e} value={e}>{examTypeLabel(e)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  Year {loadingYears && <Loader2 className="inline w-3 h-3 ml-1 animate-spin" />}
                </Label>
                {availableYears.length > 0 ? (
                  <Select
                    value={String(promotionYear)}
                    onValueChange={v => { setPromotionYear(Number(v)); setPromotionPreview(null); }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {availableYears.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-10 flex items-center px-3 border rounded-md bg-muted/30 text-sm text-muted-foreground">
                    {loadingYears ? "Loading…" : "No results found"}
                  </div>
                )}
              </div>
            </div>

            {/* Info: no results for selected class */}
            {!loadingYears && availableYears.length === 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                ⚠️ No exam results found for Class {promotionFrom}. Please enter results first before promoting students.
              </div>
            )}

            {/* Check / Preview button */}
            {!promotionPreview && availableYears.length > 0 && (
              <Button
                variant="outline"
                className="w-full gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={loadPromotionPreview}
                disabled={loadingPreview || promotionFrom === promotionTo}
              >
                {loadingPreview
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading preview…</>
                  : <><Search className="w-4 h-4" /> Preview who will be promoted</>}
              </Button>
            )}

            {/* Preview results */}
            {promotionPreview && (
              <div className="space-y-3">
                {/* Summary badges */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-2.5">
                    <p className="text-2xl font-bold text-green-700">{promotionPreview.pass.length}</p>
                    <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mt-0.5">✅ Will Promote</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-xl p-2.5">
                    <p className="text-2xl font-bold text-red-700">{promotionPreview.fail.length}</p>
                    <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mt-0.5">❌ Will Stay (Fail)</p>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-2.5">
                    <p className="text-2xl font-bold text-yellow-700">{promotionPreview.noResult.length}</p>
                    <p className="text-[10px] font-semibold text-yellow-600 uppercase tracking-wide mt-0.5">⚠ No Result</p>
                  </div>
                </div>

                {/* Passing list */}
                {promotionPreview.pass.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-green-700 mb-1.5">✅ Passing — will move to Class {promotionTo}</p>
                    <div className="bg-green-50 border border-green-200 rounded-xl max-h-32 overflow-y-auto p-2 space-y-1">
                      {promotionPreview.pass.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground w-10 shrink-0">#{s.roll_number}</span>
                          <span className="text-foreground font-medium truncate">{s.full_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Failing list */}
                {promotionPreview.fail.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-700 mb-1.5">❌ Failing — will remain in Class {promotionFrom}</p>
                    <div className="bg-red-50 border border-red-200 rounded-xl max-h-28 overflow-y-auto p-2 space-y-1">
                      {promotionPreview.fail.map(s => (
                        <div key={s.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-muted-foreground w-10 shrink-0">#{s.roll_number}</span>
                          <span className="text-foreground font-medium truncate">{s.full_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No result list */}
                {promotionPreview.noResult.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800">
                    <p className="font-semibold mb-1">⚠️ {promotionPreview.noResult.length} student(s) have no result for {examTypeLabel(promotionExamType)} {promotionYear} — they will NOT be promoted.</p>
                    <p className="text-yellow-700">Enter their results first if needed, then re-run the preview.</p>
                  </div>
                )}

                {promotionPreview.pass.length === 0 && (
                  <div className="bg-muted rounded-xl p-3 text-center text-sm text-muted-foreground">
                    No passing students found for the selected exam. Nothing to promote.
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => setPromotionPreview(null)}
                >
                  ↺ Change selection
                </Button>
              </div>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => { setPromotionOpen(false); setPromotionPreview(null); }}>Cancel</Button>
            <Button
              onClick={handlePromotion}
              disabled={promoting || !promotionPreview || promotionPreview.pass.length === 0}
              className="gap-1.5 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {promoting && <Loader2 className="w-4 h-4 animate-spin" />}
              {promoting
                ? "Promoting..."
                : promotionPreview
                  ? `Promote ${promotionPreview.pass.length} students → Class ${promotionTo}`
                  : `Promote ${promotionFrom} → ${promotionTo}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Student Profile Drawer (attendance + results + fees + ID + exam roll) ── */}
      <StudentProfileDrawer
        student={profileStudent}
        open={profileOpen}
        onOpenChange={setProfileOpen}
      />
    </div>
  );
};

export default AdminStudents;
