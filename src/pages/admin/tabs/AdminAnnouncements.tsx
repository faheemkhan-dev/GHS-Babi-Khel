import { useState } from "react";
import type React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
// Tabs replaced with manual state rendering to prevent Android Chrome GPU corruption
import { Plus, Pencil, Trash2, Loader2, CalendarIcon, Upload, Image as ImageIcon, Trophy, Newspaper, Sparkles, Pin, BarChart3, X, GripVertical, Megaphone } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { triggerConfetti } from "@/lib/confetti";
import { detectTextLanguage } from "@/lib/newsUtils";
import type { Achievement } from "@/hooks/useAchievements";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PollOption { id: string; text: string; votes: number; }
interface Notice {
  id: string; title: string; content: string | null; category: string;
  is_urgent: boolean; is_published: boolean; is_pinned: boolean; expires_at: string | null; created_at: string;
  is_poll: boolean; poll_options: PollOption[]; poll_closes_at: string | null;
}
interface NewsItem {
  id: string; title: string; content: string | null; image_url: string | null;
  is_published: boolean; is_pinned: boolean; created_at: string;
}

const noticeCategories = ["general", "academic", "events", "urgent"];
const achCategories = ["Academic", "Sports", "Art", "Science", "Other"];
const classOptions = ["6", "7", "8", "9", "10"];
const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);
const PAGE_SIZE = 15;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;
const newPollOption = (): PollOption => ({ id: `opt_${Math.random().toString(36).slice(2, 9)}`, text: "", votes: 0 });

