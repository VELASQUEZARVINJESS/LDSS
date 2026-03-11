-- LDSP Sector Classification Hotfix
-- Date: 2026-03-11
-- Purpose:
-- 1) Persist applicant sector classification as part of the application record.
-- 2) Enforce the currently supported sector classification values.

alter table public.applications
add column if not exists sector_classification text;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'applications_sector_classification_check'
          and conrelid = 'public.applications'::regclass
    ) then
        alter table public.applications
        add constraint applications_sector_classification_check check (
            sector_classification is null
            or sector_classification in (
                'Person with Disability (PWD)',
                'Solo Parent',
                'Child of Solo Parent',
                'Child of Farmer',
                'Child of Fisherfolk',
                'Orphan',
                'None of the above'
            )
        );
    end if;
end;
$$;

comment on column public.applications.sector_classification is
'Applicant sector classification selected during application filing.';
