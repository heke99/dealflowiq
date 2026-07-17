-- DealFlowIQ Batch 12J — Admin dashboard and subscription-plan polish.
-- Removes trial-first defaults from product access and keeps existing organizations on active access.

-- Plans remain editable in /admin/plans, but the app no longer presents trial access as the default mode.
UPDATE public.billing_plans
SET trial_days = 0,
    updated_at = now()
WHERE trial_days <> 0;

-- Existing default/signup trial subscriptions become active access records.
UPDATE public.organization_subscriptions
SET status = 'active',
    trial_start_at = NULL,
    trial_end_at = NULL,
    trial_source = 'admin_override',
    notes = COALESCE(notes, 'Converted to active access during subscription plan polish.'),
    updated_at = now()
WHERE status = 'trialing'
  AND COALESCE(trial_source, 'plan_default') IN ('default_signup', 'plan_default', 'admin_override', 'invite_override');

-- Keep the default plan resolver as-is, but make newly created organization subscriptions active unless a future plan explicitly reintroduces trial days.
CREATE OR REPLACE FUNCTION public.ensure_organization_subscription(_organization_id uuid, _account_type text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _existing_id uuid;
  _plan_id uuid;
  _trial_days integer := 0;
  _subscription_id uuid;
  _period_end timestamptz;
BEGIN
  SELECT id INTO _existing_id
  FROM public.organization_subscriptions
  WHERE organization_id = _organization_id
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  _plan_id := public.default_plan_for_account_type(COALESCE(_account_type, 'solo_investor'));

  SELECT COALESCE(bp.trial_days, 0)
  INTO _trial_days
  FROM public.billing_plans bp
  WHERE bp.id = _plan_id;

  _trial_days := COALESCE(_trial_days, 0);
  _period_end := CASE WHEN _trial_days > 0 THEN now() + make_interval(days => _trial_days) ELSE now() + interval '30 days' END;

  INSERT INTO public.organization_subscriptions (
    organization_id,
    plan_id,
    status,
    trial_start_at,
    trial_end_at,
    current_period_start,
    current_period_end,
    trial_source,
    notes
  ) VALUES (
    _organization_id,
    _plan_id,
    CASE WHEN _trial_days > 0 THEN 'trialing' ELSE 'active' END,
    CASE WHEN _trial_days > 0 THEN now() ELSE NULL END,
    CASE WHEN _trial_days > 0 THEN _period_end ELSE NULL END,
    now(),
    _period_end,
    CASE WHEN _trial_days > 0 THEN 'plan_default' ELSE 'admin_override' END,
    CASE WHEN _trial_days > 0 THEN 'Created automatically with configured plan trial.' ELSE 'Created automatically with active plan access.' END
  )
  RETURNING id INTO _subscription_id;

  INSERT INTO public.audit_logs (organization_id, actor_id, event_type, entity_type, entity_id, metadata)
  VALUES (
    _organization_id,
    auth.uid(),
    'subscription.created',
    'organization_subscription',
    _subscription_id,
    jsonb_build_object('source', 'ensure_organization_subscription', 'account_type', _account_type, 'trial_days', _trial_days)
  );

  RETURN _subscription_id;
END;
$$;
