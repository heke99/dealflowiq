-- =============================================================================
-- 034 — Production hardening
--
-- 1. Remove the stale 3-arg overload of ensure_organization_subscription
--    (introduced in 025_freemium_admin_community_batch.sql) so only the
--    canonical (uuid, text) signature from 033 remains.
-- 2. Add a current_user_is_org_writer() helper and tier write policies so
--    'viewer' members are read-only across org content tables.
-- 3. Restrict audit_logs inserts: rows written through the API must carry the
--    caller as actor and belong to one of the caller's organizations.
--    SECURITY DEFINER functions and the service role are unaffected.
-- 4. Restrict hud_fmr_cache writes to the service role / platform admins.
--    Application cache writes move to the server-side admin client.
-- 5. Add missing indexes for common query paths.
-- 6. Document the final state of functions that were redefined across
--    multiple migrations (see also docs/database.md).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Drop the stale ensure_organization_subscription overload.
--    The canonical signature is (uuid, text) — last defined in migration 033.
--    The (uuid, uuid, integer) overload from 025_freemium is unused by the app
--    and skips audit logging; keeping both invites ambiguous calls.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ensure_organization_subscription(uuid, uuid, integer);

COMMENT ON FUNCTION public.ensure_organization_subscription(uuid, text) IS
  'Canonical signup/backfill subscription bootstrap (final version: migration 033). Creates a 7-day launch trial on the account-type default plan for non-platform-admins; platform admins get a manually_granted subscription. Writes an audit_logs row.';

-- -----------------------------------------------------------------------------
-- 2) Role-tiered write access: viewers are read-only.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_org_writer(_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = _organization_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
      AND om.role <> 'viewer'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_is_org_writer(uuid) TO authenticated;

COMMENT ON FUNCTION public.current_user_is_org_writer(uuid) IS
  'True when the current user is an active member of the organization with any role other than viewer. Used by RLS write policies to keep viewer members read-only.';

-- deals -----------------------------------------------------------------------
DROP POLICY IF EXISTS deals_insert_org_member ON public.deals;
CREATE POLICY deals_insert_org_member
ON public.deals FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deals_update_org_member ON public.deals;
CREATE POLICY deals_update_org_member
ON public.deals FOR UPDATE
TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- properties ------------------------------------------------------------------
DROP POLICY IF EXISTS properties_insert_org_member ON public.properties;
CREATE POLICY properties_insert_org_member
ON public.properties FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS properties_update_org_member ON public.properties;
CREATE POLICY properties_update_org_member
ON public.properties FOR UPDATE
TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- deal_units ------------------------------------------------------------------
DROP POLICY IF EXISTS deal_units_insert_org_member ON public.deal_units;
CREATE POLICY deal_units_insert_org_member
ON public.deal_units FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS deal_units_update_org_member ON public.deal_units;
CREATE POLICY deal_units_update_org_member
ON public.deal_units FOR UPDATE
TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- deal_files ------------------------------------------------------------------
DROP POLICY IF EXISTS deal_files_insert_org_member ON public.deal_files;
CREATE POLICY deal_files_insert_org_member
ON public.deal_files FOR INSERT
TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- market_listings -------------------------------------------------------------
DROP POLICY IF EXISTS market_listings_insert_org ON public.market_listings;
CREATE POLICY market_listings_insert_org ON public.market_listings
FOR INSERT TO authenticated
WITH CHECK (
  (organization_id IS NOT NULL AND public.current_user_is_org_writer(organization_id))
  OR public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS market_listings_update_org ON public.market_listings;
CREATE POLICY market_listings_update_org ON public.market_listings
FOR UPDATE TO authenticated
USING ((organization_id IS NOT NULL AND public.current_user_is_org_writer(organization_id)) OR public.current_user_is_platform_admin())
WITH CHECK ((organization_id IS NOT NULL AND public.current_user_is_org_writer(organization_id)) OR public.current_user_is_platform_admin());

-- market_listing_notes ---------------------------------------------------------
DROP POLICY IF EXISTS market_listing_notes_insert_org ON public.market_listing_notes;
CREATE POLICY market_listing_notes_insert_org ON public.market_listing_notes
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_listing_notes_update_org ON public.market_listing_notes;
CREATE POLICY market_listing_notes_update_org ON public.market_listing_notes
FOR UPDATE TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- market_rent_comps -------------------------------------------------------------
DROP POLICY IF EXISTS market_rent_comps_insert_org ON public.market_rent_comps;
CREATE POLICY market_rent_comps_insert_org ON public.market_rent_comps
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS market_rent_comps_update_org ON public.market_rent_comps;
CREATE POLICY market_rent_comps_update_org ON public.market_rent_comps
FOR UPDATE TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- buyers ------------------------------------------------------------------------
DROP POLICY IF EXISTS buyers_insert_org ON public.buyers;
CREATE POLICY buyers_insert_org ON public.buyers
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyers_update_org ON public.buyers;
CREATE POLICY buyers_update_org ON public.buyers
FOR UPDATE TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- buyer_deal_matches -------------------------------------------------------------
DROP POLICY IF EXISTS buyer_deal_matches_insert_org ON public.buyer_deal_matches;
CREATE POLICY buyer_deal_matches_insert_org ON public.buyer_deal_matches
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

DROP POLICY IF EXISTS buyer_deal_matches_update_org ON public.buyer_deal_matches;
CREATE POLICY buyer_deal_matches_update_org ON public.buyer_deal_matches
FOR UPDATE TO authenticated
USING (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- buyer_interactions --------------------------------------------------------------
DROP POLICY IF EXISTS buyer_interactions_insert_org ON public.buyer_interactions;
CREATE POLICY buyer_interactions_insert_org ON public.buyer_interactions
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- market_buy_boxes -----------------------------------------------------------------
DROP POLICY IF EXISTS market_buy_boxes_insert_org ON public.market_buy_boxes;
CREATE POLICY market_buy_boxes_insert_org ON public.market_buy_boxes
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_org_writer(organization_id) OR public.current_user_is_platform_admin());

-- -----------------------------------------------------------------------------
-- 3) audit_logs: API writers must be active members writing as themselves.
--    SECURITY DEFINER functions (organization bootstrap, invites, subscription
--    creation) and the service role bypass RLS and are unaffected.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_logs_insert_org_member ON public.audit_logs;
CREATE POLICY audit_logs_insert_org_member
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (
  organization_id IS NOT NULL
  AND public.current_user_is_org_member(organization_id)
  AND actor_id = auth.uid()
);

-- -----------------------------------------------------------------------------
-- 4) hud_fmr_cache: global shared cache. Reads stay open to authenticated
--    users; writes are restricted to platform admins (application writes go
--    through the service-role client, which bypasses RLS).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hud_fmr_cache_write_authenticated ON public.hud_fmr_cache;
CREATE POLICY hud_fmr_cache_write_authenticated ON public.hud_fmr_cache
FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_platform_admin());

