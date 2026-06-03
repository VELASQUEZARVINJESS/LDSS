create or replace function public.secretary_update_applicant_profile(
    p_application_id uuid,
    p_profile_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    controls jsonb := public.active_workflow_controls();
    safe_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
    actor_role public.app_role := public.current_user_role();
    target_applicant_id uuid;
    target_email text;
    old_profile jsonb := '{}'::jsonb;
    saved_profile jsonb := '{}'::jsonb;
    old_snapshot jsonb := '{}'::jsonb;
    new_snapshot jsonb := '{}'::jsonb;
    changed_fields jsonb := '[]'::jsonb;
    has_place_of_birth boolean := false;
    application_status text := '';
    application_locked boolean := false;
begin
    if auth.uid() is null then
        raise exception 'You must be signed in to update applicant details.'
            using errcode = '42501';
    end if;

    if actor_role is distinct from 'secretary' then
        raise exception 'Only secretary accounts can update applicant details through this flow.'
            using errcode = '42501';
    end if;

    if coalesce((controls ->> 'allow_secretary_applicant_edits')::boolean, false) is not true then
        raise exception 'Applicant detail editing is currently disabled in Scholarship Settings.'
            using errcode = '42501';
    end if;

    if p_application_id is null then
        raise exception 'Application id is required.'
            using errcode = '22023';
    end if;

    select
        a.applicant_id,
        coalesce(a.status::text, ''),
        coalesce(a.is_locked, false)
    into
        target_applicant_id,
        application_status,
        application_locked
    from public.applications a
    where a.id = p_application_id
    limit 1;

    if target_applicant_id is null then
        raise exception 'Application not found.'
            using errcode = 'P0002';
    end if;

    if application_locked then
        raise exception 'Locked applications cannot be edited through secretary applicant corrections.'
            using errcode = '42501';
    end if;

    if application_status not in (
        'submitted',
        'returned_for_correction',
        'pending_exam',
        'exam_scheduled',
        'exam_completed',
        'for_interview',
        'interview_scheduled',
        'interview_completed',
        'hard_copy_verified',
        'special_endorsement_review',
        'for_approval'
    ) then
        raise exception 'This application status is not allowed for secretary applicant detail edits.'
            using errcode = '42501';
    end if;

    select
        to_jsonb(p.*),
        p.email
    into
        old_profile,
        target_email
    from public.profiles p
    where p.id = target_applicant_id
      and p.role = 'applicant'
    limit 1;

    if old_profile = '{}'::jsonb then
        raise exception 'Applicant profile not found.'
            using errcode = 'P0002';
    end if;

    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'place_of_birth'
    )
    into has_place_of_birth;

    update public.profiles p
    set
        first_name = case
            when safe_patch ? 'first_name' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'first_name', '')), '\s+', ' ', 'g'), '')
            else p.first_name
        end,
        middle_name = case
            when safe_patch ? 'middle_name' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'middle_name', '')), '\s+', ' ', 'g'), '')
            else p.middle_name
        end,
        last_name = case
            when safe_patch ? 'last_name' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'last_name', '')), '\s+', ' ', 'g'), '')
            else p.last_name
        end,
        sex = case
            when safe_patch ? 'sex' then nullif(btrim(coalesce(safe_patch ->> 'sex', '')), '')
            else p.sex
        end,
        civil_status = case
            when safe_patch ? 'civil_status' then nullif(btrim(coalesce(safe_patch ->> 'civil_status', '')), '')
            else p.civil_status
        end,
        date_of_birth = case
            when safe_patch ? 'date_of_birth' then nullif(btrim(coalesce(safe_patch ->> 'date_of_birth', '')), '')::date
            else p.date_of_birth
        end,
        barangay = case
            when safe_patch ? 'barangay' then nullif(btrim(coalesce(safe_patch ->> 'barangay', '')), '')
            else p.barangay
        end,
        address = case
            when safe_patch ? 'address' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'address', '')), '\s+', ' ', 'g'), '')
            else p.address
        end,
        mobile_number = case
            when safe_patch ? 'mobile_number' then nullif(btrim(coalesce(safe_patch ->> 'mobile_number', '')), '')
            else p.mobile_number
        end,
        school_name = case
            when safe_patch ? 'school_name' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'school_name', '')), '\s+', ' ', 'g'), '')
            else p.school_name
        end,
        course_or_strand = case
            when safe_patch ? 'course_or_strand' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'course_or_strand', '')), '\s+', ' ', 'g'), '')
            else p.course_or_strand
        end,
        year_level = case
            when safe_patch ? 'year_level' then nullif(btrim(coalesce(safe_patch ->> 'year_level', '')), '')
            else p.year_level
        end,
        student_number = case
            when safe_patch ? 'student_number' then nullif(regexp_replace(btrim(coalesce(safe_patch ->> 'student_number', '')), '\s+', ' ', 'g'), '')
            else p.student_number
        end,
        applicant_photo_path = case
            when safe_patch ? 'applicant_photo_path' then nullif(btrim(coalesce(safe_patch ->> 'applicant_photo_path', '')), '')
            else p.applicant_photo_path
        end,
        verified_interview_photo_path = case
            when safe_patch ? 'verified_interview_photo_path' then nullif(btrim(coalesce(safe_patch ->> 'verified_interview_photo_path', '')), '')
            else p.verified_interview_photo_path
        end
    where p.id = target_applicant_id
      and p.role = 'applicant';

    if not found then
        raise exception 'Applicant profile not found.'
            using errcode = 'P0002';
    end if;

    if has_place_of_birth then
        execute $place$
            update public.profiles p
            set place_of_birth = case
                when $1 ? 'place_of_birth' then nullif(regexp_replace(btrim(coalesce($1 ->> 'place_of_birth', '')), '\s+', ' ', 'g'), '')
                else p.place_of_birth
            end
            where p.id = $2
              and p.role = 'applicant'
        $place$
        using safe_patch, target_applicant_id;
    end if;

    select to_jsonb(p.*)
    into saved_profile
    from public.profiles p
    where p.id = target_applicant_id;

    old_snapshot := jsonb_build_object(
        'first_name', old_profile ->> 'first_name',
        'middle_name', old_profile ->> 'middle_name',
        'last_name', old_profile ->> 'last_name',
        'sex', old_profile ->> 'sex',
        'civil_status', old_profile ->> 'civil_status',
        'date_of_birth', old_profile ->> 'date_of_birth',
        'barangay', old_profile ->> 'barangay',
        'address', old_profile ->> 'address',
        'mobile_number', old_profile ->> 'mobile_number',
        'school_name', old_profile ->> 'school_name',
        'course_or_strand', old_profile ->> 'course_or_strand',
        'year_level', old_profile ->> 'year_level',
        'student_number', old_profile ->> 'student_number',
        'applicant_photo_path', old_profile ->> 'applicant_photo_path',
        'verified_interview_photo_path', old_profile ->> 'verified_interview_photo_path',
        'place_of_birth', old_profile ->> 'place_of_birth'
    );

    new_snapshot := jsonb_build_object(
        'first_name', saved_profile ->> 'first_name',
        'middle_name', saved_profile ->> 'middle_name',
        'last_name', saved_profile ->> 'last_name',
        'sex', saved_profile ->> 'sex',
        'civil_status', saved_profile ->> 'civil_status',
        'date_of_birth', saved_profile ->> 'date_of_birth',
        'barangay', saved_profile ->> 'barangay',
        'address', saved_profile ->> 'address',
        'mobile_number', saved_profile ->> 'mobile_number',
        'school_name', saved_profile ->> 'school_name',
        'course_or_strand', saved_profile ->> 'course_or_strand',
        'year_level', saved_profile ->> 'year_level',
        'student_number', saved_profile ->> 'student_number',
        'applicant_photo_path', saved_profile ->> 'applicant_photo_path',
        'verified_interview_photo_path', saved_profile ->> 'verified_interview_photo_path',
        'place_of_birth', saved_profile ->> 'place_of_birth'
    );

    select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
    into changed_fields
    from (
        select old_entry.key
        from jsonb_each(old_snapshot) old_entry
        join jsonb_each(new_snapshot) new_entry
            on new_entry.key = old_entry.key
        where old_entry.value is distinct from new_entry.value
    ) changed;

    if to_regclass('public.audit_logs') is not null and changed_fields <> '[]'::jsonb then
        insert into public.audit_logs (
            module,
            action,
            actor_id,
            actor_role,
            target_user_id,
            target_role,
            target_email,
            target_label,
            record_type,
            record_id,
            summary,
            details
        )
        values (
            'secretary_verification',
            'update_applicant_profile',
            auth.uid(),
            actor_role,
            target_applicant_id,
            'applicant',
            target_email,
            trim(concat_ws(' ', saved_profile ->> 'first_name', saved_profile ->> 'middle_name', saved_profile ->> 'last_name')),
            'application',
            p_application_id::text,
            'Updated applicant profile during secretary verification.',
            jsonb_build_object(
                'application_status', application_status,
                'changed_fields', changed_fields,
                'old_values', old_snapshot,
                'new_values', new_snapshot
            )
        );
    end if;

    return saved_profile;
end;
$$;

revoke all on function public.secretary_update_applicant_profile(uuid, jsonb) from public;
grant execute on function public.secretary_update_applicant_profile(uuid, jsonb) to authenticated;
