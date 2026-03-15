alter table public.notifications
add column if not exists dismissed_at timestamptz;

create index if not exists idx_notifications_recipient_dismissed_created
on public.notifications (recipient_user_id, dismissed_at, created_at desc);
