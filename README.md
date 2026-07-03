# LDSP Frontend

This project is deployable as a static frontend. Application data stays in Supabase, and new file uploads default to Supabase Storage so applicant submission still works on static hosting.

## Current Auth Wiring
- Shared login and forgot-password now accept `Email Address or Mobile Number` in the UI.
- Email-based sign-in and recovery continue to work on fully static hosting.
- Mobile-number sign-in and mobile-triggered password recovery now use the optional same-origin `server.js` auth helper route `POST /api/auth/resolve-login`.
- The login `Remember me` option now controls Supabase session persistence across the whole frontend: checked uses `localStorage`, unchecked keeps the session in `sessionStorage` for the current tab only.
- That mobile lookup helper requires `LDSS_SUPABASE_SERVICE_ROLE_KEY` on the Node host because anonymous browser requests cannot read `profiles.mobile_number` under Supabase RLS.
- Next follow-up: if a deployment will stay frontend-only with no Node helper, add clearer pre-submit copy that email is the universal fallback login and recovery path whenever mobile lookup is unavailable.

## Main URLs
- `https://daet-scholarship.gt.tc/` -> Login
- `https://daet-scholarship.gt.tc/exam-room-lookup.html` -> Public exam room lookup
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
- `LDSS_CODEBASE_MEMORY.md` (concise internal codebase map for future edit sessions)

## Supabase
- Schema + RLS bootstrap is in `supabase/ldss_phase1_schema_rls.sql`.
- One-attempt-per-school-year hotfix (includes draft) and System Admin ON/OFF intake switch are in `supabase/submission_limit_hotfix_2026_03_10.sql`.
- Security role hardening hotfix is in `supabase/security_hotfix_2026_03_10.sql`.
- LDSP branding hotfix (application number prefix) is in `supabase/branding_hotfix_ldsp_2026_03_10.sql`.
- User management hotfix (secure super-admin delete user RPC) is in `supabase/user_management_hotfix_2026_03_10.sql`.
- Reminder email log hotfix is in `supabase/reminder_email_logs_hotfix_2026_03_17.sql`.
- Reminder campaign queue hotfix is in `supabase/reminder_campaign_jobs_hotfix_2026_03_19.sql`.
- Exam schedule email queue hotfix is in `supabase/exam_schedule_email_jobs_hotfix_2026_04_05.sql`.
- Applicant intake school-year hotfix is in `supabase/application_intake_school_year_hotfix_2026_04_22.sql`.
- Workflow controls exam policy hotfix is in `supabase/workflow_controls_exam_policy_hotfix_2026_04_22.sql`.
- Special consideration applicant visibility hotfix is in `supabase/special_consideration_applicant_visibility_hotfix_2026_05_05.sql`.
- Sector-selection applicant visibility hotfix is in `supabase/current_user_application_sector_selection_flags_hotfix_2026_05_05.sql`.
- Selection pool hotfix is in `supabase/selection_pool_hotfix_2026_06_30.sql`.
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
- Applicant Dashboard now uses a cleaner client-style layout in `APPLICANT/applicant-dashboard.html`, with a welcome/profile card, summary status cards, a live application-progress row, uploaded-requirements panel, announcements list, exam schedule card, and the existing reminder modal still wired to real applicant data in `js/supabase-applicant-dashboard.js`; the shell was also tightened and widened so it uses more of the desktop view without oversized card spacing, and the `Application Overview` card now includes a `Select Application` dropdown so applicants can switch between previous and current application records and reload the dashboard details for that chosen application.
- Secretary live integrations now in:
  - `js/supabase-secretary-dashboard.js`
  - `js/supabase-secretary-applications.js`
  - `js/supabase-secretary-exam-batches.js`
  - `js/supabase-secretary-exam-results.js`
  - `js/supabase-secretary-verification.js`
  - `js/supabase-secretary-interview.js`
- Secretary sidebar now includes an `Interviews` group with `Scheduler`, `Initial Screening`, and `Final Interview`; the Initial Screening page cross-matches `Selection Pool`, saved hard-copy `Requirements`, and screening attendance before the office moves applicants into final interview.
- Secretary sidebar now uses a `Selection` dropdown with `All Passed`, `Scholar Selection`, and `Final Selection` inside it, and the `Final Selection` page is currently a clean manual-selection shell for the later final-list workflow.
- Secretary sidebar now uses an `Exam Management` dropdown with `Room Assignment`, `Score Exam`, and `Ranking`, and the old sidebar label `Exam Management` now appears as `Score Exam` on the exam-score page link.
- Secretary sidebar now keeps `Reports` pinned as the last secretary item, below the injected `Selection`, `Requirements`, and `Interviews` navigation.
- Secretary ranking print now supports a score-range mode, so office staff can print only a slice like `69` to `66` instead of the full ranked list; the next natural follow-up would be preset buttons for common ranges if staff starts reusing them often.
- Secretary Scholar Selection now supports a matching score-range filter in the final list view, names-only PDF, and masterlist print, so office staff can print only the score band they need.
- Secretary Ranking now supports bulk `Include to Selection` and `Remove from Selection` actions for checked ranked applicants, saving the selection type plus remarks into `application_staff_flags`.
- Secretary Selection now includes a dedicated `Selection Pool` page for the first saved shortlist, with `Add Manual Candidate` and a `Selection Source` filter for `Passed Exam`, `Sector Classification`, or `Manual Office Selection`, while `Scholar Selection` stays as the separate builder page.
- Secretary Selection Pool now also supports direct `Print Report` and `Save PDF` export from the saved shortlist page, with a `Print Order` selector for `By Score` or `Alphabetical` before the office prints or downloads the Selection Pool report.
- Secretary Selection Pool now shows the `LDSP` application number under each applicant name in the live table and in the print/PDF exports, replacing the old school-name subline for faster office scanning.
- Secretary Ranking now uses the main scrollable table on mobile too, and the old examinee avatar/initial strip plus ranking photo hydration were removed to keep the page lighter and faster to respond.
- Initial Screening now has direct `Mark Done`, `No Show`, and `Reset` actions on the shortlist page, and that stage is tracked in `application_staff_flags` through `supabase/initial_screening_tracking_hotfix_2026_06_30.sql` so it stays separate from the later Final Interview records.
- Initial Screening now uses ranking-style checkbox selection plus bulk header actions, so staff can mark many shortlisted applicants at once instead of saving one row at a time.
- Initial Screening now includes a dedicated top `Printing` panel beside the filters, with `Print Report` plus direct `Save PDF` actions for `No Requirements`, `Attended Initial Screening`, `No Show Initial Screening`, and `Pending Screening`; both the browser print sheet and PDF export now use long bond `8.5 x 13` sizing instead of legal.
- Secretary Requirements now removes the side-card applicant avatar so that inspector stays cleaner and does not load extra photo preview work there.
- Admin live integrations now in:
  - `js/supabase-admin-dashboard.js`
  - `js/supabase-admin-approval-queue.js`
