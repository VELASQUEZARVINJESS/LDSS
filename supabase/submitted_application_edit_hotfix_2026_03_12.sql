create or replace function public.application_editable_by_current_user(p_application_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    return exists (
        select 1
        from public.applications a
        where a.id = p_application_id
          and a.applicant_id = auth.uid()
    );
end;
$$;

drop policy if exists applications_update_owner_or_staff on public.applications;
create policy applications_update_owner_or_staff
on public.applications
for update
to authenticated
using (
    public.application_editable_by_current_user(id)
    or public.is_staff()
)
with check (
    public.application_editable_by_current_user(id)
    or public.is_staff()
);
