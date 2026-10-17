import { Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { HelmetProvider } from "react-helmet-async";
import { LazyMotion, domAnimation } from "framer-motion";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import OfflineBanner from "./components/shared/OfflineBanner";
import RouteLoadingFallback from "./components/shared/RouteLoadingFallback";
import RouteErrorBoundary from "./components/shared/RouteErrorBoundary";
import RouteProgressBar from "./components/shared/RouteProgressBar";
// Global MCQ-timer siren controller — fires the red flash + air-raid siren
// when the admin's MCQ timer reaches zero, NO MATTER which page the user
// is on (admin, public, auth — anywhere). See the component file for full
// design notes (background-tab handling, wake lock, mobile-locked behavior).
import McqSirenGlobalController from "./components/shared/McqSirenGlobalController";
import { usePageTracker } from "./hooks/usePageTracker";
import ScrollToTopOnNavigate from "./components/shared/ScrollToTopOnNavigate";
import CommandPalette from "./components/shared/CommandPalette";
import { PushPrompt } from "./components/shared/PushOptIn";
import SiteSchema from "./components/seo/SiteSchema";
import RouteSEOInjector from "./components/seo/RouteSEOInjector";
import AdminProtectedRoute   from "./components/layout/AdminProtectedRoute";
import { AuthProvider }      from "./contexts/AuthContext";
import { startBackgroundRoutePrefetch } from "./lib/routePrefetch";
import { restoreHomepageCache, persistHomepageCache } from "./lib/queryPersist";
import { lazyWithRetry } from "./lib/lazyWithRetry";
import Deferred from "./components/shared/Deferred";

const PageTracker = () => { usePageTracker(); return null; };

// Restores offline-cached data (notices/teachers/achievements/
// school-settings/results) from IndexedDB on cold start so
// Home, About, Contact, Notices, and Results can paint
// instantly even with no network, then keeps that cache updated in the
// background whenever fresh data arrives. Scoped to a small allow-list of
// query keys — see src/lib/queryPersist.ts.
const OfflineCacheBootstrap = ({ queryClient }: { queryClient: QueryClient }) => {
  useEffect(() => {
    restoreHomepageCache(queryClient);
    const stopPersisting = persistHomepageCache(queryClient);
    return stopPersisting;
  }, [queryClient]);
  return null;
};

// Quietly pre-loads the JS for About/Contact/Notices/Results
// AND Admission/Notes (list + subject page) once the homepage has finished
// its own work, so those pages are already cached and work offline even on
// a person's very first visit — not just after they've manually opened
// each page once while online.
//
// Uses the exact same import() calls App.tsx already uses to lazy-load
// these routes, so this is not a second/duplicate loading mechanism — it's
// just triggering the normal one early, in the background. Each import()
// is an ordinary fetch that the service worker's networkFirstAsset handler
// (see public/sw.js) caches exactly like a real visit would.
//
// Deliberately: only runs when online (no point trying while offline —
// there's nothing to fetch), waits until the browser is idle so it never
// competes with the homepage's own initial load, and silently does
// nothing on failure (this is a nice-to-have, should never visibly break anything).
//
// Notes' chapter page (./pages/notes/ChapterPage) is intentionally NOT
// prefetched here — it pulls in heavy deps (KaTeX, audio player, etc.)
// that would bloat the cache for every visitor. It gets cached on the
// user's first real visit to a chapter, which is fine because by then
// they're already invested in that subject. The subject list + subject
// page ARE prefetched, so the student can always reach a subject offline.
//
// SPEED: the route list, prioritised order, sequential downloading and
// Data-Saver/2G awareness now live in lib/routePrefetch.ts — shared with
// the navbar's intent prefetch (hover/touch starts downloading a route's
// chunk before the click even completes, so navigation feels instant on
// slow internet). See startBackgroundRoutePrefetch() there.
function prefetchOfflineRoutes() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  startBackgroundRoutePrefetch();
}

const OfflineRoutePrefetch = () => {
  useEffect(() => {
    prefetchOfflineRoutes();
  }, []);
  return null;
};

// Crash-proof route loading (retry / recovery / stale-chunk handling) lives in
// src/lib/lazyWithRetry.ts so the admin dashboard's tabs share the same logic.

