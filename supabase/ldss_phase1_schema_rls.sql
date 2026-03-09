-- LDSS Phase 1 Supabase Schema + RLS Bootstrap
-- Run this entire script in Supabase SQL Editor.
-- Date: 2026-03-10

create extension if not exists pgcrypto;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'app_role'
          and n.nspname = 'public'
    ) then
        create type public.app_role as enum ('applicant', 'secretary', 'admin', 'super_admin');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'application_type'
          and n.nspname = 'public'
    ) then
        create type public.application_type as enum ('new', 'renewal');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'application_status'
          and n.nspname = 'public'
    ) then
        create type public.application_status as enum (
            'draft',
            'submitted',
            'under_secretary_review',
            'interview_scheduled',
            'recommended',
            'for_admin_approval',
            'approved',
            'waitlisted',
            'rejected',
            'returned_for_correction',
            'certification_ready',
            'release_scheduled',
            'released'
        );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'document_type'
          and n.nspname = 'public'
    ) then
        create type public.document_type as enum (
            'proof_of_enrollment',
            'report_card',
            'barangay_certificate',
            'income_certificate',
            'applicant_photo',
            'verified_interview_photo',
            'other'
        );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'document_verification_status'
          and n.nspname = 'public'
    ) then
        create type public.document_verification_status as enum ('pending', 'verified', 'rejected', 'needs_reupload');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'interview_status'
          and n.nspname = 'public'
    ) then
        create type public.interview_status as enum ('not_scheduled', 'scheduled', 'rescheduled', 'completed', 'no_show', 'cancelled');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'interview_result'
          and n.nspname = 'public'
    ) then
        create type public.interview_result as enum ('pending', 'recommended', 'not_recommended', 'waitlisted');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'approval_priority'
          and n.nspname = 'public'
    ) then
        create type public.approval_priority as enum ('low', 'medium', 'high');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'decision_status'
          and n.nspname = 'public'
    ) then
        create type public.decision_status as enum ('pending', 'approved', 'waitlisted', 'rejected', 'returned_for_correction');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'release_batch_status'
          and n.nspname = 'public'
    ) then
        create type public.release_batch_status as enum ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'notification_type'
          and n.nspname = 'public'
    ) then
        create type public.notification_type as enum ('info', 'application', 'interview', 'approval', 'certification', 'release', 'reminder');
    end if;
end $$;

create sequence if not exists public.application_no_seq start 1 increment 1;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    role public.app_role not null default 'applicant',
    email text unique,
    mobile_number text unique,
    first_name text,
    middle_name text,
    last_name text,
    sex text,
    civil_status text,
    date_of_birth date,
    barangay text,
    address text,
    school_name text,
    course_or_strand text,
    year_level text,
    student_number text,
    guardian_name text,
    guardian_occupation text,
    monthly_income numeric(12, 2),
    applicant_photo_path text,
    verified_interview_photo_path text,
    is_active boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint profiles_monthly_income_non_negative check (monthly_income is null or monthly_income >= 0)
);

