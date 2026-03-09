# LDSS Product Requirements Document (PRD) v1

## 1. Project Title
**LDSS — LGU Daet Scholarship System**

## 2. Purpose
This document defines the product requirements for LDSS, a real-world scholarship management system for the Local Government Unit of Daet. This PRD is intended to be the implementation reference for Codex and the development team.

The system will support:
- applicant registration and login
- scholarship application submission
- requirement upload
- secretary evaluation and verification
- interview scheduling and evaluation
- admin approval workflow
- certification generation
- release tracking through the Mayor's Office
- scholar renewal
- notification and monitoring
- future Supabase integration

---

## 3. Final Technical Direction
### Frontend / UI
- **Use the existing SB Admin Pro template already present in the project root**
- **Bootstrap 5**
- Reuse the existing template structure where practical
- Remove unnecessary demo/template clutter
- Keep the frontend deployable to **InfinityFree**

### Backend / Data Direction
- Backend will later use **Supabase**
- Frontend is hosted on **InfinityFree**
- Supabase will handle authentication, database, and storage later
- The UI phase should leave clear TODO markers for future Supabase integration

### Deployment Direction
- **Frontend URL:** `https://daet-scholarship.gt.tc/`
- No landing page is required
- The system will be linked from the existing LGU website

---

## 4. Existing Template and Asset Rules
### Existing Template Rule
The project already contains **SB Admin Pro in the root folder**.

Codex must:
- audit the existing template structure first
- reuse existing SB Admin Pro layout/components where practical
- not replace SB Admin Pro with AdminLTE, Star Admin, or another dashboard framework
- simplify the template into a neutral, modern government system UI

### Asset Rules
Use these existing assets:
- **App icon:** `img/icon.png`
- **Login logo:** use the existing LGU Daet logo in the `img` folder
  - preferred filename: `img/daet-lgu.png`
  - if the actual file in the folder is `img/daet-lug.png`, use that exact existing filename instead

---

## 5. Product Summary
LDSS is a scholarship records, evaluation, approval, certification, and release management system for LGU Daet.

It must support both:
- **new applicants**
- **continuing scholars / renewal**

The system is a hybrid process:
- applicants submit online
- uploaded copies are reviewed online
- hard-copy verification is still done by the Secretary during evaluation/interview
- final approval and release processing are done by the authorized offices

---

## 6. Core Roles
The system must support **4 role-based user views**.

### 1. Applicant
Student/scholar user.

### 2. Secretary
Reviews applications and performs evaluation/verification tasks.

### 3. Admin
Approves applications and manages scholar records, certification, and release workflow.

### 4. Super Admin
Has the highest control over users, settings, master data, and government-side system configuration.

---

## 7. Login and Registration Rules
### Login
- One shared login page for both applicants and staff
- Role-based redirect after login
- Login field should accept **Email or Mobile Number**
- Password field required

### Registration
- Applicant self-registration is **allowed**
- Staff self-registration is **not allowed**
- Staff accounts are created by **Super Admin only**

### Login UI Goals
- modern and simple
- mobile-friendly
- logo-centered branding
- clean and neutral government look
- smartphone responsive

---

## 8. Branding and UI Direction
### Display Name
**LDSS**

### Full Name
**LGU Daet Scholarship System**

### UI Style
- modern
- minimal
- neutral
- responsive
- government-appropriate
- not crowded
- not overly template-looking

### Color Direction
- gray and white base
- very restrained orange accent only where useful
- avoid strong decorative colors

### UX Direction
- sidebar should be minimal
- repeated links should be removed
- actions should appear as buttons/cards inside pages, not always as sidebar items
- keep the app easy to use on smartphones
- keep forms and dashboards simple

---

## 9. Minimal Role-Based Sidebars
### Applicant Sidebar
- Dashboard
- My Profile
- My Applications
- Notifications
- Certification
- Renewal
- Help
- Logout

### Secretary Sidebar
- Dashboard
- Applications
- Verification
- Interview
- Recommendations
- Renewals
- Reports
- Notifications
- Logout

### Admin Sidebar
- Dashboard
- Approval Queue
- Scholar Records
- Certifications
- Release Management
- Reports
- Notifications
- Logout

### Super Admin Sidebar
- Dashboard
- User Management
- Master Data
- Scholarship Settings
- Reports
- Audit Logs
- Backup & Restore
- System Settings
- Logout

### Navigation Rule
Do not repeat action links in the sidebar when they can be better placed as:
- dashboard buttons
- page header actions
- filter tabs
- quick action cards

Examples:
- **New Application** should be a dashboard/page action button, not required as a sidebar item
- **Interview Schedule** can appear in application details/dashboard cards instead of permanent sidebar placement
- **Release Status** can be shown in the dashboard/application details instead of repeating it in the sidebar

---

## 10. Key Screens for UI Phase
Codex should prioritize these screens first:

