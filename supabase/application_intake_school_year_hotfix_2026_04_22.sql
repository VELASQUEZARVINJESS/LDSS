-- Expose the active school year through the existing intake RPC so applicant pages
-- can follow the real one-application-per-school-year rule without direct reads on
-- ranking_settings, which is protected by admin-only RLS.

create or replace function public.application_intake_is_open()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    active_school_year text;
    active_open_date date;
    active_close_date date;
    active_enabled boolean := true;
    policy_exists boolean := false;
    active_open_time_text text := '';
    active_close_time_text text := '';
    active_override_mode text := 'schedule';
    active_open_time time := time '00:00';
    active_close_time time := time '23:59';
    current_local_ts timestamp := timezone('Asia/Manila', now());
    is_open boolean := true;
    scheduled_is_open boolean := true;
    reason text := 'open';
    scheduled_reason text := 'open';
    open_at timestamp;
    close_at timestamp;
begin
    begin
        select
            rs.school_year,
            rs.application_open_date,
            rs.application_close_date,
            coalesce((rs.ranking_basis -> 'controls' ->> 'application_intake_enabled')::boolean, true),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_open_time', ''),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_close_time', ''),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_receive_override_mode', ''),
            true
        into
            active_school_year,
            active_open_date,
            active_close_date,
            active_enabled,
            active_open_time_text,
            active_close_time_text,
            active_override_mode,
            policy_exists
        from public.ranking_settings rs
        where rs.is_active = true
        order by coalesce(rs.updated_at, rs.created_at) desc
        limit 1;
    exception
        when undefined_table then
            return jsonb_build_object(
                'is_open', true,
                'enabled', true,
                'school_year', null,
                'override_mode', 'schedule',
                'scheduled_is_open', true,
                'scheduled_reason', 'open',
                'open_date', null,
                'close_date', null,
                'open_time', null,
                'close_time', null,
                'open_at', null,
                'close_at', null,
                'reason', 'open'
            );
    end;

    if not policy_exists then
        return jsonb_build_object(
            'is_open', true,
            'enabled', true,
            'school_year', null,
            'override_mode', 'schedule',
            'scheduled_is_open', true,
            'scheduled_reason', 'open',
            'open_date', null,
            'close_date', null,
            'open_time', null,
            'close_time', null,
            'open_at', null,
            'close_at', null,
            'reason', 'open'
        );
    end if;

    if active_open_time_text !~ '^(?:[01]\d|2[0-3]):[0-5]\d$' then
        active_open_time_text := '';
    end if;
    if active_close_time_text !~ '^(?:[01]\d|2[0-3]):[0-5]\d$' then
        active_close_time_text := '';
    end if;

    if active_open_time_text <> '' then
        active_open_time := active_open_time_text::time;
    end if;
    if active_close_time_text <> '' then
        active_close_time := active_close_time_text::time;
    end if;

    if active_override_mode not in ('schedule', 'force_open', 'force_closed') then
        active_override_mode := case
            when active_enabled = false then 'force_closed'
            else 'schedule'
        end;
    end if;

    if active_open_date is not null then
        open_at := active_open_date::timestamp + active_open_time;
    end if;
    if active_close_date is not null then
        close_at := active_close_date::timestamp + active_close_time;
    end if;

    if open_at is not null and current_local_ts < open_at then
        scheduled_is_open := false;
        scheduled_reason := 'before_open_date';
    elsif close_at is not null and current_local_ts > close_at then
        scheduled_is_open := false;
        scheduled_reason := 'after_close_date';
    end if;

    if active_override_mode = 'force_open' then
        is_open := true;
        reason := 'opened_by_admin';
    elsif active_override_mode = 'force_closed' or not active_enabled then
        is_open := false;
        reason := 'closed_by_admin';
    else
        is_open := scheduled_is_open;
        reason := scheduled_reason;
    end if;

    return jsonb_build_object(
        'is_open', is_open,
        'enabled', active_enabled,
        'school_year', nullif(active_school_year, ''),
        'override_mode', active_override_mode,
        'scheduled_is_open', scheduled_is_open,
        'scheduled_reason', scheduled_reason,
        'open_date', active_open_date,
        'close_date', active_close_date,
        'open_time', nullif(active_open_time_text, ''),
        'close_time', nullif(active_close_time_text, ''),
        'open_at', case when open_at is not null then to_char(open_at, 'YYYY-MM-DD"T"HH24:MI:SS') else null end,
        'close_at', case when close_at is not null then to_char(close_at, 'YYYY-MM-DD"T"HH24:MI:SS') else null end,
        'reason', reason
    );
end;
$$;

grant execute on function public.application_intake_is_open() to anon, authenticated;
