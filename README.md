# LDSP Frontend

This project is deployable as a static frontend. Application data stays in Supabase, and new file uploads default to Supabase Storage so applicant submission still works on static hosting.

## Main URLs
- `https://daet-scholarship.gt.tc/` -> Login
- `https://daet-scholarship.gt.tc/APPLICANT/` -> Applicant portal
- `https://daet-scholarship.gt.tc/SECRETARY/` -> Secretary portal
- `https://daet-scholarship.gt.tc/ADMIN/` -> Admin portal
- `https://daet-scholarship.gt.tc/SYSTEMADMINISTRATOR/` -> System Administrator portal
- `https://daet-scholarship.gt.tc/SUPERADMIN/` -> Redirects to System Administrator

## Folder Map
- `login.html`, `register.html`, `verify-account.html`, `forgot-password.html`, `reset-password.html`, `logout.html`, `index.html`
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
- Reminder email log hotfix is in `supabase/reminder_email_logs_hotfix_2026_03_17.sql`.
- Reminder campaign queue hotfix is in `supabase/reminder_campaign_jobs_hotfix_2026_03_19.sql`.
- Intake date-time enforcement hotfix is in `supabase/application_intake_datetime_hotfix_2026_03_19.sql`.
- Intake manual receive override hotfix is in `supabase/application_receive_override_hotfix_2026_03_22.sql`.
- System Administrator audit logs hotfix is in `supabase/audit_logs_hotfix_2026_03_22.sql`.
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
- System Administrator User Management now includes a manual `Confirm Email Login` action for accounts that cannot complete the Supabase email verification step; this fallback uses the Node server plus the Supabase service-role key and should be used only by the System Administrator when needed.
- Scholarship Settings now includes a `Require applicant 1x1 photo before submission` toggle so the System Administrator can temporarily allow applicant form submission without the photo while identity is checked later during examination/interview.
- System Administrator User Directory now shows each account's email address directly under the user's name for faster support and account lookup, and the directory now follows the same hoverable responsive queue-table pattern used by the secretary application list.
- System Administrator User Management now includes live email verification status chips, filtering, resend verification support, and audited access actions for account activation, suspension, deletion, and manual verification support; the verification status lookup uses the protected Node server route so staff can read Supabase Auth confirmation state safely.
- System Administrator User Management now hides the secretary-account creation block, uses a compact secretary-style filter bar, fetches the full user directory in batches beyond the old 1000-row limit, paginates at 10 rows by default for lighter page loads, and groups filters plus directory into one cleaner workspace card.
- Applicant notifications page supports live list, filter, pagination, mark read/unread, and mark all read.
- Extended application-only fields such as religion, family background, spouse details, awards, and similar non-core inputs now have a shared table path via `application_aux_data` so applicant and secretary corrections can persist across devices.
- Applicant legacy barangay cleanup now uses the dedicated `profiles.barangay` field, a dashboard reminder modal, and a direct `My Profile` barangay update path for older accounts with existing applications.
- Applicant application form now skips the auto-open Data Privacy Notice modal when reopening an already submitted application; the notice is still enforced on submit when needed.
- Applicant mobile handling now keeps the sidenav temporary-only on phones and tightens the top bar, page headers, action rows, cards, and pagination for smaller screens.
- Applicant dashboard now keeps a simpler top summary layout without the `Recent Activity`, `Requirement Summary`, and `Application Timeline` section row.
- Applicant dashboard quick actions now show only the `New Application` button in the overview bar.
- Applicant `My Applications` now removes the extra `Continue Draft` header button to keep the page less confusing.
- Applicant/application workflow chips now show `Submitted` in blue for clearer visual status distinction.
- Applicant submitted status guidance now says to wait for secretary checking for correction, screening, and exam scheduling.
- Applicant profile address display now deduplicates repeated `Barangay` segments so messy saved address text renders as one clean Daet address.
- Applicant `My Profile` now uses a more mobile-first summary layout with a stronger profile hero, scholarship summary, document status chips, a simplified applicant account menu, the summary row hidden on phones for later redesign, and the detailed personal/contact/education/family cards removed from the main view to reduce applicant confusion.
- Secretary verification supports document status updates, interview scheduling, hard-copy verification state, verified photo upload, return-for-correction/compliance flows, and applicant notifications.
- Secretary and applicant printable application forms now share the same official print-sheet layout, and the secretary print output no longer includes the requirement section so both versions match more closely.
- Secretary dashboard chart row now replaces the old Return / Resubmission graph with a reminder follow-up chart for draft/no-form users, while Sector Classification was moved into the earlier chart slot.
- Secretary Reports is now a cleared reconstruction shell; the old report cards, filters, and summary details were removed from the page so the secretary printing/reporting flow can be rebuilt cleanly.
- Secretary reminder campaigns now support queued background sending in timed batches through the Node server so large filtered reminder groups do not need to be sent all at once.
- Secretary general information report printouts now include the LGU Daet, system icon, and Maogma logos in the report header.
- System Administrator scholarship settings now support application open/close time controls, and applicant submission cutoff follows the configured date and time.
- System Administrator scholarship settings now use one responsive workspace card for the full policy form, and include a prominent `ENABLE RECEIVE` / `DISABLE RECEIVE` control in Scholarship Duration so the office can manually lock or reopen applicant filing, including emergency reopening after the scheduled cutoff once the new Supabase hotfix is applied.
- System Administrator Scholarship Settings now has a cleaner responsive workspace layout with refined KPI cards, grouped policy sections, and responsive switch-style System Control Flags for faster office use on desktop and mobile.
- System Administrator Audit Logs now provide a live critical-action history for user management verification actions and scholarship settings changes once the audit log hotfix is applied.
- Reminder emails for applicants without a submitted form now use the active scholarship settings cutoff deadline instead of a fixed hardcoded date.
- Applicant Dashboard and My Applications now disable the `New Application` entry point when receiving is manually disabled or when the configured filing window is closed.
- Secretary exam management supports exam batch scheduling, control number assignment, exam result encoding, and status transitions to `passed_exam` / `failed_exam`.
- Admin approval queue supports ranking view, special endorsement action, approve/reject/waitlist decisions, and batch decision handling.
- Scholarship workflow status model:
  - `draft`, `submitted`, `pending_exam`, `exam_scheduled`, `exam_completed`, `passed_exam`, `failed_exam`, `special_endorsement_review`, `for_interview`, `interview_scheduled`, `interview_completed`, `hard_copy_verified`, `for_approval`, `approved`, `waitlisted`, `rejected`, `for_release`, `released`
