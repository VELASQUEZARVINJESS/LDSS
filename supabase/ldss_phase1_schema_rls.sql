-- LDSP Phase 1 Supabase Schema + RLS Bootstrap
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
            'pending_exam',
            'exam_scheduled',
            'exam_completed',
            'passed_exam',
            'failed_exam',
            'special_endorsement_review',
            'for_interview',
            'interview_scheduled',
            'interview_completed',
            'hard_copy_verified',
            'for_approval',
            'for_release',
            -- legacy values retained for backward compatibility:
            'under_secretary_review',
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
        'LDSP-' || to_char(timezone('utc', now()), 'YYYY') || '-' || lpad(nextval('public.application_no_seq')::text, 5, '0')
    ),
    applicant_id uuid not null references public.profiles (id) on delete cascade,
    application_type public.application_type not null default 'new',
    scholarship_type text not null,
    school_year text not null,
    sector_classification text,
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
    constraint applications_school_year_format check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    constraint applications_sector_classification_check check (
        sector_classification is null
        or sector_classification in (
            'Person with Disability (PWD)',
            'Solo Parent',
            'Child of Solo Parent',
            'Child of Farmer',
            'Child of Fisherfolk',
            'Orphan',
            'None of the above'
        )
    )
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
    where p.id = auth.uid()
      and p.is_active = true;
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

create or replace function public.super_admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if not public.is_super_admin() then
        raise exception 'Only super admin can delete users.'
            using errcode = '42501';
    end if;

    if p_user_id is null then
        raise exception 'User id is required.'
            using errcode = '22023';
    end if;

    if p_user_id = auth.uid() then
        raise exception 'You cannot delete your own account.'
            using errcode = '23514';
    end if;

    delete from auth.users
    where id = p_user_id;

    if not found then
        raise exception 'User not found.'
            using errcode = 'P0002';
    end if;
end;
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

create or replace function public.enforce_one_submission_per_school_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    has_any_conflict boolean := false;
begin
    if new.applicant_id is null or new.school_year is null then
        return new;
    end if;

    select exists (
        select 1
        from public.applications a
        where a.applicant_id = new.applicant_id
          and a.school_year = new.school_year
          and (tg_op = 'INSERT' or a.id <> new.id)
    )
    into has_any_conflict;

    if not has_any_conflict then
        return new;
    end if;

    raise exception 'Only one application attempt is allowed per school year.'
        using errcode = '23514';
end;
$$;

drop trigger if exists trg_applications_one_submission_per_school_year on public.applications;
create trigger trg_applications_one_submission_per_school_year
before insert or update of applicant_id, school_year, status on public.applications
for each row execute function public.enforce_one_submission_per_school_year();

create or replace function public.application_intake_is_open()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    active_open_date date;
    active_close_date date;
    active_enabled boolean := true;
    policy_exists boolean := false;
    current_local_date date := timezone('Asia/Manila', now())::date;
    is_open boolean := true;
    reason text := 'open';
begin
    begin
        select
            rs.application_open_date,
            rs.application_close_date,
            coalesce((rs.ranking_basis -> 'controls' ->> 'application_intake_enabled')::boolean, true),
            true
        into
            active_open_date,
            active_close_date,
            active_enabled,
            policy_exists
        from public.ranking_settings rs
        where rs.is_active = true
        order by coalesce(rs.updated_at, rs.created_at) desc
        limit 1;
    exception
        when undefined_table then
            return jsonb_build_object(
                'is_open', true,
                'enabled', true,
                'open_date', null,
                'close_date', null,
                'reason', 'open'
            );
    end;

    if not policy_exists then
        return jsonb_build_object(
            'is_open', true,
            'enabled', true,
            'open_date', null,
            'close_date', null,
            'reason', 'open'
        );
    end if;

    if not active_enabled then
        is_open := false;
        reason := 'closed_by_admin';
    elsif active_open_date is not null and current_local_date < active_open_date then
        is_open := false;
        reason := 'before_open_date';
    elsif active_close_date is not null and current_local_date > active_close_date then
        is_open := false;
        reason := 'after_close_date';
    end if;

    return jsonb_build_object(
        'is_open', is_open,
        'enabled', active_enabled,
        'open_date', active_open_date,
        'close_date', active_close_date,
        'reason', reason
    );
