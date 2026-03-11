-- LDSP Branding Hotfix
-- Date: 2026-03-10
-- Purpose:
-- 1) Change future application number prefix from LDSS- to LDSP-.
-- 2) Update existing application numbers to LDSP-.

alter table public.applications
alter column application_no set default (
    'LDSP-' || to_char(timezone('utc', now()), 'YYYY') || '-' || lpad(nextval('public.application_no_seq')::text, 5, '0')
);

update public.applications
set application_no = regexp_replace(application_no, '^LDSS-', 'LDSP-')
where application_no like 'LDSS-%';
