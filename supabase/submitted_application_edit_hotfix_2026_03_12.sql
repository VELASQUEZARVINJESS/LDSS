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
          and a.is_locked = false
          and a.status in ('draft', 'submitted', 'returned_for_correction')
    );
$$;

drop policy if exists applications_update_owner_or_staff on public.applications;
create policy applications_update_owner_or_staff
on public.applications
for update
to authenticated
using (
    (applicant_id = auth.uid() and is_locked = false and status in ('draft', 'submitted', 'returned_for_correction'))
    or public.is_staff()
)
with check (
    (applicant_id = auth.uid() and is_locked = false and status in ('draft', 'submitted', 'returned_for_correction'))
    or public.is_staff()
);