- SQL bootstrap now includes integration-ready workflow tables:
  - `exam_batches`, `exam_records`, `interview_records`, `approval_records`, `ranking_settings`
- UI pages still include targeted `TODO(Supabase)` markers for remaining server-side integrations (ranking engine, PDF generation, report exports).
- Legacy Supabase Storage bucket/policies for requirement uploads are still included in the SQL bootstrap (`ldss-documents` bucket) for backward compatibility with older uploaded files.

## File Uploads
New uploads now default to Supabase Storage for static hosting compatibility.

Optional hosted upload mode still exists for Node deployments, but it must be explicitly enabled with `window.LDSS_USE_HOSTED_UPLOADS = true` before `js/ldss-upload-api.js` loads.

Supabase upload path format:
- `<document_type>/<user_id>/<application_id>/<filename>`
- Staff verified photo: `verified_interview_photo/staff/<staff_user_id>/<application_id>/<filename>`

Optional hosted path format:
- `uploads/<document_type>/<user_id>/<application_id>/<filename>`
- Verified interview photo: `uploads/verified_interview_photo/staff/<staff_user_id>/<application_id>/<filename>`

What remains in Supabase:
- `application_documents.storage_path`
- `profiles.applicant_photo_path`
- `profiles.verified_interview_photo_path`

Important:
- Static hosting works for applicant submission as long as the `ldss-documents` bucket and storage RLS are applied in Supabase.
- Older hosted file paths that start with `uploads/` still need the Node upload server to read/delete them.
- Older Supabase Storage file paths remain readable through signed URLs.

## Live Login Setup (Supabase)
1. Open `js/supabase-config.js`.
2. Replace:
   - `LDSS_SUPABASE_URL`
   - `LDSS_SUPABASE_ANON_KEY`
   - `LDSS_STORAGE_BUCKET` (default: `ldss-documents`)
3. Static hosting is supported.
4. Node hosting is optional unless you still rely on older hosted file paths that start with `uploads/`.

Login behavior now:
- Uses Supabase `signInWithPassword`.
- The login form now uses email/password only.
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
- `verify-account.html` now handles applicant OTP email confirmation through `supabase.auth.verifyOtp(...)`.
- `forgot-password.html` now uses Supabase `auth.resetPasswordForEmail`.
- `reset-password.html` now updates password from recovery session link.
- Password recovery is email-based by default (mobile recovery needs a separate OTP flow).
- Frontend enforces strong password policy: minimum 12 chars + uppercase + lowercase + number + symbol.
- Registration now redirects applicants into the OTP verification page, and login redirects unverified email users into the same OTP flow.
- If an applicant cannot complete the email verification step, the System Administrator can now manually confirm that account from `SYSTEMADMINISTRATOR/super-admin-user-management.html` when the Node server is available.

Required Supabase Auth settings:
1. Set Site URL to your production domain (example: `https://daet-scholarship.gt.tc`).
2. Add redirect URL:
   - `https://daet-scholarship.gt.tc/reset-password.html`
3. Keep Email provider enabled for recovery links.
4. In the `Confirm signup` email template, use `{{ .Token }}` for the OTP code instead of only `{{ .ConfirmationURL }}`.
5. Custom SMTP is strongly recommended for production so OTP emails arrive reliably.

## Developer Checks
- Run `npm run check:syntax` after low-risk JS changes to catch parse errors before uploading files to hosting.
- `npm test` is still a placeholder and does not run application tests yet.

## Placeholder Shells
- Some pages intentionally remain static shells so role-based navigation works without breaking entry points.
- Current shell examples include Applicant Help, Admin Notifications, and the System Administrator dashboard overview.

## Security Headers
- Apache/static hosting baseline headers are defined in `.htaccess`.
- Node hosting applies the same baseline headers in `server.js`.
- Current CSP allows the existing CDN scripts (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`), Supabase API/realtime connections, signed Supabase asset URLs, and the app's current inline script snippets.
- Remaining hardening work, if you want a stricter CSP later:
  - remove inline `<script>` blocks such as `window.LDSS_REQUIRED_ROLE = ...`
  - move the inline logout script into a standalone JS file
  - then remove `'unsafe-inline'` from `script-src`

