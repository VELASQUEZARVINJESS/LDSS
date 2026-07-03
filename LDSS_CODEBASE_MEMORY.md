# LDSS Codebase Memory

Updated: 2026-03-23

Purpose: a fast working-memory note for future LDSS edits so we do not need to re-audit the whole repo every time.

## Source Of Truth

- Follow `LDSS_PRD_v1_SBAdminPro.md` first.
- Use `AGENTS.md` as the project-specific implementation guide.
- Current implementation sometimes goes beyond the original PRD, so confirm behavior in code before changing workflow logic.

## Stack And Runtime

- Frontend: static HTML + Bootstrap 5 + SB Admin Pro structure.
- Shared styling: `css/styles.css` plus project overrides in `css/ldss.css`.
- Frontend backend: Supabase for auth, data, RLS, and storage.
- Optional helper backend: `server.js` for protected uploads, staff-only APIs, email sending, reminder queue processing, and super-admin auth helper routes.
- Static hosting target remains InfinityFree-compatible.

## Root Entry Flow

- `index.html` redirects to `login.html`.
- Auth pages at root:
  - `login.html`
  - `register.html`
  - `verify-account.html`
  - `forgot-password.html`
  - `reset-password.html`
  - `logout.html`
- Role portals:
  - `APPLICANT/index.html` -> `applicant-dashboard.html`
  - `SECRETARY/index.html` -> `secretary-dashboard.html`
  - `ADMIN/index.html` -> `admin-dashboard.html`
  - `SYSTEMADMINISTRATOR/index.html` -> `super-admin-dashboard.html`
  - `SUPERADMIN/index.html` -> redirect only

## Shared Frontend Runtime

- `js/supabase-config.js`
  - Contains live Supabase URL, anon key, storage bucket, and upload mode defaults.
  - Defaults to hosted upload API outside localhost, but upload helpers can fall back to Supabase Storage.
- `js/supabase-applicant-guard.js`
  - Main protected-page guard for all roles.
  - Resolves `profiles.role`, redirects on mismatch, signs out on invalid session, and blocks staff pages on mobile widths under 992px.
- `js/scripts.js`
  - SB Admin Pro behavior, sidebar toggle, tooltips, feather icons, restrained page-load motion.
- `js/ldss-workflow.js`
  - Shared workflow normalization, label/chip metadata, next-step text, exam result helpers.
- `js/ldss-upload-api.js`
  - Upload abstraction for Supabase Storage or Node upload API.
  - Reads legacy `uploads/...` paths and creates signed URLs for Supabase Storage paths.

## Auth Status

- Live and Supabase-backed:
  - login
  - applicant registration
  - OTP email verification
  - forgot password
  - reset password
  - logout
- Current auth behavior:
  - PRD-aligned login UI accepts email or mobile number.
  - Email always works on static hosting.
  - Mobile-number login and forgot-password lookup depend on the optional same-origin Node auth helper route.
  - The login `Remember me` checkbox now controls whether the Supabase session persists on the device or only in the current browser tab.
- Password rules are enforced in frontend:
  - minimum 12 chars
  - uppercase
  - lowercase
  - number
  - symbol

## Applicant Portal Status

Live modules:

- `APPLICANT/applicant-dashboard.html` + `js/supabase-applicant-dashboard.js`
  - latest application snapshot
  - notifications dropdown
  - intake/open-close awareness
  - profile reminder logic
- `APPLICANT/applicant-profile.html` + `js/supabase-applicant-profile.js`
  - live profile view
  - modal-based profile editing
  - applicant photo and verified photo display
  - barangay cleanup handling
- `APPLICANT/applicant-applications.html` + `js/supabase-applicant-applications.js`
  - live application list
  - document/exam/interview summary support
- `APPLICANT/applicant-application-form.html` + `js/supabase-applicant-application-form.js`
  - biggest applicant module
  - draft/save/submit flow
  - application aux data handling
  - applicant photo upload
  - correction-target return flow support
  - intake policy checks
- `APPLICANT/application-detail.html` + `js/supabase-applicant-application-detail.js`
  - tracking view
  - exam/interview/approval timeline
  - signed file/photo URLs
- `APPLICANT/applicant-print-form.html` + `js/supabase-applicant-print-form.js`
  - print-friendly application form
- `APPLICANT/applicant-notifications.html` + `js/supabase-applicant-notifications.js`
  - list, filters, pagination, mark read/unread, mark all read

Shell or limited pages:

