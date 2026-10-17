import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
import { Plus, Pencil, Trash2, Loader2, CalendarIcon, BarChart3, X, GripVertical } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { triggerConfetti } from "@/lib/confetti";

interface PollOption { id: string; text: string; votes: number; }

interface Notice {
  id: string; title: string; content: string | null; category: string;
  is_urgent: boolean; is_published: boolean; expires_at: string | null; created_at: string;
  is_poll: boolean; poll_options: PollOption[]; poll_closes_at: string | null;
}

const categories = ["general", "academic", "events", "urgent"];
const PAGE_SIZE = 15;
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;

const newPollOption = (): PollOption => ({ id: `opt_${Math.random().toString(36).slice(2, 9)}`, text: "", votes: 0 });

const AdminNotices = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [form, setForm] = useState({
    title: "", content: "", category: "general", is_urgent: false, is_published: true, expires_at: null as Date | null,
    is_poll: false, poll_options: [newPollOption(), newPollOption()] as PollOption[], poll_closes_at: null as Date | null,
  });
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery<{ notices: Notice[]; count: number }>({
    queryKey: ["admin-notices", page],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("notices")
        .select("id, title, content, category, is_urgent, is_published, expires_at, created_at, is_poll, poll_options, poll_closes_at", { count: "exact" })
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
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["admin-notices"] }); },
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from("notices").update({ is_published: val }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-notices"] }),
  });

  const openAdd = () => {
    setEditing(null);
    setForm({
      title: "", content: "", category: "general", is_urgent: false, is_published: true, expires_at: null,
      is_poll: false, poll_options: [newPollOption(), newPollOption()], poll_closes_at: null,
    });
    setModalOpen(true);
  };
  const openEdit = (n: Notice) => {
    setEditing(n);
    setForm({
      title: n.title, content: n.content || "", category: n.category, is_urgent: n.is_urgent, is_published: n.is_published,
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
      is_urgent: form.is_urgent, is_published: form.is_published,
      expires_at: form.expires_at ? format(form.expires_at, "yyyy-MM-dd") : null,
      is_poll: form.is_poll,
      poll_options: pollOptions,
      poll_closes_at: form.is_poll && form.poll_closes_at ? form.poll_closes_at.toISOString() : null,
    };
    const { error } = editing
      ? await supabase.from("notices").update(payload).eq("id", editing.id)
      : await supabase.from("notices").insert(payload);
    if (error) toast.error("Save failed");
    else { toast.success(editing ? "Updated" : (form.is_poll ? "Poll published! 📊" : "Notice published! 📋")); if (!editing) triggerConfetti("mini"); qc.invalidateQueries({ queryKey: ["admin-notices"] }); setModalOpen(false); }
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

  if (isLoading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;

  return (
    <div className="space-y-4" style={{ contain: "layout style" }}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-heading font-bold text-foreground">Manage Notices</h2>
        <Button onClick={openAdd} className="gap-1.5"><Plus className="w-4 h-4" /> Add Notice</Button>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto" style={{ contain: "layout style" }}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Category</TableHead><TableHead>Urgent</TableHead><TableHead>Published</TableHead><TableHead>Expires</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {notices.map(n => (
              <TableRow key={n.id} className={!n.is_published ? "opacity-50" : ""}>
                <TableCell className="font-medium max-w-[200px] truncate">{n.title}</TableCell>
                <TableCell>
                  {n.is_poll ? (
                    <Badge className="gap-1 bg-[hsl(258_60%_55%)]/10 text-[hsl(258_60%_45%)] hover:bg-[hsl(258_60%_55%)]/10">
                      <BarChart3 className="w-3 h-3" /> Poll · {(n.poll_options || []).reduce((s, o) => s + (o.votes || 0), 0)} votes
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Notice</span>
                  )}
                </TableCell>
                <TableCell><Badge variant="secondary" className="capitalize">{n.category}</Badge></TableCell>
                <TableCell>{n.is_urgent && <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/10">Urgent</Badge>}</TableCell>
                <TableCell>
                  <Switch checked={n.is_published} onCheckedChange={v => togglePublish.mutate({ id: n.id, val: v })} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{n.expires_at ? format(new Date(n.expires_at), "dd MMM yyyy") : "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(n.created_at), "dd MMM yyyy")}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(n)}><Pencil className="w-4 h-4" /></Button>
                  <AlertDialog><AlertDialogTrigger asChild><Button size="icon" variant="ghost" className="text-destructive"><Trash2 className="w-4 h-4" /></Button></AlertDialogTrigger>
                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete notice?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteMut.mutate(n.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent></AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? (form.is_poll ? "Edit Poll" : "Edit Notice") : "Add Notice"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {/* Poll toggle — flips the form between a regular notice and a
                WhatsApp-style single-choice poll. Kept as a toggle on the
                same form (rather than a separate "Add Poll" flow) since a
                poll IS a notice under the hood — same table, same
                publish/pin/urgent/expiry controls, just with voting fields
                attached. Locked once a poll has any votes, to avoid an admin
                accidentally turning a live poll back into a plain notice and
                silently discarding real vote data. */}
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
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 mt-1" onClick={addPollOption}>
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
                <SelectContent>{categories.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-6">
              <div className="flex items-center gap-2"><Switch checked={form.is_urgent} onCheckedChange={v => set("is_urgent", v)} /><Label>Urgent</Label></div>
              <div className="flex items-center gap-2"><Switch checked={form.is_published} onCheckedChange={v => set("is_published", v)} /><Label>Published</Label></div>
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
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminNotices;
      
