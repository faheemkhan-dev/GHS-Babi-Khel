import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Notice {
  id: string;
  title: string;
  content: string | null;
  category: string;
  is_urgent: boolean;
  is_published: boolean;
  is_pinned: boolean;
  created_at: string;
  expires_at: string | null;
  is_poll: boolean;
  poll_options: PollOption[];
  poll_closes_at: string | null;
}

const NOTICE_COLUMNS =
  "id, title, content, category, is_urgent, is_published, is_pinned, created_at, expires_at, is_poll, poll_options, poll_closes_at";

/**
 * A random id generated once per browser and kept in localStorage. Used only
 * to let a device vote once per poll (see cast_poll_vote() migration notes)
 * — it identifies a device, not a person, since the site has no visitor
 * login. Safe to expose: it's meaningless without the matching Supabase RPC.
 */
export function getVoterToken(): string {
  const KEY = "ghs_voter_token";
  try {
    let token = localStorage.getItem(KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(KEY, token);
    }
    return token;
  } catch {
    // localStorage unavailable (private mode edge cases) — fall back to an
    // in-memory token for this page load so voting still works, just
    // without persisting "already voted" across a refresh.
    return crypto.randomUUID();
  }
}

/**
 * Public notices query. Pinned items appear first, then by recency.
 *
 * staleTime lowered to 15s (parity with news) so a freshly published notice
 * shows up on the homepage almost immediately after the admin saves it —
 * previously this was 2 minutes which caused "I just published but it isn't
 * showing" confusion.
 */
export function useNotices(limit?: number) {
  return useQuery<Notice[]>({
    queryKey: ["notices", limit],
    queryFn: async () => {
      let query = supabase
        .from("notices")
        .select(NOTICE_COLUMNS)
        .eq("is_published", true)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Notice[];
    },
    staleTime: 15 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
    refetchOnWindowFocus: false,  // FIXED: was true — caused page refresh feeling on slow internet
  });
}

export function useNoticeItem(id: string | undefined) {
  return useQuery<Notice | null>({
    queryKey: ["notice-item", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("notices")
        .select(NOTICE_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as Notice | null) ?? null;
    },
    enabled: !!id,
    staleTime: 30 * 1000,
  });
}

/** This device's previous vote (if any) on a given poll — used to show
 *  results-so-far instead of the vote buttons when the page (re)loads. */
export function useMyPollVote(noticeId: string | undefined, isPoll: boolean) {
  return useQuery<string | null>({
    queryKey: ["my-poll-vote", noticeId],
    queryFn: async () => {
      if (!noticeId) return null;
      const { data, error } = await supabase.rpc("get_my_poll_vote", {
        p_notice_id: noticeId,
        p_voter_token: getVoterToken(),
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    enabled: !!noticeId && isPoll,
    staleTime: 60 * 1000,
  });
}

/** Casts (or re-checks) this device's single vote on a poll via the
 *  server-side RPC — see cast_poll_vote() for why this isn't a plain
 *  insert. On success, updates both the notice's cached vote counts and
 *  this device's "already voted" flag so the UI flips to results
 *  immediately without waiting for a refetch. */
export function useCastPollVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noticeId, optionId }: { noticeId: string; optionId: string }) => {
      const { data, error } = await supabase.rpc("cast_poll_vote", {
        p_notice_id: noticeId,
        p_option_id: optionId,
        p_voter_token: getVoterToken(),
      });
      if (error) throw error;
      return data as { options: PollOption[]; voted_option_id: string };
    },
    onSuccess: (data, { noticeId, optionId }) => {
      qc.setQueryData<string | null>(["my-poll-vote", noticeId], optionId);
      const patchNotice = (n: Notice) =>
        n.id === noticeId ? { ...n, poll_options: data.options } : n;
      qc.setQueriesData<Notice[]>({ queryKey: ["notices"] }, (old) =>
        old ? old.map(patchNotice) : old
      );
      qc.setQueryData<Notice | null>(["notice-item", noticeId], (old) =>
        old ? patchNotice(old) : old
      );
    },
  });
}
