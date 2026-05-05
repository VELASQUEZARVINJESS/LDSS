create or replace function public.current_user_application_exam_ranks(p_application_ids uuid[])
returns table (
    application_id uuid,
    exam_rank integer
)
language sql
stable
security definer
set search_path = public
as $$
    with target_batches as (
        select distinct
            er.batch_id
        from public.applications a
        join public.exam_records er
            on er.application_id = a.id
        where a.applicant_id = auth.uid()
          and a.id = any(coalesce(p_application_ids, '{}'::uuid[]))
          and er.batch_id is not null
    ),
    batch_population as (
        select
            a.id as application_id,
            er.batch_id,
            er.raw_score,
            case
                when (
                    coalesce(btrim(flags.special_consideration_tag), '') <> ''
                    or coalesce(a.status::text, '') = 'special_endorsement_review'
                    or coalesce(ar.special_endorsement, false)
                )
                then ceil(coalesce(rs.passing_score, 70))
                else er.raw_score
            end as effective_score
        from public.applications a
        join public.exam_records er
            on er.application_id = a.id
        left join public.application_staff_flags flags
            on flags.application_id = a.id
        left join public.approval_records ar
            on ar.application_id = a.id
        left join public.ranking_settings rs
            on rs.school_year = a.school_year
        where er.batch_id in (select batch_id from target_batches)
          and (
              er.raw_score is not null
              or coalesce(btrim(flags.special_consideration_tag), '') <> ''
              or coalesce(a.status::text, '') = 'special_endorsement_review'
              or coalesce(ar.special_endorsement, false)
          )
    ),
    owned_exam_rows as (
        select
            p.application_id,
            p.batch_id,
            p.raw_score,
            p.effective_score
        from batch_population p
        join public.applications a
            on a.id = p.application_id
        where a.applicant_id = auth.uid()
          and a.id = any(coalesce(p_application_ids, '{}'::uuid[]))
    )
    select
        owned_exam_rows.application_id,
        (
            select 1 + count(*)
            from batch_population other
            where other.batch_id = owned_exam_rows.batch_id
              and other.effective_score > owned_exam_rows.effective_score
        )::integer as exam_rank
    from owned_exam_rows;
$$;

grant execute on function public.current_user_application_exam_ranks(uuid[]) to authenticated;