DROP POLICY IF EXISTS hud_fmr_cache_update_authenticated ON public.hud_fmr_cache;
CREATE POLICY hud_fmr_cache_update_authenticated ON public.hud_fmr_cache
FOR UPDATE TO authenticated
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());

-- -----------------------------------------------------------------------------
-- 5) Missing indexes for common query paths.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_listing_messages_org ON public.listing_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON public.audit_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_created ON public.stripe_webhook_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buyer_interactions_org_created ON public.buyer_interactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_listing_detail_views_user_viewed ON public.user_listing_detail_views(user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_assigned_user ON public.deals(assigned_user_id) WHERE assigned_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_listing_scores_org ON public.market_listing_scores(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_import_audit_events_listing ON public.market_import_audit_events(listing_id, created_at DESC) WHERE listing_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6) Documentation of functions redefined across multiple migrations.
--    Full history and behavioral notes live in docs/database.md.
-- -----------------------------------------------------------------------------
COMMENT ON FUNCTION public.handle_new_user() IS
  'Auth trigger (final version: migration 017_community_invites_signup_codes). Copies signup metadata (email, full_name, account_type, organization_name, pending_invite_code) into profiles and marks onboarding complete when account type or invite metadata is present.';

COMMENT ON FUNCTION public.create_default_organization() IS
  'Workspace bootstrap RPC (final version: migration 026_trial_access_member_overrides). Ensures the profile exists, accepts a pending community invite, reuses or creates the default organization + owner membership, then runs ensure_organization_subscription and apply_admin_access_invite.';

COMMENT ON FUNCTION public.default_plan_for_account_type(text) IS
  'Plan mapping (final version: migration 033). community_guru_owner/team_company map to the community_owner plan, all other account types map to premium, falling back to free.';

COMMENT ON FUNCTION public.apply_admin_access_invite(uuid, uuid, text) IS
  'Admin invite application (final version: migration 026_trial_access_member_overrides). Matches active invites by email; trial_days defaults to 0 which grants a manually_granted subscription instead of a trial.';

COMMENT ON FUNCTION public.cleanup_expired_market_source_data() IS
  'Provider data retention (final version: migration 019_batch_12i2). Clears description/images/raw payloads for listings whose provider_data_expires_at has passed and stamps provider_data_expired_at. Returns TABLE(cleaned_count integer).';
