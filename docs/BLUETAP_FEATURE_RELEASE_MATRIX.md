# BlueTap Feature Release Matrix

Last Updated: 2026-11-15T12:40:00+08:00
Release Scope: Full Project Consolidation & Production Release
Target Environments:
- Render Backend: `https://bluetap-clean.onrender.com` (`release/render-otp-compat`)
- Vercel Frontend: `https://bluetap-beta.vercel.app` (`main`)

---

## 1. Shared Application

| Feature | Implemented Locally? | Tested? | Already Deployed? | Missing from Prod? | Dependency / Blocker | Release Decision | Next Development Action |
|---|---|---|---|---|---|---|---|
| **Landing & Public Home** | Yes | Yes | Yes (Partial) | No | None | **DEPLOYED** | Maintain responsive layouts |
| **Login & Auth Flow** | Yes | Yes | Yes | No | Firebase Auth | **DEPLOYED** | Maintain session timeouts |
| **Multi-Step Registration (Step 1-4)** | Yes | Yes | Yes | No | OTP & Face APIs | **DEPLOYED** | Monitor registration funnel |
| **Face Verification & Warmup** | Yes | Yes | Yes | No | Python Face Service | **DEPLOYED** | Maintain 500 cold-start recovery |
| **Email Verification & Registration OTP** | Yes | Yes | Yes | No | Vercel Mail Relay / Resend | **DEPLOYED** | Preserve rate limits & replay |
| **Secure Password Change with OTP** | Yes | Yes | Backend Deployed, Frontend Staged | Frontend on old baseline | Verified email requirement | **READY FOR CONSOLIDATED RELEASE** | Include `ChangePasswordModal` & `passwordChangeOtp.js` |
| **Password Recovery Flow** | Yes | Yes | Yes | No | Mail provider config | **DEPLOYED** | Maintain audit logs |
| **RoleGate Session Validation** | Yes | Yes | Yes | No | Firebase ID Token claims | **DEPLOYED** | Maintain role isolation |
| **Staging & Local QA Isolation** | Yes | Yes | Yes | No | `APP_ENV` safeguards | **READY FOR CONSOLIDATED RELEASE** | Deploy unified config preventing staging leak |
| **Global Theme System & Dark Mode** | Yes | Yes | Yes | No | Theme context | **DEPLOYED** | Maintain high-contrast accessible tokens |
| **Responsive Shells & Navigation** | Yes | Yes | Yes (Partial) | Some shells outdated on prod | Navigation sync | **READY FOR CONSOLIDATED RELEASE** | Deploy unified `AdminShell`, `ManagerShell`, etc. |
| **Centralized Status Badges & Contrast** | Yes | Yes | Yes (Partial) | Tone styling outdated on prod | SoftStatusBadge tokens | **READY FOR CONSOLIDATED RELEASE** | Deploy unified SoftStatusBadge |
| **Tailwind Reset CSS Overrides** | Yes | Yes | Yes (Manager only on prod) | Global scope | `global.css` | **READY FOR CONSOLIDATED RELEASE** | Include full button reset protection |

---

## 2. Requester Portal

| Feature | Implemented Locally? | Tested? | Already Deployed? | Missing from Prod? | Dependency / Blocker | Release Decision | Next Development Action |
|---|---|---|---|---|---|---|---|
| **Requester Dashboard** | Yes | Yes | Outdated on prod | Modern layout, quick actions | None | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `r_dashboard.jsx` |
| **Interactive Spotlight Walkthrough** | Yes | Yes | Outdated on prod | Tutorial overlay & step tracker | None | **READY FOR CONSOLIDATED RELEASE** | Deploy `requesterTour.js` & tour launcher |
| **Water Order Submission (`requestform.jsx`)** | Yes | Yes | Outdated on prod | Immutable pricing snapshot | Catalog API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `requestform.jsx` |
| **Buy More, Save More Bundle Promotions** | Yes | Yes | Backend Deployed, UI Missing on Prod | Promotion modal, banner, cart calculation | Backend pricing engine | **READY FOR CONSOLIDATED RELEASE** | Deploy `RequesterPromotion.jsx`, `SavedOrderPricing.jsx` |
| **Request Tracking & Live Delivery Stepper** | Yes | Yes | Outdated on prod | Modern stepper & status milestones | Realtime listener | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `r_request.jsx` |
| **Structured Failed-Delivery Reporting** | Yes | Yes | Backend Deployed, UI Missing on Prod | Report dialog & response UI | Delivery attempt records | **READY FOR CONSOLIDATED RELEASE** | Deploy `RequesterDeliveryReportDialog.jsx` |
| **Delivery Appeals Submission** | Yes | Yes | Backend Deployed, UI Missing on Prod | Appeal submission dialog | Moderation engine | **READY FOR CONSOLIDATED RELEASE** | Deploy `requesterDeliveryAppeals.js` |
| **Order History & Saved Items** | Yes | Yes | Outdated on prod | Price snapshot breakdown | Order records | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated order history |
| **Requester Profile & Address Management** | Yes | Yes | Outdated on prod | Modern form & validation | Profile API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `r_profile.jsx` |
| **Notifications Feed & Direct Routing** | Yes | Yes | Outdated on prod | Deep-link to delivery reports | Notification service | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `r_notification.jsx` |
| **Order Chat with Distributor (Active)** | Yes | Yes | Yes | No | Assignment version epoch | **DEPLOYED** | Maintain read cursors & immutability |
| **Requester ↔ Manager Post-Delivery Chat** | Partial / Bug Reported | Incomplete | No | General inquiry separation for delivered orders | Chat architecture transition | **INCOMPLETE — TRACKED** | Plan & implement distinct active general inquiry channel for delivered/completed orders |

