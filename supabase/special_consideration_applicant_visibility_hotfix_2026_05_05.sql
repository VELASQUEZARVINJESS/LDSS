create or replace function public.current_user_application_special_consideration_flags(p_application_ids uuid[])
returns table (
    application_id uuid,
    has_special_consideration boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select
        a.id as application_id,
        (
            coalesce(btrim(flags.special_consideration_tag), '') <> ''
            or coalesce(a.status::text, '') = 'special_endorsement_review'
            or coalesce(ar.special_endorsement, false)
        ) as has_special_consideration
    from public.applications a
    left join public.application_staff_flags flags
        on flags.application_id = a.id
    left join public.approval_records ar
        on ar.application_id = a.id
    where a.applicant_id = auth.uid()
      and a.id = any(coalesce(p_application_ids, '{}'::uuid[]));
$$;

grant execute on function public.current_user_application_special_consideration_flags(uuid[]) to authenticated;