end;
$$;

create or replace function public.enforce_application_intake_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    policy jsonb;
    intake_open boolean := true;
    intake_reason text := 'open';
    intake_open_date text := '';
    intake_close_date text := '';
begin
    if auth.uid() is null then
        return new;
    end if;

    if new.applicant_id <> auth.uid() then
        return new;
    end if;

    if public.current_user_role() <> 'applicant' then
        return new;
    end if;

    policy := public.application_intake_is_open();
    intake_open := coalesce((policy ->> 'is_open')::boolean, true);
    intake_reason := coalesce(policy ->> 'reason', 'open');
    intake_open_date := coalesce(policy ->> 'open_date', '');
    intake_close_date := coalesce(policy ->> 'close_date', '');

    if intake_open then
        return new;
    end if;

    if intake_reason = 'before_open_date' and intake_open_date <> '' then
        raise exception 'Application filing opens on %.', intake_open_date
            using errcode = '23514';
    end if;

    if intake_reason = 'after_close_date' and intake_close_date <> '' then
        raise exception 'Application filing closed on %.', intake_close_date
            using errcode = '23514';
    end if;

    raise exception 'Application filing is currently closed by System Administrator.'
        using errcode = '23514';
end;
$$;

drop trigger if exists trg_applications_march_window on public.applications;
drop trigger if exists trg_applications_intake_policy on public.applications;
create trigger trg_applications_intake_policy
before insert on public.applications
for each row execute function public.enforce_application_intake_policy();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    final_role public.app_role := 'applicant';
begin
    -- Never trust client metadata for privileged roles.
    -- Staff roles must be assigned by a super admin or server-side admin process.
    final_role := 'applicant';

    insert into public.profiles (
        id,
        role,
        email,
        mobile_number,
        first_name,
        middle_name,
        last_name
    )
    values (
        new.id,
        final_role,
        new.email,
        nullif(new.phone, ''),
        nullif(new.raw_user_meta_data ->> 'first_name', ''),
        nullif(new.raw_user_meta_data ->> 'middle_name', ''),
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
with check (
    (id = auth.uid() and role = 'applicant')
    or public.is_super_admin()
);

drop policy if exists profiles_update_self_or_super_admin on public.profiles;
create policy profiles_update_self_or_super_admin
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_super_admin())
with check (
    public.is_super_admin()
    or (
        id = auth.uid()
        and role = public.current_user_role()
    )
);

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
grant execute on function public.super_admin_delete_user(uuid) to authenticated;
grant execute on function public.application_owned_by_current_user(uuid) to authenticated;
grant execute on function public.application_editable_by_current_user(uuid) to authenticated;
grant execute on function public.application_intake_is_open() to authenticated;

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
        or (storage.foldername(name))[3] = auth.uid()::text
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
            and (
                (storage.foldername(name))[2] = auth.uid()::text
                or (storage.foldername(name))[3] = auth.uid()::text
            )
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
        or (storage.foldername(name))[3] = auth.uid()::text
    )
)
with check (
    bucket_id = 'ldss-documents'
    and (
        public.is_staff()
        or (storage.foldername(name))[2] = auth.uid()::text
        or (storage.foldername(name))[3] = auth.uid()::text
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
        or (storage.foldername(name))[3] = auth.uid()::text
    )
);

-- ============================================
-- Phase 1.2 Workflow Extension (Exam-Interview-Approval)
-- ============================================

alter type public.application_status add value if not exists 'pending_exam';
alter type public.application_status add value if not exists 'exam_scheduled';
alter type public.application_status add value if not exists 'exam_completed';
alter type public.application_status add value if not exists 'passed_exam';
alter type public.application_status add value if not exists 'failed_exam';
alter type public.application_status add value if not exists 'special_endorsement_review';
alter type public.application_status add value if not exists 'for_interview';
alter type public.application_status add value if not exists 'interview_completed';
alter type public.application_status add value if not exists 'hard_copy_verified';
alter type public.application_status add value if not exists 'for_approval';
alter type public.application_status add value if not exists 'for_release';

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'exam_batch_status'
          and n.nspname = 'public'
    ) then
        create type public.exam_batch_status as enum ('open', 'closed', 'archived');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'exam_record_status'
          and n.nspname = 'public'
    ) then
        create type public.exam_record_status as enum ('scheduled', 'completed', 'encoded');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'exam_result_status'
          and n.nspname = 'public'
    ) then
        create type public.exam_result_status as enum ('pending', 'passed', 'failed');
    end if;
