alter table public.application_staff_flags
    add column if not exists final_list_inclusion boolean not null default false;

alter table public.application_staff_flags
    add column if not exists final_list_inclusion_marked_by uuid references public.profiles(id) on delete set null;

alter table public.application_staff_flags
    add column if not exists final_list_inclusion_updated_at timestamptz;

alter table public.application_staff_flags
    add column if not exists final_list_inclusion_endorsed_by text;
