// src/pages/admin/tabs/AdminExtras.tsx
// Manages: Users (admin accounts).
//
// NOTE: this tab used to also manage Daily Quotes and Honor Roll. Both
// were removed completely per request:
//   - Daily Quotes is now a fixed, static rotating list rendered directly
//     in DailyQuoteCard.tsx (no admin control panel, no database table).
//   - Honor Roll was removed from the homepage and has no admin UI here.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, Plus, Loader2, ShieldCheck, User as UserIcon, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

// ─── Admin list (read-only view of everyone with role = "admin") ─────────────

interface AdminProfile {
  id: string;
  full_name: string | null;
  created_at: string;
}

// The `profiles` table (as used everywhere else in this app — see
// AuthContext's Profile type) does not store email; email only lives on
// Supabase's own `auth.users`, which the browser can't query directly with
// the anon key. So this list shows each admin's name (from `profiles`) —
// email isn't shown here unless a `profiles.email` column is added and kept
// in sync separately.
function useAdminUsers() {
  return useQuery({
    queryKey: ["admin-users-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, created_at")
        .eq("role", "admin")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as AdminProfile[];
    },
  });
}

// ─── Add Admin dialog ─────────────────────────────────────────────────────────

function AddAdminDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => { setFullName(""); setEmail(""); setPassword(""); };

  const handleCreate = async () => {
    if (!fullName.trim() || !email.trim() || !password) {
      toast.error("Name, email, and password are all required.");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        toast.error("Your session expired — please sign in again.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/admin-create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "create", email: email.trim(), password, full_name: fullName.trim() }),
      });

      const result = await res.json();
      if (!res.ok) {
        toast.error(result?.error || "Could not create the admin account.");
        setSaving(false);
        return;
      }

      toast.success(`Admin account created for ${email.trim()}. They can sign in now.`);
      reset();
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error("Network error — could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Admin</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Admin Name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1">
            <Label>Email *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
          </div>
          <div className="space-y-1">
            <Label>Password *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            <p className="text-xs text-muted-foreground">The new admin will sign in with this email and password right away — no email verification step.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Create Admin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete helper ─────────────────────────────────────────────────────────

async function deleteAdmin(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return { ok: false, error: "Your session expired — please sign in again." };

  try {
    const res = await fetch("/api/admin-create-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "delete", id }),
    });
    const result = await res.json();
    if (!res.ok) return { ok: false, error: result?.error || "Could not delete this admin." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error — could not reach the server." };
  }
}

// ─── Users Manager ─────────────────────────────────────────────────────────────

function UsersManager() {
  const [open, setOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { data: admins, isLoading, error, refetch } = useAdminUsers();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const result = await deleteAdmin(id);
    setDeletingId(null);
    if (!result.ok) {
      toast.error(result.error || "Could not delete this admin.");
      return;
    }
    toast.success("Admin account deleted completely.");
    refetch();
    queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
            <UserCog className="w-5 h-5" /> Admin Users
          </h3>
          <p className="text-sm text-muted-foreground">Everyone registered as an admin on this website.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add User
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading admins…
        </div>
      )}

      {!!error && !isLoading && (
        <Card><CardContent className="p-4 text-sm text-destructive">
          Could not load the admin list. Please check your connection and try again.
        </CardContent></Card>
      )}

      {!isLoading && !error && (
        <div className="grid gap-2">
          {(admins || []).map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground truncate flex items-center gap-1">
                      <UserIcon className="w-3.5 h-3.5 text-muted-foreground" /> {a.full_name || "Unnamed Admin"}
                    </p>
                    <Badge variant="outline" className="text-[10px]">Admin</Badge>
                    {a.id === user?.id && (
                      <Badge className="text-[10px] bg-primary/10 text-primary">You</Badge>
                    )}
                  </div>
                </div>
                {a.id !== user?.id && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive shrink-0" disabled={deletingId === a.id}>
                        {deletingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this admin completely?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes <strong>{a.full_name || "this admin"}</strong>'s login and profile. They will no longer be able to sign in. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(a.id)} className="bg-destructive text-destructive-foreground">
                          Delete Completely
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardContent>
            </Card>
          ))}

          {(admins || []).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No admin users found yet.
            </div>
          )}
        </div>
      )}

      <AddAdminDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["admin-users-list"] }); }}
      />
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const AdminExtras = () => (
  <div className="space-y-5">
    <div>
      <h2 className="text-xl font-heading font-bold text-foreground">Extras Management</h2>
      <p className="text-sm text-muted-foreground">Admin users</p>
    </div>
    <UsersManager />
  </div>
);

export default AdminExtras;
