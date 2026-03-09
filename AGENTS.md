# LDSS Project Instructions

## Source of truth
Always follow `LDSS_PRD_v1_SBAdminPro.md`.

## Final template direction
- Use the existing **SB Admin Pro** template already present in the project root
- Do not switch to AdminLTE, Star Admin, or another dashboard framework
- Reuse the existing template structure where practical
- Remove unnecessary demo/template clutter

## Stack direction
- Bootstrap 5
- Static frontend deployable to InfinityFree
- Supabase integration later

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
- Keep the sidebar minimal
- Remove repeated links
- Sidebar is for major navigation only
- Put actions into dashboard cards, page actions, headers, and filters instead of repeating them in the sidebar
- Avoid template-default clutter

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
- Applicant dashboard must stay simple
- Use quick action buttons like New Application inside the dashboard instead of always in the sidebar
- Admin notifications should emphasize secretary recommendations
- Make the UI responsive and polished on smartphone and desktop
- Keep cards balanced and not crowded
- Use icons consistently

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
- Audit the existing codebase and template structure first
- Refactor incrementally
- Preserve static deployability for InfinityFree
- Avoid server-side Node requirements
- Leave clear TODO comments for future Supabase integration
- Add a short README update explaining what was built and what remains next

## Motion rules
- Use only subtle premium-style motion
- Prefer fade-in, soft hover lift, and smooth transitions
- Avoid flashy, bouncy, or excessive animations
- Keep animation fast, restrained, and professional