1. Shared Login Page
2. Applicant Registration Page
3. Forgot Password Page
4. Applicant Dashboard
5. Applicant My Profile Page
6. Applicant Edit Profile Page
7. Applicant My Applications Page
8. Application Detail / Tracking Page
9. Secretary Dashboard
10. Secretary Interview Verification Page
11. Admin Dashboard
12. Approval Queue Page
13. Certification Page / Preview Placeholder
14. Super Admin Dashboard Shell

---

## 11. Applicant Dashboard Requirements
The applicant dashboard should be simple and user-friendly.

### Top Status Cards
- Current Application Status
- Interview Schedule Status
- Certification Status
- Release Status

### Quick Actions
- New Application
- Continue Draft
- View My Application
- View Notifications

### Lower Sections
- Recent Activity
- Requirement Summary
- Application Timeline

### Dashboard Rules
- keep it clean
- avoid too many cards
- avoid crowded charts/widgets
- prioritize mobile readability

---

## 12. Applicant Profile Requirements
### My Profile Page
The applicant must have a dedicated **My Profile** page.

### Profile Sections
- Personal Information
- Contact Information
- Educational Information
- Family Background
- Scholarship Information Summary
- Document Summary

### Editing Rules
Before submission, the applicant can edit most information.

After submission, only limited editable fields should remain open unless the application is returned for correction.

### Photo Rule
Applicant-submitted profile photo and Secretary-verified interview photo must be treated as separate concepts.

---

## 13. Secretary Evaluation Requirements
### Secretary Responsibilities
- review submitted applications
- verify uploaded requirements
- compare uploaded files with hard copies
- assign applicant categories
- schedule interview by batch
- encode interview results
- encode exam scores
- recommend applicants for approval

### Secretary Interview Verification Page
Must include:
- applicant details summary
- uploaded requirement summary
- hard-copy verification area
- remarks area
- applicant category tagging
- interview result section
- exam score entry placeholder
- separate verified/interview photo upload area

### Verified Photo Rule
The Secretary must be able to upload or replace a **verified/interview photo** that is separate from the applicant-submitted photo.

---

## 14. Admin Requirements
### Admin Responsibilities
- review secretary recommendations
- approve / reject / waitlist applicants
- manage scholar records
- assign release batch
- generate certification
- monitor release status

### Admin Notification Priority
Admin notifications should emphasize:
- secretary recommendations
- applications pending approval
- certifications ready
- release actions pending

---

## 15. Super Admin Requirements
### Super Admin Responsibilities
- manage users and roles
- manage higher-level settings
- manage master data
- manage scholarship settings
- manage backup / restore settings
- view audit logs
- configure system-wide controls used by government staff

---

## 16. Core Workflow Summary
### Applicant Flow
1. Applicant logs in or registers
2. Applicant updates profile if needed
3. Applicant creates a new application
4. Applicant fills out the online form
5. Applicant uploads requirements
6. Applicant submits application or saves draft
7. Applicant tracks status
8. Applicant sees interview schedule if scheduled
9. Applicant downloads certification if approved and ready
10. Applicant tracks release status
11. Applicant submits renewal if needed

### Secretary Flow
1. Review submitted applications
2. Check completeness
3. Verify uploaded files against hard copies
4. Add interview/evaluation remarks
5. Upload verified/interview photo
6. Tag applicant category if needed
7. Recommend to admin

### Admin Flow
1. Review secretary recommendations
2. Approve / reject / waitlist
3. Manage scholar records
4. Generate certification
5. Assign release batch
6. Monitor release status

### Super Admin Flow
1. Manage users and permissions
2. Manage settings and reference data
3. Control higher-level records and configuration
4. Maintain system-wide governance settings

---

## 17. File Handling Rules
### Applicant Uploads
Allow:
- JPG
- PNG
- PDF

### Generated Documents
Use:
- PDF

### Initial Upload Scope
- applicant profile photo if required
- requirement uploads
- later certification PDF generation

---

## 18. Notification Requirements
Notifications should be available in:
- a top-right bell area
- a dedicated Notifications page/history

### Applicant Notification Examples
- application submitted
- application under review
- interview scheduled
- approved / rejected / waitlisted
- certification ready
- release scheduled

### Secretary Notification Examples
- new submissions
- incomplete applications needing review
- interview schedules

### Admin Notification Examples
- recommended by secretary
- for approval
- certification generation pending
- release pending

---

## 19. Responsive and Performance Requirements
### Responsive Requirements
- must work well on smartphone
- sidebars should collapse cleanly on smaller screens
- forms should become one-column on mobile
- cards should stack properly
- avoid oversized widgets

### Performance and Optimization Rules
- keep the UI lightweight
- remove unnecessary SB Admin Pro demo pages/components
- optimize images and branding assets
- avoid cluttered dashboard widgets
- use reusable components
- keep page structure clean and maintainable

---

## 20. Notes for Codex
Codex must:
- read this PRD first
- inspect the existing SB Admin Pro template in the project root first
- preserve and adapt the template, not replace it
- remove unnecessary template/demo clutter
- build a minimal modern UI for LDSS
- preserve static deployability for InfinityFree
- avoid server-side Node requirements
- leave clear TODO comments for future Supabase integration
- output a concise file map and next steps after each implementation pass

