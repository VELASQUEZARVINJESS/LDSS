create table if not exists public.reminder_email_logs (
    id uuid primary key default gen_random_uuid(),
    applicant_id uuid not null references public.profiles (id) on delete cascade,
    application_id uuid references public.applications (id) on delete set null,
    reminder_type text not null check (reminder_type in ('draft_only', 'no_application', 'returned_resubmission')),
    channel text not null default 'email' check (channel in ('email')),
    status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
    recipient_email text,
    sent_by uuid references public.profiles (id) on delete set null,
    error_message text,
    sent_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_reminder_email_logs_applicant_type_sent
on public.reminder_email_logs (applicant_id, reminder_type, sent_at desc);

create index if not exists idx_reminder_email_logs_sent_by
on public.reminder_email_logs (sent_by, sent_at desc);

alter table public.reminder_email_logs enable row level security;

drop policy if exists reminder_email_logs_select_staff on public.reminder_email_logs;
create policy reminder_email_logs_select_staff
on public.reminder_email_logs
for select
to authenticated
using (public.is_staff());

drop policy if exists reminder_email_logs_insert_staff on public.reminder_email_logs;
create policy reminder_email_logs_insert_staff
on public.reminder_email_logs
for insert
to authenticated
with check (public.is_staff());

drop policy if exists reminder_email_logs_update_super_admin on public.reminder_email_logs;
create policy reminder_email_logs_update_super_admin
on public.reminder_email_logs
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists reminder_email_logs_delete_super_admin on public.reminder_email_logs;
create policy reminder_email_logs_delete_super_admin
on public.reminder_email_logs
for delete
to authenticated
using (public.is_super_admin());

grant select, insert, update, delete on public.reminder_email_logs to authenticated;
