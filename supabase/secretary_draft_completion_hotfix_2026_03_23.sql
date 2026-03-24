create or replace function public.active_workflow_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    fallback_controls jsonb := jsonb_build_object(
        'application_intake_enabled', true,
        'require_admin_remarks', true,
        'lock_ranking_after_decision', true,
        'allow_special_endorsement', true,
        'allow_secretary_applicant_edits', false,
        'allow_secretary_draft_completion', false,
        'allow_secretary_walk_in_intake', false,
        'auto_set_for_interview', true
    );
    db_controls jsonb := '{}'::jsonb;
begin
    begin
        select coalesce(rs.ranking_basis -> 'controls', '{}'::jsonb)
        into db_controls
        from public.ranking_settings rs
        where rs.is_active = true
        order by coalesce(rs.updated_at, rs.created_at) desc
        limit 1;
    exception
        when undefined_table then
            db_controls := '{}'::jsonb;
    end;

    return fallback_controls || coalesce(db_controls, '{}'::jsonb);
end;
$$;

grant execute on function public.active_workflow_controls() to authenticated;
