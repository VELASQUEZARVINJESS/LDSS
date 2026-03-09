# LDSS Static Frontend (InfinityFree Ready)

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
  - `js/supabase-secretary-verification.js`
  - `js/supabase-secretary-interview.js`
- Applicant notifications page now supports live list, filter, pagination, mark read/unread, and mark all read.
- Secretary verification now supports document status updates, interview scheduling, verified photo upload, return-for-correction, recommend-to-admin, and auto applicant notifications.
- Secretary interview module now supports live interview queue filtering, row-level schedule/venue/status updates, batch scheduling for filtered rows, and quick links to verification.
- Next implementation focus: Admin modules (`admin-dashboard`, `admin-approval-queue`, `admin-notifications`) and remaining Secretary/Admin/Super Admin TODO pages.
- UI pages still include `TODO(Supabase)` markers for remaining modules.
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