end $$;

create table if not exists public.exam_batches (
    id uuid primary key default gen_random_uuid(),
    batch_label text not null,
    exam_datetime timestamptz not null,
    venue text not null,
    capacity integer,
    notes text,
    status public.exam_batch_status not null default 'open',
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint exam_batches_capacity_positive check (capacity is null or capacity > 0)
);

create table if not exists public.exam_records (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null unique references public.applications (id) on delete cascade,
    batch_id uuid references public.exam_batches (id) on delete set null,
    exam_control_no text unique,
    scheduled_at timestamptz,
    raw_score numeric(7, 2),
    percentage_score numeric(5, 2),
    result public.exam_result_status not null default 'pending',
    status public.exam_record_status not null default 'scheduled',
    checked_by uuid references public.profiles (id) on delete set null,
    encoded_by uuid references public.profiles (id) on delete set null,
    checked_at timestamptz,
    encoded_at timestamptz,
    remarks text,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint exam_records_raw_score_non_negative check (raw_score is null or raw_score >= 0),
    constraint exam_records_percentage_range check (percentage_score is null or (percentage_score >= 0 and percentage_score <= 100))
);

create table if not exists public.interview_records (
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
    hard_copy_verified boolean not null default false,
    hard_copy_verified_at timestamptz,
    encoded_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint interview_records_exam_score_range check (exam_score is null or (exam_score >= 0 and exam_score <= 100))
);

create table if not exists public.approval_records (
    id uuid primary key default gen_random_uuid(),
    application_id uuid not null unique references public.applications (id) on delete cascade,
    priority public.approval_priority not null default 'medium',
    recommendation_status text not null default 'pending',
    recommendation_notes text,
    queued_at timestamptz not null default timezone('utc', now()),
    decision_status public.decision_status not null default 'pending',
    decision_notes text,
    special_endorsement boolean not null default false,
    ranking_score numeric(8, 2),
    ranking_basis jsonb,
    decided_by uuid references public.profiles (id) on delete set null,
    decided_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint approval_records_ranking_non_negative check (ranking_score is null or ranking_score >= 0)
);

create table if not exists public.ranking_settings (
    id uuid primary key default gen_random_uuid(),
    school_year text not null unique,
    quota_slots integer not null default 0,
    waitlist_slots integer not null default 0,
    passing_score numeric(5, 2) not null default 75,
    exam_total_items integer not null default 100,
    application_open_date date,
    application_close_date date,
    ranking_basis jsonb not null default '{}'::jsonb,
    is_active boolean not null default true,
    managed_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint ranking_settings_school_year_format check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
    constraint ranking_settings_quota_non_negative check (quota_slots >= 0 and waitlist_slots >= 0),
    constraint ranking_settings_passing_range check (passing_score >= 0 and passing_score <= 100),
    constraint ranking_settings_exam_items_positive check (exam_total_items > 0),
    constraint ranking_settings_window_order check (application_open_date is null or application_close_date is null or application_close_date >= application_open_date)
);

create index if not exists idx_exam_batches_datetime on public.exam_batches (exam_datetime desc);
create index if not exists idx_exam_batches_status on public.exam_batches (status, exam_datetime desc);
create index if not exists idx_exam_records_batch_status on public.exam_records (batch_id, status, updated_at desc);
create index if not exists idx_exam_records_result on public.exam_records (result, updated_at desc);
create index if not exists idx_interview_records_status_schedule on public.interview_records (status, scheduled_at);
create index if not exists idx_approval_records_decision_status on public.approval_records (decision_status, queued_at desc);
create index if not exists idx_approval_records_ranking on public.approval_records (ranking_score desc nulls last);
create index if not exists idx_ranking_settings_active_year on public.ranking_settings (is_active, school_year);

