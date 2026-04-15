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
- System Administrator User Management now includes a `Claim / Replace Login` action for applicant accounts so office-created walk-in accounts can later be transferred to the student's final email and a new password without desynchronizing Supabase Auth from `profiles.email`.
- System Administrator `Claim / Replace Login` now also shows an `Office Temporary Password` section for unclaimed walk-in accounts, where staff can generate a fresh temporary password on demand without storing a readable password in the database; once the walk-in account is claimed, that office temporary access section closes automatically.
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
- Secretary Checking now keeps the simpler summary-first workspace, while secretary-side applicant corrections keep the applicant email read-only so profile edits do not desync the user's Supabase Auth login.
- Secretary Interview Verification now also includes a dedicated `Fix Login Email` office action for applicant accounts, so staff can replace a wrong applicant login email, keep `profiles.email` in sync with Supabase Auth, and immediately send a password-reset handoff email to the corrected inbox through the protected Node route.
- Secretary Checking applicant detail editing now keeps `Place of Birth` populated from the same fallback source used by the summary sheet, so opening the correction modal no longer shows that field blank when the value is stored in shared application data.
- Secretary Checking now asks for staff confirmation before `Set for Examination` changes an application to `Pending Exam`, using the same in-page modal pattern instead of firing the action immediately on click.
- Secretary Checking no longer exposes the old `Internal Review` selector to secretary users; the hidden failed-exam exception path is now managed only from the System Administrator side.
- Secretary Checking now places that discreet `Special Consideration` chip inline beside `Applicant Summary`, without the extra `Category` label or a separate header row.
- Secretary Checking now styles `Priority Review` with the default soft chip background and green text, while `For Approval` uses the yellow accent style for quicker office scanning.
- System Administrator Special Consideration now uses the same green `Priority Review` and yellow `For Approval` badge colors as the secretary-side review pages.
- System Administrator Special Consideration now has its own dedicated page, letting the office search applicants by the active school year and mark who can stay eligible for final review even if the exam result would normally block them.
- System Administrator Special Consideration now uses a compact header switch plus a green confirmation modal when the flow is turned on.
- System Administrator Special Consideration now uses the same compact modal pattern for both enable and disable flow changes, instead of leaving a long inline status banner after turning the flow off.
- System Administrator Special Consideration now uses a minimal saved-entry catalog with only 2 levels, `Priority Review` and `For Approval`; the office saves a `Care Of / person / location`, can delete saved entries later, and then assigns students from the selection modal.
- System Administrator Special Consideration now uses a more compact responsive layout, with the tall panel stretch removed and the saved-entry rows tightened so the page reads cleaner on narrower screens.
- System Administrator Special Consideration now uses the shared popup toast pattern for save/update/remove notices, with a page-level fallback so cached old markup does not reopen the long inline status bars after actions.
- System Administrator Special Consideration now shows the allowed-students area as its own responsive table section below the main workspace row, keeping the old table-style scanability with a cleaner user-management-style shell.
- Admin Approval Queue now shows only neutral `final review` wording for those special consideration exceptions instead of exposing the old internal label in the staff queue.
- System Administrator sidebar now includes a `Special Consideration` shortcut that opens the dedicated allow-list page instead of jumping inside Scholarship Settings.
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
- Secretary Exam Management now uses the simpler office fields requested by staff: batch/session label (`Morning Session`, `Afternoon Session`, or `One Session`), venue, exam date, number of rooms, number of examinees per room, and room label; the system still auto-generates the internal exam number in the background after room and seat assignment is saved.
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
- Secretary Exam Management now includes a room-sheet search bar with Search and Show All buttons so staff can quickly find an examinee, application number, control number, or seat inside the current room result sheet without losing unsaved score inputs.
- System Administrator Scholarship Settings now includes a Checking Examination toggle so applicant progress views can show that exam scores are in score consolidation without changing the underlying database status list.
- System Administrator Scholarship Settings now includes an applicant score-visibility toggle so the office can hide or show encoded exam scores on the applicant dashboard, My Applications, and application detail screens without removing the underlying exam result status.
- Applicant navigation is now simplified for end users: the sidebar keeps only Dashboard, notification links are hidden for now, and the Dashboard now opens directly into the applicant's Application Records view instead of making them jump to a separate tracking-first screen.
- Applicant Dashboard now uses the same Application Records table view as `My Applications`, and the applicant-facing columns are now trimmed into a smaller responsive list with `No.`, `School Year`, `Applicant ID`, `Submitted On`, `Examination Status`, `Exam Result`, `Requirements`, `Final Decision`, and a simple `Option` button.
- Applicant tracking labels now treat draft or unsubmitted records as `Not Submitted` in the requirements column, and the final decision stays `Unknown` until the application reaches the actual final-review stage, where it can then move to `Pending`, `Approved`, or `Disapproved`.
- Applicant application records now keep the `Exam Result` column simple for tracking: applicants see only `Passed`, `Failed`, `Score Consolidation`, or `Not Taken`, and the table no longer shows room, seat, or hidden-score helper lines there.
- Applicant exam tracking now keeps the examination-attendance stage simple for end users, while the `Exam Result` column uses a yellow `Score Consolidation` stage until the office posts the final `Passed` or `Failed` result.
- Applicant records now use `Examination Status` for simple attendance-stage tracking, so the applicant table reads `Pending`, `Scheduled`, `Completed`, or `Absent` instead of showing the longer workflow-style `Exam Completed` label there.
- Applicant application-record cards on mobile now reset all desktop column widths, so long labels like `Requirements`, `Final Decision`, and detailed exam text stay horizontal and readable instead of collapsing into vertical letter stacks.
- Admin navigation is now reduced to `Dashboard` plus `Special Consideration`, and the Special Consideration shortcut opens the Approval Queue already focused on `Special Endorsement Review` records.
- Admin Dashboard and the `Special Consideration` route are now cleared back to simple shell states so the office can rebuild those sections one instruction at a time without old cards, tables, or actions getting in the way.
- Secretary navigation now includes a dedicated Ranking sidebar link that opens a separate Secretary ranking page with raw-score-only review options for overall, per-room, sector-classification, and top-range ranking views.
- Secretary Ranking now shows a phone-friendly card layout on small screens while keeping a folio-sized 8.5 x 13 printable table for the Save as PDF flow.
- Secretary Ranking no longer shows `Barangay`, keeping the review and printout table focused on rank, examinee, application number, room, seat, sector classification, and score.
- Secretary Ranking now uses an unframed top filter workspace with direct batch, view, and applicant-search controls, keeping the page cleaner while staff can still search by applicant name or LDSP application number without losing each applicant's original saved rank.
- Secretary Ranking now also shows a separate running `No.` counter beside `Rank`, so tied scores remain easy to follow in the on-screen list and mobile card view.
- Secretary Ranking print styling now uses smaller table text, cleaner header wrapping, and alternating row colors so long ranking lists are easier to read on screen and in PDF.
- Secretary Ranking PDF output now builds dedicated print pages with the Daet logo, a whole-number `No.` counter before `Rank`, the application number under each applicant name, and fixed 30-row chunks per page so bond-paper exports stay readable without page-break collisions.
- Secretary room assignment saving requires the SQL hotfix `supabase/exam_room_assignment_hotfix_2026_03_28.sql`.
- Reminder emails for applicants without a submitted form now use the active scholarship settings cutoff deadline instead of a fixed hardcoded date.
- Applicant Dashboard and My Applications now disable the `New Application` entry point when receiving is manually disabled or when the configured filing window is closed.
- Applicant dashboard sidebar is now trimmed for end users and keeps only `Dashboard` plus `My Applications` in the main applicant navigation.
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

- Secretary portal sidebars now include a direct `Exam Management` link again, while the main Exam Management page has been cleared into a simple custom workspace shell so new layout ideas can be added cleanly.
- Secretary Exam Management now uses a custom shell layout with a compact `Examinee` summary card on the left and a wider `Examinee List` table card on the right, with the table footer fixed to 10 rows per page.
- Secretary Exam Management now loads a live examinee counter plus a paginated examinee list from Supabase, using a compact `col-xl-3` summary card and a `col-xl-9` table card with fixed 10-row pagination.
- Secretary Exam Management now shows only applicants already moved by `Set for Examination` into the exam workflow, instead of all submitted forms.
