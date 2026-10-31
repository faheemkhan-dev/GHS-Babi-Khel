// src/hooks/usePageTracker.ts
//
// Public-site pageview tracking via Plausible only (privacy-friendly, no
// cookies). The old Supabase `site_visits` logging that fed the admin
// "Site Analytics" tab has been removed.
//
// SAFE: tracking never breaks the page.

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePlausible } from "./usePlausible";

export function usePageTracker() {
  const location    = useLocation();
  const lastTracked = useRef<string>("");
  const { trackEvent } = usePlausible();

  useEffect(() => {
    const path = location.pathname;
    if (lastTracked.current === path) return;
    lastTracked.current = path;
    // Skip the admin panel
    if (path.startsWith("/admin")) return;
    trackEvent("pageview");
  }, [location.pathname, trackEvent]);
}
