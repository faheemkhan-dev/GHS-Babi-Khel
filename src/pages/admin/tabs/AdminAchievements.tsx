import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Upload, Trophy } from "lucide-react";
import toast from "react-hot-toast";
import type { Achievement } from "@/hooks/useAchievements";
import { purgePersistedKey } from "@/lib/queryPersist";

const achCategories = ["Academic", "Sports", "Art", "Science", "Other"];
const classOptions = ["6", "7", "8", "9", "10"];
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

const AdminAchievements = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Achievement | null>(null);
  const [form, setForm] = useState({ title: "", description: "", student_name: "", class: "", year: currentYear, category: "Academic" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: achievements = [], isLoading } = useQuery<Achievement[]>({
    queryKey: ["admin-achievements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("achievements").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ title: "", description: "", student_name: "", class: "", year: currentYear, category: "Academic" });
    setImageFile(null); setModalOpen(true);
  };
  const openEdit = (a: Achievement) => {
    setEditing(a);
    setForm({ title: a.title, description: a.description || "", student_name: a.student_name || "", class: a.class || "", year: a.year || currentYear, category: a.category });
    setImageFile(null); setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      let image_url = editing?.image_url || null;
      if (imageFile) {
        image_url = await uploadToCloudinary(imageFile, "branding");
      }
      const payload = {
        title: form.title, description: form.description || null, student_name: form.student_name || null,
        class: form.class || null, year: form.year, category: form.category, image_url,
      };
      const { error } = editing
        ? await supabase.from("achievements").update(payload).eq("id", editing.id)
        : await supabase.from("achievements").insert(payload);
      if (error) toast.error("Save failed: " + error.message);
      else {
        toast.success(editing ? "Updated" : "Added");
        qc.invalidateQueries({ queryKey: ["admin-achievements"] });
        qc.invalidateQueries({ queryKey: ["achievements"] });
        void purgePersistedKey("achievements");
        setModalOpen(false);
      }
    } catch (err) {
      toast.error(err?.message || "Upload failed. Check Cloudinary env vars.");
    }
    setSaving(false);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("achievements").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-achievements"] });
      qc.invalidateQueries({ queryKey: ["achievements"] });
      void purgePersistedKey("achievements");
    },
  });

  if (isLoading) return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold text-foreground">Manage Achievements</h2>
        <Button onClick={openAdd} className="gap-1.5"><Plus className="w-4 h-4" /> Add Achievement</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {achievements.map(a => (
          <Card key={a.id} className="overflow-hidden border-border hover:shadow-elevated transition-shadow">
            {a.image_url ? (
              <div className="aspect-video bg-muted"><img src={a.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /></div>
            ) : (
              <div className="aspect-video bg-secondary flex items-center justify-center"><Trophy className="w-10 h-10 text-primary/30" /></div>
            )}
            <CardContent className="p-4 space-y-2">
              <h3 className="font-heading font-semibold text-foreground">{a.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{a.category}</Badge>
                {a.year && <Badge variant="outline">{a.year}</Badge>}
                {a.class && <Badge variant="outline">Class {a.class}</Badge>}
              </div>
              {a.student_name && <p className="text-sm text-muted-foreground">{a.student_name}</p>}
              <div className="flex gap-1 pt-2">
                <Button size="icon" variant="ghost" onClick={() => openEdit(a)}><Pencil className="w-4 h-4" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="w-4 h-4" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Delete achievement?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(a.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Achievement" : "Add Achievement"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label>Description</Label><Textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div><Label>Student Name</Label><Input value={form.student_name} onChange={e => setForm(p => ({ ...p, student_name: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Class</Label>
                <Select value={form.class} onValueChange={v => setForm(p => ({ ...p, class: v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{classOptions.map(c => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Year</Label>
                <Select value={String(form.year)} onValueChange={v => setForm(p => ({ ...p, year: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{achCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Image</Label>
              <div className="flex items-center gap-3 mt-1">
                {(imageFile || editing?.image_url) && <img src={imageFile ? URL.createObjectURL(imageFile) : editing!.image_url!} alt="" className="w-16 h-10 rounded object-cover" />}
                <label className="flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
                  <Upload className="w-4 h-4" /> Choose Image
                  <input type="file" accept="image/*" className="hidden" onChange={e => setImageFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminAchievements;


