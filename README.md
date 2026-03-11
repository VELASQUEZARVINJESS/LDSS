# LDSP Frontend + Node Upload Server

This project now runs as a Node-hosted site with private file uploads stored on the hosting server and application metadata still stored in Supabase.

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
- `server.js` (Node server for static pages + private uploads API)
- `uploads/` (created at runtime on the host; ignored in git)
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
- Legacy Supabase Storage bucket/policies for requirement uploads are still included in the SQL bootstrap (`ldss-documents` bucket) for backward compatibility with older uploaded files.

## Hosting Uploads (Node)
This project now stores new uploads in your hosting storage through the Node server instead of sending new files to Supabase Storage.

New hosted path format:
- `uploads/<document_type>/<user_id>/<application_id>/<filename>`
- Verified interview photo: `uploads/verified_interview_photo/staff/<staff_user_id>/<application_id>/<filename>`

What remains in Supabase:
- `application_documents.storage_path`
- `profiles.applicant_photo_path`
- `profiles.verified_interview_photo_path`

Required setup:
1. Run `npm install`
2. Start the app with `npm start`
3. Make sure your Node host serves this project through `server.js`
4. Keep these environment values available to Node:
   - `PORT`
   - `LDSS_UPLOAD_DIR` (default: `uploads`)
   - `LDSS_SUPABASE_URL`
   - `LDSS_SUPABASE_ANON_KEY`

Optional:
- Copy `.env.example` to `.env` for local/server setup

Important:
- New uploads use hosting storage.
- Older file paths that still point to Supabase Storage remain readable through the frontend fallback until they are replaced or reuploaded.

## Live Login Setup (Supabase)
1. Open `js/supabase-config.js`.
2. Replace:
   - `LDSS_SUPABASE_URL`
   - `LDSS_SUPABASE_ANON_KEY`
   - `LDSS_STORAGE_BUCKET` (default: `ldss-documents`)
3. For Node hosting, deploy the full project and run `npm start`.
4. For local static file references, keep the app behind the Node server so `/api/uploads` is available.

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

