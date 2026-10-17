import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, Trash2, Loader2, Users, ShieldCheck, Phone, UserCog } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";

// ─── UserAvatar (extracted to avoid hook-in-loop) ──────────────────────
function UserAvatar({ imgUrl, fullName }: { imgUrl: string | null; fullName: string }) {
  const [imgError, setImgError] = useState(false);
  return imgUrl && !imgError ? (
    <img src={imgUrl} alt={`${fullName}'s avatar`} className="w-10 h-10 rounded-full object-cover ring-1 ring-border shrink-0" onError={() => setImgError(true)} loading="lazy" decoding="async" />
  ) : (
    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary ring-1 ring-border flex items-center justify-center text-sm font-semibold shrink-0">
      {fullName.charAt(0).toUpperCase()}
    </div>
  );
}

interface UserProfile {
  id: string;
  full_name: string | null;
  role: string;
  class: string | null;
  phone: string | null;
  roll_number: string | null;
  avatar_url: string | null;
  created_at: string;
}

// This screen manages ADMINISTRATORS only. Every account added here is an
// admin, and only admin accounts are listed — students and teachers are not
// managed from here (students sign up / are handled elsewhere).
const ADMIN_ROLE = "admin";

const AdminUsers = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  // Add user modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    full_name: "",
    email: "",
    password: "",
    phone: "",
  });
  const [adding, setAdding] = useState(false);

  // ── Fetch administrators only (rejected accounts excluded) ──
  const { data: users = [], isLoading } = useQuery<UserProfile[]>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("role", ADMIN_ROLE)
        // CRITICAL FIX: Exclude 'rejected' status users from main view!
        // Rejected users should have their auth account deleted via Pending Requests tab.
        // If they still exist (fallback case), hide them here.
        .not("status", "eq", "rejected")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Delete user ──────────────────────────────────────────────────────────
  // Calls the admin_delete_user RPC which deletes from auth.users (cascades
  // to profiles). This frees up the email for re-registration.
  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_delete_user", { target_user_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User permanently deleted — email is now free for re-registration");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-teachers"] });
      qc.invalidateQueries({ queryKey: ["admin-pending-users"] });
    },
    onError: (err: any) => {
      // Surface the actual error message — could be "Permission denied",
      // "Cannot delete your own account", or a missing-function error.
      const msg = err?.message || "Delete failed";
      toast.error(`Delete failed: ${msg}`, { duration: 6000 });
    },
  });

  // ── Add new administrator ────────────────────────────────────────────────
  // IMPORTANT: the account is created with a TEMPORARY, non-persistent
  // Supabase client. Calling supabase.auth.signUp() on the main client
  // signs the browser into the newly created account (replacing the current
  // admin's session) — that was the "I get logged in as the user I just
  // added" bug. The throwaway client never touches the stored session, so
  // the current admin stays logged in. The profile is then promoted with the
  // admin's own (main) client, which is allowed to update profiles.
  const handleAddUser = async () => {
    const fullName = addForm.full_name.trim();
    const email = addForm.email.trim();
    if (!fullName || !email || !addForm.password.trim()) {
      toast.error("Name, email, and password are required");
      return;
    }
    if (addForm.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setAdding(true);
    try {
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const tempClient = createClient(url, anon, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: `ghs-admin-create-${Date.now()}`,
        },
      });

      const { data, error } = await tempClient.auth.signUp({
        email,
        password: addForm.password,
        options: { data: { full_name: fullName } },
      });

      if (error) {
        toast.error(`Failed: ${error.message}`);
        return;
      }
      // Supabase returns a user with no identities (instead of an error)
      // when the email is already registered.
      if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
        toast.error("This email is already registered");
        return;
      }

      // Wait for the profile row (created by the DB trigger), then promote it
      // to an approved admin using the CURRENT admin's session.
      let promoted = false;
      let lastMsg = "";
      for (let attempt = 0; attempt < 6 && !promoted; attempt++) {
        await new Promise(r => setTimeout(r, attempt === 0 ? 700 : 600));
        const { data: rows, error: updateError } = await supabase
          .from("profiles")
          .update({
            full_name: fullName,
            role: ADMIN_ROLE,
            phone: addForm.phone.trim() || null,
            status: "approved",
          })
          .eq("id", data.user.id)
          .select("id");
        if (updateError) lastMsg = updateError.message;
        else if (rows && rows.length > 0) promoted = true;
      }

      if (!promoted) {
        toast.error(
          `Account created, but it could not be made an admin${lastMsg ? `: ${lastMsg}` : ""}. Refresh and check the list.`,
          { duration: 7000 }
        );
      } else {
        toast.success(`✅ Admin "${fullName}" added — you are still logged in as yourself`);
        setAddOpen(false);
        setAddForm({ full_name: "", email: "", password: "", phone: "" });
      }
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(err?.message || "Something went wrong");
    } finally {
      setAdding(false);
    }
  };

  // ── Filter admins by search ──────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase();
    return !q ||
      u.full_name?.toLowerCase().includes(q) ||
      u.phone?.includes(search.trim());
  });

  const adminBadge = (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
      <ShieldCheck className="w-3 h-3" /> Admin
    </span>
  );

  const youPill = (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">You</span>
  );

  const renderRemove = (u: UserProfile) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive" aria-label="Remove admin">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {u.full_name || "this admin"}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will <strong>permanently delete</strong> {u.full_name || "this admin"}'s account completely. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteUser.mutate(u.id)}
            className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold text-destructive-foreground shadow-none hover:bg-destructive/90 sm:flex-none"
          >
            Remove Admin
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="space-y-4 pb-20 md:pb-0">

      {/* ── Premium header + action toolbar ────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <UserCog className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Manage Admins</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              <span className="font-semibold text-foreground">{users.length}</span> administrator{users.length === 1 ? "" : "s"} · add or remove admin accounts
            </p>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button onClick={() => setAddOpen(true)} className="col-span-2 h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:col-span-1">
            <Plus className="h-3.5 w-3.5 shrink-0" /> Add Admin
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search name or phone"
          className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card py-12 text-center">
          <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-semibold text-sm text-foreground">No admins found</p>
          <p className="text-xs text-muted-foreground mt-1">Try a different search or add a new admin</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map(u => {
              const isSelf = u.id === user?.id;
              return (
                <div key={u.id} className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <UserAvatar imgUrl={u.avatar_url} fullName={u.full_name || "User"} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-foreground leading-snug break-words">{u.full_name || "—"}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {adminBadge}
                        {isSelf && youPill}
                      </div>
                    </div>
                    {!isSelf && renderRemove(u)}
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-border/70 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{u.phone || "No phone"}</span>
                    <span>Joined {format(new Date(u.created_at), "dd MMM yyyy")}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5">Admin</th>
                  <th className="text-left px-3 py-2.5">Role</th>
                  <th className="text-left px-3 py-2.5">Phone</th>
                  <th className="text-left px-3 py-2.5">Joined</th>
                  <th className="w-16 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="border-t border-border/50 transition-colors hover:bg-primary/5">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar imgUrl={u.avatar_url} fullName={u.full_name || "User"} />
                          <span className="font-medium text-foreground">{u.full_name || "—"}</span>
                          {isSelf && youPill}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">{adminBadge}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{u.phone || "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(u.created_at), "dd MMM yyyy")}</td>
                      <td className="px-3 py-2.5"><div className="flex justify-end">{!isSelf && renderRemove(u)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}

      {/* Count */}
      <p className="text-[11px] text-muted-foreground text-center">
        Showing {filtered.length} of {users.length} admins
      </p>

      {/* Add User Modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 gap-3">
          <DialogHeader>
            <DialogTitle className="text-base">Add New Admin</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Full Name *</Label>
              <Input
                className="h-9 text-sm mt-1"
                value={addForm.full_name}
                onChange={e => setAddForm(p => ({ ...p, full_name: e.target.value }))}
                placeholder="Admin full name"
              />
            </div>
            <div>
              <Label className="text-xs">Email *</Label>
              <Input
                className="h-9 text-sm mt-1"
                type="email"
                value={addForm.email}
                onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))}
                placeholder="admin@gmail.com"
              />
            </div>
            <div>
              <Label className="text-xs">Password * (min 6 characters)</Label>
              <Input
                className="h-9 text-sm mt-1"
                type="password"
                value={addForm.password}
                onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input
                className="h-9 text-sm mt-1"
                value={addForm.phone}
                onChange={e => setAddForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="0300-0000000"
              />
            </div>
            <p className="text-[11px] text-muted-foreground rounded-xl bg-secondary/40 border border-border px-3 py-2 leading-relaxed">
              Role: <strong>Administrator</strong> (automatic). You will stay logged in to your own account.
            </p>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" className="h-9 min-w-0 flex-1 whitespace-nowrap rounded-full border-border/60 px-4 text-xs font-semibold shadow-none sm:flex-none" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={adding} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:flex-none">
              {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {adding ? "Adding..." : "Add Admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