---

## 3. Distributor Portal

| Feature | Implemented Locally? | Tested? | Already Deployed? | Missing from Prod? | Dependency / Blocker | Release Decision | Next Development Action |
|---|---|---|---|---|---|---|---|
| **Distributor Dashboard (`d_dashboard.jsx`)** | Yes | Yes | Outdated on prod | Carousel snap, cargo load badges | None | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `d_dashboard.jsx` |
| **Assigned Deliveries Queue (`d_requests.jsx`)** | Yes | Yes | Outdated on prod | Cargo breakdown badges, accept/decline | Branch assignment | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `d_requests.jsx` |
| **Scheduled Deliveries (`d_scheduled_requests.jsx`)** | Yes | Yes | Outdated on prod | Multi-Trip grouping, delivery start gate | Manager approval gate | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `d_scheduled_requests.jsx` |
| **Manager Approval Requirement for Start** | Yes | Yes | Yes (Backend) | Frontend indicator missing | `TRIP_APPROVAL_REQUIRED` | **READY FOR CONSOLIDATED RELEASE** | Enforce via updated frontend |
| **Delivery Failure Reporting Workflow** | Yes | Yes | Yes | Reschedule UI outdated | State machine validation | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated failure reporting |
| **Delivery History with Reviews (`d_history.jsx`)** | Yes | Yes | Backend Deployed, UI Missing on Prod | Review ratings & decision badges | Delivery review service | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `d_history.jsx` |
| **Distributor Profile (`d_profile.jsx`)** | Yes | Yes | Outdated on prod | Public UID display, branch info | Profile store | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `d_profile.jsx` |
| **Distributor ↔ Requester Chat** | Yes | Yes | Yes | No | Order lifecycle | **DEPLOYED** | Maintain grace window & termination |

---

## 4. Manager Portal

