create table if not exists public.application_staff_flags (
    application_id uuid primary key references public.applications(id) on delete cascade,
    special_consideration_tag text,
    special_consideration_marked_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.application_staff_flags
    add column if not exists special_consideration_tag text;

alter table public.application_staff_flags
    add column if not exists special_consideration_marked_by uuid references public.profiles(id) on delete set null;

alter table public.application_staff_flags
    add column if not exists created_at timestamptz not null default timezone('utc', now());

alter table public.application_staff_flags
    add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.application_staff_flags enable row level security;

drop trigger if exists trg_application_staff_flags_updated_at on public.application_staff_flags;
create trigger trg_application_staff_flags_updated_at
before update on public.application_staff_flags
for each row execute function public.set_updated_at();

drop policy if exists application_staff_flags_select_staff on public.application_staff_flags;
create policy application_staff_flags_select_staff
on public.application_staff_flags
for select
using (public.is_staff());

drop policy if exists application_staff_flags_insert_staff on public.application_staff_flags;
create policy application_staff_flags_insert_staff
on public.application_staff_flags
for insert
with check (public.is_staff());

drop policy if exists application_staff_flags_update_staff on public.application_staff_flags;
create policy application_staff_flags_update_staff
on public.application_staff_flags
for update
using (public.is_staff())
with check (public.is_staff());

drop policy if exists application_staff_flags_delete_super_admin on public.application_staff_flags;
create policy application_staff_flags_delete_super_admin
on public.application_staff_flags
for delete
using (public.current_user_role() = 'super_admin');

grant select, insert, update, delete on public.application_staff_flags to authenticated;

create or replace function public.active_workflow_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    fallback_controls jsonb := jsonb_build_object(
        'application_intake_enabled', true,
        'require_admin_remarks', true,
        'lock_ranking_after_decision', true,
        'allow_special_endorsement', true,
        'allow_secretary_applicant_edits', false,
        'allow_secretary_special_consideration', false,
        'special_consideration_options', jsonb_build_array(),
        'auto_set_for_interview', true
    );
    db_controls jsonb := '{}'::jsonb;
begin
    begin
        select coalesce(rs.ranking_basis -> 'controls', '{}'::jsonb)
        into db_controls
        from public.ranking_settings rs
        where rs.is_active = true
        order by coalesce(rs.updated_at, rs.created_at) desc
        limit 1;
    exception
        when undefined_table then
            return fallback_controls;
    end;

    return fallback_controls || coalesce(db_controls, '{}'::jsonb);
end;
$$;

grant execute on function public.active_workflow_controls() to authenticated;