- `APPLICANT/applicant-certification.html` is still a placeholder shell.
- `APPLICANT/applicant-help.html` is still a placeholder shell.
- `APPLICANT/applicant-renewal.html` is still a placeholder shell.
- `APPLICANT/applicant-profile-edit.html` remains mostly a shell and is not the real active edit flow.

## Secretary Portal Status

Live modules:

- `SECRETARY/secretary-dashboard.html` + `js/supabase-secretary-dashboard.js`
  - heavy live dashboard
  - queue summaries
  - reminder monitoring
  - charts and applicant distribution analysis
- `SECRETARY/secretary-applications.html` + `js/supabase-secretary-applications.js`
  - main queue browsing and filtering
  - correction notice awareness
  - system-admin-controlled walk-in intake action for office applicants
- `SECRETARY/secretary-interview-verification.html` + `js/supabase-secretary-verification.js`
  - very large live module
  - applicant detail review
  - document verification
  - compliance notice flow
  - return-for-correction flow
  - verified interview photo upload
  - optional secretary-side applicant edits when workflow controls allow
  - approval queue handoff support
- `SECRETARY/secretary-exam-batches.html` + `js/supabase-secretary-exam-batches.js`
  - live exam batch assignment flow
- `SECRETARY/secretary-exam-results.html` + `js/supabase-secretary-exam-results.js`
  - live exam encoding and result status updates
- `SECRETARY/secretary-interview.html` + `js/supabase-secretary-interview.js`
  - live interview scheduling and result handling
- `SECRETARY/secretary-recommendations.html` + `js/supabase-secretary-recommendations.js`
  - recommendation queue management tied to approval queue
- `SECRETARY/secretary-return-resubmissions.html` + `js/supabase-secretary-return-resubmissions.js`
  - tracks resubmitted correction cases
- `SECRETARY/secretary-unsubmitted-users.html` + `js/supabase-secretary-unsubmitted-users.js`
  - reminder campaign targeting for users without submitted forms
  - queued reminder campaign status polling
- `SECRETARY/secretary-print-form.html` + `js/supabase-secretary-print-form.js`
  - shared print-sheet style with applicant print

Shell or partial pages:

- `SECRETARY/secretary-notifications.html` is still a placeholder shell.
- `SECRETARY/secretary-renewals.html` is still a placeholder shell.
- `SECRETARY/secretary-reports.html` is intentionally a cleared shell for rebuild.

Important secretary workflow note:

- `Recommend to Admin` was removed from the secretary verification page UI/handler, so do not assume it still exists there.

## Admin Portal Status

Live modules:

- `ADMIN/admin-dashboard.html` + `js/supabase-admin-dashboard.js`
  - live queue counts and recent approval activity
- `ADMIN/admin-approval-queue.html` + `js/supabase-admin-approval-queue.js`
  - live ranking/decision workspace
  - approve, reject, waitlist, special endorsement actions
  - batch decisions
  - applicant notifications
- `ADMIN/certification-placeholder.html` + `js/supabase-admin-certification.js`
  - despite the filename, this page is a live printable application-form loader/preview

Shell pages:

- `ADMIN/admin-scholar-records.html`
- `ADMIN/admin-release-management.html`
- `ADMIN/admin-reports.html`
- `ADMIN/admin-notifications.html`

## System Administrator Portal Status

Live modules:

- `SYSTEMADMINISTRATOR/super-admin-user-management.html` + `js/supabase-superadmin-user-management.js`
  - staff/applicant directory
  - create secretary account through Node API
  - activate/suspend/delete user actions
  - email verification status lookup
  - resend verification
  - manual confirm-email fallback through Node API
- `SYSTEMADMINISTRATOR/super-admin-scholarship-settings.html` + `js/supabase-superadmin-scholarship-settings.js`
  - active ranking settings row management
  - quota, scoring, open/close schedule
  - receive override controls
  - workflow flags such as special endorsement, secretary edits, photo requirement
- `SYSTEMADMINISTRATOR/super-admin-audit-logs.html` + `js/supabase-superadmin-audit-logs.js`
  - live audit log viewer
- `SYSTEMADMINISTRATOR/super-admin-master-data.html` + `js/supabase-superadmin-master-data.js`
  - live UI, but data is stored in localStorage, not Supabase
- `SYSTEMADMINISTRATOR/super-admin-system-settings.html` + `js/supabase-superadmin-system-settings.js`
  - destructive cleanup tool for workflow/application data
  - not a full system-settings backend yet

Shell pages:

