-- DealFlowIQ Batch Stripe — launch pricing, Stripe sync columns, webhooks and access defaults.
-- Run after 032_canonical_url_import_runtime_fix.sql.

create extension if not exists pgcrypto;

-- 1) Stripe sync metadata for dynamic plan CRUD.
ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS stripe_sync_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_error text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2) Stripe subscription fields. Existing stripe_customer_id/subscription_id columns are preserved.
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_interval text,
  ADD COLUMN IF NOT EXISTS stripe_status_raw text,
  ADD COLUMN IF NOT EXISTS stripe_cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz;

ALTER TABLE public.organization_subscriptions
  DROP CONSTRAINT IF EXISTS organization_subscriptions_status_check;
ALTER TABLE public.organization_subscriptions
  ADD CONSTRAINT organization_subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired', 'comped', 'manually_granted', 'incomplete', 'unpaid'));

CREATE INDEX IF NOT EXISTS idx_billing_plans_stripe_product ON public.billing_plans(stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_stripe_monthly_price ON public.billing_plans(stripe_monthly_price_id);
CREATE INDEX IF NOT EXISTS idx_billing_plans_stripe_annual_price ON public.billing_plans(stripe_annual_price_id);
CREATE INDEX IF NOT EXISTS idx_org_subs_stripe_customer ON public.organization_subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_org_subs_stripe_subscription ON public.organization_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_org_subs_stripe_price ON public.organization_subscriptions(stripe_price_id);

-- 3) Webhook idempotency/audit table.
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'processed', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_stripe_webhook_events_updated_at ON public.stripe_webhook_events;
CREATE TRIGGER set_stripe_webhook_events_updated_at
BEFORE UPDATE ON public.stripe_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_webhook_events_select_platform_admin ON public.stripe_webhook_events;
CREATE POLICY stripe_webhook_events_select_platform_admin
ON public.stripe_webhook_events FOR SELECT
TO authenticated
USING (public.current_user_is_platform_admin());

-- 4) Hide old pre-launch public pricing without deleting it. Existing subscriptions still keep their plan record.
UPDATE public.billing_plans
SET is_public = false,
    is_active = false,
    archived_at = COALESCE(archived_at, now()),
    updated_at = now()
WHERE code IN ('solo_investor', 'landlord', 'wholesaler', 'team_company', 'community_guru', 'starter', 'pro', 'team', 'community');

