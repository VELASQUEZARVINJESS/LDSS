-- LDSP User Management Hotfix
-- Date: 2026-03-10
-- Purpose:
-- 1) Enable secure Super Admin user deletion from the web client.
-- 2) Keep deletion server-guarded (cannot delete own account, super_admin only).

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

grant execute on function public.super_admin_delete_user(uuid) to authenticated;
