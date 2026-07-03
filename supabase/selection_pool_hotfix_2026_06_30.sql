alter table public.application_staff_flags
    add column if not exists selection_included boolean not null default false;

alter table public.application_staff_flags
    add column if not exists selection_category text;

alter table public.application_staff_flags
    add column if not exists selection_notes text;

alter table public.application_staff_flags
    add column if not exists selection_marked_by uuid references public.profiles(id) on delete set null;

alter table public.application_staff_flags
    add column if not exists selection_updated_at timestamptz;
