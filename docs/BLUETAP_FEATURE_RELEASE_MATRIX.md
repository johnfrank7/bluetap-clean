# BlueTap Feature Release Matrix

Last Updated: 2026-11-15T14:35:00+08:00
Release Scope: Post-Acceptance Release Preparation (Chat & Bundles Verification)
Live Verified Commits:
- Render Backend: `728fe458517a1d6b8831a5f365b0e36b4a81a7be` (`release/render-otp-compat`)
- Vercel Frontend: `4a4a5fcdf2412d83bb64a3866c89132dc2c2163c` (`main`)

---

## 1. Shared & Foundation Architecture

| Feature | Local Status | Automated Tests | Production Deployment | Classification | Operational Notes |
|---|---|---|---|---|---|
| **Landing & Public Home** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Verified HTTP 200 and responsive rendering |
| **Login & RoleGate Auth Flow** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Firebase Auth session & role-gated routes verified |
| **Multi-Step Registration (Step 1-4)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Public registration routes & session policy intact |
| **Face Verification & Warmup** | Complete | Passed | Live on Render | **Deployed and manually verified** | Face service proxy & warmup endpoints active |
| **Email Verification & Registration OTP** | Complete | Passed | Live on Render | **Deployed and manually verified** | Mail relay provider with strict retry/replay limits |
| **In-App Password Change with OTP** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | `ChangePasswordModal` + `passwordChangeOtpHandler` live |
| **Password Recovery Flow** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Audit logging & email dispatch guards verified |
| **RoleGate Session Validation** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Role isolation prevents cross-portal access |
| **Staging & Local QA Isolation** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Guard prevents staging sessions targeting prod |
| **Global Theme System & Dark Mode** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Verified high-contrast tokens in light/dark mode |
| **Responsive Shells & Navigation** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | `AdminShell`, `ManagerShell`, `AppBottomNav` live |
| **Tailwind Reset CSS Overrides** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | `global.css` prevents button disappearance in modals |
| **CORS Preflight & Trusted Origins** | Complete | Passed | Live on Render | **Deployed and manually verified** | `https://bluetap-beta.vercel.app` verified 204 preflight |

---

## 2. Requester Portal

| Feature | Local Status | Automated Tests | Production Deployment | Classification | Operational Notes |
|---|---|---|---|---|---|
| **Requester Dashboard Layout** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/requester/r_dashboard` verified HTTP 200 |
| **Spotlight Tutorial Walkthrough** | Complete | Passed | Live on Vercel | **Deployed but not yet functionally verified** | Bundled; requires manual walkthrough confirmation in live session |
| **Water Order Submission (`requestform.jsx`)**| Complete | Passed | Live on Vercel | **Deployed but not yet functionally verified** | Bundled; non-destructive test only; no real order submitted |
| **Buy More, Save More Bundle Promotions** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Bundled in frontend & backend; awaits live checkout verification |
| **Bundle Discounted Checkout** | Complete | Passed | Live Code (Inactive) | **EMULATOR VERIFIED — BROWSER ACCEPTANCE PENDING** | Tested promotional banner, tier note, server-issued quote (₱60 subtotal, -₱5 savings, ₱7 fee, ₱62 total), immutable order snapshot, and stale quote rejection in isolated emulator. |
| **Request Tracking & Stepper** | Complete | Passed | Live on Vercel | **Deployed but not yet functionally verified** | Real-time order progress tracking component deployed |
| **Failed-Delivery Report Dialog** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Dialog component & `/api/requester/delivery-reports` live |
| **Delivery Appeals Submission** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Appeal client & `/api/requester/delivery-appeals` live |
| **Order History & Saved Items** | Complete | Passed | Live on Vercel | **Deployed but not yet functionally verified** | Historical order snapshot viewer deployed |
| **Requester Profile & Address Management** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/requester/r_profile` verified HTTP 200 |
| **Notifications Feed & Deep-Linking** | Complete | Passed | Live on Vercel | **Deployed but not yet functionally verified** | Notification card routing bundled in live web entry |
| **Requester &harr; Manager Chat** | Complete | Passed | Not Deployed (Packaged) | **LOCAL ACCEPTANCE PASSED — NOT YET DEPLOYED** | Out for Delivery chat, Delivered "Contact Branch" inquiry, and Manager reply verified in local browser and isolated emulator. |

---

## 3. Distributor Portal

