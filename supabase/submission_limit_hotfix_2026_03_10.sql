-- LDSP Submission + Intake Policy Hotfix
-- Date: 2026-03-10
-- Purpose:
-- 1) Allow only one application attempt per applicant per school year (including draft).
-- 2) Keep edits on the same existing application allowed.
-- 3) Make new application filing switchable ON/OFF by System Administrator using ranking settings.

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

grant execute on function public.application_intake_is_open() to authenticated;
