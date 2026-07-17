-- Batch 12I.2 repair: keep import job types compatible with existing production constraints.
-- Market URL imports are stored as authorized_scrape with importMode in input_payload.
-- This migration is intentionally idempotent and also tolerates older rows/code that used
-- authorized_search_url or authorized_listing_url.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'market_import_jobs'
      AND constraint_name = 'market_import_jobs_job_type_check'
  ) THEN
    ALTER TABLE public.market_import_jobs DROP CONSTRAINT market_import_jobs_job_type_check;
  END IF;

  ALTER TABLE public.market_import_jobs
    ADD CONSTRAINT market_import_jobs_job_type_check
    CHECK (job_type IN (
      'manual_url',
      'source_run',
      'csv_upload',
      'api_sync',
      'authorized_scrape',
      'scheduled_import',
      'authorized_search_url',
      'authorized_listing_url'
    ));
END $$;

UPDATE public.market_import_jobs
SET
  input_payload = COALESCE(input_payload, '{}'::jsonb) || jsonb_build_object(
    'importMode', CASE
      WHEN job_type = 'authorized_search_url' THEN 'search_url'
      WHEN job_type = 'authorized_listing_url' THEN 'listing_url'
      ELSE COALESCE(input_payload->>'importMode', 'authorized')
    END,
    'jobTypeNormalizedAt', now()
  ),
  job_type = 'authorized_scrape'
WHERE job_type IN ('authorized_search_url', 'authorized_listing_url');
