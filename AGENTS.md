# LDSS Project Instructions

## Source of truth
- Always follow `LDSS_PRD_v1_SBAdminPro.md`.
- If code, README, and PRD disagree, trust the PRD first, then confirm against the current implementation before editing.

## Final template direction
- Use the existing **SB Admin Pro** template already present in the project root.
- Do not switch to AdminLTE, Star Admin, or another dashboard framework.
- Reuse the existing template structure where practical.
- Remove unnecessary demo/template clutter.

## Stack direction
- Bootstrap 5
- Static frontend deployable to InfinityFree
- Supabase is the main live backend for auth, data, RLS, and storage
- Optional Node/Express support exists in `server.js` for uploads, mail, and a few protected APIs

## Assets
- App icon: `img/icon.png`
- Login logo: use the existing LGU Daet logo from `img/`
- Preferred filename: `img/daet-lgu.png`
- If the actual file is `img/daet-lug.png`, use that exact existing filename instead of renaming blindly

## UI direction
- Modern
- Minimal
- Neutral
- Mobile-friendly
- Government-appropriate
- Gray and white base
- Very restrained orange accents only where useful
- No landing page
- Login-first flow

## Navigation rules
- Keep the sidebar minimal.
- Remove repeated links.
- Sidebar is for major navigation only.
- Put actions into dashboard cards, page actions, headers, and filters instead of repeating them in the sidebar.
- Avoid template-default clutter.

## Role sidebars
Applicant:
- Dashboard
- My Profile
- My Applications
- Notifications
- Certification
- Renewal
- Help
- Logout

Secretary:
- Dashboard
- Applications
- Verification
- Interview
- Recommendations
- Renewals
- Reports
- Notifications
- Logout

Admin:
- Dashboard
- Approval Queue
- Scholar Records
- Certifications
- Release Management
- Reports
- Notifications
- Logout

Super Admin:
- Dashboard
- User Management
- Master Data
- Scholarship Settings
- Reports
- Audit Logs
- Backup & Restore
- System Settings
- Logout

## UX rules
- Applicant dashboard must stay simple.
- Use quick action buttons like New Application inside the dashboard instead of always in the sidebar.
- Admin notifications should emphasize secretary recommendations.
- Make the UI responsive and polished on smartphone and desktop.
- Keep cards balanced and not crowded.
- Use icons consistently.

## Build priority
1. Login page
2. Registration page
3. Forgot password page
4. Applicant dashboard
5. Applicant My Profile page
6. Applicant Edit Profile page
7. Applicant My Applications page
8. Application detail / tracking page
9. Secretary dashboard
10. Secretary Interview Verification page
11. Admin dashboard
12. Approval Queue page
13. Certification placeholder page
14. Super Admin dashboard shell

## Implementation rules
- Audit the existing codebase and template structure first.
- Refactor incrementally.
- Preserve static deployability for InfinityFree.
- Avoid adding new server-side requirements unless truly necessary.
- Leave clear TODO comments only when a future integration is real and specific.
- Keep the user informed which files need to be uploaded to hosting after code changes.
- Add a short README update explaining what was built and what remains next when the change is user-facing or architectural.

## Motion rules
- Use only subtle premium-style motion.
- Prefer fade-in, soft hover lift, and smooth transitions.
- Avoid flashy, bouncy, or excessive animations.
- Keep animation fast, restrained, and professional.

## Project Map
- Root auth/static pages:
  - `index.html` -> redirects to `login.html`
  - `login.html`
  - `register.html`
  - `forgot-password.html`
  - `reset-password.html`
  - `logout.html`
- Applicant portal:
  - `APPLICANT/`
- Secretary portal:
  - `SECRETARY/`
- Admin portal:
  - `ADMIN/`
- Super Admin portal:
  - `SYSTEMADMINISTRATOR/`
- Legacy redirect:
  - `SUPERADMIN/` -> redirects to `SYSTEMADMINISTRATOR/`
- Shared assets and logic:
  - `css/`
  - `js/`
  - `img/`
  - `assets/`
- Backend/helper runtime:
  - `server.js`
- Database/bootstrap:
  - `supabase/`

## Entry Points
- Root:
  - `index.html` -> `login.html`
