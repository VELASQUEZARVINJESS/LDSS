create or replace function public.current_user_application_sector_selection_flags(p_application_ids uuid[])
returns table (
    application_id uuid,
    is_sector_selected boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with workflow as (
        select public.active_workflow_controls() as controls
    ),
    policy as (
        select
            coalesce(nullif((controls ->> 'passing_score'), '')::numeric, 75::numeric) as passing_score,
            greatest(1, coalesce(nullif((controls ->> 'exam_total_items'), '')::integer, 100)) as exam_total_items
        from workflow
    ),
    owned_rows as (
        select
            a.id as application_id,
            a.application_no,
            a.sector_classification,
            er.batch_id,
            er.raw_score,
            er.room_label,
            er.room_seat_no,
            coalesce(btrim(flags.special_consideration_tag), '') as special_consideration_tag,
            coalesce(ar.special_endorsement, false) as special_endorsement,
            policy.passing_score,
            policy.exam_total_items
        from public.applications a
        join public.exam_records er
            on er.application_id = a.id
        cross join policy
        left join public.application_staff_flags flags
            on flags.application_id = a.id
        left join public.approval_records ar
            on ar.application_id = a.id
        where a.applicant_id = auth.uid()
          and a.id = any(coalesce(p_application_ids, '{}'::uuid[]))
          and er.batch_id is not null
          and er.raw_score is not null
    ),
    owned_batch_ids as (
        select distinct batch_id
        from owned_rows
        where batch_id is not null
    ),
    batch_rows as (
        select
            a.id as application_id,
            a.application_no,
            a.sector_classification,
            er.batch_id,
            er.raw_score,
            er.room_label,
            er.room_seat_no,
            coalesce(btrim(flags.special_consideration_tag), '') as special_consideration_tag,
            coalesce(ar.special_endorsement, false) as special_endorsement,
            policy.passing_score,
            policy.exam_total_items
        from public.applications a
        join public.exam_records er
            on er.application_id = a.id
        cross join policy
        left join public.application_staff_flags flags
            on flags.application_id = a.id
        left join public.approval_records ar
            on ar.application_id = a.id
        where er.batch_id in (select batch_id from owned_batch_ids)
          and er.raw_score is not null
    ),
    sector_ranked as (
        select
            application_id,
            batch_id,
            row_number() over (
                partition by batch_id
                order by
                    raw_score desc,
                    coalesce(room_label, '') asc,
                    coalesce(room_seat_no, 0) asc,
                    coalesce(application_no, '') asc,
                    application_id asc
            ) as sector_rank
        from batch_rows
        where coalesce(btrim(sector_classification), '') <> ''
          and lower(btrim(sector_classification)) <> 'none of the above'
          and coalesce(special_consideration_tag, '') = ''
          and special_endorsement = false
          and ((raw_score / nullif(exam_total_items, 0)) * 100) < passing_score
    )
    select
        owned_rows.application_id,
        exists (
            select 1
            from sector_ranked sr
            where sr.application_id = owned_rows.application_id
              and sr.sector_rank <= 76
        ) as is_sector_selected
    from owned_rows;
$$;

grant execute on function public.current_user_application_sector_selection_flags(uuid[]) to authenticated;
