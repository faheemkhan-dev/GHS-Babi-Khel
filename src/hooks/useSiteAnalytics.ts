// src/hooks/useSiteAnalytics.ts
//
// Site Analytics data hook — queries the site_visits Supabase table
// to provide visitor metrics, page views, device breakdowns, referrers,
// and trend data for the admin Site Analytics dashboard.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AnalyticsPeriod = 1 | 7 | 15 | 30;

export interface VisitorSummary {
  totalVisits: number;
  uniqueVisitors: number;      // unique session_ids
  uniqueUsers: number;          // logged-in users
  avgDailyVisits: number;
  peakDay: { date: string; visits: number } | null;
  peakHour: number | null;      // 0-23
  mobileVisits: number;
  desktopVisits: number;
  tabletVisits: number;
  bounceRate: number;           // sessions with only 1 page view
  avgPagesPerSession: number;
  returningVisitors: number;    // sessions with >1 page view
}

export interface DailyVisit {
  date: string;        // "2026-06-10"
  visits: number;
  uniqueVisitors: number;
  label: string;       // "Jun 10"
}

export interface HourlyVisit {
  hour: number;        // 0-23
  label: string;       // "12 AM", "1 AM", etc.
  visits: number;
}

export interface PageVisit {
  page: string;
  visits: number;
  uniqueVisitors: number;
}

export interface DeviceBreakdown {
  device: string;
  count: number;
  percentage: number;
}

export interface ReferrerEntry {
  referrer: string;
  visits: number;
}

export interface CountryVisit {
  country: string;
  visits: number;
}