- Applicant:
  - `APPLICANT/index.html` -> `applicant-dashboard.html`
- Secretary:
  - `SECRETARY/index.html` -> `secretary-dashboard.html`
- Admin:
  - `ADMIN/index.html` -> `admin-dashboard.html`
- Super Admin:
  - `SYSTEMADMINISTRATOR/index.html` -> `super-admin-dashboard.html`

## Frontend Architecture
- Shared template/runtime modules:
  - `js/scripts.js` = SB Admin Pro behaviors, sidebar toggle, tooltips, page-load class
  - `js/ldss-workflow.js` = workflow status normalization, labels, chips, helper meta
  - `js/ldss-upload-api.js` = upload abstraction for Supabase Storage vs hosted upload API
  - `js/toasts.js` = shared toast notifications
  - `js/supabase-config.js` = frontend Supabase URL/key/bucket/upload-mode config
  - `js/supabase-applicant-guard.js` = session + role guard for all protected role pages
- Auth modules:
  - `js/supabase-login.js`
  - `js/supabase-register.js`
  - `js/supabase-forgot-password.js`
  - `js/supabase-reset-password.js`
  - `js/supabase-auth-email-helper.js`
- Applicant modules:
  - dashboard, profile, applications, application form, application detail, print form, notifications
- Secretary modules:
  - dashboard, applications, exam batches, exam results, interview, verification, print form, recommendations, return resubmissions, unsubmitted users
- Admin modules:
  - dashboard, approval queue, certification
- Super Admin modules:
  - user management, scholarship settings, system settings, master data

## Backend And API Connections
- Supabase is the primary live backend.
- `server.js` is optional for static hosting but currently provides:
  - secure hosted uploads API
  - email sending
  - super-admin secretary account creation API
  - reminder campaign API
- Current Node API routes:
  - `GET /api/uploads/health`
  - `POST /api/uploads`
  - `GET /api/uploads/blob`
  - `POST /api/uploads/delete`
  - `POST /api/super-admin/secretaries`
  - `POST /api/notifications/compliance-email`
  - `POST /api/notifications/reminder-campaign`
- `.htaccess` and `server.js` both apply baseline security headers and CSP rules.

## Environment And Config Files
- Tracked config:
  - `.env.example`
  - `.htaccess`
  - `js/supabase-config.js`
- Ignored runtime secret file:
  - `.env`
