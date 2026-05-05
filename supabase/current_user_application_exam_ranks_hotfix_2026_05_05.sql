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
    with owned_exam_rows as (
        select
            a.id as application_id,
            er.batch_id,
            er.raw_score
        from public.applications a
        join public.exam_records er
            on er.application_id = a.id
        where a.applicant_id = auth.uid()
          and a.id = any(coalesce(p_application_ids, '{}'::uuid[]))
          and er.batch_id is not null
          and er.raw_score is not null
    )
    select
        owned_exam_rows.application_id,
        (
            select 1 + count(*)
            from public.exam_records other
            where other.batch_id = owned_exam_rows.batch_id
              and other.raw_score is not null
              and other.raw_score > owned_exam_rows.raw_score
        )::integer as exam_rank
    from owned_exam_rows;
$$;

grant execute on function public.current_user_application_exam_ranks(uuid[]) to authenticated;
