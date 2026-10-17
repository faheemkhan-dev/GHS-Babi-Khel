import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2, Upload, Search, GraduationCap, Phone, Mail, Users } from "lucide-react";
import toast from "react-hot-toast";
import type { Teacher } from "@/hooks/useTeachers";

const emptyTeacher = {
  full_name: "", subject: "", qualification: "", experience: "",
  phone: "", email: "", bio: "", photo_url: null as string | null,
  display_order: 0, is_active: true,
};

const Avatar = ({ t, size = "w-11 h-11" }: { t: Teacher; size?: string }) =>
  t.photo_url ? (
    <img src={t.photo_url} alt="" className={`${size} rounded-full object-cover ring-1 ring-border shrink-0`} />
  ) : (
    <div className={`${size} rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold ring-1 ring-border shrink-0`}>
      {t.full_name.charAt(0)}
    </div>
  );

const StatusPill = ({ active }: { active: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
      active
        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
        : "bg-muted text-muted-foreground border-border"
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
    {active ? "Active" : "Inactive"}
  </span>
);

const AdminTeachers = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [form, setForm] = useState(emptyTeacher);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const { data: teachers = [], isLoading } = useQuery<Teacher[]>({
    queryKey: ["admin-teachers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers").select("*").order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teachers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-teachers"] });
      // Also refresh the shared teachers cache (Timetables dropdown, Substitute
      // dialog, homepage, public Teachers page, student dashboard).
      qc.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: () => toast.error("Delete failed"),
  });

  const openAdd = () => { setEditing(null); setForm(emptyTeacher); setPhotoFile(null); setModalOpen(true); };
  const openEdit = (t: Teacher) => {
    setEditing(t);
    setForm({
      full_name: t.full_name, subject: t.subject || "", qualification: t.qualification || "",
      experience: t.experience || "", phone: t.phone || "", email: t.email || "",
      bio: t.bio || "", photo_url: t.photo_url, display_order: t.display_order, is_active: t.is_active,
    });
    setPhotoFile(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name || !form.subject) { toast.error("Name and Subject required"); return; }
    setSaving(true);
    try {
      let photo_url = form.photo_url;
      if (photoFile) {
        photo_url = await uploadToCloudinary(photoFile, "teachers");
      }
      const payload = { ...form, photo_url };
      const { error } = editing
        ? await supabase.from("teachers").update(payload).eq("id", editing.id)
        : await supabase.from("teachers").insert(payload);
      if (error) toast.error("Save failed: " + error.message);
      else {
        toast.success(editing ? "Updated" : "Added");
        qc.invalidateQueries({ queryKey: ["admin-teachers"] });
        qc.invalidateQueries({ queryKey: ["teachers"] });
        setModalOpen(false);
      }
    } catch (err) {
      toast.error(err?.message || "Save failed. Check Cloudinary env vars.");
    }
    setSaving(false);
  };

  const set = (k: string, v: string | number | boolean | null) => setForm((p) => ({ ...p, [k]: v }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) =>
      [t.full_name, t.subject, t.qualification].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [teachers, search]);

  const activeCount = teachers.filter((t) => t.is_active).length;

  const RowActions = ({ t }: { t: Teacher }) => (
    <div className="flex items-center gap-0.5 shrink-0">
      <Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-primary" onClick={() => openEdit(t)} aria-label="Edit">
        <Pencil className="w-3.5 h-3.5" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-destructive" aria-label="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {t.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 shadow-none">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMut.mutate(t.id)} className="h-9 shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (isLoading) {
    return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-heading font-bold text-foreground leading-tight">Manage Teachers</h2>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Users className="w-3 h-3" /> {teachers.length} total · {activeCount} active
          </p>
        </div>
        <Button onClick={openAdd} className="h-8 px-3 text-xs font-medium shadow-none gap-1 shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add Teacher
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, subject or qualification"
          className="h-9 pl-9 text-sm rounded-full bg-card"
        />
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((t) => (
          <div key={t.id} className="rounded-2xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-3">
              <Avatar t={t} size="w-12 h-12" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground truncate">{t.full_name}</p>
                <p className="text-xs text-primary font-medium truncate">{t.subject}</p>
              </div>
              <RowActions t={t} />
            </div>
            <div className="mt-2.5 pt-2.5 border-t border-border/70 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <StatusPill active={t.is_active} />
              {t.qualification && (
                <span className="flex items-center gap-1 min-w-0"><GraduationCap className="w-3 h-3 shrink-0" /><span className="truncate">{t.qualification}</span></span>
              )}
              {t.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{t.phone}</span>}
              {t.email && <span className="flex items-center gap-1 min-w-0"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{t.email}</span></span>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">No teachers found</div>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-medium px-4 py-2.5">Teacher</th>
              <th className="text-left font-medium px-4 py-2.5">Subject</th>
              <th className="text-left font-medium px-4 py-2.5">Qualification</th>
              <th className="text-left font-medium px-4 py-2.5">Contact</th>
              <th className="text-left font-medium px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 w-24" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t border-border/70 hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar t={t} size="w-9 h-9" />
                    <span className="font-medium text-foreground">{t.full_name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-foreground">{t.subject}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{t.qualification || "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {t.phone || t.email ? (
                    <div className="space-y-0.5">
                      {t.phone && <div>{t.phone}</div>}
                      {t.email && <div>{t.email}</div>}
                    </div>
                  ) : "—"}
                </td>
                <td className="px-4 py-2.5"><StatusPill active={t.is_active} /></td>
                <td className="px-4 py-2.5"><div className="flex justify-end"><RowActions t={t} /></div></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-10">No teachers found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto p-5 sm:p-6 gap-4">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Teacher" : "Add Teacher"}</DialogTitle></DialogHeader>

          {/* Photo */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 p-3">
            {(form.photo_url || photoFile) ? (
              <img src={photoFile ? URL.createObjectURL(photoFile) : form.photo_url!} alt="" className="w-14 h-14 rounded-full object-cover ring-1 ring-border" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold">
                {form.full_name.charAt(0) || "?"}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">Profile photo</p>
              <label className="inline-flex items-center gap-1.5 mt-1 h-7 px-3 rounded-full border border-input bg-card text-xs font-medium text-foreground cursor-pointer hover:bg-secondary transition-colors">
                <Upload className="w-3 h-3" /> {form.photo_url || photoFile ? "Change" : "Choose"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              </label>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Full Name *</Label><Input className="h-9 text-sm" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Subject *</Label><Input className="h-9 text-sm" value={form.subject} onChange={(e) => set("subject", e.target.value)} /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Qualification</Label><Input className="h-9 text-sm" value={form.qualification} onChange={(e) => set("qualification", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Experience</Label><Input className="h-9 text-sm" value={form.experience} onChange={(e) => set("experience", e.target.value)} placeholder="e.g. 5 years" /></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Phone</Label><Input className="h-9 text-sm" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input className="h-9 text-sm" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Bio</Label><Textarea rows={2} className="text-sm" value={form.bio} onChange={(e) => set("bio", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1"><Label className="text-xs">Display Order</Label><Input className="h-9 text-sm" type="number" value={form.display_order} onChange={(e) => set("display_order", +e.target.value)} /></div>
              <div className="flex items-center justify-between h-9 rounded-md border border-input px-3">
                <Label className="text-xs">Active</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="h-8 px-4 text-xs font-medium shadow-none flex-1 sm:flex-none">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-8 px-4 text-xs font-medium shadow-none gap-1.5 flex-1 sm:flex-none">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? "Update" : "Add"} Teacher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminTeachers;