- Super Admin settings integration shell:
  - `js/supabase-superadmin-scholarship-settings.js`
  - `js/supabase-superadmin-user-management.js`
- System Administrator User Management now includes a manual `Confirm Email Login` action for accounts that cannot complete the Supabase email verification step; this fallback uses the Node server plus the Supabase service-role key and should be used only by the System Administrator when needed.
- System Administrator User Management now includes a `Claim / Replace Login` action for applicant accounts so office-created walk-in accounts can later be transferred to the student's final email and a new password without desynchronizing Supabase Auth from `profiles.email`.
- System Administrator `Claim / Replace Login` now also shows an `Office Temporary Password` section for unclaimed walk-in accounts, where staff can generate a fresh temporary password on demand without storing a readable password in the database; once the walk-in account is claimed, that office temporary access section closes automatically.
- Scholarship Settings now includes a `Require applicant 1x1 photo before submission` toggle so the System Administrator can temporarily allow applicant form submission without the photo while identity is checked later during examination/interview.
- Scholarship Settings still exposes an `Allow applicants to edit saved applications` toggle in the UI, and the matching Supabase hotfix now lets applicants edit any owned application record in `supabase/submitted_application_edit_hotfix_2026_03_12.sql` so forced edit mode can save successfully.
- Applicant intake closure now only blocks brand-new application creation; existing application drafts and submitted records can still be edited and resubmitted from the same form.
- Secretary Checking now includes a dedicated `Unlock for Editing` action for locked submitted or returned records, so staff can reopen an application without using the correction flow when they only need to clear the lock.
- System Administrator User Directory now shows each account's email address directly under the user's name for faster support and account lookup, and the directory now follows the same hoverable responsive queue-table pattern used by the secretary application list.
- System Administrator User Management now includes live email verification status chips, filtering, resend verification support, and audited access actions for account activation, suspension, deletion, and manual verification support; the verification status lookup uses the protected Node server route so staff can read Supabase Auth confirmation state safely.
- System Administrator User Management now hides the secretary-account creation block, uses a compact secretary-style filter bar, fetches the full user directory in batches beyond the old 1000-row limit, paginates at 10 rows by default for lighter page loads, and groups filters plus directory into one cleaner workspace card.
- Applicant notifications page supports live list, filter, pagination, mark read/unread, and mark all read.
- Extended application-only fields such as religion, family background, spouse details, awards, and similar non-core inputs now have a shared table path via `application_aux_data` so applicant and secretary corrections can persist across devices.
- Applicant legacy barangay cleanup now uses the dedicated `profiles.barangay` field, a dashboard reminder modal, and a direct `My Profile` barangay update path for older accounts with existing applications.
- Applicant application form now skips the auto-open Data Privacy Notice modal when reopening an already submitted application; the notice is still enforced on submit when needed.
- Applicant mobile handling now keeps the sidenav temporary-only on phones and tightens the top bar, page headers, action rows, cards, and pagination for smaller screens.
- Applicant dashboard now focuses the applicant on one cleaner workspace: progress tracking, uploaded requirements, notifications, exam schedule, and direct `New Application` plus `My Applications` quick actions without bringing back the older crowded lower dashboard sections.
- Applicant `My Applications` now removes the extra `Continue Draft` header button to keep the page less confusing.
- Applicant record-table actions now show `View`, `Edit`, and `Download PDF`, with `Edit` opening the form in forced edit mode so applicants can jump straight into the editable application form from the table.
- Applicant edit flows now refuse to fall back into a brand-new draft when an edit URL cannot load the existing record, and successful saves on existing records now say `Your changes were saved successfully`.
- Applicant dashboard and form now auto-load the latest owned application into the editable form when no `application_id` is present and intake is closed, so Save no longer falls back into a new closed filing.
- Applicant submission failures now stay inline for now instead of opening the blocking `Submission Failed` modal.
- Applicant save and submit failures now stay visible in the form banner instead of failing silently, with clearer duplicate email/mobile and live Supabase policy hints for applicant-side edits.
- Applicant and secretary family-income sections now display `Annual Gross Income` wording instead of `Monthly Gross Income` for the parents income field.
- Applicant/application workflow chips now show `Submitted` in blue for clearer visual status distinction.
- Applicant submitted status guidance now says to wait for secretary checking for correction, screening, and exam scheduling.
- Applicant printable form now shows `Edit Application` beside `Back to Applications` and opens the same record in forced edit mode.
- Applicant save errors now point to the live Supabase edit policy when the hotfix has not been deployed yet.
- Applicant profile address display now deduplicates repeated `Barangay` segments so messy saved address text renders as one clean Daet address.
- Applicant `My Profile` now uses a more mobile-first summary layout with a stronger profile hero, scholarship summary, document status chips, a simplified applicant account menu, the summary row hidden on phones for later redesign, and the detailed personal/contact/education/family cards removed from the main view to reduce applicant confusion.
- Applicant `My Profile` now exposes all four live edit modals from the hero `Edit Profile` menu, keeps login email read-only so profile edits do not desync Supabase Auth, auto-syncs the displayed profile email from the real signed-in account, and redirects the old standalone `applicant-profile-edit.html` shell back to the active profile page.
- Secretary Checking now keeps the simpler summary-first workspace, while secretary-side applicant corrections keep the applicant email read-only so profile edits do not desync the user's Supabase Auth login.
- Secretary Interview Verification now also includes a dedicated `Fix Login Email` office action for applicant accounts, so staff can replace a wrong applicant login email, keep `profiles.email` in sync with Supabase Auth, and immediately send a password-reset handoff email to the corrected inbox through the protected Node route.
- Secretary Checking applicant detail editing now keeps `Place of Birth` populated from the same fallback source used by the summary sheet, so opening the correction modal no longer shows that field blank when the value is stored in shared application data.
- Secretary-side `Upload / Replace Photo` now saves the applicant photo path through the same secure staff-profile RPC used for applicant detail corrections, so secretary uploads persist to the applicant profile once the updated `supabase/secretary_applicant_profile_edit_hotfix_2026_04_07.sql` is re-run in Supabase.
- Secretary Checking now asks for staff confirmation before `Set for Examination` changes an application to `Pending Exam`, using the same in-page modal pattern instead of firing the action immediately on click.
- Secretary Checking no longer exposes the old `Internal Review` selector to secretary users; the hidden failed-exam exception path is now managed only from the System Administrator side.
- Secretary Checking now places that discreet `Special Consideration` chip inline beside `Applicant Summary`, without the extra `Category` label or a separate header row.
- Secretary Checking now styles `Priority Review` with the default soft chip background and green text, while `For Approval` uses the yellow accent style for quicker office scanning.
- Secretary Applications now includes a dedicated `Requirements` sidebar shortcut that opens a compact summary-first view with four neutral cards for `Completed`, `To Follow-Up`, `User Not Submitted`, and `No. Submitted` without the numeric counter row, while the old queue/filter blocks stay hidden on that tab.
- Printed applicant names across the active application form, secretary print form, certification, scholar-selection exports, exam ranking prints, special-consideration exports, and exam room/attendance printouts now show `Last Name, First Name Middle Name` instead of first-name-first.
- Secretary Ranking now includes an `Open Details` button after the score column, opening the full applicant checking record in a separate browser tab so staff can review the record without leaving the ranking view.
- Secretary Ranking now also includes a header-only slide switch for the `Special Consideration` badge, so staff can hide or show that tag in the ranking view and print preview without losing the highlighted record itself.
- Secretary Ranking now shows the applicant profile picture before the examinee name in both the desktop table and the mobile ranking cards, using a circular avatar with a cleaner ring style; both the avatar and the applicant name block open the full applicant details in a new tab, the layout falls back to initials when no applicant photo is available, and photos hydrate in small batches so the ranking list appears first without waiting on every image.
- System Administrator Special Consideration now keeps tagged applicants visible in its allow-list even when those tagged records are outside the first active-year application fetch, so secretary-saved `For Approval` and other special-consideration tags no longer disappear from that page.
- System Administrator Special Consideration now shows live counter boxes for tagged applicants, `Priority Review`, `For Approval`, and remaining available applicants, and it also includes a `Print All Tagged` action with a cleaner numbered allow-list table for office reporting.
- System Administrator Special Consideration now includes score and overall rank in the allowed-students list, browser printout, and PDF export, and the print/export layout now uses a larger LGU-logo header on long-bond `8.5 x 13` portrait paper with readable table text.
- System Administrator Special Consideration print/PDF tables now place each applicant number under the bold examinee name, then print barangay above sector classification before the score and special consideration details.
- System Administrator Special Consideration print/PDF tables now keep scores bold without cell highlighting, center the special consideration column, and color only the status words: `Priority Review` green and `For Approval` yellow.
- System Administrator Special Consideration print/PDF table headers now use a larger font size for easier reading.
- System Administrator Special Consideration print/PDF tables now keep long-bond side allowance so the table border no longer sits flush against the paper edge.
- System Administrator Special Consideration now uses the same green `Priority Review` and yellow `For Approval` badge colors as the secretary-side review pages.
- System Administrator Special Consideration now has its own dedicated page, letting the office search applicants by the active school year and mark who can stay eligible for final review even if the exam result would normally block them.
- System Administrator Special Consideration now uses a compact header switch plus a green confirmation modal when the flow is turned on.
- System Administrator Special Consideration now uses the same compact modal pattern for both enable and disable flow changes, instead of leaving a long inline status banner after turning the flow off.
- System Administrator Special Consideration now uses a minimal saved-entry catalog with only 2 levels, `Priority Review` and `For Approval`; the office saves a `Care Of / person / location`, can delete saved entries later, and then assigns students from the selection modal.
- System Administrator Special Consideration now uses a more compact responsive layout, with the tall panel stretch removed and the saved-entry rows tightened so the page reads cleaner on narrower screens.
- System Administrator Special Consideration now uses the shared popup toast pattern for save/update/remove notices, with a page-level fallback so cached old markup does not reopen the long inline status bars after actions.
- System Administrator Special Consideration now shows the allowed-students area as its own responsive table section below the main workspace row, keeping the old table-style scanability with a cleaner user-management-style shell.
- System Administrator Special Consideration now also includes a separate `Final List Inclusion` manager with its own search/results table, so the office can add applicants into the Secretary Scholar Selection final total without changing the applicant-side score or rank display.
- Final List Inclusion now records a `Care Of / Person In Charge / Endorsed By` note per applicant through its own modal, keeps that detail editable from the Included Applicants table, and preserves the note in the same `application_staff_flags` record as the inclusion flag.
- Admin Approval Queue now shows only neutral `final review` wording for those special consideration exceptions instead of exposing the old internal label in the staff queue.
- Admin Approval Queue now includes an admin-only `Print Form` link per applicant row that opens the printable application form preview for that record.
- System Administrator sidebar now restores the direct `Special Consideration` shortcut to the dedicated allow-list page instead of jumping inside Scholarship Settings.
- System Administrator Special Consideration printing now includes a `Print Tag` dropdown so staff can export or print only one tag group, such as `Mayor Office`, instead of the entire allow-list.
- System Administrator Special Consideration live table and print/PDF output now fade the rows green when an applicant's saved raw score meets the active passing score.
- System Administrator Dashboard now includes a direct `Check Exam Room Assignment` button that opens the public room checker without leaving staff to hunt for the applicant-side entry point.
- Secretary Checking now renders the applicant summary and form state first, while photo previews and queue-navigation hydration finish in the background for a faster first load on localhost and hosted deployments.
- Secretary applicant-detail corrections no longer report a false success when the profile write is blocked by database policy, and the page now asks for the dedicated Supabase hotfix if the secure staff-save RPC is not deployed yet.
- Secretary applicant-detail profile edits now use the Supabase hotfix `supabase/secretary_applicant_profile_edit_hotfix_2026_04_07.sql`, which safely limits the RPC to secretary accounts, blocks locked/finalized records, and writes audit entries to System Administrator Audit Logs when `supabase/audit_logs_hotfix_2026_03_22.sql` is deployed.
- Account verification now expects an 8-digit email OTP in the registration copy, verification page input, and client-side OTP validation flow.
- Secretary address displays in checking/print now strip loose `Barangay` placeholder segments so summary fields no longer show redundant values like `Barangay, Barangay Magang`.
- Secretary Applications now includes a System Administrator-controlled `Walk-In Intake` action in the page header so office staff can create or reuse one applicant account and place a submitted application directly into the secretary queue for in-person walk-ins.
- Secretary Applications queue now renders faster by showing the main queue first and loading correction-history badges as a secondary pass; apply `supabase/secretary_application_queue_performance_hotfix_2026_03_23.sql` if the hosted queue still feels slow on larger datasets.
- Secretary Applications barangay filtering now includes a `No Barangay` option whenever queue records still have a blank barangay value, so office staff can find and clean those records directly.
- Secretary Applications now opens with the status filter set to `Submitted` by default instead of `Status All` so the regular queue is front and center on load.
- Secretary Applications queue now uses a more compact applicant-row layout, keeping `Resubmitted` details on a tighter line so more records fit in view without forcing a fixed table height.
- Secretary Applications now keeps only verification-stage records in the main queue, so once `Set for Examination` moves an applicant to `Pending Exam`, that record drops out of the verification list and is handled from Exam Management instead.
- Secretary Applications now includes a `Mass Set to Examination` queue action that moves the currently filtered `Submitted` applications to `Pending Exam` in one step and sends the same applicant-ready notification used by the single-record action.
- Secretary draft applications can now be exposed to the Secretary queue only when Scholarship Settings enables draft completion; the status filter now pins `Draft` for faster office triage, and from Secretary Checking, staff can update applicant details, attach or replace the applicant 1x1 photo, and move the draft into submitted status.
- Secretary Applications queue now renders applicant names in uppercase for consistent office scanning, and the walk-in intake name fields normalize to uppercase before saving new or reused applicant records.
- Secretary Walk-In Intake name fields now keep spaces while staff type multi-word first, middle, or last names, while still normalizing the saved values to uppercase on submit.
- Secretary Checking now includes an office-side `Upload / Replace Photo` action in the applicant photo block so staff can attach or replace the applicant 1x1 image directly from the verification screen when the office already has the file.
- Secretary Checking now shows a `Back to Checking` action for records in `Returned for Correction`, and `Save Checking` automatically moves a corrected resubmission back to the regular checking queue once the applicant has updated the returned form.
- Secretary Checking now keeps the `Back to Checking` button visible in the action row, and disables it with a short hint when the loaded record is not currently in `Returned for Correction`.
- Secretary Checking now places the `Special Consideration` dropdown under `Secretary Remarks` for a cleaner responsive layout, and Scholarship Settings now has a separate `Show Special Consideration selector on Secretary Checking` flag so the System Administrator can hide or show that secretary-only input without changing the dedicated Special Consideration page toggle.
- Secretary Exam Management now includes an exam-schedule notice form and `Send Schedule Emails` action that emails all applicants already saved in the selected batch, writes applicant notifications, and confirms those scheduled records stay in `exam_scheduled`; this action requires the Node server and SMTP to be configured.
- Secretary Exam Management now lets staff type the batch label manually, such as a year like `2026`, instead of forcing the old fixed session labels; the system still auto-generates the internal exam number in the background after room and seat assignment is saved.
- Secretary Requirements now uses a split layout: the main `col-9` table card keeps the selection dropdowns in its card header, while the first `col-3` side card reflects the visible Requirements list and auto-loads the first applicant’s submitted requirement details, then switches when staff click another applicant name.
- Secretary Exam Management now fills rooms sequentially by the configured per-room capacity, such as Room 1 first, then Room 2, until all selected examinees are consumed; the downloaded room-list and masterlist PDFs now show only applicant full name, LDSP application number, and seat number.
- Secretary Exam Management now preloads the exam schedule email note with the office reminder to bring a school ID or any valid ID plus one black ballpen, while still letting staff edit that message before sending schedule emails.
- Secretary Room Assignment now includes a one-person `Send Test Email` flow for a selected scheduled examinee, with an optional test receiver email so staff can preview the real exam notice in their own inbox before sending the full batch.
- Secretary Room Assignment and the exam-schedule email API now read the valid `scheduled` exam-record rows directly again, preventing the `invalid input value for enum exam_record_status: "exam_scheduled"` error during one-person test emails and batch schedule sends.
- Exam schedule emails now use a cleaner government-style HTML layout with a proper notice header, stronger room and seat emphasis, clearer official detail sections, and more polished action buttons for tracking and the public room checker.
- `Send Schedule Emails` now queues exam schedule notices instead of blasting them in one request: the Node server sends them in background batches of 100 every 5 minutes to reduce spam risk, while the secretary page immediately confirms the queue summary.
- The queued exam schedule sender also requires `LDSS_SUPABASE_SERVICE_ROLE_KEY` in the Node app environment, because the background processor updates queue progress outside the secretary's browser session.
- Secretary Room Assignment now shows a live `Batch Email Status` counter for the loaded batch, including queued, sent, skipped, failed, and remaining email counts, and it keeps auto-refreshing while the batch email queue is still sending in the background.
- Secretary Room Assignment now shows the saved room preview in room-based tabs, keeping assigned rooms easy to open one by one while grouping reserved empty rooms into one summary tab instead of a long stack of empty cards.
- Secretary Room Assignment, Exam Results, and the exam-schedule email sender now fetch `exam_records` in batches beyond Supabase's first 1000 rows, so larger room assignments no longer stop counting or sending at 1000 examinees.
- The exam-schedule email sender now also loads its related `applications` and `profiles` in smaller chunks, preventing the secretary page from failing with `Failed to load scheduled applications.` on larger saved batches.
- Secretary Room Assignment now includes a safe `Reset Exam Data` action for the currently selected batch, clearing only unlocked scheduled room assignments back to `Pending Exam`, and the Eligible Examinees table now shows 10 rows per page with pagination controls.
- Secretary Room Assignment now shuffles the selected examinees randomly before filling `ROOM 1`, `ROOM 2`, and the remaining planned rooms, instead of following LDSP number or name order.
- Secretary Room Assignment now also includes a `Delete Batch` action for the currently selected saved batch, removing empty or still-scheduled old batches from `Existing Batch` while blocking any batch that already contains completed or encoded exam records.
- Secretary Room Assignment now labels the eligible-examinee clearing control as `Uncheck All`, and it clears the whole current eligible selection instead of only the visible page.
- Secretary Room Assignment now replaces the old separate `Reset Exam Data` and `Delete Batch` actions in the main UI with one simpler `Start Over` action that clears the currently loaded safe batch and returns the page to `Create new batch`.
- Secretary Room Assignment no longer shows the old `Batch Directory` card on the page, keeping the workspace focused on the current batch form, eligible examinees, and room preview instead of a second saved-batch list.
- Secretary Room Assignment `Start Over` now force-clears the currently loaded batch selection after the safe batch is removed, so the room preview and form reset immediately instead of reusing the old batch in memory.
- Secretary Room Assignment now also includes `Clear All Safe Batches`, which bulk-removes every saved batch that still has only safe scheduled data or is empty, while leaving any completed or encoded exam batches protected.
- Secretary Room Assignment safe cleanup now archives cleared batches and hides them from the Secretary dropdown instead of trying to hard-delete rows that Secretary accounts are not allowed to delete under the current database security rules.
- Secretary Room Settings now uses a full-width compact top layout with smaller grouped fields, and the old `Batch Notes` textarea has been removed from the visible form to keep the room-assignment page cleaner before staff upload and send schedules.
- Secretary Room Assignment now places `Start Over` and `Clear All Safe Batches` in a separate red top-side danger section, keeping those destructive batch actions away from the normal generate, email, and PDF buttons to reduce accidental clicks.
- Secretary Room Assignment now shows an `Active Batch Examination` summary card near the top, making the currently loaded batch label, exam date, venue, and room plan visible before staff generate, email, or download anything.
- Secretary Room Assignment room-list and masterlist downloads now use a more official but compact legal-size layout with one centered LGU Daet logo across the top, minimal batch/date/venue details, and a clearer bold `ROOM 1`, `ROOM 2`, and similar room title without wasting too much page space.
- Secretary Room Assignment now uses a denser two-column desktop workspace: compact counters stay on top, `Secretary Room Settings` uses a narrower `col-4` panel, and `Eligible Examinees` uses a wider `col-8` panel, with smaller form controls to maximize the visible scheduling area.
- Secretary Room Settings now stacks its inputs one per line inside the narrower left panel, so the `col-4` layout stays cleaner and easier to read while the wider `Eligible Examinees` table keeps more horizontal space.
- Secretary Room Settings now also applies a forced full-width stack rule on that left panel, so every field stays one-per-line even if an older cached Bootstrap layout tries to place fields side by side.
- Secretary Room Assignment now simplifies `Send Test Email`: if staff type a custom test receiver email, the page automatically uses the first scheduled examinee in the loaded batch for the preview, without requiring a checked table row.
- Secretary Room Assignment now shows clearer HTTP/API error messages for exam-email actions, so staff can distinguish session, permission, bad-request, SMTP, or Node-server failures instead of seeing only a generic `Request failed`.
- Secretary Interview Verification no longer blocks applicant-detail corrections when an older hosted file preview under `/api/uploads/blob` is unavailable; the page now keeps the edit/save flow working and simply hides that preview until the Node upload route is available.
- Secretary Room Assignment now follows a simpler office flow: `Generate and Save Room Assignment` uses all eligible `Pending Exam` applicants automatically for the current batch, while `Send Schedule Emails` handles the mass notice and each scheduled applicant row now has its own direct `Send Test Email` action for one-person preview.
- Secretary Room Assignment no longer auto-checks every eligible row by default, the room-preview list now has its own direct `Send Test Email` button beside each scheduled applicant, and new room saves now continue exam control numbers from the latest saved record to avoid duplicate-key errors.
- Secretary Room Assignment now also supports late examinees without regenerating the whole saved batch: staff can use `Append Checked to Batch` for checked `Pending Exam` rows, or use each row's `Assign Room` / `Edit Assignment` action to place one applicant in an exact room and seat manually.
- Manual room assignment now also includes `Save and Email Applicant`, which sends a one-person real exam schedule notice immediately after the room/seat save so late-added examinees do not require a full batch resend.
- Secretary late-examinee `Append Checked to Batch` and manual `Save Assignment` now stay available even when the loaded batch already has completed or encoded results, while still blocking any applicant whose own exam record is already completed or encoded.
- Secretary Room Assignment now also includes `Download Attendance PDF`, which exports a more compact room-grouped attendance sheet on long bond paper (`8.5 x 13`), keeps one room per page in the normal room-capacity flow, and adds a blank signature column beside each assigned examinee.
- Attendance-sheet exports now hide the batch/session box in the header, place `Seat No.` before the applicant name, and use more even attendance column alignment for signing.
- Attendance-sheet print and PDF exports now use tighter long-bond margins and a slightly larger table/header layout so the `8.5 x 13` page is used more fully.
- Attendance-sheet table text is now bumped a total of `+2` in both print view and PDF export to improve readability on the long bond sheet.
- Attendance-sheet applicant names now render in bold in both print view and PDF export for easier room checking.
- Room-list exports now also render applicant names in bold, and the shared export header no longer shows the venue box.
- Applicant Registration now keeps spaces while users type multi-word first names or surnames like `MARIA LUISA` or `DELA CRUZ`, while still normalizing the saved value to clean uppercase on submit.
- Applicant-side tracking now also shows the saved exam `Room` and `Seat No.` inside `My Applications` and the application detail page once secretary room assignment has already been posted through `exam_records`.
- Secretary Reports is now rebuilt again as a live school-year summary page, with refresh/print actions plus applicant/application totals and table summaries for workflow status, barangay, sector classification, and school distribution.
- Secretary draft rows now use a queue action dropdown so staff can choose `View Draft` for read-only preview or `Finish Draft` for office-side completion.
- Secretary Checking now includes a `Not Qualified` action beside `Set for Examination`, allowing the scholarship office to stop an applicant from proceeding to exam and move the record directly to `Rejected`.
- Secretary Checking `Save Checking` now clears `Returned for Correction` back to `Submitted` once the applicant has actually updated the returned record, so corrected applications do not stay stuck in correction status after secretary re-check.
- Secretary and applicant printable application forms now share the same official print-sheet layout, and the secretary print output no longer includes the requirement section so both versions match more closely.
- Secretary Checking `Print Form` now opens the secretary printable sheet in print-ready mode, and the secretary print page now allows submitted and later application records so office staff can print during checking instead of waiting until after exam/interview.
- Secretary printable-form loading now renders the text fields before file-preview URLs are fetched, so an older hosted upload preview or temporary `/api/uploads` issue no longer leaves the whole secretary print sheet blank on `Loading application record...`.
- Secretary dashboard chart row now replaces the old Return / Resubmission graph with a reminder follow-up chart for draft/no-form users, while Sector Classification was moved into the earlier chart slot.
- Secretary Reports is now a cleared reconstruction shell; the old report cards, filters, and summary details were removed from the page so the secretary printing/reporting flow can be rebuilt cleanly.
- Secretary reminder campaigns now support queued background sending in timed batches through the Node server so large filtered reminder groups do not need to be sent all at once.
- Secretary general information report printouts now include the LGU Daet, system icon, and Maogma logos in the report header.
- System Administrator scholarship settings now support application open/close time controls, and applicant submission cutoff follows the configured date and time.
- System Administrator scholarship settings now use one responsive workspace card for the full policy form, and include a prominent `ENABLE RECEIVE` / `DISABLE RECEIVE` control in Scholarship Duration so the office can manually lock or reopen applicant filing, including emergency reopening after the scheduled cutoff once the new Supabase hotfix is applied.
- System Administrator `Application Receive Control` now saves immediately when `ENABLE RECEIVE`, `DISABLE RECEIVE`, or `RETURN TO SCHEDULE` is clicked, so applicant filing opens or locks without requiring a separate `Save Settings` step.
- System Administrator Scholarship Settings now has a cleaner responsive workspace layout with refined KPI cards, grouped policy sections, and responsive switch-style System Control Flags for faster office use on desktop and mobile.
- System Administrator Scholarship Settings now includes an `Allow secretary to finish applicant drafts from Secretary Checking` control flag for emergency office completion of applicant drafts.
- System Administrator Scholarship Settings now includes an `Allow secretary walk-in intake for individual office applicants` control flag that governs whether the Secretary Applications page exposes the office-only walk-in encoder.
- System Administrator Scholarship Settings now again shows both the `Allow secretary to finish applicant drafts from Secretary Checking` and `Allow secretary walk-in intake for individual office applicants` switches in the live System Control Flags UI, so those Secretary page actions can be turned on from the browser again.
- System Administrator Audit Logs now provide a live critical-action history for user management verification actions and scholarship settings changes once the audit log hotfix is applied.
- System Administrator Special Consideration search now affects only the add-candidate results, while the saved Allowed Students table stays static; when a searched student is already on the allow-list, the page explains that clearly instead of making the record look missing.
- System Administrator Special Consideration now caps the Student Allow-List search panel at the top 5 matches and shows the Allowed Students table in its own separate card below the main Special Consideration workspace.
- System Administrator Special Consideration Allowed Students now uses the same queue-style row arrangement as the applicant lists, with stacked applicant details, labeled mobile cards, and inline Edit / Remove actions for easier office scanning.
- System Administrator Special Consideration now loads the full active-school-year application pool in batches instead of stopping at the latest 500 records, so older applicants can still be found in search when the office has a larger queue.
- System Administrator Special Consideration now also loads `application_staff_flags` in smaller batches, preventing Supabase `Bad Request` errors when refreshing larger active-school-year queues.
- Applicant name handling is now normalized to uppercase in registration and applicant profile name edits, and office-side Special Consideration / Secretary Checking displays also render applicant names in uppercase for consistent staff scanning.
- Secretary draft completion depends on the SQL hotfix `supabase/secretary_draft_completion_hotfix_2026_03_23.sql` so the new workflow flag is exposed through `active_workflow_controls()`.
- Secretary walk-in intake requires the protected Node route `POST /api/secretary/walk-in-intake`, a valid Supabase service-role key on the server, and the SQL hotfix `supabase/secretary_walk_in_intake_hotfix_2026_03_23.sql`.
- Secretary Exam Management now includes `Open Details` actions in both the examinee queue and saved room preview so office staff can still open the full Secretary Checking record and edit applicant details after moving the applicant into examination.
- Secretary sidebar navigation now places `Room Assignment` directly under `Applications`, followed by `Exam Management`, so the office flow matches the actual scheduling sequence.
- Secretary Room Assignment now uses a cleaner full-width layout: `Secretary Room Settings` first, a four-card metrics strip next, and the full-width `Eligible Examinees` table directly underneath the settings instead of side-by-side.
- A new public `exam-room-lookup.html` page now lets applicants check their posted exam room using `Full Name + LDSP Application Number`, and exam schedule emails now include that public room-check link so the office can share room assignments without requiring applicant login.
- Exam schedule emails and the public room checker now both show the LDSP Support Facebook Page for applicants who still cannot see their room assignment after checking.
- Secretary Exam Management now lets staff enter how many rooms the batch will use, reserve `ROOM 1` up to the final room count automatically, fill selected `Pending Exam` applicants sequentially across those rooms, save each applicant's room and seat assignment on `exam_records`, and keep the planned room count plus room label inside the saved batch.
- Secretary Room Assignment now downloads true PDF room lists and masterlists from the page, and the room-list PDF includes the full planned room sequence so unused reserved rooms like `ROOM 59` and `ROOM 60` still appear in order when the office needs a complete batch file.
- Secretary Exam Management Eligible Examinees now includes reverse controls for office mistakes: selected unlocked rows can be moved back to `Pending Exam` or returned all the way to secretary checking, and any still-scheduled room assignments tied to those examinees are cleared automatically before the status is rolled back.
- Secretary Exam Management rollback actions now use an in-page confirmation modal aligned with the existing project template instead of the browser `confirm()` popup, so staff see the selected examinee count, target status, and room-assignment impact before proceeding.
- Secretary Exam Management now uses an `Exam Date` field without a required time for the current office workflow, and it still locks the batch exam date plus venue once saved examinees already exist.
- Secretary Exam Management keeps the exam date/time and venue on the secretary batch form, while System Administrator Scholarship Settings stays focused on policy controls rather than day-to-day room assignment scheduling.
- Secretary portal sidebar links are now consistent across the remaining exam, interview, recommendation, notification, renewal, print, and follow-up routes, so opening Room Assignment no longer makes the `Reports` link disappear from the secretary navigation.
- Secretary sidebar navigation now separates `Exam Management` from `Room Assignment`, so staff can open exam result work and room assignment from distinct sidebar links.
- Secretary Exam Management now uses a more compact monochrome workspace style for the room-assignment screen, keeping the page black, white, and gray with smaller action buttons for a steadier office-facing look on desktop and mobile.
- Secretary Exam Management status messages now use a cleaner monochrome notice box style so save, review, info, and error states feel more official and easier to scan.
- Secretary Exam Management now places the room generator in a narrower left workspace and the Eligible Examinees table in a wider right workspace on desktop, while still stacking cleanly on smaller screens.
- Secretary Exam Management now opens a room-based raw-score sheet for exam encoding, so staff can choose a saved batch plus room, enter whole-number raw scores in printed seat order, and move room-to-room without using a visible passing-threshold rule on the page.
- Secretary Exam Management now highlights special-consideration examinees with a subtle amber row tint and badge in the room sheet and ranking views, while leaving the raw-score workflow and ranking math unchanged.
- Secretary Exam Management now includes a room-sheet search bar with Search and Show All buttons so staff can quickly find an examinee, application number, control number, or seat inside the current room result sheet without losing unsaved score inputs.
- System Administrator Scholarship Settings now includes a Checking Examination toggle so applicant progress views can show that exam scores are in score consolidation without changing the underlying database status list.
- System Administrator Scholarship Settings now includes an applicant score-visibility toggle so the office can hide or show encoded exam scores plus final pass/fail exam results on the applicant dashboard, My Applications, profile summary, and application detail screens without exposing them too early.
- Applicant-facing exam result displays now read the active System Administrator `passing_score` and `exam_total_items` policy, so once the workflow-controls exam-policy hotfix is deployed, applicant raw-score summaries and pass/fail labels follow the live active scholarship settings.
- Secretary Ranking now shows `Barangay` as its own column after `Examinee`, keeps the LDSP application number under the applicant name, and displays sector classification in normal text without the old colored highlight.
- Secretary Ranking search now updates while typing, ignores letter case and caps lock, and matches applicant names more accurately by first name, last name, or LDSP application number instead of using a broad mixed-field lookup.
- Secretary Ranking sector-filter reports now keep each applicant on the same overall ranking number instead of re-ranking the filtered sector list from 1, making sector-based reporting match the overall ranking file.
- Secretary Ranking `All sector classifications` now shows all sector-tagged applicants together while preserving their original overall rank numbers, with tied scores sharing the same counted rank.
- Secretary Room Score Encoding now includes a `Mark Blank as Failed to Take Exam` action for the selected room, labeling blank/no-show examinees as failed without changing scored rows.
- Secretary Scholar Selection now excludes blank/no-show records from the Sector Classification failed-score pool, so sector slots come only from applicants with an encoded raw score.
- Applicant navigation is now simplified for end users: the sidebar keeps Dashboard and My Applications, notification links are hidden for now, and the Dashboard now opens directly into the applicant's Application Records view instead of making them jump to a separate tracking-first screen.
- Applicant Dashboard now uses the same Application Records table view as `My Applications`, and the applicant-facing columns are now trimmed into a smaller responsive list with `No.`, `School Year`, `Applicant ID`, `Submitted On`, `Examination Status`, `Exam Result`, and an `Option` column with `View`, `Edit`, and `Download PDF`.
- Applicant application tables now show a small `SCORE | STATUS | RANK` helper line under the `Exam Result` header so the column meaning is easier to read at a glance.
- Special consideration and regular pass applicant rows now display `score | PASSED` with a recomputed rank when score visibility is enabled, while the stored raw score remains unchanged and special consideration still uses the rounded active passing score for the display score.
- Sector-classification applicant rows now resolve the final 76 selected sector applicants from the batch itself, and those rows display `SCORE | SELECTED` with a small gray detail line such as `Sector Classification: Person with Disability (PWD)` on the applicant table and detail/dashboard views when score visibility is enabled, with the selected label green and the sector classification detail kept muted on the applicant side.
- Applicant application tables now show `score | FAIL | Rank ####` for failed rows when score visibility is enabled and the applicant has a computed batch score rank available, with the rank label kept in a muted gray tone on the applicant side.
- Applicant application rows now resolve `Not Qualified` from the exam result itself, so a failed exam no longer falls through to `Unknown` while the workflow status is still catching up.
- Applicant `My Applications` now shows direct `View`, `Edit`, and `Download PDF` actions for submitted records, so the printable form and editable form are one click away from the record table.
- Applicant form and tracking pages now expose direct `Download PDF` actions that open the dedicated printable application sheet, so applicants can reach the browser print dialog from the form, detail view, or submit confirmation modal.
- Applicant printable application flow now uses clearer `Download PDF` labels and a mobile-friendly print-page button so phone users can reach the Save as PDF sheet more easily.
- Applicant Dashboard and `My Applications` now show the `New Application` page action again, and the applicant-side lock now checks only the active school year so previous-cycle records no longer hide fresh filing for the new cycle.
- Applicant tracking labels now treat draft or unsubmitted records as `Not Submitted` in the requirements column, and the final decision stays `Unknown` until the application reaches the actual final-review stage, where it can then move to `Pending`, `Approved`, or `Not Qualified`.
- Applicant application records now keep the `Exam Result` column simple for regular tracking: applicants see `Passed`, `Failed`, `Score Consolidation`, or `Not Taken`, while special-consideration rows can show the active passing score and rank when score visibility is enabled.
- Applicant exam tracking now keeps the examination-attendance stage simple for end users, while the `Exam Result` column uses a yellow `Score Consolidation` stage until the office posts the final `Passed` or `Failed` result.
- Applicant records now use `Examination Status` for simple attendance-stage tracking, so the applicant table reads `Pending`, `Scheduled`, `Completed`, or `Absent` instead of showing the longer workflow-style `Exam Completed` label there.
- Applicant application-record cards on mobile now reset all desktop column widths, so the remaining labels and detailed exam text stay horizontal and readable instead of collapsing into vertical letter stacks.
- Admin navigation is now reduced to `Dashboard` plus `Special Consideration`, and the Special Consideration shortcut opens the Approval Queue special view with a read-only table of saved care-of entries and tagged counts.
- Admin Dashboard and the `Special Consideration` route are now cleared back to simple shell states so the office can rebuild those sections one instruction at a time without old cards, tables, or actions getting in the way.
- Secretary navigation now includes a dedicated Ranking sidebar link that opens a separate Secretary ranking page with score-based review options for overall, per-room, sector-classification, and top-range ranking views.
- Secretary navigation now also includes an `All Passed` sidebar page, giving the office a temporary manual batch-by-batch control for marking exam results as `Passed`, `Fail`, or `Pending` while the scoring workflow is still being adjusted.
- Secretary All Passed now removes the top KPI cards and orders the manual passed list by raw-score rank, with tied scores sharing the same rank and unscored examinees appearing after ranked rows.
- Secretary navigation now includes `Scholar Selection`, a final-list builder that combines Regular score passers, Sector Classification slot picks from below-passing-score applicants, and Special Consideration tags into one printable list.
- Secretary Scholar Selection now shows Special Consideration rows at the rounded active passing score and recomputes their displayed rank against that score, while keeping the stored raw score intact for audit history.
- Secretary Scholar Selection now labels the 76-slot sector pool rows as `Selected` with a soft amber/yellow badge, while keeping the sector explanation in the basis text.
- Secretary Scholar Selection now keeps the Likhang Daeteño Performing Arts section as actual manual entries only, shows the real Likhang entry count in the summary, and removes the old dummy-slot reservation behavior while keeping the masterlist print on a responsive 8.5 x 13 bond-paper table with row-break protection and a compact LGU logo header.
- Secretary Scholar Selection now reads the separate `Final List Inclusion` System Administrator flag as its own final-list category, counts those applicants in the final total, and keeps their real score/rank untouched on the applicant side.
- Final List Inclusion rows in Secretary Scholar Selection now carry the System Administrator `Care Of / Endorsed By` note into the Basis / Remarks text, so the endorsement follows the final list and print output without altering exam scores or ranks.
- Secretary Scholar Selection masterlist print now makes the applicant name larger and left-aligns the smaller category badge underneath it so each row reads cleaner in the print preview.
- Secretary Scholar Selection masterlist print now uses alternating row shading so the bond-paper table is easier to scan than the previous plain-white rows.
- Secretary Scholar Selection masterlist print now paginates at 25 applicants per bond-paper page, hiding the count cards in print to maximize space.
- Secretary Scholar Selection masterlist print header now reads `LGU DAET EXPANDED SCHOLARSHIP PROGRAM` with `Batch 2026` underneath.
- Secretary Scholar Selection masterlist print now uses tighter bond-paper margins, keeps the table inside a bordered card frame, and places a subtle underlined `www.iskolarngdaet.app` footer outside the card at the lower-right of every printed page.
- Secretary Scholar Selection masterlist print now keeps the Score column black by default and turns scores below 70 red so low scores stand out without coloring every row.
- Secretary Scholar Selection masterlist print pages now render as bordered card-like sheets so the table stays visually inside the frame during long-bond printing.
- Secretary Scholar Selection print now shows the counter boxes in print again so Regular, Sector, Special, Likhang, and Total remain visible above the masterlist table.
- Secretary Scholar Selection masterlist print now centers the Application No. and Sector columns for a cleaner bond-paper layout.
- Secretary Scholar Selection masterlist print now centers the Score header too, matching the other centered columns in the bond-paper layout.
- Special Consideration is now an Admin-only shortcut in the sidebar, with the Admin approval queue still exposing the same view from its header for the final approve/decline workflow and a care-of catalog shell for the added entries.
- Secretary Scholar Selection sector masterlist rows now come only from the below-passing sector pool, and the sector slot field is fixed at 76 so the summary and masterlist stay aligned with the office rule.
- Secretary Ranking now shows a phone-friendly card layout on small screens while keeping a folio-sized 8.5 x 13 printable table for the Save as PDF flow.
- Secretary Ranking now shows barangay under each applicant name in the on-screen table, mobile cards, and print layout for clearer office reporting context.
- Secretary Ranking now uses an unframed top filter workspace with direct batch, view, and applicant-search controls, keeping the page cleaner while staff can still search by applicant name or LDSP application number without losing each applicant's original saved rank.
- Secretary Ranking now also shows a separate running `No.` counter beside `Rank`, so tied scores remain easy to follow in the on-screen list and mobile card view.
- Secretary Ranking print styling now uses smaller table text, cleaner header wrapping, and alternating row colors so long ranking lists are easier to read on screen and in PDF.
- Secretary Ranking print now follows the Special Consideration long-bond style with side allowance, larger logo/header, bold score, bold examinee name with application number underneath, and barangay with sector classification underneath when available.
- Secretary Ranking print now keeps the LGU/title header only on the first long-bond page, then uses compact continuation pages with table headers only so the remaining paper space is consumed cleanly without broken rows.
- Secretary Ranking print columns now follow `NO.`, `RANK`, `EXAMINEE`, `BARANGAY`, `ROOM / SEAT`, `SECTOR CLASSIFICATION`, and `SCORES`, with a slightly larger print font for readability.
- Secretary Ranking print now uses one continuous long-bond table again, removing manual page chunks so blank reserved space is avoided while table rows stay protected from splitting at the page bottom.
- Secretary Ranking print now hides the on-screen ranking card title/summary so only the dedicated print header and table appear in the printout.
- Secretary Ranking PDF output now builds dedicated print pages with the Daet logo, a whole-number `No.` counter before `Rank`, the application number under each applicant name, and fixed 30-row chunks per page so bond-paper exports stay readable without page-break collisions.
- Secretary Scholar Selection now includes a separate `Download Names PDF` action that exports the current final-list view as an alphabetically sorted names-only PDF with the simplified public-posting header, while keeping the full `Print Masterlist` worksheet unchanged.
- System Administrator passing score entry is now whole-number only, and the shared applicant/workflow policy readers now round any older decimal passing score values back to a whole-number threshold before pass/fail display logic runs.
- Secretary room assignment saving requires the SQL hotfix `supabase/exam_room_assignment_hotfix_2026_03_28.sql`.
- Reminder emails for applicants without a submitted form now use the active scholarship settings cutoff deadline instead of a fixed hardcoded date.
- Applicant Dashboard and My Applications now disable the `New Application` entry point when receiving is manually disabled or when the configured filing window is closed.
- Applicant dashboard sidebar is now trimmed for end users and keeps only `Dashboard` plus `My Applications` in the main applicant navigation.
- Applicant sidebar now labels the main application link as `Manage Application` while keeping the same applicant applications page and flow.
- Applicant Dashboard is now cleared into a simple shell page so the next applicant-side dashboard details can be rebuilt cleanly.
- Applicant submission form now includes the missing intake-date formatter used by the filing-window guard, fixing the `formatDate is not defined` submission error when the system shows intake open/close schedule messaging.
- Applicant form now lets users update already-submitted or returned-for-correction applications after the intake deadline, while still blocking first-time draft submission once filing is closed.
- Login and applicant registration pages now show a public filing-status modal when online scholarship application is not yet open, already closed, or manually closed by the scholarship office, while clarifying that existing applicants may still sign in even though new submission is unavailable.
- Secretary exam management supports exam batch scheduling, room assignment, and raw-score encoding for ranking-based review.
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
- The login form accepts email directly and can also resolve a mobile number through the optional same-origin auth helper route.
- `Remember me` now decides whether the Supabase session stays on the device or only in the current browser tab.
- The login page no longer includes the public exam room lookup shortcut; that checker stays on its dedicated page.
- Fetches `profiles.role`.
- Redirects automatically:
  - `applicant` -> `APPLICANT/`
  - `secretary` -> `SECRETARY/`
  - `admin` -> `ADMIN/`
  - `super_admin` -> `SYSTEMADMINISTRATOR/`