drop trigger if exists trg_exam_batches_updated_at on public.exam_batches;
create trigger trg_exam_batches_updated_at
before update on public.exam_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_exam_records_updated_at on public.exam_records;
create trigger trg_exam_records_updated_at
before update on public.exam_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_interview_records_updated_at on public.interview_records;
create trigger trg_interview_records_updated_at
before update on public.interview_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_approval_records_updated_at on public.approval_records;
create trigger trg_approval_records_updated_at
before update on public.approval_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_ranking_settings_updated_at on public.ranking_settings;
create trigger trg_ranking_settings_updated_at
before update on public.ranking_settings
for each row execute function public.set_updated_at();

alter table public.exam_batches enable row level security;
alter table public.exam_records enable row level security;
alter table public.interview_records enable row level security;
alter table public.approval_records enable row level security;
alter table public.ranking_settings enable row level security;

drop policy if exists exam_batches_select_staff on public.exam_batches;
create policy exam_batches_select_staff
on public.exam_batches
for select
to authenticated
using (public.is_staff());

drop policy if exists exam_batches_insert_staff on public.exam_batches;
create policy exam_batches_insert_staff
on public.exam_batches
for insert
to authenticated
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists exam_batches_update_staff on public.exam_batches;
create policy exam_batches_update_staff
on public.exam_batches
for update
to authenticated
using (public.current_user_role() in ('secretary', 'admin', 'super_admin'))
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists exam_batches_delete_super_admin on public.exam_batches;
create policy exam_batches_delete_super_admin
on public.exam_batches
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists exam_records_select_owner_or_staff on public.exam_records;
create policy exam_records_select_owner_or_staff
on public.exam_records
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists exam_records_insert_staff on public.exam_records;
create policy exam_records_insert_staff
on public.exam_records
for insert
to authenticated
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists exam_records_update_staff on public.exam_records;
create policy exam_records_update_staff
on public.exam_records
for update
to authenticated
using (public.current_user_role() in ('secretary', 'admin', 'super_admin'))
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists exam_records_delete_super_admin on public.exam_records;
create policy exam_records_delete_super_admin
on public.exam_records
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists interview_records_select_owner_or_staff on public.interview_records;
create policy interview_records_select_owner_or_staff
on public.interview_records
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists interview_records_insert_staff on public.interview_records;
create policy interview_records_insert_staff
on public.interview_records
for insert
to authenticated
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists interview_records_update_staff on public.interview_records;
create policy interview_records_update_staff
on public.interview_records
for update
to authenticated
using (public.current_user_role() in ('secretary', 'admin', 'super_admin'))
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists interview_records_delete_super_admin on public.interview_records;
create policy interview_records_delete_super_admin
on public.interview_records
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists approval_records_select_admin_or_higher on public.approval_records;
create policy approval_records_select_admin_or_higher
on public.approval_records
for select
to authenticated
using (public.is_admin_or_higher());

drop policy if exists approval_records_insert_staff on public.approval_records;
create policy approval_records_insert_staff
on public.approval_records
for insert
to authenticated
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists approval_records_update_staff on public.approval_records;
create policy approval_records_update_staff
on public.approval_records
for update
to authenticated
using (public.current_user_role() in ('secretary', 'admin', 'super_admin'))
with check (public.current_user_role() in ('secretary', 'admin', 'super_admin'));

drop policy if exists approval_records_delete_super_admin on public.approval_records;
create policy approval_records_delete_super_admin
on public.approval_records
for delete
to authenticated
using (public.is_super_admin());

drop policy if exists ranking_settings_select_admin_or_higher on public.ranking_settings;
create policy ranking_settings_select_admin_or_higher
on public.ranking_settings
for select
to authenticated
using (public.is_admin_or_higher());

drop policy if exists ranking_settings_insert_super_admin on public.ranking_settings;
create policy ranking_settings_insert_super_admin
on public.ranking_settings
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists ranking_settings_update_super_admin on public.ranking_settings;
create policy ranking_settings_update_super_admin
on public.ranking_settings
for update
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists ranking_settings_delete_super_admin on public.ranking_settings;
create policy ranking_settings_delete_super_admin
on public.ranking_settings
for delete
to authenticated
using (public.is_super_admin());

grant select, insert, update, delete on public.exam_batches to authenticated;
grant select, insert, update, delete on public.exam_records to authenticated;
grant select, insert, update, delete on public.interview_records to authenticated;
grant select, insert, update, delete on public.approval_records to authenticated;
grant select, insert, update, delete on public.ranking_settings to authenticated;