// ═══════════════════════════════════════════════════════════════════════════════
// NOTICES SECTION
// ═══════════════════════════════════════════════════════════════════════════════
const NoticesSection = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [form, setForm] = useState({
    title: "", content: "", category: "general", is_published: true, is_pinned: false, expires_at: null as Date | null,
    is_poll: false, poll_options: [newPollOption(), newPollOption()] as PollOption[], poll_closes_at: null as Date | null,
  });
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<{ notices: Notice[]; count: number }>({
    queryKey: ["admin-notices", page],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("notices").select("*", { count: "exact" })
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      return { notices: (data ?? []) as unknown as Notice[], count: count ?? 0 };
    },
  });
  const notices = data?.notices ?? [];
  const totalPages = Math.ceil((data?.count ?? 0) / PAGE_SIZE);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("notices").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-notices"] });
      // Also invalidate the public notices cache so the homepage reflects the change.
      qc.invalidateQueries({ queryKey: ["notices"] });
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from("notices").update({ is_published: val }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-notices"] });
      qc.invalidateQueries({ queryKey: ["notices"] });
    },
  });

  // Pin/unpin a notice in one click — pinned items appear at the top of the public list.
  const togglePin = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from("notices").update({ is_pinned: val }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.val ? "📌 Pinned to top" : "Unpinned");
      qc.invalidateQueries({ queryKey: ["admin-notices"] });
      qc.invalidateQueries({ queryKey: ["notices"] });
    },
  });

  const openAdd = () => {
    setEditing(null);
    setForm({
      title: "", content: "", category: "general", is_published: true, is_pinned: false, expires_at: null,
      is_poll: false, poll_options: [newPollOption(), newPollOption()], poll_closes_at: null,
    });
    setModalOpen(true);
  };
  const openEdit = (n: Notice) => {
    setEditing(n);
    setForm({
      title: n.title, content: n.content || "", category: n.category, is_published: n.is_published, is_pinned: n.is_pinned ?? false,
      expires_at: n.expires_at ? new Date(n.expires_at) : null,
      is_poll: n.is_poll, poll_options: n.poll_options?.length ? n.poll_options : [newPollOption(), newPollOption()],
      poll_closes_at: n.poll_closes_at ? new Date(n.poll_closes_at) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) { toast.error("Title required"); return; }

    let pollOptions: PollOption[] = [];
    if (form.is_poll) {
      const cleaned = form.poll_options
        .map(o => ({ ...o, text: o.text.trim() }))
        .filter(o => o.text.length > 0);
      if (cleaned.length < MIN_POLL_OPTIONS) {
        toast.error(`A poll needs at least ${MIN_POLL_OPTIONS} options`);
        return;
      }
      const removedVotes = form.poll_options
        .filter(o => !o.text.trim())
        .reduce((sum, o) => sum + (o.votes || 0), 0);
      if (editing && removedVotes > 0) {
        toast.error("Can't remove an option that already has votes");
        return;
      }
      pollOptions = cleaned;
    }

    setSaving(true);
    const payload = {
      title: form.title, content: form.content, category: form.category,
      is_urgent: form.category === "urgent", is_published: form.is_published, is_pinned: form.is_pinned,
      expires_at: form.expires_at ? format(form.expires_at, "yyyy-MM-dd") : null,
      is_poll: form.is_poll,
      poll_options: pollOptions,
      poll_closes_at: form.is_poll && form.poll_closes_at ? form.poll_closes_at.toISOString() : null,
    };
    const { error } = editing
      ? await supabase.from("notices").update(payload).eq("id", editing.id)
      : await supabase.from("notices").insert(payload);
    if (error) {
      // Surface the actual Supabase error instead of a generic "Save
      // failed" — e.g. if the poll_options/is_poll columns don't exist yet
      // because the migration hasn't been run, this will say so directly
      // (something like 'column "is_poll" of relation "notices" does not
      // exist') instead of leaving the admin guessing.
      console.error("Notice save failed:", error);
      toast.error(error.message || "Save failed");
    }
    else {
      toast.success(editing ? "Updated" : (form.is_poll ? "Poll published! 📊" : "Notice published! 📋"));
      if (!editing) triggerConfetti("mini");
      qc.invalidateQueries({ queryKey: ["admin-notices"] });
      qc.invalidateQueries({ queryKey: ["notices"] });
      setModalOpen(false);
    }
    setSaving(false);
  };

  const set = (k: string, v: string | boolean | Date | null | PollOption[]) => setForm(p => ({ ...p, [k]: v }));

  const updatePollOptionText = (id: string, text: string) =>
    setForm(p => ({ ...p, poll_options: p.poll_options.map(o => o.id === id ? { ...o, text } : o) }));
  const addPollOption = () =>
    setForm(p => p.poll_options.length >= MAX_POLL_OPTIONS ? p : { ...p, poll_options: [...p.poll_options, newPollOption()] });
  const removePollOption = (id: string) =>
    setForm(p => {
      if (p.poll_options.length <= MIN_POLL_OPTIONS) return p;
      const target = p.poll_options.find(o => o.id === id);
      if (editing && target && (target.votes || 0) > 0) {
        toast.error("Can't remove an option that already has votes");
        return p;
      }
      return { ...p, poll_options: p.poll_options.filter(o => o.id !== id) };
    });

  const renderNoticeActions = (n: any) => (
    <div className="flex items-center gap-0.5 shrink-0">
      <Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-primary" onClick={() => openEdit(n)}><Pencil className="w-3.5 h-3.5" /></Button>
      <AlertDialog><AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button></AlertDialogTrigger>
        <AlertDialogContent className="rounded-2xl"><AlertDialogHeader><AlertDialogTitle>Delete notice?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(n.id)} className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent></AlertDialog>
    </div>
  );

  const pollVotes = (n: any) => (n.poll_options || []).reduce((s: number, o: any) => s + (o.votes || 0), 0);

  if (isLoading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">Manage school notices and announcements</p>
        <Button onClick={openAdd} className="h-9 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="w-3.5 h-3.5" /> Add Notice</Button>
      </div>

      {notices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card py-12 text-center text-sm text-muted-foreground">No notices yet</div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {notices.map(n => (
          <div key={n.id} className={`rounded-2xl border bg-card p-3 shadow-sm ${n.is_urgent ? "border-destructive/40" : "border-border/60"} ${!n.is_published ? "opacity-70" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  {n.is_pinned && <Pin className="w-3.5 h-3.5 mt-0.5 text-[hsl(43_70%_48%)] shrink-0 fill-[hsl(43_70%_48%)]" />}
                  <p className="font-semibold text-sm text-foreground leading-snug break-words">{n.title}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <Badge variant="secondary" className="capitalize text-[10px] h-5 px-2 font-medium">{n.category}</Badge>
                  {n.is_urgent && <Badge className="text-[10px] h-5 px-2 bg-destructive/10 text-destructive hover:bg-destructive/10">Urgent</Badge>}
                  {n.is_poll && (
                    <Badge className="gap-1 text-[10px] h-5 px-2 bg-[hsl(258_60%_55%)]/10 text-[hsl(258_60%_45%)] hover:bg-[hsl(258_60%_55%)]/10">
                      <BarChart3 className="w-3 h-3" /> Poll · {pollVotes(n)} votes
                    </Badge>
                  )}
                </div>
              </div>
              {renderNoticeActions(n)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {format(new Date(n.created_at), "dd MMM yyyy")}
              {n.expires_at && <> · Expires {format(new Date(n.expires_at), "dd MMM yyyy")}</>}
            </p>
            <div className="mt-2.5 pt-2.5 border-t border-border/70 flex items-center gap-5">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={!!n.is_pinned} onCheckedChange={v => togglePin.mutate({ id: n.id, val: v })} /> Pinned
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={n.is_published} onCheckedChange={v => togglePublish.mutate({ id: n.id, val: v })} /> Published
              </label>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      {notices.length > 0 && (
        <div className="hidden md:block rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-bold px-4 py-2.5">Title</th>
                <th className="text-left font-bold px-3 py-2.5">Type</th>
                <th className="text-left font-bold px-3 py-2.5">Category</th>
                <th className="text-center font-bold px-3 py-2.5">Pinned</th>
                <th className="text-center font-bold px-3 py-2.5">Published</th>
                <th className="text-left font-bold px-3 py-2.5">Expires</th>
                <th className="text-left font-bold px-3 py-2.5">Date</th>
                <th className="w-20 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {notices.map(n => (
                <tr key={n.id} className={`border-t border-border/50 hover:bg-primary/5 transition-colors ${!n.is_published ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5 max-w-[320px]">
                    <div className="flex items-start gap-1.5">
                      {n.is_pinned && <Pin className="w-3.5 h-3.5 mt-0.5 text-[hsl(43_70%_48%)] shrink-0 fill-[hsl(43_70%_48%)]" />}
                      <span className="font-medium text-foreground break-words">{n.title}</span>
                      {n.is_urgent && <Badge className="ml-1 text-[10px] h-5 px-2 shrink-0 bg-destructive/10 text-destructive hover:bg-destructive/10">Urgent</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {n.is_poll ? (
                      <Badge className="gap-1 text-[10px] h-5 px-2 bg-[hsl(258_60%_55%)]/10 text-[hsl(258_60%_45%)] hover:bg-[hsl(258_60%_55%)]/10 whitespace-nowrap">
                        <BarChart3 className="w-3 h-3" /> {pollVotes(n)} votes
                      </Badge>
                    ) : <span className="text-xs text-muted-foreground">Notice</span>}
                  </td>
                  <td className="px-3 py-2.5"><Badge variant="secondary" className="capitalize text-[10px] h-5 px-2 font-medium">{n.category}</Badge></td>
                  <td className="px-3 py-2.5 text-center"><Switch checked={!!n.is_pinned} onCheckedChange={v => togglePin.mutate({ id: n.id, val: v })} /></td>
                  <td className="px-3 py-2.5 text-center"><Switch checked={n.is_published} onCheckedChange={v => togglePublish.mutate({ id: n.id, val: v })} /></td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{n.expires_at ? format(new Date(n.expires_at), "dd MMM yyyy") : "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(n.created_at), "dd MMM yyyy")}</td>
                  <td className="px-3 py-2.5"><div className="flex justify-end">{renderNoticeActions(n)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" className="h-9 min-w-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" className="h-9 min-w-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? (form.is_poll ? "Edit Poll" : "Edit Notice") : "Add Notice"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {/* Poll toggle — a poll is just a notice with voting fields
                attached, so it shares this same form/table rather than a
                separate flow. Locked once a poll has real votes so an admin
                can't accidentally flip it back to a plain notice and lose
                vote data. */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[hsl(258_60%_55%)]/5 border border-[hsl(258_60%_55%)]/20">
              <Switch
                checked={form.is_poll}
                disabled={!!editing && (editing.poll_options || []).some(o => (o.votes || 0) > 0)}
                onCheckedChange={v => set("is_poll", v)}
              />
              <div className="flex-1">
                <Label className="flex items-center gap-1.5 cursor-pointer" onClick={() => { if (!editing || !(editing.poll_options || []).some(o => (o.votes || 0) > 0)) set("is_poll", !form.is_poll); }}>
                  <BarChart3 className="w-3.5 h-3.5 text-[hsl(258_60%_55%)]" /> Make this a Poll
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Visitors vote for one option — no login needed, one vote per device.
                </p>
              </div>
            </div>

            <div><Label>{form.is_poll ? "Poll Question *" : "Title *"}</Label><Input value={form.title} onChange={e => set("title", e.target.value)} placeholder={form.is_poll ? "e.g. Should Saturday remain a holiday?" : ""} /></div>
            <div><Label>{form.is_poll ? "Description (optional)" : "Content"}</Label><Textarea rows={form.is_poll ? 2 : 5} value={form.content} onChange={e => set("content", e.target.value)} /></div>

            {form.is_poll && (
              <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
                <Label>Options * (2–{MAX_POLL_OPTIONS})</Label>
                {form.poll_options.map((opt, i) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <Input
                      value={opt.text}
                      onChange={e => updatePollOptionText(opt.id, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      maxLength={80}
                    />
                    {editing && (opt.votes || 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{opt.votes} votes</span>
                    )}
                    <Button
                      type="button" size="icon" variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={form.poll_options.length <= MIN_POLL_OPTIONS}
                      onClick={() => removePollOption(opt.id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                {form.poll_options.length < MAX_POLL_OPTIONS && (
                  <Button type="button" variant="outline" size="sm" className="mt-1 h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none border-border/60" onClick={addPollOption}>
                    <Plus className="w-3.5 h-3.5" /> Add Option
                  </Button>
                )}
                <div className="pt-2">
                  <Label>Poll Closes At (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start gap-2 mt-1">
                        <CalendarIcon className="w-4 h-4" />
                        {form.poll_closes_at ? format(form.poll_closes_at, "dd MMM yyyy") : "Stays open until unpublished"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={form.poll_closes_at ?? undefined} onSelect={d => set("poll_closes_at", d ?? null)} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}

            <div><Label>Category</Label>
              <Select value={form.category} onValueChange={v => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{noticeCategories.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-6 flex-wrap">
              <div className="flex items-center gap-2"><Switch checked={form.is_published} onCheckedChange={v => set("is_published", v)} /><Label>Published</Label></div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_pinned} onCheckedChange={v => set("is_pinned", v)} />
                <Label className="flex items-center gap-1"><Pin className="w-3 h-3" /> Pin to top</Label>
              </div>
            </div>
            <div>
              <Label>Expires At (optional)</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start gap-2 mt-1">
                    <CalendarIcon className="w-4 h-4" />
                    {form.expires_at ? format(form.expires_at, "dd MMM yyyy") : "No expiry"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={form.expires_at ?? undefined} onSelect={d => set("expires_at", d ?? null)} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
const NewsSection = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [form, setForm] = useState({ title: "", content: "", image_url: null as string | null, is_published: true, is_pinned: false });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: news = [], isLoading } = useQuery<NewsItem[]>({
    queryKey: ["admin-news"],
    queryFn: async () => {
      const { data, error } = await supabase.from("news").select("*")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error; return data ?? [];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("news").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => {
      toast.success("Deleted");
      // Invalidate BOTH admin and public news caches — otherwise the homepage
      // would keep serving the stale list and "newly published articles wouldn't
      // appear" for up to the cache's staleTime window.
      qc.invalidateQueries({ queryKey: ["admin-news"] });
      qc.invalidateQueries({ queryKey: ["news"] });
    },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from("news").update({ is_published: val }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-news"] });
      qc.invalidateQueries({ queryKey: ["news"] });
    },
  });

  // Pin/unpin a news article in one click — pinned items appear at the top of the public list.
  const togglePin = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from("news").update({ is_pinned: val }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.val ? "📌 Pinned to top" : "Unpinned");
      qc.invalidateQueries({ queryKey: ["admin-news"] });
      qc.invalidateQueries({ queryKey: ["news"] });
    },
  });

  const openAdd = () => { setEditing(null); setForm({ title: "", content: "", image_url: null, is_published: true, is_pinned: false }); setImageFile(null); setModalOpen(true); };
  const openEdit = (n: NewsItem) => {
    setEditing(n); setForm({ title: n.title, content: n.content || "", image_url: n.image_url, is_published: n.is_published, is_pinned: n.is_pinned ?? false }); setImageFile(null); setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      let image_url = form.image_url;
      if (imageFile) image_url = await uploadToCloudinary(imageFile, "branding");
      const payload = { ...form, image_url };
      const { error } = editing
        ? await supabase.from("news").update(payload).eq("id", editing.id)
        : await supabase.from("news").insert(payload);
      if (error) toast.error("Save failed: " + error.message);
      else {
        toast.success(editing ? "Updated" : "News published");
        // Critical: invalidate public news cache so the homepage / /news page
        // pick up the new article immediately instead of showing stale data.
        qc.invalidateQueries({ queryKey: ["admin-news"] });
        qc.invalidateQueries({ queryKey: ["news"] });
        setModalOpen(false);
      }
    } catch (err) { toast.error(err?.message || "Upload failed. Check Cloudinary env vars."); }
    setSaving(false);
  };

  const set = (k: string, v: string | boolean | null) => setForm(p => ({ ...p, [k]: v }));

  if (isLoading) return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">Manage school news articles</p>
        <Button onClick={openAdd} className="h-9 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="w-3.5 h-3.5" /> Add News</Button>
      </div>

      {news.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No news articles yet</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {news.map(n => (
          <Card key={n.id} className={`border-border overflow-hidden relative rounded-2xl shadow-sm ${!n.is_published ? "opacity-60" : ""} ${n.is_pinned ? "ring-2 ring-[hsl(43_70%_58%)]/60" : ""}`}>
            <div className="aspect-video bg-muted relative">
              {n.image_url
                ? <img src={n.image_url} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-muted-foreground/30" /></div>}
              <Badge className={`absolute top-2 right-2 ${n.is_published ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border border-border bg-muted text-muted-foreground hover:bg-muted"}`}>
                {n.is_published ? "Published" : "Draft"}
              </Badge>
              {n.is_pinned && (
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-[0.22em] bg-gradient-to-r from-[hsl(43_70%_48%)] to-[hsl(43_80%_55%)] text-[hsl(348_55%_22%)] shadow-sm">
                  <Pin className="w-2.5 h-2.5" /> Pinned
                </span>
              )}
            </div>
            <CardContent className="p-4 space-y-2">
              <h3 className="font-heading font-semibold text-foreground leading-snug line-clamp-2 break-words">{n.title}</h3>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CalendarIcon className="w-3 h-3" />
                {format(new Date(n.created_at), "dd MMM yyyy · h:mm a")}
              </p>
              {n.content && <p className="text-sm text-muted-foreground line-clamp-2">{n.content}</p>}
              <div className="flex items-center gap-x-4 gap-y-2 pt-3 mt-1 border-t border-border/70 flex-wrap">
                <div className="flex items-center gap-1" title="Pin to top">
                  <Switch checked={!!n.is_pinned} onCheckedChange={v => togglePin.mutate({ id: n.id, val: v })} />
                  <span className="text-[11px] text-muted-foreground">Pin</span>
                </div>
                <div className="flex items-center gap-1" title="Publish">
                  <Switch checked={n.is_published} onCheckedChange={v => togglePublish.mutate({ id: n.id, val: v })} />
                </div>
                <Button size="icon" variant="ghost" onClick={() => openEdit(n)} className="h-8 w-8 shadow-none text-muted-foreground hover:text-primary ml-auto"><Pencil className="w-3.5 h-3.5" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button></AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader><AlertDialogTitle>Delete this news?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(n.id)} className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Newspaper className="w-5 h-5 text-primary" />
              {editing ? "Edit News" : "Add News"}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-gold" />
              Write in English or Urdu — the homepage will auto-format it as a typeset editorial article.
            </p>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Title *</Label>
                {form.title && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    detectTextLanguage(form.title) === "ur"
                      ? "bg-[hsl(348_55%_28%)]/10 text-[hsl(348_55%_28%)]"
                      : "bg-[hsl(215_45%_28%)]/10 text-[hsl(215_45%_28%)]"
                  }`}>
                    {detectTextLanguage(form.title) === "ur" ? "اردو · RTL" : "English · LTR"}
                  </span>
                )}
              </div>
              <Input
                value={form.title}
                onChange={e => set("title", e.target.value)}
                dir={form.title && detectTextLanguage(form.title) === "ur" ? "rtl" : "ltr"}
                placeholder={form.title ? "" : "Enter title in English or Urdu…"}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Content</Label>
                {form.content && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    detectTextLanguage(form.content) === "ur"
                      ? "bg-[hsl(348_55%_28%)]/10 text-[hsl(348_55%_28%)]"
                      : "bg-[hsl(215_45%_28%)]/10 text-[hsl(215_45%_28%)]"
                  }`}>
                    {detectTextLanguage(form.content) === "ur" ? "اردو" : "English"}
                  </span>
                )}
              </div>
              <Textarea
                rows={6}
                value={form.content}
                onChange={e => set("content", e.target.value)}
                dir={form.content && detectTextLanguage(form.content) === "ur" ? "rtl" : "ltr"}
                placeholder="Write the article body… (Urdu or English — auto-detected)"
                style={form.content && detectTextLanguage(form.content) === "ur"
                  ? { fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" }
                  : undefined}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2"><Switch checked={form.is_published} onCheckedChange={v => set("is_published", v)} /><Label>Published</Label></div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_pinned} onCheckedChange={v => set("is_pinned", v)} />
                <Label className="flex items-center gap-1"><Pin className="w-3 h-3" /> Pin to top</Label>
              </div>
            </div>
            <div>
              <Label>Image <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <div className="flex items-center gap-3 mt-1">
                {(form.image_url || imageFile) && <img src={imageFile ? URL.createObjectURL(imageFile) : form.image_url!} alt="" className="w-16 h-10 rounded object-cover" />}
                <label className="flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
                  <Upload className="w-4 h-4" /> Choose Image
                  <input type="file" accept="image/*" className="hidden" onChange={e => setImageFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? "Save changes" : "Publish news"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// ACHIEVEMENTS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
const AchievementsSection = () => {
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
      if (imageFile) image_url = await uploadToCloudinary(imageFile, "branding");
      const payload = {
        title: form.title, description: form.description || null, student_name: form.student_name || null,
        class: form.class || null, year: form.year, category: form.category, image_url,
      };
      const { error } = editing
        ? await supabase.from("achievements").update(payload).eq("id", editing.id)
        : await supabase.from("achievements").insert(payload);
      if (error) toast.error("Save failed: " + error.message);
      else { toast.success(editing ? "Updated" : "Added"); qc.invalidateQueries({ queryKey: ["admin-achievements"] }); setModalOpen(false); }
    } catch (err) { toast.error(err?.message || "Upload failed. Check Cloudinary env vars."); }
    setSaving(false);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("achievements").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["admin-achievements"] }); },
  });

  if (isLoading) return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground sm:text-sm">Manage student and school achievements</p>
        <Button onClick={openAdd} className="h-9 min-w-0 shrink-0 gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90"><Plus className="w-3.5 h-3.5" /> Add Achievement</Button>
      </div>

      {achievements.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No achievements yet</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {achievements.map(a => (
          <Card key={a.id} className="overflow-hidden border-border rounded-2xl shadow-sm hover:shadow-elevated transition-shadow">
            {a.image_url ? (
              <div className="aspect-video bg-muted"><img src={a.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /></div>
            ) : (
              <div className="aspect-video bg-secondary flex items-center justify-center"><Trophy className="w-10 h-10 text-primary/30" /></div>
            )}
            <CardContent className="p-4 space-y-2">
              <h3 className="font-heading font-semibold text-foreground leading-snug break-words">{a.title}</h3>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[10px] h-5 px-2 font-medium">{a.category}</Badge>
                {a.year && <Badge variant="outline">{a.year}</Badge>}
                {a.class && <Badge variant="outline">Class {a.class}</Badge>}
              </div>
              {a.student_name && <p className="text-sm text-muted-foreground">{a.student_name}</p>}
              <div className="flex justify-end gap-0.5 pt-2 mt-1 border-t border-border/70">
                <Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-primary" onClick={() => openEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="h-8 w-8 shadow-none text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button></AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader><AlertDialogTitle>Delete achievement?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(a.id)} className="h-9 min-w-0 flex-1 rounded-full px-4 text-xs font-semibold shadow-none bg-destructive text-destructive-foreground hover:bg-destructive/90 sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="rounded-2xl p-5 gap-3 max-w-md">
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
            <Button variant="outline" className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none border-border/60 sm:flex-none" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full px-4 text-xs font-semibold shadow-none bg-primary text-primary-foreground hover:bg-primary/90 sm:flex-none">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// TAB BAR — manual state, no Radix Tabs (prevents Android Chrome GPU corruption
// caused by Radix rendering all TabsContent divs simultaneously in the DOM)
// ═══════════════════════════════════════════════════════════════════════════════
type AnnTab = "notices" | "news" | "achievements";

/* ──────────────────────────────────────────────────────────────────────────
 *  HD SVG tab icons — hand-crafted, gradient-filled, crisp at 18px.
 *  Each icon uses unique gradient IDs (prefixed `tg-` = "tab gradient") so
 *  they can coexist on the same page without SVG `<defs>` collisions.
 *  Palette per tab matches the previous colored-badge scheme:
 *    • Notices      → amber bell
 *    • News         → sky-blue folded paper
 *    • Achievements → gold trophy
 * ────────────────────────────────────────────────────────────────────────── */
const NoticesTabIcon = () => (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
    <defs>
      <linearGradient id="tg-bell-body" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor="#FCD34D" />
        <stop offset="55%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#B45309" />
      </linearGradient>
      <linearGradient id="tg-bell-shine" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor="#FEF3C7" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#FEF3C7" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path
      d="M12 2.4c-1.05 0-2.04.3-2.88.84A4.85 4.85 0 0 0 7.1 6.6c-.06.36-.1.74-.1 1.14 0 1.7-.2 3.1-.6 4.3-.36 1.04-.84 1.86-1.5 2.55-.4.42-.6.94-.6 1.5 0 .5.18.94.5 1.27.32.34.78.5 1.27.5h11.86c.5 0 .95-.16 1.27-.5.32-.33.5-.77.5-1.27 0-.56-.2-1.08-.6-1.5-.66-.7-1.14-1.5-1.5-2.55-.4-1.2-.6-2.6-.6-4.3 0-.4-.04-.78-.1-1.14a4.85 4.85 0 0 0-2.02-3.36A5.16 5.16 0 0 0 12 2.4z"
      fill="url(#tg-bell-body)"
      stroke="#7C2D12"
      strokeWidth="0.7"
      strokeLinejoin="round"
    />
    <path
      d="M10.3 4.2c-.5.18-.94.45-1.3.82-.46.48-.74 1.1-.82 1.86-.04.34-.05.7-.05 1.1v3.2c0 .95-.08 1.84-.24 2.66-.13.7-.32 1.36-.56 1.96h1l.2-.55c.26-.66.44-1.4.55-2.2.12-.85.18-1.78.18-2.78V8.1c0-.4.06-.78.18-1.12.14-.4.36-.74.64-1z"
      fill="url(#tg-bell-shine)"
    />
    <path
      d="M9.8 19.3c.32.86 1.13 1.4 2.2 1.4s1.88-.54 2.2-1.4z"
      fill="#7C2D12"
    />
    <circle cx="18.2" cy="5.6" r="1.1" fill="#FBBF24" stroke="#7C2D12" strokeWidth="0.5" />
  </svg>
);

const NewsTabIcon = () => (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
    <defs>
      <linearGradient id="tg-paper-body" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor="#E0F2FE" />
        <stop offset="100%" stopColor="#7DD3FC" />
      </linearGradient>
      <linearGradient id="tg-paper-edge" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#0EA5E9" />
        <stop offset="100%" stopColor="#0369A1" />
      </linearGradient>
    </defs>
    <rect
      x="3.5" y="4" width="14" height="16" rx="1.2"
      fill="url(#tg-paper-body)" stroke="#0369A1" strokeWidth="0.7"
    />
    <rect x="6" y="6.5" width="9" height="1.6" rx="0.4" fill="#0C4A6E" />
    <rect x="6" y="9.5"  width="9" height="0.7" rx="0.35" fill="#075985" opacity="0.7" />
    <rect x="6" y="11"   width="9" height="0.7" rx="0.35" fill="#075985" opacity="0.7" />
    <rect x="6" y="12.5" width="9" height="0.7" rx="0.35" fill="#075985" opacity="0.7" />
    <rect x="6" y="14"   width="6" height="0.7" rx="0.35" fill="#075985" opacity="0.7" />
    <path
      d="M17.5 6v12.5c0 1 .8 1.5 1.7 1.5s1.8-.5 1.8-1.5V8.5z"
      fill="url(#tg-paper-edge)" stroke="#0C4A6E" strokeWidth="0.6" strokeLinejoin="round"
    />
    <rect x="18.5" y="10" width="1.4" height="0.5" rx="0.25" fill="#BAE6FD" />
    <rect x="18.5" y="12" width="1.4" height="0.5" rx="0.25" fill="#BAE6FD" />
    <rect x="18.5" y="14" width="1.4" height="0.5" rx="0.25" fill="#BAE6FD" />
  </svg>
);

const AchievementsTabIcon = () => (
  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
    <defs>
      <linearGradient id="tg-trophy-body" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0%" stopColor="#FDE68A" />
        <stop offset="50%" stopColor="#FBBF24" />
        <stop offset="100%" stopColor="#B45309" />
      </linearGradient>
      <linearGradient id="tg-trophy-shine" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#FFFBEB" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#FFFBEB" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path
      d="M7 3h10v3.5c0 2.5-2.2 4.5-5 4.5S7 9 7 6.5z"
      fill="url(#tg-trophy-body)" stroke="#78350F" strokeWidth="0.7" strokeLinejoin="round"
    />
    <path
      d="M7 4.5H5.2c-.9 0-1.5.7-1.5 1.6 0 1.6 1 2.9 2.6 3.4.5.15 1 .2 1.5.2"
      fill="none" stroke="#78350F" strokeWidth="0.8" strokeLinecap="round"
    />
    <path
      d="M17 4.5h1.8c.9 0 1.5.7 1.5 1.6 0 1.6-1 2.9-2.6 3.4-.5.15-1 .2-1.5.2"
      fill="none" stroke="#78350F" strokeWidth="0.8" strokeLinecap="round"
    />
    <path d="M9 4v2.5c0 1.8 1.3 3 3 3s3-1.2 3-3V4z" fill="url(#tg-trophy-shine)" />
    <rect x="10"  y="11"  width="4"   height="2.5" fill="#92400E" />
    <rect
      x="7.5" y="13.5" width="9" height="1.8" rx="0.4"
      fill="url(#tg-trophy-body)" stroke="#78350F" strokeWidth="0.6"
    />
    <rect
      x="9" y="15.3" width="6" height="3.5" rx="0.4"
      fill="url(#tg-trophy-body)" stroke="#78350F" strokeWidth="0.6"
    />
    <path d="M11 15.5h2" stroke="#FEF3C7" strokeWidth="0.5" strokeLinecap="round" opacity="0.7" />
    <path d="M10.5 18.8h3" stroke="#78350F" strokeWidth="0.6" />
  </svg>
);

const AnnouncementTabs = () => {
  const [active, setActive] = useState<AnnTab>("notices");
  const tabs: { id: AnnTab; label: string; icon: React.ReactNode }[] = [
    { id: "notices",      label: "Notices",      icon: <NoticesTabIcon /> },
    { id: "news",         label: "News",         icon: <NewsTabIcon /> },
    { id: "achievements", label: "Achievements", icon: <AchievementsTabIcon /> },
  ];
  return (
    <div className="w-full" style={{ contain: "layout style" }}>
      {/* Tab bar — compact pill row. Each tab is icon + label only (no
          heavy colored background per icon), so the row stays slim and
          horizontally scrollable on small screens without truncation. */}
      <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex h-10 min-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1 sm:min-w-0">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold whitespace-nowrap transition-all ${
                active === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Only render the active section — prevents all 3 sections loading simultaneously */}
      {active === "notices"      && <NoticesSection />}
      {active === "news"         && <NewsSection />}
      {active === "achievements" && <AchievementsSection />}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMBINED COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
const AdminAnnouncements = () => {
  return (
    <div className="space-y-4 pb-20 md:pb-0" style={{ contain: "layout style" }}>
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <Megaphone className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Announcements</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">Notices, News & Achievements — all in one place</p>
          </div>
        </div>
      </div>

      <AnnouncementTabs />
    </div>
  );
};

export default AdminAnnouncements;
