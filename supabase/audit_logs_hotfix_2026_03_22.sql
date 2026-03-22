create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    module text not null default 'system_admin',
    action text not null,
    actor_id uuid references public.profiles (id) on delete set null,
    actor_role public.app_role not null default 'super_admin',
    target_user_id uuid references public.profiles (id) on delete set null,
    target_role public.app_role,
    target_email text,
    target_label text,
    record_type text not null default 'system',
    record_id text,
    summary text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_audit_logs_created_at
on public.audit_logs (created_at desc);

create index if not exists idx_audit_logs_module_action_created
on public.audit_logs (module, action, created_at desc);

create index if not exists idx_audit_logs_actor_created
on public.audit_logs (actor_id, created_at desc);

create index if not exists idx_audit_logs_target_user_created
on public.audit_logs (target_user_id, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_super_admin on public.audit_logs;
create policy audit_logs_select_super_admin
on public.audit_logs
for select
to authenticated
using (public.is_super_admin());

drop policy if exists audit_logs_insert_super_admin on public.audit_logs;
create policy audit_logs_insert_super_admin
on public.audit_logs
for insert
to authenticated
with check (
    public.is_super_admin()
    and actor_id = auth.uid()
    and actor_role = 'super_admin'
);

grant select, insert on public.audit_logs to authenticated;