export interface SiteAnalyticsData {
  summary: VisitorSummary;
  dailyTrend: DailyVisit[];
  hourlyDistribution: HourlyVisit[];
  topPages: PageVisit[];
  deviceBreakdown: DeviceBreakdown[];
  topReferrers: ReferrerEntry[];
  comparison: {
    visitsChange: number;     // percentage change vs previous period
    uniqueChange: number;
    bounceChange: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const HOUR_LABELS = ["12 AM","1 AM","2 AM","3 AM","4 AM","5 AM","6 AM","7 AM","8 AM","9 AM","10 AM","11 AM",
  "12 PM","1 PM","2 PM","3 PM","4 PM","5 PM","6 PM","7 PM","8 PM","9 PM","10 PM","11 PM"];

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function getDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// Supabase/PostgREST caps unbounded selects at 1000 rows by default.
// This helper pages through with .range() until all matching rows are fetched,
// so counts stay accurate even once traffic exceeds 1000 rows in a period.
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000
): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    all = all.concat(batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// ─── Main Hook ──────────────────────────────────────────────────────────────

export function useSiteAnalytics(period: AnalyticsPeriod = 7) {
  return useQuery<SiteAnalyticsData>({
    queryKey: ["site-analytics", period],
    queryFn: async () => {
      const startDate = getDaysAgo(period);
      const prevStartDate = getDaysAgo(period * 2);

      // Fetch current period data (paginated past Supabase's 1000-row default cap)
      type Record = {
        page: string; referrer: string | null; user_agent: string | null;
        device_type: string | null; session_id: string; user_id: string | null; created_at: string;
      };
      const records = await fetchAllRows<Record>((from, to) =>
        supabase
          .from("site_visits")
          .select("page, referrer, user_agent, device_type, session_id, user_id, created_at")
          .gte("created_at", startDate)
          .order("created_at", { ascending: true })
          .range(from, to)
      );

      // Fetch previous period data for comparison (also paginated)
      type PrevRecord = { session_id: string; created_at: string };
      const prevRecords = await fetchAllRows<PrevRecord>((from, to) =>
        supabase
          .from("site_visits")
          .select("session_id, created_at")
          .gte("created_at", prevStartDate)
          .lt("created_at", startDate)
          .range(from, to)
      );

      // ── Summary ──
      const totalVisits = records.length;
      const uniqueSessions = new Set(records.map(r => r.session_id)).size;
      const uniqueUsers = new Set(records.filter(r => r.user_id).map(r => r.user_id)).size;
      const avgDailyVisits = period > 0 ? Math.round(totalVisits / period) : 0;

      // Peak day
      const dayMap = new Map<string, number>();
      records.forEach(r => {
        const day = (r.created_at || "").slice(0, 10);
        if (day) dayMap.set(day, (dayMap.get(day) || 0) + 1);
      });
      let peakDay: { date: string; visits: number } | null = null;
      dayMap.forEach((visits, date) => {
        if (!peakDay || visits > peakDay.visits) peakDay = { date, visits };
      });

      // Peak hour
      const hourMap = new Map<number, number>();
      records.forEach(r => {
        if (r.created_at) {
          const h = new Date(r.created_at).getHours();
          hourMap.set(h, (hourMap.get(h) || 0) + 1);
        }
      });
      let peakHour: number | null = null;
      let peakHourCount = 0;
      hourMap.forEach((count, hour) => {
        if (count > peakHourCount) { peakHourCount = count; peakHour = hour; }
      });

      // Device breakdown
      const deviceMap = new Map<string, number>();
      records.forEach(r => {
        const dt = r.device_type || "unknown";
        deviceMap.set(dt, (deviceMap.get(dt) || 0) + 1);
      });
      const deviceBreakdown: DeviceBreakdown[] = Array.from(deviceMap.entries())
        .map(([device, count]) => ({ device, count, percentage: totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);

      const mobileVisits = deviceMap.get("mobile") || 0;
      const desktopVisits = deviceMap.get("desktop") || 0;
      const tabletVisits = deviceMap.get("tablet") || 0;

      // Bounce rate & returning visitors
      const sessionPageMap = new Map<string, number>();
      records.forEach(r => {
        sessionPageMap.set(r.session_id, (sessionPageMap.get(r.session_id) || 0) + 1);
      });
      const singlePageSessions = Array.from(sessionPageMap.values()).filter(c => c === 1).length;
      const multiPageSessions = Array.from(sessionPageMap.values()).filter(c => c > 1).length;
      const bounceRate = uniqueSessions > 0 ? Math.round((singlePageSessions / uniqueSessions) * 100) : 0;
      const totalPageViews = Array.from(sessionPageMap.values()).reduce((a, b) => a + b, 0);
      const avgPagesPerSession = uniqueSessions > 0 ? Math.round((totalPageViews / uniqueSessions) * 10) / 10 : 0;
      const returningVisitors = multiPageSessions;

      const summary: VisitorSummary = {
        totalVisits,
        uniqueVisitors: uniqueSessions,
        uniqueUsers,
        avgDailyVisits,
        peakDay,
        peakHour,
        mobileVisits,
        desktopVisits,
        tabletVisits,
        bounceRate,
        avgPagesPerSession,
        returningVisitors,
      };

      // ── Daily Trend ──
      const dailyMap = new Map<string, { visits: number; sessions: Set<string> }>();
      // Initialize all days in range
      for (let i = period - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dailyMap.set(key, { visits: 0, sessions: new Set() });
      }
      records.forEach(r => {
        const day = (r.created_at || "").slice(0, 10);
        if (dailyMap.has(day)) {
          const entry = dailyMap.get(day)!;
          entry.visits++;
          if (r.session_id) entry.sessions.add(r.session_id);
        }
      });

      const dailyTrend: DailyVisit[] = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, visits: v.visits, uniqueVisitors: v.sessions.size, label: formatShortDate(date) }));

      // ── Hourly Distribution ──
      const hourDistMap = new Map<number, number>();
      for (let h = 0; h < 24; h++) hourDistMap.set(h, 0);
      records.forEach(r => {
        if (r.created_at) {
          const h = new Date(r.created_at).getHours();
          hourDistMap.set(h, (hourDistMap.get(h) || 0) + 1);
        }
      });
      const hourlyDistribution: HourlyVisit[] = Array.from(hourDistMap.entries())
        .map(([hour, visits]) => ({ hour, visits, label: HOUR_LABELS[hour] }));

      // ── Top Pages ──
      const pageMap = new Map<string, { visits: number; sessions: Set<string> }>();
      records.forEach(r => {
        const page = r.page || "/";
        if (!pageMap.has(page)) pageMap.set(page, { visits: 0, sessions: new Set() });
        const entry = pageMap.get(page)!;
        entry.visits++;
        if (r.session_id) entry.sessions.add(r.session_id);
      });
      const topPages: PageVisit[] = Array.from(pageMap.entries())
        .map(([page, v]) => ({ page, visits: v.visits, uniqueVisitors: v.sessions.size }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 10);

      // ── Top Referrers ──
      const refMap = new Map<string, number>();
      records.forEach(r => {
        const ref = r.referrer || "Direct / None";
        try {
          if (ref !== "Direct / None" && ref.startsWith("http")) {
            const url = new URL(ref);
            const host = url.hostname.replace(/^www\./, "");
            refMap.set(host, (refMap.get(host) || 0) + 1);
          } else {
            refMap.set(ref, (refMap.get(ref) || 0) + 1);
          }
        } catch {
          refMap.set(ref, (refMap.get(ref) || 0) + 1);
        }
      });
      const topReferrers: ReferrerEntry[] = Array.from(refMap.entries())
        .map(([referrer, visits]) => ({ referrer, visits }))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 8);

      // ── Comparison vs previous period ──
      const prevTotal = prevRecords.length;
      const prevUnique = new Set(prevRecords.map(r => r.session_id)).size;
      const prevSessionMap = new Map<string, number>();
      prevRecords.forEach(r => {
        prevSessionMap.set(r.session_id, (prevSessionMap.get(r.session_id) || 0) + 1);
      });
      const prevSingle = Array.from(prevSessionMap.values()).filter(c => c === 1).length;
      const prevBounce = prevUnique > 0 ? Math.round((prevSingle / prevUnique) * 100) : 0;

      const visitsChange = prevTotal > 0 ? Math.round(((totalVisits - prevTotal) / prevTotal) * 100) : 0;
      const uniqueChange = prevUnique > 0 ? Math.round(((uniqueSessions - prevUnique) / prevUnique) * 100) : 0;
      const bounceChange = prevBounce > 0 ? bounceRate - prevBounce : 0;

      return {
        summary,
        dailyTrend,
        hourlyDistribution,
        topPages,
        deviceBreakdown,
        topReferrers,
        comparison: { visitsChange, uniqueChange, bounceChange },
      };
    },
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
    refetchOnMount: "always",
    refetchOnReconnect: false,    // FIXED: was true — aggressive reconnect refetch interrupted edits
  });
}
