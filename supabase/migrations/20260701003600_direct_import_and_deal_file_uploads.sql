-- DealFlowIQ Batch 31 — Direct import reliability + deal file uploads.
-- Fixes URL import button reliability by keeping DB constraints aligned and adds private deal file storage.

create extension if not exists pgcrypto;

-- 1) Re-assert provider/source constraints used by the direct import action.
do $$
begin
  if exists (select 1 from information_schema.table_constraints where constraint_schema='public' and table_name='market_listings' and constraint_name='market_listings_source_type_check') then
    alter table public.market_listings drop constraint market_listings_source_type_check;
  end if;
  alter table public.market_listings add constraint market_listings_source_type_check
    check (source_type in ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
end $$;

do $$
begin
  if exists (select 1 from information_schema.table_constraints where constraint_schema='public' and table_name='market_url_import_batches' and constraint_name='market_url_import_batches_source_type_check') then
    alter table public.market_url_import_batches drop constraint market_url_import_batches_source_type_check;
  end if;
  alter table public.market_url_import_batches add constraint market_url_import_batches_source_type_check
    check (source_type in ('manual','manual_url','zillow','investorlift','crexi','loopnet','redfin','realtor','apartments','csv','partner_api','mls_feed','public_deal','community_deal','other'));
end $$;

do $$
begin
  if exists (select 1 from information_schema.table_constraints where constraint_schema='public' and table_name='market_url_import_batches' and constraint_name='market_url_import_batches_status_check') then
    alter table public.market_url_import_batches drop constraint market_url_import_batches_status_check;
  end if;
  alter table public.market_url_import_batches add constraint market_url_import_batches_status_check
    check (status in ('draft','analyzed','ready','queued','preview_ready','running','importing','rate_limited','partially_imported','completed','needs_review','failed','cancelled','expired_provider_data'));
end $$;

-- 2) Re-assert live InvestorLift policy: 40 listings per rolling hour, no demo fallback.
insert into public.market_provider_policies (
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
values (
  null,
  'investorlift',
  'InvestorLift',
  true,
  40,
  null,
  15,
  true,
  true,
  true,
  true,
  true,
  true,
  'Authorized InvestorLift live import. 40 listings per rolling hour. No demo mode, proxy rotation, CAPTCHA bypass, or anti-bot circumvention.'
)
on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type) do update set
  provider_label = excluded.provider_label,
  is_active = true,
  max_listings_per_hour = 40,
  max_listings_per_day = excluded.max_listings_per_day,
  storage_days = excluded.storage_days,
  images_allowed = excluded.images_allowed,
  description_allowed = excluded.description_allowed,
  source_link_required = excluded.source_link_required,
  attribution_required = excluded.attribution_required,
  search_import_allowed = true,
  listing_import_allowed = true,
  provider_notes = excluded.provider_notes,
  updated_at = now();

-- 3) Private storage bucket for manually created deal photos/documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deal-files',
  'deal-files',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.deal_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  storage_bucket text not null default 'deal-files',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null default 0,
  file_kind text not null check (file_kind in ('image','pdf')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index if not exists idx_deal_files_org_deal on public.deal_files(organization_id, deal_id, sort_order, created_at);
create index if not exists idx_deal_files_uploaded_by on public.deal_files(uploaded_by, created_at desc);

alter table public.deal_files enable row level security;

drop policy if exists deal_files_select_org_member on public.deal_files;
create policy deal_files_select_org_member on public.deal_files
for select to authenticated
using (public.current_user_is_org_member(organization_id) or public.current_user_is_platform_admin());

drop policy if exists deal_files_insert_org_member on public.deal_files;
create policy deal_files_insert_org_member on public.deal_files
for insert to authenticated
with check (public.current_user_is_org_member(organization_id) or public.current_user_is_platform_admin());

drop policy if exists deal_files_delete_owner_admin_or_uploader on public.deal_files;
create policy deal_files_delete_owner_admin_or_uploader on public.deal_files
for delete to authenticated
using (
  uploaded_by = auth.uid()
  or public.current_user_has_org_role(organization_id, array['owner','admin'])
  or public.current_user_is_platform_admin()
);

-- 4) Storage object policies. Path format is {organization_id}/{deal_id}/{file}.
drop policy if exists deal_files_storage_select_org_member on storage.objects;
create policy deal_files_storage_select_org_member on storage.objects
for select to authenticated
using (
  bucket_id = 'deal-files'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  and (public.current_user_is_org_member(split_part(name, '/', 1)::uuid) or public.current_user_is_platform_admin())
);

drop policy if exists deal_files_storage_insert_org_member on storage.objects;
create policy deal_files_storage_insert_org_member on storage.objects
for insert to authenticated
with check (
  bucket_id = 'deal-files'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  and (public.current_user_is_org_member(split_part(name, '/', 1)::uuid) or public.current_user_is_platform_admin())
);

drop policy if exists deal_files_storage_delete_org_admin on storage.objects;
create policy deal_files_storage_delete_org_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'deal-files'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
  and (
    public.current_user_has_org_role(split_part(name, '/', 1)::uuid, array['owner','admin'])
    or public.current_user_is_platform_admin()
  )
);

comment on table public.deal_files is 'Uploaded photos and PDF documents for manually created or edited deals. Files are stored in the private deal-files bucket.';