-- 5) Launch/intro plans.
INSERT INTO public.billing_plans (
  code, name, description, currency, monthly_price_cents, annual_price_cents, trial_days,
  is_public, is_active, display_order, account_types, features, limits, stripe_sync_status
) VALUES
(
  'free',
  'Free',
  'Free access after trial or for users who only need light browsing before upgrading.',
  'usd', 0, 0, 0, true, true, 0,
  ARRAY['solo_investor','wholesaler','landlord','section_8_landlord','brrrr_investor','fix_and_flip_investor','team_company','community_guru_owner'],
  '{"market_search":true,"market_rent":true,"market_opportunities":true,"public_community_deals":true}'::jsonb,
  '{"max_visible_opportunities":2,"opportunity_detail_cooldown_hours":48,"max_saved_deals":3,"max_imports_per_7_days":1,"max_imports_per_month":0,"max_deals":2,"max_buyers":0,"max_team_members":1,"max_hud_lookups":3,"max_ai_reviews":0,"max_deal_landing_pages":0,"max_community_members":0}'::jsonb,
  'skipped_free'
),
(
  'premium',
  'Premium',
  'Full investor toolkit for imports, saved deals, Deal Score, calculators, DSCR, rent intelligence, alerts and exports.',
  'usd', 1299, 15000, 7, true, true, 10,
  ARRAY['solo_investor','wholesaler','landlord','section_8_landlord','brrrr_investor','fix_and_flip_investor','team_company'],
  '{"deals":true,"deal_analyzer":true,"market_search":true,"rent_analysis":true,"market_rent":true,"calculators":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"seller_finance":true,"five_year_projection":true,"csv_export":true,"pdf_export":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"ai_review":true,"lender_view":true,"market_source_imports":true,"market_opportunities":true,"scheduled_market_imports":true,"public_community_deals":true}'::jsonb,
  '{"max_visible_opportunities":null,"opportunity_detail_cooldown_hours":0,"max_saved_deals":null,"max_imports_per_7_days":null,"max_imports_per_month":100,"max_deals":null,"max_buyers":null,"max_team_members":3,"max_hud_lookups":500,"max_ai_reviews":100,"max_deal_landing_pages":100,"max_community_members":0}'::jsonb,
  'pending'
),
(
  'community_owner',
  'Community Owner',
  'Everything in Premium plus community management, invite codes/email invites, member dashboards, analytics and moderation tools.',
  'usd', 1999, 23000, 7, true, true, 20,
  ARRAY['community_guru_owner','team_company'],
  '{"deals":true,"deal_analyzer":true,"market_search":true,"rent_analysis":true,"market_rent":true,"calculators":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"seller_finance":true,"five_year_projection":true,"csv_export":true,"pdf_export":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"community_members":true,"white_label":false,"ai_review":true,"lender_view":true,"market_source_imports":true,"market_opportunities":true,"scheduled_market_imports":true,"public_community_deals":true}'::jsonb,
  '{"max_visible_opportunities":null,"opportunity_detail_cooldown_hours":0,"max_saved_deals":null,"max_imports_per_7_days":null,"max_imports_per_month":250,"max_deals":null,"max_buyers":null,"max_team_members":10,"max_hud_lookups":1500,"max_ai_reviews":250,"max_deal_landing_pages":250,"max_community_members":500}'::jsonb,
  'pending'
),
(
  'enterprise_custom',
  'Enterprise / Custom',
  'Hidden plan for manual partner, custom limit, white-label or enterprise deals.',
  'usd', 0, 0, 0, false, true, 90,
  ARRAY[]::text[],
  '{"deals":true,"deal_analyzer":true,"market_search":true,"rent_analysis":true,"market_rent":true,"calculators":true,"section8_hud":true,"brrrr":true,"flip":true,"wholesale":true,"seller_finance":true,"five_year_projection":true,"csv_export":true,"pdf_export":true,"buyers":true,"buyer_matching":true,"deal_distribution":true,"community_members":true,"white_label":true,"ai_review":true,"lender_view":true,"admin_plan_management":false,"market_source_imports":true,"market_opportunities":true,"scheduled_market_imports":true,"public_community_deals":true}'::jsonb,
  '{"max_visible_opportunities":null,"opportunity_detail_cooldown_hours":0,"max_saved_deals":null,"max_imports_per_7_days":null,"max_imports_per_month":null,"max_deals":null,"max_buyers":null,"max_team_members":null,"max_hud_lookups":null,"max_ai_reviews":null,"max_deal_landing_pages":null,"max_community_members":null}'::jsonb,
  'skipped_free'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  currency = EXCLUDED.currency,
  monthly_price_cents = EXCLUDED.monthly_price_cents,
  annual_price_cents = EXCLUDED.annual_price_cents,
  trial_days = EXCLUDED.trial_days,
  is_public = EXCLUDED.is_public,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order,
  account_types = EXCLUDED.account_types,
  features = EXCLUDED.features,
  limits = EXCLUDED.limits,
  stripe_sync_status = CASE
    WHEN public.billing_plans.stripe_product_id IS NULL AND EXCLUDED.monthly_price_cents > 0 THEN 'pending'
    ELSE public.billing_plans.stripe_sync_status
  END,
  updated_at = now();

-- 6) Default signup: 7-day launch trial on Premium/Community Owner, then app access falls back to Free when trial is over.
CREATE OR REPLACE FUNCTION public.default_plan_for_account_type(_account_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _plan_id uuid;
BEGIN
  IF _account_type IN ('community_guru_owner', 'team_company') THEN
    SELECT id INTO _plan_id FROM public.billing_plans WHERE code = 'community_owner' AND is_active = true LIMIT 1;
  END IF;

  IF _plan_id IS NULL THEN
    SELECT id INTO _plan_id FROM public.billing_plans WHERE code = 'premium' AND is_active = true LIMIT 1;
  END IF;

  IF _plan_id IS NULL THEN
    SELECT id INTO _plan_id FROM public.billing_plans WHERE code = 'free' AND is_active = true LIMIT 1;
  END IF;

  RETURN _plan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_organization_subscription(_organization_id uuid, _account_type text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _plan_id uuid;
  _trial_days integer := 7;
  _subscription_id uuid;
  _trial_end timestamptz;
  _is_platform_admin boolean := public.current_user_is_platform_admin();
BEGIN
  SELECT id INTO _existing_id
  FROM public.organization_subscriptions
  WHERE organization_id = _organization_id
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  _plan_id := public.default_plan_for_account_type(COALESCE(_account_type, 'solo_investor'));

  SELECT COALESCE(bp.trial_days, 7)
  INTO _trial_days
  FROM public.billing_plans bp
  WHERE bp.id = _plan_id;

  _trial_days := CASE WHEN _is_platform_admin THEN 0 ELSE COALESCE(NULLIF(_trial_days, 0), 7) END;
  _trial_end := CASE WHEN _trial_days > 0 THEN now() + make_interval(days => _trial_days) ELSE NULL END;

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    current_period_start,
    current_period_end,
    trial_source,
    notes,
    manually_granted_by
  ) VALUES (
    _organization_id,
    _plan_id,
    CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'manually_granted' END,
    CASE WHEN _trial_days > 0 THEN now() ELSE NULL END,
    _trial_end,
    now(),
    _trial_end,
    CASE WHEN _trial_days > 0 THEN 'plan_default' ELSE 'admin_override' END,
    CASE WHEN _trial_days > 0 THEN 'Created automatically with launch trial. Trial expiry falls back to Free access until paid.' ELSE 'Created automatically for platform admin without trial.' END,
    CASE WHEN _is_platform_admin THEN auth.uid() ELSE NULL END
  )
  RETURNING id INTO _subscription_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _organization_id,
    auth.uid(),
    'subscription.created',
    'organization_subscription',
    _subscription_id,
    jsonb_build_object('source', 'ensure_organization_subscription', 'account_type', _account_type, 'trial_days', _trial_days, 'platform_admin', _is_platform_admin, 'batch', 'stripe')
  );

  RETURN _subscription_id;
END;
$$;

COMMENT ON TABLE public.stripe_webhook_events IS 'Stripe webhook idempotency/audit table used by /api/stripe/webhook.';
COMMENT ON COLUMN public.billing_plans.stripe_sync_status IS 'pending/synced/not_configured/skipped_free/failed/archived. Stripe prices are created from app admin actions or checkout.';
COMMENT ON COLUMN public.organization_subscriptions.stripe_subscription_item_id IS 'Stored to safely replace Stripe subscription item prices later without adding duplicate active prices.';
