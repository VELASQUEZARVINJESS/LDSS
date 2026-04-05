create table if not exists public.exam_schedule_email_jobs (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid references public.exam_batches (id) on delete set null,
    batch_label text,
    recipient_payloads jsonb not null default '[]'::jsonb,
    total_recipients integer not null default 0 check (total_recipients >= 0),
    processed_count integer not null default 0 check (processed_count >= 0),
    sent_count integer not null default 0 check (sent_count >= 0),
    skipped_count integer not null default 0 check (skipped_count >= 0),
    failed_count integer not null default 0 check (failed_count >= 0),
    batch_size integer not null default 100 check (batch_size > 0 and batch_size <= 500),
    batch_delay_minutes integer not null default 5 check (batch_delay_minutes > 0 and batch_delay_minutes <= 1440),
    created_by uuid references public.profiles (id) on delete set null,
    status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    next_run_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    last_error text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint exam_schedule_email_jobs_payloads_is_array check (jsonb_typeof(recipient_payloads) = 'array')
);

create index if not exists idx_exam_schedule_email_jobs_status_next_run
on public.exam_schedule_email_jobs (status, next_run_at asc, created_at asc);

create index if not exists idx_exam_schedule_email_jobs_batch_id
on public.exam_schedule_email_jobs (batch_id, created_at desc);

create index if not exists idx_exam_schedule_email_jobs_created_by
on public.exam_schedule_email_jobs (created_by, created_at desc);

drop trigger if exists set_exam_schedule_email_jobs_updated_at on public.exam_schedule_email_jobs;
create trigger set_exam_schedule_email_jobs_updated_at
before update on public.exam_schedule_email_jobs
for each row execute function public.set_updated_at();

alter table public.exam_schedule_email_jobs enable row level security;

drop policy if exists exam_schedule_email_jobs_select_staff on public.exam_schedule_email_jobs;
create policy exam_schedule_email_jobs_select_staff
on public.exam_schedule_email_jobs
for select
to authenticated
using (public.is_staff());

drop policy if exists exam_schedule_email_jobs_insert_staff on public.exam_schedule_email_jobs;
create policy exam_schedule_email_jobs_insert_staff
on public.exam_schedule_email_jobs
for insert
to authenticated
with check (public.is_staff());

drop policy if exists exam_schedule_email_jobs_update_super_admin on public.exam_schedule_email_jobs;
create policy exam_schedule_email_jobs_update_super_admin
on public.exam_schedule_email_jobs
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists exam_schedule_email_jobs_delete_super_admin on public.exam_schedule_email_jobs;
create policy exam_schedule_email_jobs_delete_super_admin
on public.exam_schedule_email_jobs
for delete
to authenticated
using (public.is_super_admin());

grant select, insert, update, delete on public.exam_schedule_email_jobs to authenticated;
