# LDSP Static Frontend (InfinityFree Ready)

This project is now standalone (no nested SB Admin folder) and deploy-ready for static hosting.

## Main URLs
- `https://daet-scholarship.gt.tc/` -> Login
- `https://daet-scholarship.gt.tc/APPLICANT/` -> Applicant portal
- `https://daet-scholarship.gt.tc/SECRETARY/` -> Secretary portal
- `https://daet-scholarship.gt.tc/ADMIN/` -> Admin portal
- `https://daet-scholarship.gt.tc/SYSTEMADMINISTRATOR/` -> System Administrator portal
- `https://daet-scholarship.gt.tc/SUPERADMIN/` -> Redirects to System Administrator

## Folder Map
- `login.html`, `register.html`, `forgot-password.html`, `reset-password.html`, `logout.html`, `index.html`
- `APPLICANT/` (applicant pages)
- `SECRETARY/` (secretary pages)
- `ADMIN/` (admin pages)
- `SYSTEMADMINISTRATOR/` (renamed Super Admin portal)
- `SUPERADMIN/` (legacy redirect)
- `css/`, `js/`, `assets/`, `img/`
- `supabase/ldss_phase1_schema_rls.sql`

## Supabase
- Schema + RLS bootstrap is in `supabase/ldss_phase1_schema_rls.sql`.
- One-attempt-per-school-year hotfix (includes draft) and System Admin ON/OFF intake switch are in `supabase/submission_limit_hotfix_2026_03_10.sql`.
- Security role hardening hotfix is in `supabase/security_hotfix_2026_03_10.sql`.
- LDSP branding hotfix (application number prefix) is in `supabase/branding_hotfix_ldsp_2026_03_10.sql`.
- User management hotfix (secure super-admin delete user RPC) is in `supabase/user_management_hotfix_2026_03_10.sql`.
- Applicant Phase 1.1 live integrations now in:
  - `js/supabase-applicant-guard.js`
  - `js/supabase-applicant-profile.js`
  - `js/supabase-applicant-applications.js`
  - `js/supabase-applicant-application-detail.js`
  - `js/supabase-applicant-application-form.js`
  - `js/supabase-applicant-dashboard.js`
  - `js/supabase-applicant-notifications.js`
- Secretary live integrations now in:
  - `js/supabase-secretary-dashboard.js`
  - `js/supabase-secretary-applications.js`
  - `js/supabase-secretary-exam-batches.js`
  - `js/supabase-secretary-exam-results.js`
  - `js/supabase-secretary-verification.js`
  - `js/supabase-secretary-interview.js`
- Admin live integrations now in:
  - `js/supabase-admin-dashboard.js`
  - `js/supabase-admin-approval-queue.js`
- Super Admin settings integration shell:
  - `js/supabase-superadmin-scholarship-settings.js`
  - `js/supabase-superadmin-user-management.js`
- Applicant notifications page supports live list, filter, pagination, mark read/unread, and mark all read.
- Secretary verification supports document status updates, interview scheduling, hard-copy verification state, verified photo upload, recommend-to-admin, and applicant notifications.
- Secretary exam management supports exam batch scheduling, control number assignment, exam result encoding, and status transitions to `passed_exam` / `failed_exam`.
- Admin approval queue supports ranking view, special endorsement action, approve/reject/waitlist decisions, and batch decision handling.
- Scholarship workflow status model:
  - `draft`, `submitted`, `pending_exam`, `exam_scheduled`, `exam_completed`, `passed_exam`, `failed_exam`, `special_endorsement_review`, `for_interview`, `interview_scheduled`, `interview_completed`, `hard_copy_verified`, `for_approval`, `approved`, `waitlisted`, `rejected`, `for_release`, `released`
- SQL bootstrap now includes integration-ready workflow tables:
  - `exam_batches`, `exam_records`, `interview_records`, `approval_records`, `ranking_settings`
- UI pages still include targeted `TODO(Supabase)` markers for remaining server-side integrations (ranking engine, PDF generation, report exports).
- Storage bucket/policies for requirement uploads are included in the same SQL bootstrap (`ldss-documents` bucket).

## Live Login Setup (Supabase)
1. Open `js/supabase-config.js`.
2. Replace:
   - `LDSS_SUPABASE_URL`
   - `LDSS_SUPABASE_ANON_KEY`
   - `LDSS_STORAGE_BUCKET` (default: `ldss-documents`)
3. Upload all files to InfinityFree public directory.

Login behavior now:
- Uses Supabase `signInWithPassword` (email or mobile/phone).
- Fetches `profiles.role`.
- Redirects automatically:
  - `applicant` -> `APPLICANT/`
  - `secretary` -> `SECRETARY/`
  - `admin` -> `ADMIN/`
  - `super_admin` -> `SYSTEMADMINISTRATOR/`

Session/logout behavior:
- Protected role pages require active authenticated session for the required role (`applicant`, `secretary`, `admin`, `super_admin`).
- Role mismatch redirects to the correct role portal.
- Logout links now route to `logout.html` to ensure Supabase session sign-out before returning to login.
- Applicant account dropdown now includes: `My Profile`, `Certification`, `Renewal`, `Help`, `Logout`.

## Live Register + Password Recovery
- `register.html` now uses Supabase `auth.signUp` for applicant registration.
- `forgot-password.html` now uses Supabase `auth.resetPasswordForEmail`.
- `reset-password.html` now updates password from recovery session link.
- Password recovery is email-based by default (mobile recovery needs a separate OTP flow).
- Frontend enforces strong password policy: minimum 12 chars + uppercase + lowercase + number + symbol.

Required Supabase Auth settings:
1. Set Site URL to your production domain (example: `https://daet-scholarship.gt.tc`).
2. Add redirect URL:
   - `https://daet-scholarship.gt.tc/reset-password.html`
3. Keep Email provider enabled for recovery links.

