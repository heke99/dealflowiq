-- DealFlowIQ Batch — Import runtime stability fix.
-- Keeps interactive imports fast, keeps InvestorLift constraints/policy aligned,
-- and prevents notification/import status constraints from breaking import flows.

create extension if not exists pgcrypto;

-- 1) Provider/source-type constraints: InvestorLift must be accepted everywhere the import engine writes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_sources' AND constraint_name='market_sources_source_type_check') THEN
    ALTER TABLE public.market_sources DROP CONSTRAINT market_sources_source_type_check;
  END IF;
  ALTER TABLE public.market_sources ADD CONSTRAINT market_sources_source_type_check
    CHECK (source_type IN ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_url_import_batches' AND constraint_name='market_url_import_batches_source_type_check') THEN
    ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_source_type_check;
  END IF;
  ALTER TABLE public.market_url_import_batches ADD CONSTRAINT market_url_import_batches_source_type_check
    CHECK (source_type IN ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_listings' AND constraint_name='market_listings_source_type_check') THEN
    ALTER TABLE public.market_listings DROP CONSTRAINT market_listings_source_type_check;
  END IF;
  ALTER TABLE public.market_listings ADD CONSTRAINT market_listings_source_type_check
    CHECK (source_type IN ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_import_preview_items' AND constraint_name='market_import_preview_items_source_type_check') THEN
    ALTER TABLE public.market_import_preview_items DROP CONSTRAINT market_import_preview_items_source_type_check;
  END IF;
  ALTER TABLE public.market_import_preview_items ADD CONSTRAINT market_import_preview_items_source_type_check
    CHECK (source_type IN ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_provider_policies' AND constraint_name='market_provider_policies_source_type_check') THEN
    ALTER TABLE public.market_provider_policies DROP CONSTRAINT market_provider_policies_source_type_check;
  END IF;
  ALTER TABLE public.market_provider_policies ADD CONSTRAINT market_provider_policies_source_type_check
    CHECK (source_type IN ('zillow','investorlift','redfin','realtor','crexi','loopnet','apartments','generic','manual_url','manual','other'));
END $$;

-- 2) Status constraints used by the current import UI/actions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_url_import_batches' AND constraint_name='market_url_import_batches_status_check') THEN
    ALTER TABLE public.market_url_import_batches DROP CONSTRAINT market_url_import_batches_status_check;
  END IF;
  ALTER TABLE public.market_url_import_batches ADD CONSTRAINT market_url_import_batches_status_check
    CHECK (status IN ('draft','analyzed','ready','queued','preview_ready','running','importing','rate_limited','partially_imported','completed','needs_review','failed','cancelled','expired_provider_data'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_import_preview_items' AND constraint_name='market_import_preview_items_status_check') THEN
    ALTER TABLE public.market_import_preview_items DROP CONSTRAINT market_import_preview_items_status_check;
  END IF;
  ALTER TABLE public.market_import_preview_items ADD CONSTRAINT market_import_preview_items_status_check
    CHECK (status IN ('new','existing','duplicate','ignored','selected','imported','skipped','failed'));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='market_import_jobs' AND constraint_name='market_import_jobs_status_check') THEN
    ALTER TABLE public.market_import_jobs DROP CONSTRAINT market_import_jobs_status_check;
  END IF;
  ALTER TABLE public.market_import_jobs ADD CONSTRAINT market_import_jobs_status_check
    CHECK (status IN ('queued','running','completed','failed','partial','cancelled'));
END $$;

-- 3) Notification types used by imports, messaging, billing and buy-box alerts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema='public' AND table_name='notifications' AND constraint_name='notifications_type_check') THEN
    ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'system','admin_alert','system_alert',
    'import_analyzed','import_preview_ready','import_completed','import_failed','import_rate_limited','provider_data_expiring','provider_data_expired','cleanup_completed',
    'opportunity_found','buyer_match','buy_box_match','buy_box_run_completed','new_listing','price_drop','deal_score_alert','saved_deal_score_changed',
    'community_deal','community_activity','message_received',
    'rent_confidence_review','rent_analysis_failed','hud_lookup_failed',
    'deal_note_added','deal_status_changed','duplicate_listing_detected','manual_override_changed',
    'trial_ending','payment_required','subscription_updated'
  ));
END $$;

-- 4) Re-assert InvestorLift as live provider with a 40/hour cap.
INSERT INTO public.market_provider_policies (
  organization_id,
  source_type,
  provider_label,
  is_active,
  max_listings_per_hour,
  max_listings_per_day,
  storage_days,
  images_allowed,
  description_allowed,
  source_link_required,
  attribution_required,
  search_import_allowed,
  listing_import_allowed,
  provider_notes
)
VALUES (
  NULL,
  'investorlift',
  'InvestorLift',
  true,
  40,
  NULL,
  15,
  true,
  true,
  true,
  true,
  true,
  true,
  'Authorized InvestorLift live import. Interactive UI imports create the first listing immediately, then the remaining queued/previewed items can be imported by the source runner within the 40 listings/hour cap.'
)
ON CONFLICT (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type)
DO UPDATE SET
  provider_label = EXCLUDED.provider_label,
  is_active = EXCLUDED.is_active,
  max_listings_per_hour = EXCLUDED.max_listings_per_hour,
  max_listings_per_day = EXCLUDED.max_listings_per_day,
  storage_days = EXCLUDED.storage_days,
  images_allowed = EXCLUDED.images_allowed,
  description_allowed = EXCLUDED.description_allowed,
  source_link_required = EXCLUDED.source_link_required,
  attribution_required = EXCLUDED.attribution_required,
  search_import_allowed = EXCLUDED.search_import_allowed,
  listing_import_allowed = EXCLUDED.listing_import_allowed,
  provider_notes = EXCLUDED.provider_notes,
  updated_at = now();

-- 5) Backfill primary image for older imports where multiple images exist.
UPDATE public.market_listings
SET primary_image_url = image_urls->>0
WHERE primary_image_url IS NULL
  AND jsonb_typeof(image_urls) = 'array'
  AND jsonb_array_length(image_urls) > 0;

COMMENT ON COLUMN public.market_provider_policies.max_listings_per_hour IS 'Rolling hourly import cap per organization/provider. InvestorLift default is 40/hour; interactive actions import small batches to avoid request timeouts.';