create table if not exists public.release_batches (
    id uuid primary key default gen_random_uuid(),
    batch_code text not null unique,
    release_date date,
    venue text,
    status public.release_batch_status not null default 'draft',
    notes text,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.applications (
    id uuid primary key default gen_random_uuid(),
    application_no text not null unique default (
        'LDSS-' || to_char(timezone('utc', now()), 'YYYY') || '-' || lpad(nextval('public.application_no_seq')::text, 5, '0')
    ),
    applicant_id uuid not null references public.profiles (id) on delete cascade,
    application_type public.application_type not null default 'new',
    scholarship_type text not null,
    school_year text not null,
    status public.application_status not null default 'draft',
    submitted_at timestamptz,
    secretary_reviewer_id uuid references public.profiles (id) on delete set null,
    admin_reviewer_id uuid references public.profiles (id) on delete set null,
    secretary_remarks text,
    admin_remarks text,
    is_locked boolean not null default false,
    certification_pdf_path text,
    release_batch_id uuid references public.release_batches (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint applications_school_year_format check (school_year ~ '^[0-9]{4}-[0-9]{4}$')
);

create table if not exists public.application_documents (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null references public.applications (id) on delete cascade,
    document_type public.document_type not null,
    storage_path text not null,
    original_filename text,
    mime_type text,
    file_size_bytes bigint,
    verification_status public.document_verification_status not null default 'pending',
    verification_notes text,
    uploaded_by uuid references public.profiles (id) on delete set null,
    verified_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint application_documents_file_size_non_negative check (file_size_bytes is null or file_size_bytes >= 0)
);

create table if not exists public.interviews (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null unique references public.applications (id) on delete cascade,
    batch_label text,
    scheduled_at timestamptz,
    venue text,
    status public.interview_status not null default 'not_scheduled',
    result public.interview_result not null default 'pending',
    exam_score numeric(5, 2),
    remarks text,
    verified_photo_path text,
    encoded_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint interviews_exam_score_range check (exam_score is null or (exam_score >= 0 and exam_score <= 100))
);

create table if not exists public.approval_queue (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null unique references public.applications (id) on delete cascade,
    priority public.approval_priority not null default 'medium',
    secretary_recommendation public.decision_status not null default 'pending',
    recommendation_notes text,
    queued_at timestamptz not null default timezone('utc', now()),
    decision_status public.decision_status not null default 'pending',
    decided_by uuid references public.profiles (id) on delete set null,
    decided_at timestamptz,
    decision_notes text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_user_id uuid not null references public.profiles (id) on delete cascade,
    sender_user_id uuid references public.profiles (id) on delete set null,
    notification_type public.notification_type not null default 'info',
    title text not null,
    message text not null,
    related_application_id uuid references public.applications (id) on delete set null,
    related_url text,
    is_read boolean not null default false,
    read_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_mobile_number on public.profiles (mobile_number);
create index if not exists idx_release_batches_status_date on public.release_batches (status, release_date);
create index if not exists idx_applications_applicant_id on public.applications (applicant_id);
create index if not exists idx_applications_status_created_at on public.applications (status, created_at desc);
create index if not exists idx_applications_release_batch_id on public.applications (release_batch_id);
create index if not exists idx_application_documents_application_id on public.application_documents (application_id);
create index if not exists idx_application_documents_type on public.application_documents (document_type);
create index if not exists idx_interviews_status_scheduled on public.interviews (status, scheduled_at);
create index if not exists idx_approval_queue_decision_status on public.approval_queue (decision_status, queued_at);
create index if not exists idx_notifications_recipient_read_created on public.notifications (recipient_user_id, is_read, created_at desc);
create index if not exists idx_notifications_related_application on public.notifications (related_application_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_release_batches_updated_at on public.release_batches;
create trigger trg_release_batches_updated_at
before update on public.release_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_applications_updated_at on public.applications;
create trigger trg_applications_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

drop trigger if exists trg_application_documents_updated_at on public.application_documents;
create trigger trg_application_documents_updated_at
before update on public.application_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_interviews_updated_at on public.interviews;
create trigger trg_interviews_updated_at
before update on public.interviews
for each row execute function public.set_updated_at();

drop trigger if exists trg_approval_queue_updated_at on public.approval_queue;
create trigger trg_approval_queue_updated_at
before update on public.approval_queue
for each row execute function public.set_updated_at();

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
    select p.role
    from public.profiles p
    where p.id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.current_user_role() in ('secretary', 'admin', 'super_admin'), false);
$$;

create or replace function public.is_admin_or_higher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.current_user_role() in ('admin', 'super_admin'), false);
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.current_user_role() = 'super_admin', false);
$$;

create or replace function public.application_owned_by_current_user(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.applications a
        where a.id = p_application_id
          and a.applicant_id = auth.uid()
    );
$$;

create or replace function public.application_editable_by_current_user(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.applications a
        where a.id = p_application_id
          and a.applicant_id = auth.uid()
          and a.status in ('draft', 'returned_for_correction')
    );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_role text;
    final_role public.app_role := 'applicant';
begin
    requested_role := lower(coalesce(new.raw_user_meta_data ->> 'role', ''));

    if requested_role = 'secretary' then
        final_role := 'secretary';
    elsif requested_role = 'admin' then
        final_role := 'admin';
    elsif requested_role = 'super_admin' then
        final_role := 'super_admin';
    else
        final_role := 'applicant';
    end if;

    insert into public.profiles (
        id,
        role,
        email,
        mobile_number,
        first_name,
        last_name
    )
    values (
        new.id,
        final_role,
        new.email,
        nullif(new.phone, ''),
        nullif(new.raw_user_meta_data ->> 'first_name', ''),
        nullif(new.raw_user_meta_data ->> 'last_name', '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.release_batches enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.interviews enable row level security;
alter table public.approval_queue enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_select_own_or_staff on public.profiles;
create policy profiles_select_own_or_staff
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_insert_self_or_super_admin on public.profiles;
create policy profiles_insert_self_or_super_admin
on public.profiles
for insert
to authenticated
with check (id = auth.uid() or public.is_super_admin());

drop policy if exists profiles_update_self_or_super_admin on public.profiles;
create policy profiles_update_self_or_super_admin
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_super_admin())
with check (id = auth.uid() or public.is_super_admin());

drop policy if exists profiles_delete_super_admin on public.profiles;
create policy profiles_delete_super_admin
on public.profiles
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists release_batches_select_staff on public.release_batches;
create policy release_batches_select_staff
on public.release_batches
for select
to authenticated
using (public.is_staff());

drop policy if exists release_batches_insert_admin on public.release_batches;
create policy release_batches_insert_admin
on public.release_batches
for insert
to authenticated
with check (public.is_admin_or_higher());

drop policy if exists release_batches_update_admin on public.release_batches;
create policy release_batches_update_admin
on public.release_batches
for update
to authenticated
using (public.is_admin_or_higher())
with check (public.is_admin_or_higher());

drop policy if exists release_batches_delete_super_admin on public.release_batches;
create policy release_batches_delete_super_admin
on public.release_batches
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists applications_select_owner_or_staff on public.applications;
create policy applications_select_owner_or_staff
on public.applications
for select
to authenticated
using (applicant_id = auth.uid() or public.is_staff());

drop policy if exists applications_insert_owner_or_admin on public.applications;
create policy applications_insert_owner_or_admin
on public.applications
for insert
to authenticated
with check (
    (applicant_id = auth.uid() and public.current_user_role() = 'applicant')
    or public.is_admin_or_higher()
);

drop policy if exists applications_update_owner_or_staff on public.applications;
create policy applications_update_owner_or_staff
on public.applications
for update
to authenticated
using (
    (applicant_id = auth.uid() and status in ('draft', 'returned_for_correction'))
    or public.is_staff()
)
with check (
    (applicant_id = auth.uid() and status in ('draft', 'submitted', 'returned_for_correction'))
    or public.is_staff()
);

drop policy if exists applications_delete_draft_owner_or_super_admin on public.applications;
create policy applications_delete_draft_owner_or_super_admin
on public.applications
for delete
to authenticated
using (
    (applicant_id = auth.uid() and status = 'draft')
    or public.is_super_admin()
);

drop policy if exists application_documents_select_owner_or_staff on public.application_documents;
create policy application_documents_select_owner_or_staff
on public.application_documents
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists application_documents_insert_owner_or_staff on public.application_documents;
create policy application_documents_insert_owner_or_staff
on public.application_documents
for insert
to authenticated
with check (
    (public.application_owned_by_current_user(application_id) and public.application_editable_by_current_user(application_id))
    or public.is_staff()
);

drop policy if exists application_documents_update_owner_or_staff on public.application_documents;
create policy application_documents_update_owner_or_staff
on public.application_documents
for update
to authenticated
using (
    (public.application_owned_by_current_user(application_id) and public.application_editable_by_current_user(application_id))
    or public.is_staff()
)
with check (
    (public.application_owned_by_current_user(application_id) and public.application_editable_by_current_user(application_id))
    or public.is_staff()
);

drop policy if exists application_documents_delete_owner_or_staff on public.application_documents;
create policy application_documents_delete_owner_or_staff
on public.application_documents
for delete
to authenticated
using (
    (public.application_owned_by_current_user(application_id) and public.application_editable_by_current_user(application_id))
    or public.is_staff()
);

drop policy if exists interviews_select_owner_or_staff on public.interviews;
create policy interviews_select_owner_or_staff
on public.interviews
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists interviews_insert_staff on public.interviews;
create policy interviews_insert_staff
on public.interviews
for insert
to authenticated
with check (public.is_staff());

drop policy if exists interviews_update_staff on public.interviews;
create policy interviews_update_staff
on public.interviews
for update
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists interviews_delete_super_admin on public.interviews;
create policy interviews_delete_super_admin
on public.interviews
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists approval_queue_select_owner_or_staff on public.approval_queue;
create policy approval_queue_select_owner_or_staff
on public.approval_queue
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists approval_queue_insert_staff on public.approval_queue;
create policy approval_queue_insert_staff
on public.approval_queue
for insert
to authenticated
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists approval_queue_update_staff on public.approval_queue;
create policy approval_queue_update_staff
on public.approval_queue
for update
to authenticated
using (public.current_user_role() in ('secretary', 'admin', 'super_admin'))
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists approval_queue_delete_super_admin on public.approval_queue;
create policy approval_queue_delete_super_admin
on public.approval_queue
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists notifications_select_recipient_or_staff on public.notifications;
create policy notifications_select_recipient_or_staff
on public.notifications
for select
to authenticated
using (recipient_user_id = auth.uid() or public.is_staff());

drop policy if exists notifications_insert_staff on public.notifications;
create policy notifications_insert_staff
on public.notifications
for insert
to authenticated
with check (public.is_staff());

drop policy if exists notifications_update_recipient_or_staff on public.notifications;
create policy notifications_update_recipient_or_staff
on public.notifications
for update
to authenticated
using (recipient_user_id = auth.uid() or public.is_staff())
with check (recipient_user_id = auth.uid() or public.is_staff());

drop policy if exists notifications_delete_super_admin on public.notifications;
create policy notifications_delete_super_admin
on public.notifications
for delete
to authenticated
using (public.is_super_admin());

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.release_batches to authenticated;
grant select, insert, update, delete on public.applications to authenticated;
grant select, insert, update, delete on public.application_documents to authenticated;
grant select, insert, update, delete on public.interviews to authenticated;
grant select, insert, update, delete on public.approval_queue to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant usage, select on sequence public.application_no_seq to authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin_or_higher() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.application_owned_by_current_user(uuid) to authenticated;
grant execute on function public.application_editable_by_current_user(uuid) to authenticated;

-- Storage bootstrap for applicant requirement uploads
insert into storage.buckets (id, name, public)
values ('ldss-documents', 'ldss-documents', false)
on conflict (id) do nothing;

drop policy if exists ldss_documents_select_owner_or_staff on storage.objects;
create policy ldss_documents_select_owner_or_staff
on storage.objects
for select
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
    )
);

drop policy if exists ldss_documents_insert_owner_or_staff on storage.objects;
create policy ldss_documents_insert_owner_or_staff
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (
            public.current_user_role() = 'applicant'
            and (storage.foldername(name))[2] = auth.uid()::text
        )
    )
);

drop policy if exists ldss_documents_update_owner_or_staff on storage.objects;
create policy ldss_documents_update_owner_or_staff
on storage.objects
for update
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
    )
)
with check (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
    )
);

drop policy if exists ldss_documents_delete_owner_or_staff on storage.objects;
create policy ldss_documents_delete_owner_or_staff
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
    )
);