| Feature | Implemented Locally? | Tested? | Already Deployed? | Missing from Prod? | Dependency / Blocker | Release Decision | Next Development Action |
|---|---|---|---|---|---|---|---|
| **Manager Operations Dashboard (`dashboard.jsx`)** | Yes | Yes | Outdated on prod | KPI cards, quick actions, operations widgets | `managerDashboardOperations.js` | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/manager/dashboard.jsx` |
| **Sales & Revenue Overview (`SalesOverviewContent`)** | Yes | Yes | Missing from prod | Live revenue charts & series | Realtime branch sales | **READY FOR CONSOLIDATED RELEASE** | Deploy `components/SalesOverviewContent.jsx` |
| **Distributor Dispatch Queue (`distributors.jsx`)** | Yes | Yes | Part 3 Deployed | Full view polish | None | **DEPLOYED / REINFORCE** | Ensure full integration with consolidated dashboard |
| **Dispatch Queue Pagination (5/page)** | Yes | Yes | Yes (Part 3) | No | None | **DEPLOYED** | Maintain clamping & ellipsis |
| **Assign & Schedule Modal with Co-Load** | Yes | Yes | Yes (Part 3) | No | Capacity engine | **DEPLOYED** | Maintain high-contrast action buttons |
| **Distributor Workload Summary & Modal** | Yes | Yes | Yes (Part 3) | No | Trip capacity calculations | **DEPLOYED** | Maintain clickable metric filtering |
| **Concurrent-Safe Multi-Trip Concurrency Guard** | Yes | Yes | Yes (Render Backend) | No | `distributorDispatchGuards` | **DEPLOYED** | Monitor production reservation locks |
| **Ongoing Requests Monitor (`ManagerOngoingRequestsMonitor`)**| Yes | Yes | Part 3 Deployed | Ensure full context synchronization | Realtime listener | **DEPLOYED / REINFORCE** | Maintain 4 tabs (Active, Scheduled, Failed, Trips) |
| **Delivery Progress Stepper Alignment** | Yes | Yes | Yes (Part 3) | No | Background track geometry | **DEPLOYED** | Maintain leading line alignment |
| **Manager Requests & Order Editing (`request.jsx`)** | Yes | Yes | Outdated on prod | Outside Radius queue, Order detail maps, Saved pricing | `orderEditPricing.js` | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/manager/request.jsx` |
| **Outside Radius Approvals Workflow** | Yes | Yes | Backend Deployed, UI Missing on Prod | Approval queue & distance calculations | Geolocation service | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated outside radius queue |
| **Failed Delivery Review Management** | Yes | Yes | Backend Deployed, UI Missing on Prod | Decision modal, appeal resolution | Delivery review flow | **READY FOR CONSOLIDATED RELEASE** | Deploy `components/ManagerDeliveryReview.jsx` |
| **Branch Accounts Management (`accounts.jsx`)** | Yes | Yes | Outdated on prod | Mobile cards, search & filter bar, suspension modal | Branch-scoped authority | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/manager/accounts.jsx` |
| **Manager Products & Catalog Pricing** | Yes | Yes | Yes | No | Product rules | **DEPLOYED** | Maintain delivery day snapshots |
| **Manager Analytics (`analytics.jsx`)** | Yes | Yes | Outdated on prod | Realtime branch metrics, chart views | Realtime provider | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/manager/analytics.jsx` |
| **Manager Settings (`settings.jsx`)** | Yes | Yes | Missing entirely from prod | Branch configuration, notification preferences | Branch store | **READY FOR CONSOLIDATED RELEASE** | Deploy `app/manager/settings.jsx` |
| **Manager Notifications (`notifications.jsx`)** | Yes | Yes | Outdated on prod | Notification cards with order context routing | Notification service | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/manager/notifications.jsx` |
| **Manager Moderation & Safety Reports** | Yes | Yes | Outdated on prod | Abuse reports, safety holds | Moderation API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated moderation tabs |

---

## 5. Admin Portal

| Feature | Implemented Locally? | Tested? | Already Deployed? | Missing from Prod? | Dependency / Blocker | Release Decision | Next Development Action |
|---|---|---|---|---|---|---|---|
| **Admin Overview Dashboard (`dashboard.jsx`)** | Yes | Yes | Outdated on prod | System KPIs, activity log | `dashboardOverviewHandler.js` | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/dashboard.jsx` |
| **Accounts & Durable Audit (`accounts.jsx`)** | Yes | Yes | Outdated on prod | 10/page pagination, suspension, session revocation | Account action executor | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/accounts.jsx` |
| **Branch Management (`branches.jsx`)** | Yes | Yes | Outdated on prod | Interactive location map, geocoding | Location map model | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/branches.jsx` |
| **Manager Management (`managers.jsx`)** | Yes | Yes | Outdated on prod | Branch assignment, profile security | Manager API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/managers.jsx` |
| **Distributor Management (`distributors.jsx`)** | Yes | Yes | Outdated on prod | Branch assignment, active deliveries guard | Distributor API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/distributors.jsx` |
| **Requests & Dispatch Override (`requests.jsx`)** | Yes | Yes | Outdated on prod | Emergency distributor override, delivery appeals | Admin dispatch override | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/requests.jsx` |
| **Products & Promotions Management (`products.jsx`)**| Yes | Yes | Outdated on prod | Buy More Save More draft modal, publication toggle | `bundlePromotionDrafts` | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/products.jsx` |
| **Reports & Safety Moderation (`reports-safety.jsx`)** | Yes | Yes | Outdated on prod | User incident tracking, penalties, safety holds | Moderation service | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/reports-safety.jsx` |
| **System-Wide Analytics (`analytics.jsx`)** | Yes | Yes | Outdated on prod | Consolidated station metrics | Analytics provider | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/analytics.jsx` |
| **System Maintenance & Feature Toggles (`system-maintenance.jsx`)**| Yes | Yes | Outdated on prod | Maintenance mode, feature flags | Maintenance API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/system-maintenance.jsx` |
| **Registration Security Policies (`registration-security.jsx`)** | Yes | Yes | Outdated on prod | Face verification & OTP toggles | Registration security API | **READY FOR CONSOLIDATED RELEASE** | Deploy consolidated `app/admin/registration-security.jsx` |

---

## 6. Release Classification Summary

- **DEPLOYED & ACTIVE**: 16 Core Infrastructure & Auth Features + Part 3 Multi-Trip Allocation (Render backend commit `9c0382a`).
- **READY FOR CONSOLIDATED RELEASE**: 34 Portal UIs, Screens, Components, Services, and Navigation Upgrades across Requester, Distributor, Manager, and Admin.
- **INCOMPLETE — TRACKED**: Requester ↔ Manager Out for Delivery and post-delivery General Inquiry chat separation.
- **BLOCKED — TRACKED**: None. Zero blockers. Full test suite (1,291 tests) and production build (1,577 modules) are green.