const Home             = lazyWithRetry(() => import("./pages/Home"));
const About            = lazyWithRetry(() => import("./pages/About"));
const Teachers         = lazyWithRetry(() => import("./pages/Teachers"));
const Notices          = lazyWithRetry(() => import("./pages/Notices"));
const Results          = lazyWithRetry(() => import("./pages/Results"));
const Gallery          = lazyWithRetry(() => import("./pages/Gallery"));
const Library          = lazyWithRetry(() => import("./pages/Library"));
const ResultCard       = lazyWithRetry(() => import("./pages/ResultCard"));
const SignIn           = lazyWithRetry(() => import("./pages/auth/SignIn"));
const ForgotPassword   = lazyWithRetry(() => import("./pages/auth/ForgotPassword"));
const ResetPassword    = lazyWithRetry(() => import("./pages/auth/ResetPassword"));
const AuthCallback     = lazyWithRetry(() => import("./pages/auth/AuthCallback"));
const NotesPage        = lazyWithRetry(() => import("./pages/notes/NotesPage"));
const SubjectPage      = lazyWithRetry(() => import("./pages/notes/SubjectPage"));
const ChapterPage      = lazyWithRetry(() => import("./pages/notes/ChapterPage"));
const AdminDashboard   = lazyWithRetry(() => import("./pages/admin/AdminDashboard"));
const RollNoSlip       = lazyWithRetry(() => import("./pages/ExamRollNumbers"));
const NotFound         = lazyWithRetry(() => import("./pages/NotFound"));
const Admission        = lazyWithRetry(() => import("./pages/Admission"));
const DutyPage         = lazyWithRetry(() => import("./pages/Duty"));
const Search           = lazyWithRetry(() => import("./pages/Search"));
const NoticeDetail     = lazyWithRetry(() => import("./pages/NoticeDetail"));
const Contact          = lazyWithRetry(() => import("./pages/Contact"));
const FAQ              = lazyWithRetry(() => import("./pages/FAQ"));
const MeritList        = lazyWithRetry(() => import("./pages/MeritList"));

// The route-loading UI lives in src/components/shared/RouteLoadingFallback.tsx —
// it explains offline / slow-connection states instead of a bare spinner,
// and pairs with importWithRecovery() above to make slow/offline navigation
// recoverable instead of crashing into the root ErrorBoundary.

