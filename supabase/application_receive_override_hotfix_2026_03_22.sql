create or replace function public.application_intake_is_open()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
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
            rs.application_open_date,
            rs.application_close_date,
            coalesce((rs.ranking_basis -> 'controls' ->> 'application_intake_enabled')::boolean, true),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_open_time', ''),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_close_time', ''),
            coalesce(rs.ranking_basis -> 'controls' ->> 'application_receive_override_mode', ''),
            true
        into
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

create or replace function public.enforce_application_intake_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    policy jsonb;
    intake_open boolean := true;
    intake_reason text := 'open';
    intake_open_date text := '';
    intake_close_date text := '';
    intake_open_time text := '';
    intake_close_time text := '';
begin
    if auth.uid() is null then
        return new;
    end if;

    if new.applicant_id <> auth.uid() then
        return new;
    end if;

    if public.current_user_role() <> 'applicant' then
        return new;
    end if;

    if tg_op = 'UPDATE' then
        if old.status is not distinct from new.status then
            return new;
        end if;
        if coalesce(new.status::text, '') <> 'submitted' then
            return new;
        end if;
        if coalesce(old.status::text, '') = 'submitted' then
            return new;
        end if;
    end if;

    policy := public.application_intake_is_open();
    intake_open := coalesce((policy ->> 'is_open')::boolean, true);
    intake_reason := coalesce(policy ->> 'reason', 'open');
    intake_open_date := coalesce(policy ->> 'open_date', '');
    intake_close_date := coalesce(policy ->> 'close_date', '');
    intake_open_time := coalesce(policy ->> 'open_time', '');
    intake_close_time := coalesce(policy ->> 'close_time', '');

    if intake_open then
        return new;
    end if;

    if intake_reason = 'before_open_date' and intake_open_date <> '' then
        if intake_open_time <> '' then
            raise exception 'Application filing opens on % at %.', intake_open_date, intake_open_time
                using errcode = '23514';
        end if;
        raise exception 'Application filing opens on %.', intake_open_date
            using errcode = '23514';
    end if;

    if intake_reason = 'after_close_date' and intake_close_date <> '' then
        if intake_close_time <> '' then
            raise exception 'Application filing closed on % at %.', intake_close_date, intake_close_time
                using errcode = '23514';
        end if;
        raise exception 'Application filing closed on %.', intake_close_date
            using errcode = '23514';
    end if;

    raise exception 'Application filing is currently closed by System Administrator.'
        using errcode = '23514';
end;
$$;

grant execute on function public.application_intake_is_open() to authenticated;