Applicant exam display now:
- The applicant dashboard, My Applications, application detail page, and profile status chip now show `PASSED` for passed exams, and special consideration cases also stay `PASSED` on the applicant side.
- Failed applicant exam results now show `score | FAIL` inline in the Exam Result column when score visibility is enabled, without the percentage field.
- When score visibility is disabled, applicant-side exam result/status chips collapse to a yellow `Score Consolidation` state instead of exposing pass/fail.
- Special consideration applicants are resolved through a safe current-user RPC so the applicant view can treat them as passed without exposing the staff-only tag.

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
- Password recovery stays email-delivered, but the forgot-password page can resolve a registered mobile number to the linked email when the optional auth helper route is available.
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
- Run `npm run check:syntax` after low-risk JS changes to parse-check `server.js` plus every file under `js/` before uploading files to hosting.
- `npm test` is still a placeholder and does not run application tests yet.
- Repository hygiene: local snapshot archives and OS metadata files like `.DS_Store` should stay ignored and should not be uploaded to hosting.

## Placeholder Shells
- Some pages intentionally remain static shells so role-based navigation works without breaking entry points.
- Current shell examples include Applicant Help, Admin Notifications, and the System Administrator dashboard overview.
- Secretary Requirements currently has its four-card summary block removed so the page can be redesigned manually without loading the previous summary layout.

