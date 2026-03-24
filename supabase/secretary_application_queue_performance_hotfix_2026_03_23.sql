create index if not exists idx_applications_queue_non_draft_updated_at
on public.applications (updated_at desc)
where status <> 'draft';

create index if not exists idx_notifications_related_type_created
on public.notifications (related_application_id, notification_type, created_at desc);
