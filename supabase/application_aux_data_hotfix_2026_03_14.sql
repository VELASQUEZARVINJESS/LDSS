create table if not exists public.application_aux_data (
    application_id uuid primary key references public.applications (id) on delete cascade,
    applicant_id uuid not null references public.profiles (id) on delete cascade,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_application_aux_data_applicant_id on public.application_aux_data (applicant_id);

drop trigger if exists trg_application_aux_data_updated_at on public.application_aux_data;
create trigger trg_application_aux_data_updated_at
before update on public.application_aux_data
for each row execute function public.set_updated_at();

alter table public.application_aux_data enable row level security;

drop policy if exists application_aux_data_select_owner_or_staff on public.application_aux_data;
create policy application_aux_data_select_owner_or_staff
on public.application_aux_data
for select
to authenticated
using (public.application_owned_by_current_user(application_id) or public.is_staff());

drop policy if exists application_aux_data_insert_owner_or_staff on public.application_aux_data;
create policy application_aux_data_insert_owner_or_staff
on public.application_aux_data
for insert
to authenticated
with check (
    ((applicant_id = auth.uid()) and public.application_owned_by_current_user(application_id))
    or public.is_staff()
);

drop policy if exists application_aux_data_update_owner_or_staff on public.application_aux_data;
create policy application_aux_data_update_owner_or_staff
on public.application_aux_data
for update
to authenticated
using (
    (applicant_id = auth.uid() and public.application_editable_by_current_user(application_id))
    or public.is_staff()
)
with check (
    (applicant_id = auth.uid() and public.application_editable_by_current_user(application_id))
    or public.is_staff()
);

drop policy if exists application_aux_data_delete_super_admin on public.application_aux_data;
create policy application_aux_data_delete_super_admin
on public.application_aux_data
for delete
to authenticated
using (public.is_super_admin());

grant select, insert, update, delete on public.application_aux_data to authenticated;
