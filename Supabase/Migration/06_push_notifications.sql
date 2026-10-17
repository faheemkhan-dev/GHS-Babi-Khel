-- ═══════════════════════════════════════════════════════════════════════
-- FILE 06 — Push Notification Subscriptions (optional)
-- ═══════════════════════════════════════════════════════════════════════
-- Web Push storage. RLS is enabled with NO policies on purpose: only the
-- server (service-role key, used by /api/push) can read or write these
-- tables. Anonymous browser clients can NEVER read another visitor's push
-- endpoint.
--
-- Run AFTER files 00-05. Skippable if your deployment does not use web push
-- notifications.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  topics        text[] NOT NULL DEFAULT '{results,merit,rollslip,admission,notices,news,datesheet,calendar}',
  admission_ref text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_topics_idx        ON public.push_subscriptions USING gin (topics);
CREATE INDEX IF NOT EXISTS push_subscriptions_admission_ref_idx ON public.push_subscriptions (admission_ref) WHERE admission_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.push_state (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_state         ENABLE ROW LEVEL SECURITY;