## Security Headers
- Apache/static hosting baseline headers are defined in `.htaccess`.
- Node hosting applies the same baseline headers in `server.js`.
- Public exam room lookup now rate-limits repeated attempts and returns a generic maintenance message instead of raw backend/database errors.
- Current CSP allows the existing CDN scripts (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`), Supabase API/realtime connections, signed Supabase asset URLs, and the app's current inline script snippets.
- Remaining hardening work, if you want a stricter CSP later:
  - remove inline `<script>` blocks such as `window.LDSS_REQUIRED_ROLE = ...`
  - move the inline logout script into a standalone JS file
  - then remove `'unsafe-inline'` from `script-src`

- Secretary portal sidebars now include a direct `Exam Management` link again, while the main Exam Management page has been cleared into a simple custom workspace shell so new layout ideas can be added cleanly.
- Secretary Exam Management now uses a custom shell layout with a compact `Examinee` summary card on the left and a wider `Examinee List` table card on the right, with the table footer fixed to 10 rows per page.
- Secretary Exam Management now loads a live examinee counter plus a paginated examinee list from Supabase, using a compact `col-xl-3` summary card and a `col-xl-9` table card with fixed 10-row pagination.
- Secretary Exam Management now shows only applicants already moved by `Set for Examination` into the exam workflow, instead of all submitted forms.
- Secretary Requirements now includes its own card-header search field so the Requirements List can be filtered by applicant name without leaving the requirements view.
- Secretary Requirements now uses a cleaner card header in requirements view by removing the duplicate inner title copy and keeping the filters as the main focus.
- Secretary Requirements now saves a full hard-copy checklist per applicant through `application_aux_data`, and the same saved checklist is shown read-only on the applicant tracking page.
- Secretary Requirements now uses a smaller, more minimal checklist editor in the side card by showing only the requirement title with a compact status selector.
- Secretary Requirements now uses a `col-xl-4` checklist card and a `col-xl-8` table, with the application ID moved under the applicant name and the Requirements table trimmed to sector, status, and `View Data`.
- Secretary Requirements now labels the side checklist card as `Applicant Requirements` for a clearer title.
- Secretary Requirements now shows the selected applicant with a round photo avatar and white border, matching the ranking-style identity treatment when a profile photo is available.
- Secretary Requirements now opens the selected applicant's printable `Application Form` inside a modal preview when staff click the `Application Form` requirement title.
