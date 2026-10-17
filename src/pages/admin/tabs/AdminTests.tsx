import { useState, useRef } from "react";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Eye, ToggleLeft, ToggleRight, Upload, Download, ArrowLeft, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  useAdminTests, useTestQuestions, useTestAttempts, useTestMutations,
  Test, TestQuestion, TestFormData, QuestionFormData, getGrade, formatTimeTaken
} from "@/hooks/useTests";

// ─── Main Component ──────────────────────────────────────────────────
const AdminTests = () => {
  const [view, setView] = useState<"list" | "questions" | "results">("list");
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);

  if (view === "questions" && selectedTest) {
    return <QuestionsManager test={selectedTest} onBack={() => setView("list")} />;
  }
  if (view === "results" && selectedTest) {
    return <ResultsView test={selectedTest} onBack={() => setView("list")} />;
  }

  return (
    <TestList
      onManageQuestions={(t) => { setSelectedTest(t); setView("questions"); }}
      onViewResults={(t) => { setSelectedTest(t); setView("results"); }}
    />
  );
};

export default AdminTests;

// ─── Test List ───────────────────────────────────────────────────────
function TestList({ onManageQuestions, onViewResults }: { onManageQuestions: (t: Test) => void; onViewResults: (t: Test) => void }) {
  const { data: tests, isLoading } = useAdminTests();
  const { createTest, updateTest, deleteTest, togglePublish } = useTestMutations();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Test | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState<TestFormData>({ title: "", subject: "", type: "weekly", description: "", time_per_question: 15 });
  const [deleteTarget, setDeleteTarget] = useState<Test | null>(null);

  const openCreate = () => { setEditing(null); setForm({ title: "", subject: "", type: "weekly", description: "", time_per_question: 15 }); setModalOpen(true); };
  const openEdit = (t: Test) => { setEditing(t); setForm({ title: t.title, subject: t.subject, type: t.type, description: t.description || "", time_per_question: t.time_per_question }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.title.trim() || !form.subject.trim()) { toast.error("Title and Subject are required"); return; }
    try {
      if (editing) { await updateTest.mutateAsync({ ...form, id: editing.id }); toast.success("Test updated"); }
      else { await createTest.mutateAsync(form); toast.success("Test created"); }
      setModalOpen(false);
    } catch { toast.error("Failed to save test"); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try { await deleteTest.mutateAsync(deleteTarget.id); toast.success("Test deleted"); }
    catch { toast.error("Failed to delete"); }
    finally { setDeleteTarget(null); }
  };

  const handleToggle = async (t: Test) => {
    try { await togglePublish.mutateAsync({ id: t.id, is_published: !t.is_published }); toast.success(t.is_published ? "Unpublished" : "Published"); }
    catch { toast.error("Failed to toggle"); }
  };

  const filtered = (tests || []).filter((t) => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (filterStatus === "published" && !t.is_published) return false;
    if (filterStatus === "draft" && t.is_published) return false;
    return true;
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-heading font-bold text-foreground">MCQ Tests</h2>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" /> Create Test</Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/50">
                <th className="text-left p-3 font-medium">Title</th>
                <th className="text-left p-3 font-medium">Subject</th>
                <th className="text-left p-3 font-medium">Type</th>
                <th className="text-center p-3 font-medium">Questions</th>
                <th className="text-center p-3 font-medium">Status</th>
                <th className="text-right p-3 font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No tests found</td></tr>}
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-medium text-foreground">{t.title}</td>
                    <td className="p-3 text-muted-foreground">{t.subject}</td>
                    <td className="p-3"><Badge variant={t.type === "weekly" ? "default" : "secondary"} className="capitalize">{t.type}</Badge></td>
                    <td className="p-3 text-center">{t.question_count || 0}</td>
                    <td className="p-3 text-center"><Badge variant={t.is_published ? "default" : "outline"}>{t.is_published ? "Published" : "Draft"}</Badge></td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)} title="Edit"><Edit className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => onManageQuestions(t)} title="Questions"><Plus className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => onViewResults(t)} title="Results"><Eye className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => handleToggle(t)} title={t.is_published ? "Unpublish" : "Publish"}>
                          {t.is_published ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(t)} title="Delete"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Test" : "Create Test"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Test Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Week 3 English Test" /></div>
            <div><Label>Subject *</Label><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="English, Maths, Science..." /></div>
            <div><Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "weekly" | "monthly" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" /></div>
            <div><Label>Time per Question (seconds)</Label><Input type="number" min={5} max={120} value={form.time_per_question} onChange={(e) => setForm({ ...form, time_per_question: Math.max(5, Math.min(120, Number(e.target.value))) })} /></div>
            <Button onClick={handleSave} className="w-full" disabled={createTest.isPending || updateTest.isPending}>
              {(createTest.isPending || updateTest.isPending) ? "Saving..." : "Save Test"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Questions Manager ───────────────────────────────────────────────
function QuestionsManager({ test, onBack }: { test: Test; onBack: () => void }) {
  const { data: questions, isLoading } = useTestQuestions(test.id);
  const { addQuestion, deleteQuestion, updateQuestion, bulkInsertQuestions } = useTestMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<QuestionFormData>({ question_text: "", option_a: "", option_b: "", option_c: "", option_d: "", correct_option: "A" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<QuestionFormData>({ question_text: "", option_a: "", option_b: "", option_c: "", option_d: "", correct_option: "A" });

  const handleAdd = async () => {
    if (!form.question_text.trim() || !form.option_a.trim() || !form.option_b.trim() || !form.option_c.trim() || !form.option_d.trim()) {
      toast.error("Fill all fields"); return;
    }
    try {
      await addQuestion.mutateAsync({ testId: test.id, question: form, orderNumber: (questions?.length || 0) + 1 });
      setForm({ question_text: "", option_a: "", option_b: "", option_c: "", option_d: "", correct_option: "A" });
      toast.success("Question added");
    } catch { toast.error("Failed to add question"); }
  };

  const [deleteQId, setDeleteQId] = useState<string | null>(null);

  const confirmDeleteQuestion = async () => {
    if (!deleteQId) return;
    try { await deleteQuestion.mutateAsync(deleteQId); toast.success("Question deleted"); } catch { toast.error("Failed"); }
    finally { setDeleteQId(null); }
  };

  const handleUpdate = async (id: string) => {
    try { await updateQuestion.mutateAsync({ id, ...editForm }); setEditingId(null); toast.success("Updated"); } catch { toast.error("Failed"); }
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      const validOpts = ["A", "B", "C", "D"];
      const toInsert: (QuestionFormData & { order_number: number })[] = [];
      let skipped = 0;
      const startOrder = (questions?.length || 0) + 1;
      lines.forEach((line, i) => {
        if (i === 0 && line.toLowerCase().includes("question")) return; // skip header
        const parts = line.split(",").map((p) => p.trim());
        if (parts.length < 6) { skipped++; return; }
        const [question_text, option_a, option_b, option_c, option_d, correct_option] = parts;
        if (!question_text || !option_a || !option_b || !option_c || !option_d || !validOpts.includes(correct_option.toUpperCase())) { skipped++; return; }
        toInsert.push({ question_text, option_a, option_b, option_c, option_d, correct_option: correct_option.toUpperCase() as "A" | "B" | "C" | "D", order_number: startOrder + toInsert.length });
      });
      if (toInsert.length > 0) {
        try {
          await bulkInsertQuestions.mutateAsync({ testId: test.id, questions: toInsert });
          toast.success(`✅ ${toInsert.length} questions imported, ${skipped} skipped`);
        } catch { toast.error("Import failed"); }
      } else {
        toast.error(`No valid questions found. ${skipped} rows skipped.`);
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const csv = `question,option_a,option_b,option_c,option_d,correct_option\nWhat is 2+2?,3,4,5,6,B\nCapital of Pakistan?,Lahore,Islamabad,Karachi,Peshawar,B\nWhich planet is nearest to the Sun?,Venus,Earth,Mercury,Mars,C`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "mcq_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <div>
          <h2 className="text-xl font-heading font-bold text-foreground">Questions — {test.title}</h2>
          <p className="text-sm text-muted-foreground">{questions?.length || 0} questions added</p>
        </div>
      </div>

      {/* Add Question Form */}
      <Card>
        <CardHeader><CardTitle className="text-base">Add Question</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Textarea placeholder="Question text" value={form.question_text} onChange={(e) => setForm({ ...form, question_text: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Option A" value={form.option_a} onChange={(e) => setForm({ ...form, option_a: e.target.value })} />
            <Input placeholder="Option B" value={form.option_b} onChange={(e) => setForm({ ...form, option_b: e.target.value })} />
            <Input placeholder="Option C" value={form.option_c} onChange={(e) => setForm({ ...form, option_c: e.target.value })} />
            <Input placeholder="Option D" value={form.option_d} onChange={(e) => setForm({ ...form, option_d: e.target.value })} />
          </div>
          <div>
            <Label className="mb-2 block">Correct Answer</Label>
            <div className="flex gap-3">
              {(["A", "B", "C", "D"] as const).map((opt) => (
                <button key={opt} onClick={() => setForm({ ...form, correct_option: opt })}
                  className={`w-10 h-10 rounded-lg font-bold text-sm border-2 transition-colors ${form.correct_option === opt ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleAdd} disabled={addQuestion.isPending}>{addQuestion.isPending ? "Adding..." : "Add Question"}</Button>
        </CardContent>
      </Card>

      {/* CSV Import */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4 mr-1" /> Import CSV</Button>
          <Button variant="outline" onClick={downloadTemplate}><Download className="w-4 h-4 mr-1" /> Download Template</Button>
        </CardContent>
      </Card>

      {/* Questions List */}
      {isLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="space-y-3">
          {(questions || []).map((q, i) => (
            <Card key={q.id}>
              <CardContent className="p-4">
                {editingId === q.id ? (
                  <div className="space-y-3">
                    <Textarea value={editForm.question_text} onChange={(e) => setEditForm({ ...editForm, question_text: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={editForm.option_a} onChange={(e) => setEditForm({ ...editForm, option_a: e.target.value })} />
                      <Input value={editForm.option_b} onChange={(e) => setEditForm({ ...editForm, option_b: e.target.value })} />
                      <Input value={editForm.option_c} onChange={(e) => setEditForm({ ...editForm, option_c: e.target.value })} />
                      <Input value={editForm.option_d} onChange={(e) => setEditForm({ ...editForm, option_d: e.target.value })} />
                    </div>
                    <div className="flex gap-2">
                      {(["A", "B", "C", "D"] as const).map((o) => (
                        <button key={o} onClick={() => setEditForm({ ...editForm, correct_option: o })}
                          className={`w-8 h-8 rounded font-bold text-xs border-2 ${editForm.correct_option === o ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{o}</button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleUpdate(q.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <GripVertical className="w-4 h-4 mt-1 text-muted-foreground shrink-0 cursor-grab" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground mb-2"><span className="text-primary font-bold mr-2">Q{i + 1}.</span>{q.question_text}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
                        {(["A", "B", "C", "D"] as const).map((opt) => {
                          const val = q[`option_${opt.toLowerCase()}` as keyof TestQuestion] as string;
                          const isCorrect = q.correct_option === opt;
                          return (
                            <div key={opt} className={`px-3 py-1.5 rounded-md ${isCorrect ? "bg-primary/10 text-primary font-semibold border border-primary/30" : "bg-muted/50 text-muted-foreground"}`}>
                              <span className="font-bold mr-2">{opt}.</span>{val}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => { setEditingId(q.id); setEditForm({ question_text: q.question_text, option_a: q.option_a, option_b: q.option_b, option_c: q.option_c, option_d: q.option_d, correct_option: q.correct_option }); }}><Edit className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteQId(q.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {/* Delete Question Confirmation */}
      <AlertDialog open={!!deleteQId} onOpenChange={(o) => !o && setDeleteQId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Question</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this question? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteQuestion} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Results View ────────────────────────────────────────────────────
function ResultsView({ test, onBack }: { test: Test; onBack: () => void }) {
  const { data: attempts, isLoading } = useTestAttempts(test.id);

  const stats = (() => {
    if (!attempts || attempts.length === 0) return { total: 0, avg: 0, highest: 0, passRate: 0 };
    const total = attempts.length;
    const avg = Math.round(attempts.reduce((s, a) => s + a.percentage, 0) / total);
    const highest = Math.max(...attempts.map((a) => a.percentage));
    const passRate = Math.round((attempts.filter((a) => a.percentage >= 50).length / total) * 100);
    return { total, avg, highest, passRate };
  })();

  const exportCSV = () => {
    if (!attempts) return;
    const rows = [["Rank", "Name", "Class", "Roll No", "Score", "Percentage", "Grade", "Time Taken", "Completed"]];
    attempts.forEach((a, i) => rows.push([
      String(i + 1), a.student_name, a.student_class || "", a.roll_number || "",
      `${a.score}/${a.total_questions}`, `${a.percentage}%`, getGrade(a.percentage),
      formatTimeTaken(a.time_taken), new Date(a.completed_at).toLocaleDateString()
    ]));
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${test.title}_results.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
        <div>
          <h2 className="text-xl font-heading font-bold text-foreground">Results — {test.title}</h2>
          <p className="text-sm text-muted-foreground">{test.subject} · {test.type}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Attempts", value: stats.total },
          { label: "Average Score", value: `${stats.avg}%` },
          { label: "Highest Score", value: `${stats.highest}%` },
          { label: "Pass Rate", value: `${stats.passRate}%` },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Leaderboard</CardTitle>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/50">
                <th className="p-3 text-left font-medium">Rank</th>
                <th className="p-3 text-left font-medium">Name</th>
                <th className="p-3 text-left font-medium">Class</th>
                <th className="p-3 text-left font-medium">Roll No</th>
                <th className="p-3 text-center font-medium">Score</th>
                <th className="p-3 text-center font-medium">%</th>
                <th className="p-3 text-center font-medium">Grade</th>
                <th className="p-3 text-right font-medium">Time</th>
              </tr></thead>
              <tbody>
                {(attempts || []).map((a, i) => {
                  const pct = a.percentage;
                  const rowClass = pct >= 80 ? "bg-primary/5" : pct >= 50 ? "bg-blue-500/5" : "bg-destructive/5";
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1);
                  return (
                    <tr key={a.id} className={`border-b border-border ${rowClass}`}>
                      <td className="p-3 font-bold">{medal}</td>
                      <td className="p-3 font-medium text-foreground">{a.student_name}</td>
                      <td className="p-3 text-muted-foreground">{a.student_class || "—"}</td>
                      <td className="p-3 text-muted-foreground">{a.roll_number || "—"}</td>
                      <td className="p-3 text-center">{a.score}/{a.total_questions}</td>
                      <td className="p-3 text-center font-semibold">{pct}%</td>
                      <td className="p-3 text-center"><Badge variant={pct >= 50 ? "default" : "destructive"}>{getGrade(pct)}</Badge></td>
                      <td className="p-3 text-right text-muted-foreground">{formatTimeTaken(a.time_taken)}</td>
                    </tr>
                  );
                })}
                {(!attempts || attempts.length === 0) && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No attempts yet</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
    }