- `SYSTEMADMINISTRATOR/super-admin-dashboard.html`
- `SYSTEMADMINISTRATOR/super-admin-reports.html`
- `SYSTEMADMINISTRATOR/super-admin-backup-restore.html`

## Node API Status In `server.js`

Routes confirmed:

- `GET /api/uploads/health`
- `POST /api/uploads`
- `GET /api/uploads/blob`
- `POST /api/uploads/delete`
- `POST /api/super-admin/secretaries`
- `GET /api/super-admin/users/verification-status`
- `POST /api/super-admin/users/:userId/confirm-email`
- `POST /api/secretary/walk-in-intake`
- `POST /api/notifications/compliance-email`
- `POST /api/notifications/reminder-campaign`

Server responsibilities:

- serve static app files
- secure upload read/write/delete for legacy hosted files
- SMTP mail sending
- reminder email batching and queued job processor
- super-admin user verification helper routes
- secretary walk-in applicant/application creation helper route
- CSP and security headers

## Database Shape

Main schema bootstrap:

- `supabase/ldss_phase1_schema_rls.sql`

Core tables used heavily in frontend:

- `profiles`
- `applications`
- `application_aux_data`
- `application_documents`
- `notifications`
- `exam_batches`
- `exam_records`
- `interviews`
- `interview_records`
- `approval_queue`
- `approval_records`
- `ranking_settings`
- `release_batches`
- `reminder_email_logs`

Important database functions and policies:

- signup trigger creates/syncs applicant profile
- one-application-per-school-year enforcement
- intake open/close RPCs and trigger enforcement
- workflow controls exposed through active ranking settings
- RLS across main tables and storage
- `super_admin_delete_user` RPC

## Current Fallback Patterns

Several live JS modules still support fallback reads if newer tables are missing:

- applicant detail/dashboard can fall back from:
  - `exam_records` to older assumptions
  - `interview_records` to `interviews`
  - `approval_records` to `approval_queue`
- admin and secretary modules also use `approval_queue` and `interviews` as compatibility fallback in places.

This means schema deployment status matters before changing workflow code.

## Important Caveats

- Staff pages are desktop-only by design through the shared auth guard.
- New uploads default to Supabase Storage.
- Older `uploads/...` file paths still depend on the Node server for read/delete access.
- Public auth pages now have a pre-login/pre-registration filing notice path driven by `application_intake_is_open()`, so that RPC must remain executable by `anon` as well as `authenticated`.
- Secretary draft completion now exists behind a System Administrator workflow flag; when enabled, drafts appear in Secretary Applications and can be finished from Secretary Checking, including office-side applicant photo upload.
- Secretary walk-in intake now exists, but it depends on the Node server plus the Supabase service-role key and the related SQL hotfix being deployed.
- `toasts.js` is basically template-demo code and not the main notification system.
- `js/supabase-applicant-application-form.js`, `js/supabase-secretary-verification.js`, and `js/supabase-secretary-dashboard.js` are the heaviest workflow files and likely the highest-risk edit points.
- `super-admin-master-data` is currently browser-local, so changes there are not centralized across staff devices yet.
- `super-admin-system-settings` is not a normal settings page right now; it is mainly a cleanup/reset tool.

## Known Repo State

- `npm run check:syntax` passed on 2026-03-23.
- The git worktree was already dirty before any new edits in this pass.
- Existing non-code changes include deleted documentation assets and zip files plus untracked archive files, so be careful not to revert user work casually.

## Good Starting Points For Tonight

- Auth or login issue: start in `login.html`, `register.html`, `verify-account.html`, and `js/supabase-auth-email-helper.js`.
- Applicant workflow issue: start in `APPLICANT/applicant-application-form.html` and `js/supabase-applicant-application-form.js`.
- Applicant profile issue: start in `APPLICANT/applicant-profile.html` and `js/supabase-applicant-profile.js`.
- Secretary verification issue: start in `SECRETARY/secretary-interview-verification.html` and `js/supabase-secretary-verification.js`.
- Admin approval issue: start in `ADMIN/admin-approval-queue.html` and `js/supabase-admin-approval-queue.js`.
- System settings or intake issue: start in `SYSTEMADMINISTRATOR/super-admin-scholarship-settings.html`, `js/supabase-superadmin-scholarship-settings.js`, and related SQL hotfixes.
- Upload/email/API issue: start in `server.js` plus `js/ldss-upload-api.js`.
- Schema/RLS issue: start in `supabase/ldss_phase1_schema_rls.sql` plus the dated hotfix SQL files.
