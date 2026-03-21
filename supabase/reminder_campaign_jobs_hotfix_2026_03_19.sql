create table if not exists public.reminder_campaign_jobs (
    id uuid primary key default gen_random_uuid(),
    campaign_type text not null check (campaign_type in ('all_visible', 'draft_only', 'no_application')),
    recipient_ids jsonb not null default '[]'::jsonb,
    total_recipients integer not null default 0 check (total_recipients >= 0),
    processed_count integer not null default 0 check (processed_count >= 0),
    sent_count integer not null default 0 check (sent_count >= 0),
    skipped_count integer not null default 0 check (skipped_count >= 0),
    failed_count integer not null default 0 check (failed_count >= 0),
    batch_size integer not null default 100 check (batch_size > 0 and batch_size <= 500),
    batch_delay_minutes integer not null default 10 check (batch_delay_minutes > 0 and batch_delay_minutes <= 1440),
    base_url text,
    created_by uuid references public.profiles (id) on delete set null,
    status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    next_run_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    last_error text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint reminder_campaign_jobs_recipient_ids_is_array check (jsonb_typeof(recipient_ids) = 'array')
);

create index if not exists idx_reminder_campaign_jobs_status_next_run
on public.reminder_campaign_jobs (status, next_run_at asc, created_at asc);

create index if not exists idx_reminder_campaign_jobs_created_by
on public.reminder_campaign_jobs (created_by, created_at desc);

drop trigger if exists set_reminder_campaign_jobs_updated_at on public.reminder_campaign_jobs;
create trigger set_reminder_campaign_jobs_updated_at
before update on public.reminder_campaign_jobs
for each row execute function public.set_updated_at();

alter table public.reminder_campaign_jobs enable row level security;

drop policy if exists reminder_campaign_jobs_select_staff on public.reminder_campaign_jobs;
create policy reminder_campaign_jobs_select_staff
on public.reminder_campaign_jobs
for select
to authenticated
using (public.is_staff());

drop policy if exists reminder_campaign_jobs_insert_staff on public.reminder_campaign_jobs;
create policy reminder_campaign_jobs_insert_staff
on public.reminder_campaign_jobs
for insert
to authenticated
with check (public.is_staff());

drop policy if exists reminder_campaign_jobs_update_super_admin on public.reminder_campaign_jobs;
create policy reminder_campaign_jobs_update_super_admin
on public.reminder_campaign_jobs
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists reminder_campaign_jobs_delete_super_admin on public.reminder_campaign_jobs;
create policy reminder_campaign_jobs_delete_super_admin
on public.reminder_campaign_jobs
for delete
to authenticated
using (public.is_super_admin());

grant select, insert, update, delete on public.reminder_campaign_jobs to authenticated;
