alter table public.application_staff_flags
    add column if not exists initial_screening_batch_label text;

alter table public.application_staff_flags
    add column if not exists initial_screening_scheduled_at timestamptz;

alter table public.application_staff_flags
    add column if not exists initial_screening_venue text;

alter table public.application_staff_flags
    add column if not exists initial_screening_status text not null default 'not_scheduled';

alter table public.application_staff_flags
    add column if not exists initial_screening_notes text;

alter table public.application_staff_flags
    add column if not exists initial_screening_marked_by uuid references public.profiles(id) on delete set null;

alter table public.application_staff_flags
    add column if not exists initial_screening_updated_at timestamptz;
