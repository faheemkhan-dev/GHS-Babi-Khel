/**
 * useAuth — re-exported from AuthContext.
 *
 * All components that import { useAuth } from "@/hooks/useAuth" will now
 * consume the single shared AuthContext instead of each spinning up their
 * own Supabase session listener. This fixes:
 *
 *  1. Refresh → redirect to sign-in:
 *     Previously every ProtectedRoute called useAuth() independently.
 *     On refresh, each instance briefly had loading=false + user=null
 *     before Supabase resolved, causing an immediate Navigate to /sign-in.
 *     Now there is ONE loading state at the top of the tree — protected
 *     routes always wait for it before making any redirect decision.
 *
 *  2. Back button → dashboard disappears:
 *     Previously DashboardLayout and ProtectedRoute had separate auth
 *     instances that could get out of sync after navigation. With a shared
 *     context they always read the same state.
 *
 * The Profile interface is also re-exported so existing imports don't break.
 */
export type { Profile } from "@/contexts/AuthContext";
export { useAuth } from "@/contexts/AuthContext";