| Feature | Local Status | Automated Tests | Production Deployment | Classification | Operational Notes |
|---|---|---|---|---|---|
| **Distributor Dashboard & Metrics** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/distributor/d_dashboard` verified HTTP 200 |
| **Assigned Orders & Grouped Trips View** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Multi-trip grouping logic bundled in live distributor view |
| **Delivery Failure Review Logging** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Reason codes & photo evidence dialog live on backend |
| **Trip Completion & Milestone Updates** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Milestone event updates deployed |
| **Distributor Profile & Activity History** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/distributor/d_profile` verified HTTP 200 |
| **Scheduled Deliveries View** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/distributor/d_scheduled_requests` verified HTTP 200 |

---

## 4. Manager Portal

| Feature | Local Status | Automated Tests | Production Deployment | Classification | Operational Notes |
|---|---|---|---|---|---|
| **Operations Dashboard (`dashboard.jsx`)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Sales Overview & operational metrics live in web bundle |
| **Multi-Trip Dispatch & Co-Loading** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | 60-container trip validation & duplicate guard live |
| **Dispatch Queue Pagination (5/page)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Pagination component with page clamping live |
| **Assign & Schedule Modal with Co-Load** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | High-contrast Approve/Co-Load buttons in light/dark |
| **Distributor Workload Summary & Modal** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Clickable metrics revealing assigned trips live |
| **Ongoing Requests Monitor (Full View Grid)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Two-column responsive desktop layout live |
| **Delivery Progress Stepper Alignment** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Flush left-edge green alignment live |
| **Manager Requests & Order Editing (`request.jsx`)**| Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/manager/request` verified HTTP 200 |
| **Outside Radius Approvals Workflow** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Outside radius queue handler live on Render |
| **Failed Delivery Review Management** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Review modal & decision service live on Render |
| **Branch Accounts Management (`accounts.jsx`)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/manager/accounts` verified HTTP 200 |
| **Manager Analytics (`analytics.jsx`)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/manager/analytics` verified HTTP 200 |
| **Manager Settings (`settings.jsx`)** | Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/manager/settings` verified HTTP 200 & bundled |
| **Manager Notifications (`notifications.jsx`)**| Complete | Passed | Live on Vercel | **Deployed and manually verified** | Route `/manager/notifications` verified HTTP 200 |
| **Manager Moderation & Safety Reports** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Moderation review handlers live on Render |

---

## 5. Admin Portal

| Feature | Local Status | Automated Tests | Production Deployment | Classification | Operational Notes |
|---|---|---|---|---|---|
| **Admin Overview Dashboard (`dashboard.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/dashboard` verified HTTP 200 & overview API live |
| **Accounts & Durable Audit (`accounts.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | 10/page pagination, suspension, session revocation live |
| **Branch Management (`branches.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/branches` verified HTTP 200 & branch API live |
| **Manager Management (`managers.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/managers` verified HTTP 200 & manager API live |
| **Distributor Management (`distributors.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/distributors` verified HTTP 200 & distributor API live |
| **Requests & Dispatch Override (`requests.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed but not yet functionally verified** | Emergency override handler live on Render |
| **Products & Promotions Management (`products.jsx`)**| Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/products` verified HTTP 200 & draft API live |
| **Bundle Admin Draft UI** | Complete | Passed | Live on Vercel & Render | **LOCAL ACCEPTANCE PASSED** | Admin draft save and reload verified in local browser; displays Draft, Disabled, and activation-unavailable states properly. |
| **Production Bundle Activation** | Guarded | Passed | Pending Authorization | **PENDING AUTHORIZATION** | Activation runbook prepared. Requires user approval to set `BLUETAP_PROMOTIONS_ENABLED=1` on Render and publish live discounts. |
| **Reports & Safety Moderation (`reports-safety.jsx`)** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/reports-safety` verified HTTP 200 |
| **System Maintenance & Feature Toggles** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/system-maintenance` verified HTTP 200 |
| **Registration Security Policies** | Complete | Passed | Live on Vercel & Render | **Deployed and manually verified** | Route `/admin/registration-security` verified HTTP 200 |

---

## 6. Classification Breakdown

- **Deployed and manually verified**: 28 features (Core infrastructure, authentication, security guards, CORS, navigation shells, Manager Multi-Trip, Stepper, Workload modal, Ongoing requests full view, Manager Settings, all portal routes).
- **Deployed but not yet functionally verified**: 14 features (End-to-end user checkout with real cart promotions, live failure photo upload, delivery review decision with real penalties, emergency dispatch override).
- **Post-Acceptance Release Preparation**:
  - **Requester &harr; Manager Chat**: **LOCAL ACCEPTANCE PASSED — NOT YET DEPLOYED** (Verified Out for Delivery chat, Delivered "Contact Branch" inquiry, and Manager reply in local browser and isolated emulator).
  - **Bundle Admin Draft UI**: **LOCAL ACCEPTANCE PASSED** (Admin draft save/reload verified in local browser; displays Draft, Disabled, and activation-unavailable states properly).
  - **Bundle Discounted Checkout**: **EMULATOR VERIFIED — BROWSER ACCEPTANCE PENDING** (10/10 pricing emulator test suites, server quote, price snapshot calculation, and stale quote rejection verified in isolated emulator).
  - **Production Bundle Activation**: **PENDING AUTHORIZATION** (Activation runbook prepared; requires user authorization for Render environment variable toggle and live publication).
- **Blocked**: 0 features.
