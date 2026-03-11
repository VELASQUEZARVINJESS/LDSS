-- LDSP Security Hotfix
-- Date: 2026-03-10
-- Purpose:
-- 1) Prevent client-supplied signup metadata from assigning staff roles.
-- 2) Prevent authenticated users from self-escalating profiles.role.
-- 3) Ensure inactive profiles do not resolve to a privileged role.

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

-- Audit current staff-level accounts (run and review result):
-- select id, email, role, created_at
-- from public.profiles
-- where role in ('secretary', 'admin', 'super_admin')
-- order by created_at desc;