- Main env vars used by `server.js`:
  - `PORT` / `NODE_PORT`
  - `LDSS_UPLOAD_DIR`
  - `LDSS_SUPABASE_URL`
  - `LDSS_SUPABASE_ANON_KEY`
  - `LDSS_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
  - `LDSS_SMTP_HOST`
  - `LDSS_SMTP_PORT`
  - `LDSS_SMTP_SECURE`
  - `LDSS_SMTP_USER`
  - `LDSS_SMTP_PASS`
  - `LDSS_MAIL_FROM`
  - `LDSS_MAIL_REPLY_TO`

## Database Model
- Main bootstrap:
  - `supabase/ldss_phase1_schema_rls.sql`
- Important tables:
  - `profiles`
  - `applications`
  - `application_aux_data`
  - `application_documents`
  - `interviews`
  - `exam_batches`
  - `exam_records`
  - `interview_records`
  - `approval_queue`
  - `approval_records`
  - `notifications`
  - `ranking_settings`
  - `release_batches`
  - `reminder_email_logs`
- Important database behaviors:
  - auth signup trigger creates/syncs applicant profile
  - RLS is active across the main tables
  - one-application-attempt-per-school-year policy exists
  - intake open/close logic can be controlled from settings, including open/close time in `ranking_basis.controls`
  - workflow controls are exposed through database-side config

## SQL Hotfixes
- `submission_limit_hotfix_2026_03_10.sql`
  - one application attempt per school year and intake gating
- `security_hotfix_2026_03_10.sql`
  - prevents self role escalation and hardens applicant signup role
- `branding_hotfix_ldsp_2026_03_10.sql`
  - changes numbering prefix to `LDSP-`
- `user_management_hotfix_2026_03_10.sql`
  - adds secure super-admin delete user RPC
- `sector_classification_hotfix_2026_03_11.sql`
  - adds `applications.sector_classification`
- `storage_uploads_folder_hotfix_2026_03_11.sql`
  - keeps storage policies compatible with old and new upload paths
- `profile_place_of_birth_hotfix_2026_03_12.sql`
  - adds `profiles.place_of_birth`
- `submitted_application_edit_hotfix_2026_03_12.sql`
  - allows controlled edits on submitted/returned applications
- `application_aux_data_hotfix_2026_03_14.sql`
  - adds JSONB table for extended application-only fields
- `notifications_dismissal_hotfix_2026_03_14.sql`
  - adds notification dismissal support
- `workflow_controls_hotfix_2026_03_14.sql`
  - adds active workflow controls from settings
- `address_cleanup_hotfix_2026_03_15.sql`
  - normalizes address values
- `barangay_cleanup_hotfix_2026_03_15.sql`
  - cleans legacy barangay values
- `reminder_email_logs_hotfix_2026_03_17.sql`
  - logs reminder-email sends and cooldowns
- `application_intake_datetime_hotfix_2026_03_19.sql`
  - adds System Admin-controlled application open/close time and submit cutoff enforcement

## Core Business Logic
- Auth and roles:
  - users sign in with Supabase auth
  - role is resolved from `profiles.role`
  - protected pages redirect to the correct role portal on mismatch
- Applicant flow:
  - applicant registers
  - completes profile
  - creates one application per active school year
  - uploads requirements
  - saves draft or submits
  - tracks status through exam, interview, approval, and release stages
- Secretary flow:
  - manages submission queues
  - reviews requirements and applicant details
  - can return an application for correction
  - can send compliance notices
  - schedules exam/interview related steps
  - uses reminder campaign pages for users with draft-only or no application yet
- Admin flow:
  - works the approval queue
  - approves, waitlists, rejects, or handles special endorsement review
  - manages downstream release states
- Super Admin flow:
  - manages staff accounts
  - controls scholarship settings and workflow toggles
  - manages some system/master-data features

## Important Workflow Notes
- `application_aux_data` is the shared storage for extended form sections that do not fit cleanly in core tables.
- Applicant uploads default to Supabase Storage so static hosting continues to work.
- Older hosted files under `uploads/...` still need the Node server for read/delete access.
- Reminder campaigns use `reminder_email_logs` cooldowns:
  - `draft_only` = 5 days
  - `no_application` = 7 days
  - `returned_resubmission` = 3 days
- Large secretary reminder campaigns are now queued server-side through `reminder_campaign_jobs` and processed in background batches of 100 every 10 minutes by the Node app.
- Reminder emails for applicants with no submitted form should use the active scholarship settings close date/time as the deadline label when available.
- Secretary verification currently supports:
  - document verification
  - secretary-side applicant detail edits when workflow controls allow
  - verified interview photo upload
  - save checking
  - set for examination
  - return for correction
  - compliance notice
- Current correction flow behavior:
  - secretary selects one or more form sections
  - applicant is redirected to the selected section(s)
  - compliance notice now follows the same selected correction targets
- `Recommend to Admin` was removed from the secretary verification page UI/handler, so do not assume that action still exists there.

## Current Caveats
- The PRD says login can be email or mobile, but the current live login implementation is still effectively email/password in the frontend logic.
- `APPLICANT/applicant-profile-edit.html` is still mostly a shell and is not the real active profile editing flow.
- Several admin and super-admin pages are still placeholders or light shells.
- `README.md` is useful but can lag behind the current code; confirm behavior in the source before making workflow claims.

## Dependencies
- Runtime npm dependencies:
  - `@supabase/supabase-js`
  - `dotenv`
  - `express`
  - `multer`
  - `nodemailer`
- Dev dependency:
  - `serve`
- Frontend CDN dependencies used by the pages/template include Bootstrap-adjacent assets, Feather icons, and other SB Admin Pro assets already in the project.

## Working Style For Future Tasks
- Start by checking the PRD, then the relevant HTML/JS/SQL, then the current runtime behavior.
- Prefer updating the existing SB Admin Pro-based structure instead of introducing new patterns.
- Keep sidebars minimal and put actions in the page body/header where practical.
- When touching workflows, verify both frontend logic and matching SQL/server behavior.
- After every code change, remind the user which files need to be uploaded to hosting.
