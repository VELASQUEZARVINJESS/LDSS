create or replace function public.active_workflow_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    fallback_payload jsonb := jsonb_build_object(
        'application_intake_enabled', true,
        'require_admin_remarks', true,
        'lock_ranking_after_decision', true,
        'allow_special_endorsement', true,
        'allow_secretary_applicant_edits', false,
        'allow_secretary_draft_completion', false,
        'allow_secretary_walk_in_intake', false,
        'auto_set_for_interview', true,
        'exam_checking_in_progress', false,
        'show_applicant_exam_scores', true,
        'exam_total_items', 100,
        'passing_score', 75
    );
    db_controls jsonb := '{}'::jsonb;
    active_exam_total_items integer := 100;
    active_passing_score numeric(5, 2) := 75;
begin
    begin
        select
            coalesce(rs.ranking_basis -> 'controls', '{}'::jsonb),
            greatest(coalesce(rs.exam_total_items, 100), 1),
            least(greatest(coalesce(rs.passing_score, 75), 0), 100)
        into
            db_controls,
            active_exam_total_items,
            active_passing_score
        from public.ranking_settings rs
        where rs.is_active = true
        order by coalesce(rs.updated_at, rs.created_at) desc
        limit 1;
    exception
        when undefined_table then
            return fallback_payload;
    end;

    return fallback_payload
        || coalesce(db_controls, '{}'::jsonb)
        || jsonb_build_object(
            'exam_total_items', active_exam_total_items,
            'passing_score', active_passing_score
        );
end;
$$;

grant execute on function public.active_workflow_controls() to authenticated;