// ✅ OPTIMIZED QueryClient configuration for NO page refreshes:
//
// CRITICAL SETTINGS EXPLAINED:
// 1. refetchOnWindowFocus: false
//    - Prevents data refetching when user switches tabs or windows
//    - This was a major cause of "page feels like it refreshed" because
//      all queries would re-run and update the UI when user returned
//    - Admin dashboard especially has many queries, so tab-switching
//      caused visible flickering and form resets
//
// 2. refetchOnReconnect: false  
//    - Prevents aggressive refetching when connection restores
//    - On slow/flaky networks, this would trigger constantly
//    - User could be mid-edit when connection flickers and data refreshes
//
// 3. Increased retry counts and delays
//    - More forgiving of slow networks
//    - Won't immediately show errors on transient failures
//
// 4. structuralSharing: false
//    - Prevents reference equality issues that cause unnecessary re-renders
//    - Complex objects won't trigger cascading updates
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * 60 * 1000, // 15 minutes — data stays fresh longer
      gcTime: 60 * 60 * 1000,    // 1 hour cache — survive long editing sessions
      // CRITICAL: Don't refetch on window focus — prevents "refresh" feeling
      refetchOnWindowFocus: false,
      // CRITICAL: Don't aggressively refetch on reconnect — prevents interrupting edits
      // FIXED: was 'off', which is NOT a valid React Query v5 value (it's a
      // truthy string, so refetch-on-reconnect was actually LEFT ON — every
      // connection flicker on a slow network mass-refetched all queries and
      // interrupted edits). false is the correct "completely off" value.
      refetchOnReconnect: false,
      retry: 4,                   // More retries before showing error
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000), // Gentler backoff
      // Structural sharing disabled for complex objects to prevent reference issues
      structuralSharing: false,
      // Keep previous data while refetching — prevents UI flashes
      placeholderData: (previousData) => previousData,
    },
    mutations: {
      retry: 3,                   // More mutation retries
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // Don't throw errors immediately — let error boundaries handle gracefully
      throwOnError: false,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    {/* Global MCQ-timer siren controller. Mounted high in the tree so it
        lives for the entire app lifetime. Renders nothing — it's a
        side-effect-only component that watches localStorage and fires the
        siren + red flash overlay when the MCQ timer hits zero, regardless
        of which page the user is currently on. */}
    <Deferred><McqSirenGlobalController /></Deferred>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
        <OfflineCacheBootstrap queryClient={queryClient} />
        <OfflineRoutePrefetch />
        <LazyMotion features={domAnimation} strict>
          <Deferred><SiteSchema /></Deferred>
          <Deferred>
          <Toaster
            position="top-right"
            toastOptions={{ duration: 3000 }}
            containerStyle={{ top: 16 }}
          />
          </Deferred>
          <Deferred><OfflineBanner /></Deferred>
          {/* Slim top progress bar for in-app route transitions (chunk events).
              Mounted ABOVE the router so it can never be unmounted by the
              Suspense fallback or a route swap. */}
          <Deferred><RouteProgressBar /></Deferred>
          <BrowserRouter
            future={{
              // ✅ THE CORE FIX for "whole page reloads on slow internet":
              //
              // Route updates are wrapped in React.startTransition, which means
              // when the user taps a link whose page chunk hasn't downloaded yet,
              // React KEEPS THE CURRENT PAGE fully visible and interactive while
              // the chunk arrives — it no longer unmounts the whole app into the
              // white full-screen RouteLoadingFallback (the "fake reload" users
              // saw on slow connections; that fallback now only appears on the
              // very first document load, where there is genuinely nothing else
              // to show). The finished page swaps in the moment it's ready —
              // same-document navigation, zero reloads, zero lost context.
              v7_startTransition: true,
            }}
          >
            <ScrollToTopOnNavigate />
            <PageTracker />
            <Deferred><RouteSEOInjector /></Deferred>
            {/* ⌘K / Ctrl+K command palette — global, works from any route.
                Mounted once here (not per-page) so its open state and
                localStorage-backed recent searches persist across
                navigation. */}
            <Deferred><CommandPalette /></Deferred>
            {/* Web Push: gentle opt-in prompt + daily subscription refresh. */}
            <Deferred><PushPrompt /></Deferred>
            {/* (Lantern Mode · Hujra ambience layer removed along with the
                lantern theme — the site ships System/Bright + Dark only.) */}
            {/* Academic Universe (3D WebGL background) removed — it was
                causing CPU hangs/stuttering on public pages. Component
                files left on disk; see chat for deletion locations. */}
            <RouteErrorBoundary>
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/"                     element={<Home />} />
                <Route path="/about"                element={<About />} />
                <Route path="/contact"              element={<Contact />} />
                <Route path="/teachers"             element={<Teachers />} />
                <Route path="/notices"              element={<Notices />} />
                <Route path="/notices/:id"          element={<NoticeDetail />} />
                <Route path="/search"               element={<Search />} />
                <Route path="/results"              element={<Results />} />
                <Route path="/merit-list"           element={<MeritList />} />
                <Route path="/result-card"          element={<ResultCard />} />
                <Route path="/gallery"              element={<Gallery />} />
                <Route path="/library"              element={<Library />} />
                <Route path="/auth/signin"          element={<SignIn />} />
                <Route path="/auth/forgot-password" element={<ForgotPassword />} />
                <Route path="/auth/reset-password"  element={<ResetPassword />} />
                <Route path="/auth/callback"         element={<AuthCallback />} />
                <Route
                  path="/admin"
                  element={
                    <AdminProtectedRoute>
                      <AdminDashboard />
                    </AdminProtectedRoute>
                  }
                />
                <Route path="/roll-no-slip"            element={<RollNoSlip />} />
                <Route path="/admission"               element={<Admission />} />
                <Route path="/faq"                    element={<FAQ />} />
                <Route path="/duty"                    element={<DutyPage />} />
                <Route path="/notes"                   element={<NotesPage />} />
                <Route path="/notes/:subject"          element={<SubjectPage />} />
                <Route path="/notes/:subject/:chapter" element={<ChapterPage />} />
                <Route path="*"                        element={<NotFound />} />
              </Routes>
            </Suspense>
            </RouteErrorBoundary>
          </BrowserRouter>
        </LazyMotion>
        </AuthProvider>
      </QueryClientProvider>
    </HelmetProvider>
  </ErrorBoundary>
);

export default App;
