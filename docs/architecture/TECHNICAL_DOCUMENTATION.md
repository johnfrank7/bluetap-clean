# BlueTap Technical Documentation

Prepared for capstone proposal hearing.

## Document Scope

This document describes the current BlueTap project as implemented in the repository. It also identifies planned production requirements where the current source code is still prototype-level, especially in distributor request handling, security rules, hosting, and notifications.

The documentation intentionally separates:

- Implemented behavior: features already connected to Firebase or present in the app.
- Prototype/static behavior: screens that exist but currently use hard-coded sample data or local component state.
- Recommended production behavior: improvements needed before deployment to real users.

## Executive Summary

BlueTap is a role-based mineral water ordering system built with Expo, React Native, Expo Router, and Firebase. Requesters can register, browse products, create water requests, track active orders, and cancel pending requests. Administrators can review distributor applications, manage products, and view dashboard analytics. Distributors can register, wait for approval, log in after approval, and manage their profile; their operational request screens are already designed but are not yet fully connected to Firestore for live accept, schedule, and delivery completion actions.

The project uses an Expo client, Firebase Authentication, Cloud Firestore, Firebase Storage, and a Node.js backend prepared for Render for secure registration, email OTP, username checks, and face-verification orchestration. Vercel API handlers remain as temporary fallbacks during migration. The main technical risk areas are authorization hardening, replacing the hard-coded admin login, completing Firestore-backed distributor workflows, adding Firebase security rules, and implementing trusted liveness detection.

## Table of Contents

1. Project Overview
2. Technology Stack
3. Folder Structure
4. Database
5. Authentication Flow
6. Application Flow
7. Request Flow
8. Distributor Flow
9. Firestore Queries
10. Analytics
11. Security
12. Serverless Architecture
13. Libraries Used
14. Possible Limitations
15. Future Improvements
16. Appendices

## 1. Project Overview

### Purpose of the System

BlueTap is a mobile-first mineral water ordering and distribution management system. It connects requesters who need bottled or gallon water with approved distributors and water stations. The system provides account registration, role-based access, product catalog management, request creation, request tracking, distributor approval, and administrative analytics.

The project is built as an Expo Router and React Native application backed by Firebase services. Firebase Authentication handles user accounts, Firestore stores user profiles, products, requests, and counters, and Firebase Storage stores product images.

### Target Users

- Requesters: Customers who order mineral water, select products, choose container type, select a water station, and track request status.
- Distributors: Delivery personnel or station partners who apply for access, wait for admin approval, view assigned request screens, schedule deliveries, view history, and manage their profile.
- Administrators: System managers who approve distributor applications, manage products, monitor user/request metrics, view analytics, and manage approved distributors.

### Main Features

- Public cover screen, login, registration, and password reset.
- Requester and distributor registration using Firebase email/password accounts.
- Admin login using a local secret credential flow.
- Role-based navigation protection for admin, requester, and distributor modules.
- Requester product browsing through a carousel.
- Admin product create, edit, delete, search, and image upload.
- Request creation with multiple products, quantity calculation, container selection, water station selection, and total cost computation.
- Requester active order list and order history.
- Requester cancellation of pending requests.
- Distributor application approval and rejection by admin.
- Distributor profile loading and editing.
- Admin dashboard metrics and analytics charts.
- Local fallback storage for users, products, sessions, and requests when Firestore or browser storage is unavailable.

### System Actors and Permissions

| Actor | Access Level | Main Permissions | Current Persistence |
|---|---|---|---|
| Public visitor | Unauthenticated | Open cover page, go to login, go to signup | None |
| Requester | Firebase-authenticated user with `role: requester` | Browse products, create requests, view current requests, cancel pending requests, view history, edit profile | Firestore and local fallback |
| Distributor applicant | Firebase-authenticated user with `role: distributor` and pending/rejected status | Register account, wait for admin review, receive approval/rejection messaging | Firestore and local fallback |
| Approved distributor | Firebase-authenticated user with `role: distributor` and approved status | Access distributor module, view/edit profile, view designed request/schedule/history screens | Profile is Firestore-backed; request operations are mostly static/local in current code |
| Administrator | Local secret admin session in current prototype | Approve/reject distributors, manage products, view analytics, remove distributors | Product/user/request reads and writes through Firestore; admin auth itself is local |

### Implementation Status Summary

| Module | Status | Notes |
|---|---|---|
| Public landing | Implemented | Cover page routes to login |
| Login | Implemented | Firebase user login plus local admin secret login |
| Signup | Implemented | Creates Firebase Auth user and Firestore profile |
| Requester dashboard | Implemented | Live products and live requester current requests |
| Request form | Implemented | Creates Firestore request documents |
| Requester history | Implemented | Live requester-specific request subscription |
| Request cancellation | Implemented | Updates Firestore for pending requests |
| Admin product management | Implemented | Product CRUD and Storage upload fallback behavior |
| Admin distributor approval | Implemented | Updates distributor profile status |
| Admin analytics | Implemented with limitations | Uses live users/requests, but trend chart is generated from total sales |
| Distributor profile | Implemented | Firestore-backed profile read/update |
| Distributor request handling | Prototype/static | UI exists, but accept/schedule/deliver actions are not Firestore-backed |
| Notifications | Prototype/static | Notification pages contain hard-coded examples |
| BlueTap AI | Prototype/static | UI only, no AI backend |
| Firebase security rules | Not included in repo | Must be added before production deployment |

### Core Business Rules

- A requester account is approved immediately after registration.
- A distributor account is not allowed to enter the distributor module until an admin approves the application.
- A pending distributor can be approved or rejected by the admin.
- A rejected distributor is blocked from logging in to the distributor module.
- A requester must have a unique requester ID before creating a request.
- A request must contain at least one product item with quantity greater than zero.
- Request total cost is computed from selected products and quantities.
- New requests always start with `Pending` status.
- A requester can cancel only a `Pending` request.
- Cancelled, delivered, and rejected requests are not shown as current requester requests.
- Products are managed by admin and shown to requesters.
- Product images are stored in Firebase Storage when upload succeeds.

### Non-Functional Requirements

| Requirement | Current Support | Notes |
|---|---|---|
| Usability | Strong | Mobile-first screens, role-specific navigation, clear actions |
| Availability | Moderate | Firebase backend and local fallbacks improve resilience |
| Scalability | Moderate to strong | Firebase can scale, but query design and rules must be finalized |
| Security | Prototype-level | Firebase Auth exists; authorization needs Firestore/Storage rules |
| Maintainability | Moderate | Services are separated, but some layouts and static distributor data need cleanup |
| Portability | Strong | Expo supports Android, iOS, and web |
| Offline tolerance | Partial | Local fallback exists but is not a full offline sync system |
| Observability | Low | No central logs, monitoring, or analytics events beyond Firestore data |

## 2. Technology Stack

### Frontend

- Expo SDK 54
- React 19.1.0
- React Native 0.81.5
- Expo Router 6.0.22 for file-based routing
- React Native Web for browser support
- NativeWind and Tailwind CSS configuration for utility styling support
- React Native StyleSheet for most implemented UI styles
- React Native Reanimated and Reanimated Carousel for animated UI and requester product carousel

### Backend

The application uses Firebase services together with a responsibility-based Node.js backend. `backend/app.js` runs the API on Render, while thin Vercel routes remain as migration fallbacks. It does not use Express, PHP, or a traditional stateful application server.

Backend responsibilities are handled by:

- Firebase Authentication for account identity
- Cloud Firestore for structured application data
- Firebase Storage for uploaded product images
- Render HTTP server under `backend/app.js` for the public HTTP contract
- Vercel functions under `api/` as temporary same-contract fallbacks
- Server-only implementations under `backend/` for registration, OTP, username, Firebase Admin, email, and face-verification work
- A separately deployed Render face service called only by the verification backend

### Database

- Cloud Firestore
- Main collections:
  - `users`
  - `products`
  - `requests`
  - `counters`

### Authentication

- Firebase Authentication email/password for requesters and distributors
- React Native AsyncStorage persistence for native Firebase Auth sessions
- Web Firebase Auth through `firebaseAuth.web.js`
- Local role session cache in `services/authSession.js`
- Hard-coded admin secret session in `app/login.jsx`

### Storage

- Firebase Storage for product images
- Product image path format:

```text
products/{productId}/{timestamp}-{sanitizedFileName}
```

### Hosting

The Expo web app is deployed on Vercel. The API is prepared for Render, with the existing Vercel API routes retained during the first migration pass. The repository also retains `firebase.json` for the inactive legacy Firebase Functions implementation; it does not define Firebase Hosting.

Possible hosting targets:

- Expo Go or development builds for mobile testing
- EAS Build for Android/iOS production builds
- Expo Web exported static build
- Firebase Hosting, Vercel, Netlify, or other static web hosting for the web build

### Deployment

Current scripts in `package.json`:

```json
{
  "start": "expo start",
  "android": "expo start --android",
  "ios": "expo start --ios",
  "web": "expo start --web",
  "build": "expo export --platform web",
  "dev:mobile": "expo start --dev-client",
  "build:android:device": "expo run:android --device",
  "build:ios:device": "expo run:ios --device",
  "test": "node --test backend/*/tests/*.test.js"
}
```

Current deployment status:

- Expo development builds are configured for native testing.
- Vercel builds the Expo web export; root `api/` functions remain active fallbacks during migration.
- Render runs `npm run start:backend` and checks `GET /health`.
- `eas.json` includes an internal-distribution development profile; production profiles are not configured.
- No CI/CD configuration is included.
- No Firebase rules files are included in the repo.

Recommended deployment path:

1. Configure Firestore and Storage rules.
2. Move admin authorization to secure Firebase custom claims or a protected admin-only user record.
3. Build mobile apps through EAS Build.
4. Export the web version if needed.
5. Host the web admin panel through Firebase Hosting or another static host.
6. Add environment-based Firebase configuration management.

### Environment Configuration

The Firebase project configuration is currently committed in `firebaseApp.js`. Firebase web configuration values are not database passwords, but they identify the Firebase project and should still be managed carefully.

Recommended production setup:

- Store Firebase config values in environment-specific configuration.
- Use separate Firebase projects for development, staging, and production.
- Restrict Firestore and Storage access through rules, not by hiding config values.
- Register allowed domains in Firebase Authentication settings.
- Use Expo/EAS secrets for build-time environment values when creating production builds.

## 3. Folder Structure

```text
.
|-- app/
|   |-- _layout.jsx
|   |-- index.jsx
|   |-- login.jsx
|   |-- signup.jsx
|   |-- admin/
|   |-- requester/
|   `-- distributor/
|-- assets/
|   `-- icons/
|-- api/                    # temporary Vercel fallback handlers; URLs stay stable
|-- backend/
|   |-- app.js             # Render HTTP entrypoint
|   |-- routes/
|   |-- auth/
|   |-- email/
|   |-- firebase/
|   |-- registration/
|   |-- username/
|   |-- utils/
|   `-- verification/      # feature tests live under */tests/
|-- components/
|-- services/
|-- docs/
|   |-- architecture/
|   |-- backend/
|   |-- mobile/
|   `-- verification/
|-- functions/             # inactive legacy Firebase Functions source
|-- firebase.js
|-- firebaseApp.js
|-- firebaseAuth.js
|-- firebaseAuth.web.js
|-- localUsers.js
|-- package.json
|-- app.json
|-- metro.config.js
|-- tailwind.config.js
|-- global.css
|-- eas.json
`-- vercel.json
```

### `app/`

Contains Expo Router routes. Every file becomes a screen or layout. This folder defines public pages, admin pages, requester pages, and distributor pages.

### `app/_layout.jsx`

Root application layout. It wraps the app in `GestureHandlerRootView` and renders the Expo Router `Stack` with headers disabled.

### `app/index.jsx`

Public cover page. Displays the BlueTap branding, tagline, and an Enter button that navigates to `/login`.

### `app/login.jsx`

Login, admin secret login, forgot password, and missing-profile setup screen. It uses Firebase Auth for normal users and local session storage for the admin secret session.

### `app/signup.jsx`

Registration screen for requesters and distributors. It validates staged account and personal details, uses a platform-specific identity-verification step, then asks the backend to create the Firebase Auth account and Firestore profile after the registration gate is satisfied. On web, Step 3 uses the browser camera and a backend-verified capture pair; Android and iOS retain the native ML Kit challenge flow.

### `app/admin/`

Admin module. Protected by `RoleGate role="admin"` through `app/admin/_layout.jsx`.

Major admin screens:

- `dashboard.jsx`: admin overview metrics, user composition charts, distributor/requester table
- `analytics.jsx`: analytics dashboard for users, sales, barangay, and station data
- `products.jsx`: product catalog CRUD and product image upload
- `request.jsx`: pending distributor approval/rejection
- `distributors.jsx`: approved distributor list and distributor removal
- `profile.jsx`: static admin profile page

### `app/requester/`

Requester module. Protected by `RoleGate role="requester"` through `app/requester/_layout.jsx`. The layout includes a shared requester header and bottom navigation.

Major requester screens:

- `r_dashboard.jsx`: product carousel and current requests
- `requestform.jsx`: new request/order form
- `r_request.jsx`: active orders and order history
- `r_profile.jsx`: profile display/edit/logout
- `r_notification.jsx`: static notification page
- `bluetap_AI.jsx`: static help assistant UI

### `app/distributor/`

Distributor module. Protected by `RoleGate role="distributor"` through `app/distributor/_layout.jsx`. The layout includes a distributor bottom navigation.

Major distributor screens:

- `d_dashboard.jsx`: distributor dashboard with static current request and summary cards
- `d_requests.jsx`: pending requests and scheduling UI using local sample data
- `d_scheduled_requests.jsx`: scheduled request list using static sample data
- `d_history.jsx`: delivered request history using static sample data
- `d_profile.jsx`: distributor profile display/edit/logout
- `d_notification.jsx`: static notification page

### `assets/icons/`

Stores BlueTap logos and navigation icons used by mobile UI, headers, buttons, and bottom navigation.

### `components/`

Shared reusable UI and behavior components.

- `AdminShell.jsx`: admin sidebar, topbar, search, logout, and layout container
- `AppBottomNav.jsx`: requester and distributor animated bottom navigation
- `BlueTapHeader.jsx`: shared BlueTap header with notification link
- `RequesterHeader.jsx`: requester-specific header wrapper
- `RoleGate.jsx`: role-based route protection
- `RequestDetailsModal.jsx`: reusable request details modal
- `SoftStatusBadge.jsx`: status badge styling
- `shadowStyles.js`: cross-platform shadow helper
- `adminAnimationHooks.js`: reusable admin animation hooks and number formatting

### `services/`

Service layer for Firebase and local persistence operations.

- `authSession.js`: role sessions, admin session, route access validation, logout
- `products.js`: product subscription, create, update, delete, image upload, local product fallback
- `requests.js`: requester request subscription, current request filtering, create request, cancel request, local request fallback
- `uniqueIds.js`: generation and assignment of `REQ-000001` and `DIS-000001` style unique IDs

### `api/`

Contains thin Vercel route handlers. These files preserve the existing `/api/auth/*`
and `/api/verification/*` URLs and delegate to feature implementations under
`backend/`. They remain active fallbacks until the Render service is production-tested.

### `backend/`

Contains server-only code grouped by responsibility. `app.js` and `routes/` expose the
same HTTP paths on Render. Each feature owns its handlers, domain logic, and a `tests/`
directory where applicable. Frontend modules do not import this folder.

### `docs/`

Contains architecture, active-backend, verification, and mobile-testing documents.
Start with `docs/README.md` for navigation.

### `functions/`

Retains the inactive Firebase Functions OTP implementation because `firebase.json`
still refers to it and it may be useful for historical comparison. Vercel does not use it.

### Firebase Files

- `firebaseApp.js`: initializes Firebase app using project config
- `firebaseAuth.js`: native Firebase Auth with AsyncStorage persistence
- `firebaseAuth.web.js`: web Firebase Auth instance
- `firebase.js`: exports configured Firestore, Storage, Auth, and app instances

### Other Root Files

- `localUsers.js`: local user profile cache and distributor status helpers
- `package.json`: dependencies and scripts
- `app.json`: Expo app configuration
- `metro.config.js`: Metro bundler and NativeWind configuration
- `tailwind.config.js`: NativeWind/Tailwind content config
- `global.css`: Tailwind directives
- `eas.json`: EAS development-build profile
- `vercel.json`: web export and Vercel route behavior
- `docs/architecture/BLUETAP_CONTEXT.md`: engineering context note

## 4. Database

BlueTap uses Cloud Firestore as the main database.

### Collection: `users`

Purpose:

- Stores application profile data for Firebase Auth users.
- Determines role access.
- Stores distributor approval status.
- Stores requester and distributor unique IDs.
- Provides user data for profiles, admin dashboard, admin analytics, and distributor approval.

Document ID:

```text
users/{firebaseAuthUid}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `uid` | string | Firebase Auth UID |
| `unique_id` | string | Human-readable ID such as `REQ-000001` or `DIS-000001` |
| `firstName` | string | User first name |
| `lastName` | string | User last name |
| `email` | string | User email |
| `phone` | string | Contact number |
| `barangay` | string | Barangay selected during registration |
| `address` | string | Delivery or profile address |
| `role` | string | `requester`, `distributor`, or `admin` |
| `approvalStatus` | string | `pending`, `approved`, or `rejected` |
| `status` | string | Display status such as `Pending`, `Approved`, `Rejected` |
| `rejectionReason` | string/null | Distributor rejection reason |
| `createdAt` | timestamp | Account profile creation date |
| `updatedAt` | timestamp | Last profile update date |
| `reviewedAt` | timestamp | Admin review date for distributor applications |
| `removedAt` | timestamp | Date a distributor was removed/rejected |
| `waterStation` | string | Optional distributor water station assignment |

Sample requester document:

```json
{
  "uid": "firebase_uid_001",
  "unique_id": "REQ-000001",
  "firstName": "Maria",
  "lastName": "Santos",
  "email": "maria@example.com",
  "phone": "09123456789",
  "barangay": "Poblacion",
  "address": "Poblacion",
  "role": "requester",
  "approvalStatus": "approved",
  "status": "Approved",
  "rejectionReason": null,
  "createdAt": "serverTimestamp()"
}
```

Sample distributor document:

```json
{
  "uid": "firebase_uid_002",
  "unique_id": "DIS-000001",
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "email": "juan@example.com",
  "phone": "09991234567",
  "barangay": "Luray II",
  "address": "Luray II",
  "role": "distributor",
  "approvalStatus": "pending",
  "status": "Pending",
  "rejectionReason": null,
  "createdAt": "serverTimestamp()"
}
```

### Collection: `products`

Purpose:

- Stores the water product catalog shown to requesters.
- Managed by admin through the Products page.
- Supports image upload through Firebase Storage.

Document ID:

```text
products/{autoGeneratedProductId}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `product_name` | string | Product name |
| `price` | number | Product price |
| `image` | string | Firebase Storage download URL or local data URL fallback |
| `imagePath` | string | Firebase Storage object path |
| `created_at` | timestamp | Product creation timestamp |
| `updated_at` | timestamp | Product update timestamp |

Additional fields read by the normalizer if present:

- `productName`
- `capacity`
- `subtext`
- `createdAt`
- `updatedAt`
- stock-related display fields such as `stock`, `stock_status`, or `availability`

Sample product document:

```json
{
  "product_name": "Purified Mineral Water",
  "price": 25,
  "image": "https://firebasestorage.googleapis.com/...",
  "imagePath": "products/productId/1720000000000-water.png",
  "created_at": "serverTimestamp()",
  "updated_at": "serverTimestamp()"
}
```

### Collection: `requests`

Purpose:

- Stores customer water requests.
- Used by requester dashboard, requester order history, admin dashboard, and admin analytics.
- Distributor pages currently use sample data and are not fully connected to this collection for accept/schedule/deliver actions.

Document ID:

```text
requests/{autoGeneratedRequestDocId}
```

Fields:

| Field | Type | Description |
|---|---|---|
| `request_id` | string | Human-readable request number such as `BT-12345` |
| `requester_id` | string | Firebase UID of requester |
| `requester_unique_id` | string | Human-readable requester ID |
| `requester_name` | string | Requester full name |
| `contact_number` | string | Contact number |
| `address` | string | Delivery address |
| `product_id` | string | First product ID for backward compatibility |
| `product_name` | string | First or comma-separated product names |
| `product_price` | number | First product price for backward compatibility |
| `quantity` | number | Total quantity across all items |
| `items` | array | Product line items |
| `container` | string | `New Container` or `Exchange` |
| `water_station` | string | Selected station, currently `aquabea` or `bluetap` |
| `delivery_date` | string | Expected delivery date displayed as `MM - DD - YYYY` |
| `total_cost` | number | Total computed amount |
| `status` | string | Request status, initially `Pending` |
| `created_at` | timestamp | Request creation time |
| `updated_at` | timestamp | Last update time |
| `canceled_at` | timestamp | Cancellation time when canceled |
| `distributor_id` | string | Future/optional assigned distributor UID |
| `distributor_unique_id` | string | Future/optional distributor unique ID |
| `distributor_name` | string | Future/optional assigned distributor name |

Sample request document:

```json
{
  "request_id": "BT-12345",
  "requester_id": "firebase_uid_001",
  "requester_unique_id": "REQ-000001",
  "requester_name": "Maria Santos",
  "contact_number": "09123456789",
  "address": "Poblacion",
  "product_id": "product_doc_001",
  "product_name": "Purified Mineral Water",
  "product_price": 25,
  "quantity": 3,
  "items": [
    {
      "product_id": "product_doc_001",
      "product_name": "Purified Mineral Water",
      "product_price": 25,
      "quantity": 3,
      "line_total": 75
    }
  ],
  "container": "New Container",
  "water_station": "bluetap",
  "delivery_date": "07 - 24 - 2026",
  "total_cost": 75,
  "status": "Pending",
  "created_at": "serverTimestamp()",
  "updated_at": "serverTimestamp()"
}
```

### Collection: `counters`

Purpose:

- Stores counters for human-readable requester and distributor IDs.
- Used by `services/uniqueIds.js`.

Document ID:

```text
counters/unique_ids
```

Fields:

| Field | Type | Description |
|---|---|---|
| `requester` | number | Last assigned requester number |
| `distributor` | number | Last assigned distributor number |

Sample counter document:

```json
{
  "requester": 12,
  "distributor": 4
}
```

### Relationships

- `users/{uid}` is linked to Firebase Auth by matching the document ID and `uid`.
- `requests.requester_id` references `users/{uid}` for requester ownership.
- `requests.requester_unique_id` stores a display copy of the requester's unique ID.
- `requests.items[].product_id` references `products/{productId}`.
- `requests.distributor_id` is prepared for future assignment to `users/{uid}` with role `distributor`.
- `counters/unique_ids` is used by transactions to generate stable `unique_id` values.

### Data Validation Rules

The current application validates most data on the client side before writing to Firestore. For production, the same rules should be enforced in Firestore rules, Cloud Functions, or both.

| Entity | Field | Current Validation | Recommended Server-Side Validation |
|---|---|---|---|
| User | `email` | Signup checks basic email pattern | Require string email matching authenticated user email |
| User | `password` | Minimum 8 characters before Firebase signup | Firebase Auth enforces password policy; configure stronger policy if needed |
| User | `role` | Must be requester or distributor at signup | Allow only approved role values; admin only via secure admin process |
| User | `approvalStatus` | Requester approved; distributor pending by default | Only admins can approve/reject distributors |
| Product | `product_name` | Required in admin modal | Require non-empty string |
| Product | `price` | Must be numeric and non-negative | Require number greater than or equal to 0 |
| Request | `requester_id` | Must exist before submit | Must equal `request.auth.uid` for requester-created requests |
| Request | `requester_unique_id` | Required before submit | Must match requester profile unique ID or be generated server-side |
| Request | `items` | At least one item and quantity greater than 0 | Require array with valid product IDs, quantities, and numeric line totals |
| Request | `total_cost` | Calculated from selected items | Recalculate server-side or validate against product prices |
| Request | `status` | New requests start as `Pending` | Restrict allowed transitions by role |
| Request | `water_station` | Must be selected | Require known station ID from a future `stations` collection |

### Local Fallback Data

Several services merge Firestore data with local cache data. This improves demo resilience and UI responsiveness, but it should not be treated as a source of truth.

Local keys:

| Key | Module | Purpose |
|---|---|---|
| `bluetapLocalUsers` | `localUsers.js` | Local profile and distributor status cache |
| `bluetapActiveAuthSession` | `authSession.js` | Active role session |
| `bluetapModuleAuthSessions` | `authSession.js` | Per-role session cache |
| `bluetapLocalProducts` | `products.js` | Product fallback/optimistic cache |
| `bluetapLocalRequests` | `requests.js` | Request fallback/optimistic cache |

Production recommendation:

- Treat Firestore as canonical.
- Add a formal offline queue if offline support is required.
- Mark locally saved records with a sync state such as `pending_sync`, `synced`, or `sync_failed`.
- Add user-visible retry controls for failed syncs.

## 5. Authentication Flow

### Login

Login is implemented in `app/login.jsx`.

Regular user flow:

1. User enters email and password.
2. App calls `signInWithEmailAndPassword(auth, email, password)`.
3. App reads `users/{uid}` from Firestore.
4. App validates that the profile has a valid role.
5. Requester/distributor unique ID is ensured through `ensureUserUniqueId`.
6. Profile is saved to local cache through `saveLocalUser`.
7. Role session is saved through `saveRoleSession`.
8. User is routed to the correct module:
   - `requester` -> `/requester/r_dashboard`
   - `distributor` -> `/distributor/d_dashboard`
   - `admin` -> `/admin/dashboard`

Distributor login condition:

- Distributor profiles must have `approvalStatus` or `status` normalized to `approved`.
- Pending or rejected distributors are signed out and shown a status message.

Admin secret login:

```text
email: bluetapadmin
password: 12345678
```

This flow signs out any Firebase Auth user, stores a local admin session, and routes to `/admin/dashboard`. This is useful for prototype/demo access, but it is not production-safe.

### Registration

Registration is implemented in `app/signup.jsx`.

1. User chooses account type and supplies the required personal details.
2. The app creates an opaque registration session on the BlueTap backend.
3. Step 3 verifies identity using the current platform:
   - Web requests the front-facing browser camera, captures two short JPEG frames, and sends them only to the BlueTap backend.
   - Android and iOS keep the existing on-device ML Kit challenge flow.
4. The backend validates the registration session, performs protected face comparison, duplicate detection, and enrollment, then records a trusted verification result. The browser cannot set this result itself.
5. The user supplies credentials, accepts the terms, and completes email OTP verification.
6. Only a backend-approved registration session can create the Firebase Auth account and Firestore profile.
7. The backend transaction assigns a unique ID:
   - requester -> `REQ-000001`
   - distributor -> `DIS-000001`
8. Local profile cache is updated after successful registration.
9. Requesters are approved automatically and routed to requester dashboard.
10. Distributors are marked pending, signed out, and told to wait for admin approval.

Requester default profile status:

```json
{
  "role": "requester",
  "approvalStatus": "approved",
  "status": "Approved"
}
```

Distributor default profile status:

```json
{
  "role": "distributor",
  "approvalStatus": "pending",
  "status": "Pending"
}
```

### Role Management

Role management is handled by Firestore profile fields and client-side route protection.

Valid roles:

- `admin`
- `requester`
- `distributor`

Role home paths in `services/authSession.js`:

```js
const ROLE_HOME_PATHS = {
  admin: '/admin/dashboard',
  requester: '/requester/r_dashboard',
  distributor: '/distributor/d_dashboard',
};
```

Route protection:

- Admin layout uses `<RoleGate role="admin">`.
- Requester layout uses `<RoleGate role="requester">`.
- Distributor layout uses `<RoleGate role="distributor">`.

Admin distributor review:

- Pending distributors are loaded from `users` where `role == "distributor"`, then filtered to pending status.
- Accept sets `approvalStatus: "approved"` and `status: "Approved"`.
- Reject requires a rejection reason and sets `approvalStatus: "rejected"` and `status: "Rejected"`.

### Session Handling

Firebase session:

- Native auth persistence is configured with `@react-native-async-storage/async-storage`.
- Web auth uses `getAuth(app)`.

Application role sessions:

- `bluetapActiveAuthSession`
- `bluetapModuleAuthSessions`

These are stored in `globalThis.localStorage` when available, with an in-memory fallback.

Session validation:

1. `RoleGate` listens to Firebase Auth state changes through `onAuthStateChanged`.
2. `RoleGate` listens to local session changes through `subscribeAuthSessionChanges`.
3. `validateRoleAccess(expectedRole)` confirms whether access is allowed.
4. Unauthorized users are redirected to `/login`.
5. Role mismatches are redirected to the correct module home.
6. Distributor users are blocked if not approved.

Logout:

- `signOutAndClearSessions()` clears local role sessions and signs out Firebase Auth.

### Authentication Sequence Diagram

```text
User
-> Login screen
-> Firebase Authentication
-> Firestore users/{uid}
-> local user cache
-> role session cache
-> RoleGate
-> role-specific home screen
```

### Registration Sequence Diagram

```text
User
-> Signup screen
-> registration-session backend endpoint
-> browser camera verification OR native ML Kit challenge
-> backend face comparison, duplicate check, and enrollment
-> email OTP and backend registration completion
-> Firebase Authentication creates account
-> unique ID transaction reads counters/unique_ids
-> Firestore writes users/{uid}
-> local user cache updated
-> requester enters app OR distributor waits for approval
```

### Distributor Approval Sequence Diagram

```text
Distributor applicant
-> Signup creates pending user profile
-> Admin opens /admin/request
-> Admin approves or rejects
-> Firestore users/{uid} approvalStatus updated
-> Distributor login allowed only if approved
```

## 6. Application Flow

### Public Pages

#### `/`

File: `app/index.jsx`

- Displays BlueTap logo and tagline.
- Pressing Enter routes to `/login`.

#### `/login`

File: `app/login.jsx`

Internal behavior:

- Handles admin secret login.
- Handles Firebase email/password login.
- Reads Firestore user profile.
- Reconstructs a missing Firestore profile from local cache if available.
- Blocks unapproved distributors.
- Supports forgot password by checking sign-in methods and sending a Firebase password reset email.
- Supports finishing setup when a Firebase Auth user exists but app profile is missing.

#### `/signup`

File: `app/signup.jsx`

Internal behavior:

- Shows account type selection modal.
- Validates staged registration fields.
- Uses browser camera verification on web and preserves the native ML Kit flow on Android and iOS.
- Lets the backend, rather than the browser, determine whether the registration face check has passed.
- Completes account creation through the backend only after face verification, terms acceptance, and email OTP verification.
- Requester enters the app immediately.
- Distributor is signed out and waits for admin approval.

### Admin Pages

#### `/admin/_layout`

File: `app/admin/_layout.jsx`

- Wraps all admin screens with `RoleGate role="admin"`.
- Disables headers and route animation.

#### `/admin/dashboard`

File: `app/admin/dashboard.jsx`

Internal behavior:

- Uses `AdminShell`.
- Listens to all `users`.
- Listens to all `requests`.
- Merges Firestore data with local fallback data.
- Computes registered user count, distributor count, requester count, total product sales in gallons, and station count.
- Displays metric cards, product sales trend, barangay chart, user composition, stations panel, and registered accounts table.
- Allows approved distributor removal by marking the distributor profile rejected.

#### `/admin/analytics`

File: `app/admin/analytics.jsx`

Internal behavior:

- Listens to all `users`.
- Listens to all `requests`.
- Merges local and Firestore data.
- Calculates total users, distributor/requester counts, product sales, barangay distribution, and station rows.
- Displays analytics charts and animated metric cards.

#### `/admin/products`

File: `app/admin/products.jsx`

Internal behavior:

- Subscribes to products through `subscribeProducts`.
- Shows product catalog table.
- Supports product search by name.
- Opens add/edit modal.
- Validates product name and price.
- Uses browser file input for image selection when running on web.
- Creates, updates, or deletes products through `services/products.js`.
- Uploads images to Firebase Storage when possible.
- Falls back to local product cache when Firebase is unavailable.

#### `/admin/request`

File: `app/admin/request.jsx`

Internal behavior:

- Loads users where `role == "distributor"`.
- Filters to pending distributor applications.
- Merges Firestore and local pending users.
- Allows admin to accept an application.
- Allows admin to reject an application with required reason.
- Updates Firestore `users/{uid}` and local user cache.

#### `/admin/distributors`

File: `app/admin/distributors.jsx`

Internal behavior:

- Loads users where `role == "distributor"`.
- Filters to approved distributors.
- Merges Firestore and local approved distributors.
- Supports search.
- Allows admin to remove a distributor by marking status rejected and adding `removedAt`.

#### `/admin/profile`

File: `app/admin/profile.jsx`

Internal behavior:

- Displays static BlueTap admin workspace profile information.
- Uses `AdminShell`.

### Requester Pages

#### `/requester/_layout`

File: `app/requester/_layout.jsx`

- Wraps requester pages with `RoleGate role="requester"`.
- Shows shared requester header.
- Shows requester bottom navigation.

#### `/requester/r_dashboard`

File: `app/requester/r_dashboard.jsx`

Internal behavior:

- Subscribes to products and displays them in a carousel.
- Pressing Order routes to `/requester/requestform?productId={id}`.
- Subscribes to the current requester's active/current requests.
- Current requests exclude canceled, cancelled, delivered, and rejected statuses.
- Shows request details modal.
- Allows cancellation of pending current requests.

#### `/requester/requestform`

File: `app/requester/requestform.jsx`

Internal behavior:

- Subscribes to products.
- Reads route `productId` and preselects that product if present.
- Loads requester profile from local cache and Firestore.
- Ensures requester unique ID exists.
- Allows multiple products and quantity updates.
- Calculates line totals, total quantity, and total cost.
- Supports container choice: `New Container` or `Exchange`.
- Supports water station choice: `aquabea` or `bluetap`.
- Builds a summary modal.
- On confirmation, calls `createRequest`.
- Routes back to requester dashboard.

#### `/requester/r_request`

File: `app/requester/r_request.jsx`

Internal behavior:

- Gets current requester ID from local user cache.
- Subscribes to all requester requests.
- Splits display into:
  - Active Orders: pending, accepted, scheduled, out for delivery
  - History: delivered, cancelled, canceled
- Shows details modal.
- Allows cancellation only for pending requests.

#### `/requester/r_profile`

File: `app/requester/r_profile.jsx`

Internal behavior:

- Loads profile from local cache first.
- Reads `users/{uid}` from Firestore.
- Verifies role is requester.
- Ensures unique ID exists.
- Displays unique ID, full name, phone, email, and address.
- Allows editing full name, phone, and address.
- Saves local profile first, then merges updates into Firestore.
- Provides logout.
- Links to BlueTap AI help page.

#### `/requester/r_notification`

File: `app/requester/r_notification.jsx`

Internal behavior:

- Displays static sample notification messages.
- Does not currently subscribe to a notifications collection.

#### `/requester/bluetap_AI`

File: `app/requester/bluetap_AI.jsx`

Internal behavior:

- Displays static quick-help content.
- Includes a text input and send button UI.
- Does not currently call an AI API or backend service.

### Distributor Pages

#### `/distributor/_layout`

File: `app/distributor/_layout.jsx`

- Wraps distributor pages with `RoleGate role="distributor"`.
- Shows distributor bottom navigation.

#### `/distributor/d_dashboard`

File: `app/distributor/d_dashboard.jsx`

Internal behavior:

- Displays static summary cards for pending, scheduled, and delivered requests.
- Displays a static current request.
- Shows request details modal.
- Primary action routes to pending requests or scheduled requests depending on static request status.

#### `/distributor/d_requests`

File: `app/distributor/d_requests.jsx`

Internal behavior:

- Displays pending request cards from local `PENDING_REQUESTS` sample array.
- Shows details modal.
- Accept Request opens a scheduling bottom sheet.
- Scheduling supports Today, Tomorrow, or Custom Date & Time.
- Confirming schedule stores the result in local component state only.
- It does not update Firestore request status yet.

#### `/distributor/d_scheduled_requests`

File: `app/distributor/d_scheduled_requests.jsx`

Internal behavior:

- Displays scheduled request cards from static `SCHEDULED_REQUESTS`.
- Shows details modal.
- Includes Start Delivery button UI.
- It does not update Firestore status yet.

#### `/distributor/d_history`

File: `app/distributor/d_history.jsx`

Internal behavior:

- Displays delivered request cards from static `HISTORY_REQUESTS`.
- Shows details modal.
- It does not query Firestore request history yet.

#### `/distributor/d_profile`

File: `app/distributor/d_profile.jsx`

Internal behavior:

- Loads distributor profile from local cache and Firestore.
- Verifies role is distributor.
- Ensures unique ID exists.
- Displays full name, contact number, email, address, water station, unique ID, and role.
- Allows editing full name, contact number, and address.
- Saves updates to Firestore and local cache.
- Provides logout.

#### `/distributor/d_notification`

File: `app/distributor/d_notification.jsx`

Internal behavior:

- Displays static delivered-request notification.
- Does not currently subscribe to a notifications collection.

### Screen-to-Data Source Matrix

| Screen | Primary Data Source | Writes Data? | Notes |
|---|---|---|---|
| `/` | None | No | Static cover page |
| `/login` | Firebase Auth, `users`, local users | Yes | Saves local sessions and may repair missing user profile |
| `/signup` | Firebase Auth, `users`, `counters` | Yes | Creates auth user and profile |
| `/admin/dashboard` | `users`, `requests`, local caches | Yes | Can mark distributor rejected/removed |
| `/admin/analytics` | `users`, `requests`, local caches | No | Reads data for charts |
| `/admin/products` | `products`, Firebase Storage, local products | Yes | Product CRUD and image upload |
| `/admin/request` | `users`, local users | Yes | Approves/rejects distributors |
| `/admin/distributors` | `users`, local users | Yes | Removes distributors by marking rejected |
| `/admin/profile` | Static | No | Admin profile card only |
| `/requester/r_dashboard` | `products`, `requests`, local caches | Yes | Cancels pending requests |
| `/requester/requestform` | `products`, `users`, `requests` | Yes | Creates requests |
| `/requester/r_request` | `requests`, local requests | Yes | Cancels pending requests |
| `/requester/r_profile` | `users`, local users | Yes | Updates requester profile |
| `/requester/r_notification` | Static | No | Notification examples only |
| `/requester/bluetap_AI` | Static | No | Help UI only |
| `/distributor/d_dashboard` | Static | No | Designed dashboard only |
| `/distributor/d_requests` | Static/local component state | Local component state only | Scheduling UI not persisted |
| `/distributor/d_scheduled_requests` | Static | No | Designed schedule view |
| `/distributor/d_history` | Static | No | Designed history view |
| `/distributor/d_profile` | `users`, local users | Yes | Updates distributor profile |
| `/distributor/d_notification` | Static | No | Notification example only |

## 7. Request Flow

### Implemented Persisted Request Flow

The implemented Firestore-backed request lifecycle is:

```text
Pending -> Cancelled
```

Detailed flow:

1. Requester logs in and opens the dashboard.
2. Dashboard subscribes to products from Firestore/local cache.
3. Requester selects a product or opens the request form.
4. Request form loads requester profile from local cache and Firestore.
5. Request form ensures requester unique ID exists.
6. Requester selects one or more products.
7. App calculates:
   - line total per product
   - total quantity
   - total cost
8. Requester selects container type and water station.
9. Requester opens order summary.
10. Requester confirms order.
11. `createRequest` creates a new Firestore document in `requests`.
12. Request status is set to `Pending`.
13. Request appears on requester dashboard as a current request.
14. Request also appears in requester Active Orders.
15. If requester cancels the pending request, `cancelRequest` updates:
   - `status: "Cancelled"`
   - `updated_at`
   - `canceled_at`
16. Canceled request is removed from requester dashboard current requests.
17. Canceled request remains visible in requester history.

### Current Request State Transition Table

| Current Status | Action | Actor | New Status | Persisted Now? |
|---|---|---|---|---|
| None | Create request | Requester | Pending | Yes |
| Pending | Cancel request | Requester | Cancelled | Yes |
| Pending | Accept request | Distributor | Accepted | Not yet |
| Accepted | Schedule delivery | Distributor | Scheduled | Not yet |
| Scheduled | Start delivery | Distributor | Out for Delivery | Not yet |
| Out for Delivery | Mark delivered | Distributor | Delivered | Not yet |
| Any | Reject/remove | Admin or workflow rule | Rejected | Not implemented for customer requests |

### Request Data Flow Diagram

```text
Requester UI
-> requestform.jsx validates profile and selected products
-> services/requests.js builds request payload
-> Firestore requests collection stores request
-> requester dashboard listener receives update
-> requester order page listener receives update
-> admin dashboard/analytics listeners recompute metrics
```

### Future Complete Request Lifecycle

The UI implies this complete operational lifecycle:

```text
Pending -> Accepted -> Scheduled -> Out for Delivery -> Delivered
```

Recommended future persisted flow:

1. Requester creates `Pending` request.
2. Distributor sees pending requests filtered by water station or assignment rules.
3. Distributor accepts the request.
4. Firestore updates request with distributor assignment:

```json
{
  "status": "Accepted",
  "distributor_id": "firebase_uid_002",
  "distributor_unique_id": "DIS-000001",
  "distributor_name": "Juan Dela Cruz",
  "accepted_at": "serverTimestamp()"
}
```

5. Distributor schedules delivery:

```json
{
  "status": "Scheduled",
  "scheduled_at": "2026-07-25T09:00:00.000Z",
  "updated_at": "serverTimestamp()"
}
```

6. Distributor starts delivery:

```json
{
  "status": "Out for Delivery",
  "started_delivery_at": "serverTimestamp()"
}
```

7. Distributor marks delivered:

```json
{
  "status": "Delivered",
  "delivered_at": "serverTimestamp()"
}
```

8. Requester dashboard removes delivered request from current view.
9. Requester history shows delivered request.
10. Admin analytics includes the delivered or all ordered quantity depending on chosen reporting rule.

## 8. Distributor Flow

### Current Implemented Distributor Account Flow

1. Distributor signs up through `/signup`.
2. Firebase Auth account is created.
3. Firestore profile is saved under `users/{uid}`.
4. Role is set to `distributor`.
5. Status is set to pending.
6. Distributor is signed out.
7. Admin reviews the application through `/admin/request`.
8. Admin approves or rejects.
9. Approved distributor can log in.
10. `RoleGate` verifies distributor role and approved status.
11. Distributor can access distributor module.
12. Distributor can view and edit profile.
13. Distributor can log out.

### Current Distributor Operational Screens

Distributor dashboard:

- Views static summary counts.
- Views static current request.
- Opens request details modal.
- Navigates to pending requests or scheduled requests.

Pending requests:

- Views static pending request cards.
- Opens details.
- Opens schedule bottom sheet.
- Chooses Today, Tomorrow, or Custom Date & Time.
- Confirms schedule.
- The selected request is hidden locally from the pending list.
- Success toast is shown.
- Firestore is not updated yet.

Scheduled requests:

- Views static scheduled request cards.
- Opens details.
- Sees Start Delivery button UI.
- Firestore is not updated yet.

History:

- Views static delivered request cards.
- Opens details.
- Firestore is not queried yet.

Notifications:

- Static notification content.
- No real notification backend yet.

### Recommended Complete Distributor Flow

1. Distributor logs in after approval.
2. Distributor dashboard subscribes to Firestore requests assigned to their station or distributor ID.
3. Pending request list queries:

```text
requests where status == "Pending"
```

Optionally also filter by:

```text
water_station == distributor.waterStation
```

4. Distributor accepts request.
5. App writes distributor identity fields and status `Accepted`.
6. Distributor selects schedule.
7. App writes status `Scheduled` and `scheduled_at`.
8. Scheduled screen listens for requests assigned to the distributor with status `Scheduled`.
9. Distributor starts delivery.
10. App writes status `Out for Delivery`.
11. Distributor marks delivered.
12. App writes status `Delivered` and `delivered_at`.
13. Delivered request appears in distributor history.
14. Requester sees status changes in real time.
15. Admin analytics updates automatically through Firestore listeners.

## 9. Firestore Queries

### Fetch One User Profile

Used in login, requester profile, distributor profile, and request form.

```js
const snapshot = await getDoc(doc(db, 'users', user.uid));

if (snapshot.exists()) {
  const profile = snapshot.data();
}
```

### Listen to Product Catalog

Used by admin products, requester dashboard, and request form through `subscribeProducts`.

```js
const productsQuery = query(
  collection(db, 'products'),
  orderBy('created_at', 'asc')
);

const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
  const products = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
});
```

### Create Product

Used by admin product management.

```js
const productRef = doc(collection(db, 'products'));

await setDoc(productRef, {
  product_name: productName,
  price,
  image,
  imagePath,
  created_at: serverTimestamp(),
  updated_at: serverTimestamp(),
});
```

### Update Product

Used by admin product edit.

```js
await setDoc(
  doc(db, 'products', productId),
  {
    product_name: productName,
    price,
    image,
    imagePath,
    updated_at: serverTimestamp(),
  },
  { merge: true }
);
```

### Delete Product

Used by admin product delete.

```js
await deleteDoc(doc(db, 'products', product.id));
```

If the product has `imagePath`, the app also attempts:

```js
await deleteObject(ref(storage, product.imagePath));
```

### Listen to Requester Requests

Used by requester dashboard and requester request/history page.

```js
const requestsQuery = query(
  collection(db, 'requests'),
  where('requester_id', '==', requesterId)
);

const unsubscribe = onSnapshot(requestsQuery, (snapshot) => {
  const requests = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
});
```

### Listen to Requester Current Requests

Implemented by `subscribeRequesterCurrentRequests`. It reuses the requester request listener and filters out inactive statuses.

Inactive statuses:

```text
cancelled
canceled
delivered
rejected
```

### Create Request

Used by requester request form.

```js
const requestRef = doc(collection(db, 'requests'));

await setDoc(requestRef, {
  request_id: 'BT-12345',
  requester_id: requesterId,
  requester_unique_id: requesterUniqueId,
  requester_name: requesterName,
  contact_number: contactNumber,
  address,
  product_id: firstItem.product_id,
  product_name: productNames,
  product_price: firstItem.product_price,
  quantity: totalQuantity,
  items,
  container,
  water_station: waterStation,
  delivery_date: deliveryDate,
  total_cost: totalCost,
  status: 'Pending',
  created_at: serverTimestamp(),
  updated_at: serverTimestamp(),
});
```

### Cancel Request

Used by requester dashboard and request/history page.

```js
await setDoc(
  doc(db, 'requests', requestId),
  {
    status: 'Cancelled',
    updated_at: serverTimestamp(),
    canceled_at: serverTimestamp(),
  },
  { merge: true }
);
```

Cancellation is allowed only when normalized status is `pending`.

### Listen to Pending Distributor Applications

Used by admin request review page.

```js
const pendingQuery = query(
  collection(db, 'users'),
  where('role', '==', 'distributor')
);

const unsubscribe = onSnapshot(pendingQuery, (snapshot) => {
  const pendingDistributors = snapshot.docs
    .map((item) => ({ id: item.id, uid: item.id, ...item.data() }))
    .filter((item) => getDistributorApplicationStatus(item) === 'pending');
});
```

### Approve or Reject Distributor

Used by admin request review page.

```js
await setDoc(
  doc(db, 'users', distributorUid),
  {
    role: 'distributor',
    approvalStatus: 'approved',
    status: 'Approved',
    rejectionReason: null,
    reviewedAt: serverTimestamp(),
  },
  { merge: true }
);
```

Reject:

```js
await setDoc(
  doc(db, 'users', distributorUid),
  {
    role: 'distributor',
    approvalStatus: 'rejected',
    status: 'Rejected',
    rejectionReason,
    reviewedAt: serverTimestamp(),
  },
  { merge: true }
);
```

### Generate Unique IDs

Used by signup, login profile repair, and role validation.

```js
await runTransaction(db, async (transaction) => {
  const userSnapshot = await transaction.get(userRef);
  const counterSnapshot = await transaction.get(counterRef);
  const nextNumber = Math.max(currentCounter, observedHighest) + 1;
  const uniqueId = formatUniqueId(role, nextNumber);

  transaction.set(counterRef, { [counterField]: nextNumber }, { merge: true });
  transaction.set(userRef, { ...profileData, unique_id: uniqueId }, { merge: true });
});
```

### Admin Dashboard and Analytics Listeners

Admin dashboard and analytics listen to all users and requests:

```js
onSnapshot(collection(db, 'users'), handleUsers);
onSnapshot(collection(db, 'requests'), handleRequests);
```

These listeners support live metric updates.

### Firestore Index Notes

The current implemented queries are simple and mostly rely on default single-field indexes.

Current query patterns:

| Query | Used By | Index Requirement |
|---|---|---|
| `products orderBy created_at asc` | Product list, requester product browsing | Single-field index on `created_at`, normally automatic |
| `requests where requester_id == uid` | Requester dashboard and request history | Single-field index on `requester_id`, normally automatic |
| `users where role == distributor` | Admin request review and distributor list | Single-field index on `role`, normally automatic |
| `users where unique_id range + orderBy unique_id desc` | Unique ID recovery/checking | Single-field index on `unique_id`, normally automatic |
| `users all documents` | Admin dashboard and analytics | No composite index |
| `requests all documents` | Admin dashboard and analytics | No composite index |

Recommended future composite indexes:

| Future Query | Purpose | Suggested Composite Index |
|---|---|---|
| `requests where requester_id == uid and status in [...] orderBy created_at desc` | Requester active/history split at database level | `requester_id`, `status`, `created_at desc` |
| `requests where water_station == station and status == Pending orderBy created_at asc` | Distributor station-specific queue | `water_station`, `status`, `created_at asc` |
| `requests where distributor_id == uid and status == Scheduled orderBy scheduled_at asc` | Distributor schedule | `distributor_id`, `status`, `scheduled_at asc` |
| `requests where status == Delivered orderBy delivered_at desc` | Delivery history and analytics | `status`, `delivered_at desc` |
| `notifications where recipient_id == uid orderBy created_at desc` | Real-time notifications | `recipient_id`, `created_at desc` |

### Read, Write, Delete, and Listen Summary

| Operation | Current Code Path | Firebase Method |
|---|---|---|
| Read user profile once | Login, requester profile, distributor profile, request form | `getDoc(doc(db, 'users', uid))` |
| Listen to products | Product pages and request forms | `onSnapshot(query(collection(db, 'products'), orderBy(...)))` |
| Create product | Admin Products page | `setDoc(doc(collection(db, 'products')), payload)` |
| Update product | Admin Products page | `setDoc(doc(db, 'products', id), payload, { merge: true })` |
| Delete product | Admin Products page | `deleteDoc(doc(db, 'products', id))` |
| Upload product image | Admin Products page | `uploadBytes`, `getDownloadURL` |
| Delete product image | Admin Products page | `deleteObject` |
| Listen to requester requests | Requester dashboard/history | `onSnapshot(query(collection(db, 'requests'), where(...)))` |
| Create request | Request form | `setDoc(doc(collection(db, 'requests')), payload)` |
| Cancel request | Requester dashboard/history | `setDoc(doc(db, 'requests', id), payload, { merge: true })` |
| Approve/reject distributor | Admin Requests page | `setDoc(doc(db, 'users', uid), payload, { merge: true })` |
| Generate unique ID | Signup/login/profile validation | `runTransaction` |

## 10. Analytics

Analytics are implemented in `app/admin/dashboard.jsx` and `app/admin/analytics.jsx`.

### Overall Registered Users

Data source:

- Firestore `users`
- local users cache from `localUsers.js`

Computation:

```text
registeredUsers = mergedUsers.length
```

### Registered Distributors

Data source:

- Firestore `users`
- local users cache

Computation:

```text
registeredDistributors = users where role == "distributor"
```

Dashboard approved distributor table filters to approved distributors. Metric count currently counts distributor role users in merged users.

### Registered Requesters

Data source:

- Firestore `users`
- local users cache

Computation:

```text
registeredRequesters = users where role == "requester"
```

### Product Sales in Gallons

Data source:

- Firestore `requests`
- local requests cache

Computation:

```text
productSales = sum of request quantity
```

If a request has `items`, it sums `items[].quantity`. Otherwise, it uses `request.quantity`.

Important note:

- Current implementation counts ordered quantity across all loaded requests, regardless of status.
- For production analytics, the team should decide whether sales mean all requested gallons, accepted gallons, or delivered gallons only.

### Product Sales Trend Chart

Data source:

- Computed `productSales`

Computation:

The current chart does not group real requests by month. It derives a demonstration trend from total sales using fixed factors:

```js
const factors = [0.52, 0.6, 0.56, 0.68, 0.76, 1];
const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
```

Future improvement:

- Group requests by `created_at` or `delivered_at`.
- Sum quantity per month.
- Display actual monthly totals.

### Registered Users by Barangay Chart

Data source:

- Firestore `users`
- local users cache

Computation:

```text
group users by barangay or address
count users per barangay
```

The analytics page search filters barangay rows by name.

### User Composition Chart

Data source:

- Firestore `users`
- local users cache

Computation:

```text
distributors = count users where role == "distributor"
requesters = count users where role == "requester"
```

### Stations Panel

Data source:

- Default stations:
  - `aquabea`
  - `bluetap`
- Firestore/local `requests.water_station`

Dashboard:

- Counts distinct station names from default stations and requests.
- Displays default station panel.

Analytics:

- Builds station rows from default stations plus request station data.
- Gallons sold per station are computed by summing request quantities grouped by `water_station`.

### Registered Accounts Table

Data source:

- Firestore `users`
- local users cache

Displays:

- Name
- Unique ID
- Contact
- Email
- Barangay
- Joined date
- Actions

### Analytics Limitations and Interpretation

For the proposal hearing, the analytics should be described as operational dashboard analytics, not financial accounting analytics.

Current interpretation:

- Registered users means total merged Firestore/local user profiles.
- Registered requesters and distributors are counted by profile role.
- Product sales means total gallons ordered based on request quantities.
- Stations online means known station names from defaults and request records.
- Barangay chart means user distribution by barangay/address.

Important caveat:

- The trend chart is a visual projection based on current total product sales, not a historical month-by-month Firestore aggregation.
- The app currently does not distinguish pending orders from delivered sales in the product sales metric.
- For a production report, delivered sales should use only requests with `status == "Delivered"` and a valid `delivered_at` timestamp.

## 11. Security

### Current Security Status

The project includes client-side role checks and Firebase Authentication, but it does not include Firestore Rules or Storage Rules files in the repository.

Current limitations:

- Admin credentials are hard-coded in the client.
- Admin session is local and bypasses Firebase Auth.
- Role enforcement is primarily client-side.
- Firestore and Storage access must be secured in Firebase Console or added as rules files.
- Product image upload does not currently validate file size/type through Firebase Storage rules in this repo.

### Firestore Rules

No `firestore.rules` file is present in the repository.

Recommended Firestore rules for production:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userDoc(uid) {
      return get(/databases/$(database)/documents/users/$(uid));
    }

    function role() {
      return signedIn() && userDoc(request.auth.uid).data.role;
    }

    function isAdmin() {
      return role() == 'admin';
    }

    function isRequester() {
      return role() == 'requester';
    }

    function isDistributor() {
      return role() == 'distributor' &&
        userDoc(request.auth.uid).data.approvalStatus == 'approved';
    }

    match /users/{uid} {
      allow create: if signedIn() && request.auth.uid == uid;
      allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow update: if signedIn() && (
        request.auth.uid == uid ||
        isAdmin()
      );
      allow delete: if false;
    }

    match /products/{productId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }

    match /requests/{requestId} {
      allow create: if isRequester() &&
        request.resource.data.requester_id == request.auth.uid;

      allow read: if signedIn() && (
        isAdmin() ||
        resource.data.requester_id == request.auth.uid ||
        resource.data.distributor_id == request.auth.uid
      );

      allow update: if signedIn() && (
        isAdmin() ||
        (
          isRequester() &&
          resource.data.requester_id == request.auth.uid &&
          resource.data.status == 'Pending' &&
          request.resource.data.status == 'Cancelled'
        ) ||
        (
          isDistributor() &&
          (
            resource.data.distributor_id == request.auth.uid ||
            !('distributor_id' in resource.data)
          )
        )
      );

      allow delete: if isAdmin();
    }

    match /counters/{counterId} {
      allow read: if isAdmin();
      allow write: if signedIn();
    }
  }
}
```

Important note:

- The recommended rules above assume real Firebase-authenticated admin users. The current hard-coded admin secret cannot be enforced by Firestore rules because it does not create a Firebase Auth identity.

### Authentication Security

Implemented:

- Firebase email/password auth for requester and distributor accounts.
- Password reset through Firebase.
- Route protection through `RoleGate`.
- Distributor login blocked unless approved.

Needs improvement:

- Replace hard-coded admin login with Firebase Auth admin account.
- Use custom claims or secure admin role records.
- Enforce roles in Firestore rules.
- Avoid storing sensitive authorization state only in local storage.

### Authorization Security

Implemented:

- Client checks expected route role.
- Client redirects role mismatches.
- Distributor approval status is checked during login and role validation.

Needs improvement:

- Firestore rules must enforce role and ownership.
- Storage rules must restrict writes to admin users.
- Request status transitions should be validated server-side or through security rules.
- Admin-only product writes must not rely on UI hiding alone.

### File Upload Security

Implemented:

- Product images are uploaded only through the admin Products UI.
- Image upload path includes product ID and sanitized file name.
- Previous product image is deleted when a replacement image succeeds.
- Upload has a 12-second timeout wrapper.

Current gaps:

- No Storage rules in repo.
- No file size validation.
- No MIME-type validation in rules.
- Admin status is not enforceable with current local secret admin session.

Recommended Storage rules:

```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    function signedIn() {
      return request.auth != null;
    }

    function isImage() {
      return request.resource.contentType.matches('image/.*');
    }

    function isSmallEnough() {
      return request.resource.size < 5 * 1024 * 1024;
    }

    function isAdmin() {
      return signedIn() &&
        firestore.get(
          /databases/(default)/documents/users/$(request.auth.uid)
        ).data.role == 'admin';
    }

    match /products/{productId}/{fileName} {
      allow read: if signedIn();
      allow write: if isAdmin() && isImage() && isSmallEnough();
      allow delete: if isAdmin();
    }
  }
}
```

## 12. Serverless Architecture

BlueTap follows a serverless architecture across Firebase, the BlueTap Render backend,
Vercel web hosting, and the separate protected face service.

### High-Level Architecture Diagram

```text
Expo React Native App
|-- Public module
|-- Requester module
|-- Distributor module
`-- Admin module
     |
     |-----------------------> Firebase client services
     |                         |-- Authentication
     |                         |-- Firestore
     |                         `-- Storage
     |
     `-----------------------> BlueTap Render /api routes
                               `-- backend feature modules
                                   |-- Firebase Admin
                                   |-- email OTP and registration
                                   `-- face-verification orchestration
                                        `-- separate protected face API

Vercel /api routes temporarily expose the same backend modules as a fallback.
```

### Logical Module Diagram

```text
app/
|-- login/signup
|-- requester screens
|   |-- services/products.js
|   `-- services/requests.js
|-- distributor screens
|   `-- services/authSession.js
|-- admin screens
    |-- services/products.js
    |-- services/uniqueIds.js
    `-- localUsers.js
api/ -> backend/{auth,registration,username,verification}
```

### Firebase Authentication

Used for:

- Requester signup
- Distributor signup
- Requester/distributor login
- Password reset
- Persistent auth state
- User identity through UID

### Cloud Firestore

Used for:

- User profiles and roles
- Distributor application status
- Product catalog
- Request/order records
- Unique ID counters
- Admin analytics data source

Firestore is accessed directly from the client SDK. Real-time updates are handled with `onSnapshot`.

### Firebase Storage

Used for:

- Product image uploads
- Product image download URLs
- Product image replacement and deletion

### Local Client Persistence

The app also uses local fallback storage:

- `bluetapLocalUsers`
- `bluetapActiveAuthSession`
- `bluetapModuleAuthSessions`
- `bluetapLocalProducts`
- `bluetapLocalRequests`

Purpose:

- Provide optimistic UI behavior.
- Preserve local data during Firebase errors.
- Allow prototype/demo resilience.

Limitation:

- Local fallback is not a complete offline sync queue. Data can diverge from Firestore if background synchronization fails.

### Serverless API Backend

Render executes `backend/app.js`, whose route table delegates to modules that use
Firebase Admin, send email OTPs, manage registration sessions, validate usernames,
and coordinate face verification. Vercel executes equivalent fallback handlers from
`api/` during migration. The retained `functions/` implementation is legacy and inactive.

## 13. Libraries Used

### `expo`

Chosen to build and run a cross-platform React Native application with mobile and web support.

### `expo-router`

Chosen for file-based navigation that maps directly to the `app/` folder structure.

### `react` and `react-native`

Core UI framework for building the mobile application.

### `react-native-web` and `react-dom`

Allow the Expo/React Native app to run in a browser, especially useful for the admin panel and product image upload.

### `firebase`

Chosen as the backend SDK for:

- Firebase Authentication
- Cloud Firestore
- Firebase Storage

### `@react-native-async-storage/async-storage`

Used to persist Firebase Auth sessions in React Native environments.

### `expo-linear-gradient`

Used for BlueTap gradient backgrounds on mobile requester and public screens.

### `expo-status-bar`

Used to control status bar appearance per screen.

### `react-native-safe-area-context`

Ensures content respects device safe areas such as notches and bottom indicators.

### `react-native-gesture-handler`

Required for gesture support and used at the root layout.

### `react-native-reanimated`

Used for smooth animations in dashboards, navigation, and UI transitions.

### `react-native-reanimated-carousel`

Used for the requester product carousel on the dashboard.

### `react-native-screens`

Improves native navigation screen performance.

### `nativewind` and `tailwindcss`

Configured for Tailwind-style utility support in React Native. The current UI mainly uses `StyleSheet`, but NativeWind is available.

### `expo-linking`, `expo-constants`, `react-native-worklets`

Supporting Expo and React Native runtime packages required by the app stack and dependencies.

## 14. Possible Limitations

- Admin login is hard-coded in the client.
- Admin authorization is not enforceable through Firestore rules in its current form.
- No Firestore rules file is included in the repo.
- No Firebase Storage rules file is included in the repo.
- `firebase.json` covers only the retained legacy Functions source; Firebase Hosting is not configured.
- Distributor request operations are mostly static UI and local state.
- Firestore does not yet persist distributor accept, schedule, out-for-delivery, or delivered actions.
- Notifications are static and not backed by Firestore or push notifications.
- BlueTap AI is a static help UI and not connected to an AI service.
- Request lifecycle currently persists only `Pending -> Cancelled`.
- Backend and native challenge tests run with `npm test`; browser and physical-device coverage remains incomplete.
- Product image upload is available only when a browser `document` exists.
- Local fallback persistence can diverge from Firestore.
- In-memory fallback does not survive app restart.
- Distributor removal marks a profile rejected but does not delete the Firebase Auth account.
- Dashboard product sales trend uses generated factors rather than actual monthly grouping.
- Admin metrics count request quantities regardless of final status.
- Firebase config is committed in source code.
- There is no central logging, monitoring, or audit trail.
- Some UI strings show encoding artifacts in source, especially special symbols in the static BlueTap AI page.
- Some layout/navigation patterns are duplicated across screens.

## 15. Future Improvements

### Security and Authorization

- Replace hard-coded admin secret with Firebase Auth admin accounts.
- Add Firebase custom claims or secure admin role management.
- Add and deploy Firestore rules.
- Add and deploy Storage rules.
- Restrict admin-only operations at the database level.
- Validate request status transitions in rules or Cloud Functions.

### Request and Distributor Operations

- Connect distributor pending request page to Firestore.
- Implement real accept request action.
- Persist distributor assignment fields.
- Persist scheduled delivery date and time.
- Implement Start Delivery and Delivered status updates.
- Add distributor request history query.
- Add station-based request routing.

### Notifications

- Add `notifications` collection.
- Generate notifications when:
  - request is submitted
  - request is accepted
  - delivery is scheduled
  - request is out for delivery
  - request is delivered
  - request is canceled
- Add real-time notification listeners.
- Consider Firebase Cloud Messaging for push notifications.

### Analytics

- Replace simulated monthly sales trend with actual monthly aggregation.
- Separate requested gallons from delivered gallons.
- Add date filters.
- Add station filters.
- Add distributor performance metrics.
- Add cancellation rate and delivery completion rate.

### Reliability

- Add robust offline sync queue for locally saved products and requests.
- Add retry handling with visible sync status.
- Add central error logging.
- Add data validation before Firestore writes.
- Expand automated coverage for client services, route access, and browser flows.

### Deployment

- Add Firebase project configuration files.
- Add Firebase Hosting configuration only if Firebase becomes the chosen web host.
- Add Firestore and Storage rules files.
- Configure Expo EAS builds.
- Configure web hosting for the admin panel.
- Add CI/CD for linting, tests, and deployment.

### User Experience

- Replace static notification pages with live notification lists.
- Complete BlueTap AI or convert it to a guided FAQ.
- Improve distributor dashboard with live counts.
- Add requester profile image or more account settings.
- Add payment status and payment method.
- Add order receipt view.
- Add request search and filtering.

### Data Model

- Add `notifications` collection.
- Add `stations` collection.
- Add `deliveries` collection if delivery events need separate tracking.
- Add `audit_logs` collection for admin and distributor actions.
- Add `status_history` array or subcollection under requests.

## Appendix A: Current Key Data Flows

### Requester Creates Request

```text
requestform.jsx
-> load requester profile from users/{uid}
-> subscribeProducts()
-> user selects products
-> createRequest()
-> setDoc(requests/{requestId})
-> dashboard receives onSnapshot update
```

### Requester Cancels Request

```text
r_dashboard.jsx or r_request.jsx
-> cancelRequest(request)
-> validate status is Pending
-> setDoc(requests/{id}, { status: "Cancelled" }, { merge: true })
-> current request list filters it out
-> history still displays it
```

### Admin Approves Distributor

```text
signup.jsx
-> creates distributor with pending status
-> admin/request.jsx listens to users where role == distributor
-> admin presses Accept
-> setDoc(users/{uid}, { approvalStatus: "approved", status: "Approved" })
-> distributor can log in
```

### Admin Manages Products

```text
admin/products.jsx
-> subscribeProducts()
-> createProduct/updateProduct/deleteProduct()
-> product image upload to Firebase Storage
-> product data saved to products collection
-> requester dashboard and request form receive live product updates
```

## Appendix B: Current Status Model

Statuses recognized by UI badges:

- Pending
- Accepted
- Scheduled
- Processing
- Out for Delivery
- Delivered
- Cancelled
- Canceled
- Rejected

Statuses currently persisted by implemented request service:

- Pending
- Cancelled

Statuses shown in static distributor UI:

- Pending
- Scheduled
- Out for Delivery
- Delivered

## Appendix C: Capstone Hearing Demo Script

### Demo Goal

Show that BlueTap supports role-based access, product management, requester ordering, distributor approval, and live requester/admin data updates through Firebase.

### Recommended Demo Order

1. Open the cover page.
2. Navigate to login.
3. Sign up a requester account.
4. Show requester dashboard.
5. Log out.
6. Log in as admin using the prototype admin credentials.
7. Open Products and add a product.
8. Open Dashboard or Analytics and show user/product/request data panels.
9. Log out.
10. Log in as the requester.
11. Create a request from the product catalog.
12. Show the request on requester dashboard.
13. Open My Orders and show Active Orders.
14. Cancel the pending request.
15. Show the request moved out of Current Request and into History.
16. Sign up a distributor account.
17. Log in as admin.
18. Open Requests and approve the distributor.
19. Log in as the distributor.
20. Show distributor dashboard and profile.

### Suggested Explanation During Demo

Use this explanation when presenting the system:

```text
BlueTap uses Firebase Authentication for user identity and Firestore for application data.
Each user has a role stored in the users collection. The app checks that role before allowing access to each module.
Requesters can create Firestore-backed water requests. Admin product management is also Firestore-backed.
Distributor operational screens are already designed and protected, but their request accept/schedule/deliver actions are the next implementation milestone.
```

### Demo Data to Prepare

Recommended pre-demo data:

- At least one requester account.
- At least one pending distributor account.
- At least two products in `products`.
- At least one pending request in `requests`.
- At least one cancelled request for history demonstration.

## Appendix D: Requirement Mapping

| Capstone Requirement | BlueTap Implementation |
|---|---|
| User registration | `app/signup.jsx` with platform-specific face verification, backend registration session/OTP gates, Firebase Auth, and Firestore profile |
| Login/authentication | `app/login.jsx` with Firebase email/password |
| Role-based access | `RoleGate.jsx` and `services/authSession.js` |
| Database storage | Firestore collections: `users`, `products`, `requests`, `counters` |
| File storage | Firebase Storage for product images |
| Admin management | Admin dashboard, distributor review, products, analytics |
| Customer/requester workflow | Dashboard, request form, order history, profile |
| Distributor workflow | Approval-gated module, profile, designed request/schedule/history screens |
| Analytics/reporting | Admin dashboard and analytics pages |
| Security discussion | Firebase Auth, recommended Firestore/Storage rules, role authorization notes |
| Serverless architecture | Vercel web frontend, BlueTap Render backend, Firebase services, and a separate protected face service |

## Appendix E: Production Readiness Checklist

### Must Complete Before Real Deployment

- Replace hard-coded admin login with Firebase Auth admin account.
- Add Firestore security rules.
- Add Firebase Storage security rules.
- Connect distributor accept/schedule/start/deliver actions to Firestore.
- Add request status transition validation.
- Add real notifications.
- Add production Firebase project configuration.
- Add deployment configuration for mobile and/or web.
- Add automated service tests for auth, requests, products, and unique IDs.

### Should Complete Soon After Deployment

- Add analytics date filtering.
- Add station management.
- Add distributor assignment rules.
- Add sync retry UI for locally saved data.
- Add audit logs for admin and distributor actions.
- Add error monitoring.
- Improve static BlueTap AI page into a real FAQ or assistant.

### Nice-to-Have Enhancements

- Add push notifications.
- Add payment tracking.
- Add order receipts.
- Add map/location support.
- Add admin export reports.
- Add role-specific onboarding screens.

## Appendix F: Suggested Future Collections

### `notifications`

Purpose:

- Store requester and distributor notification records.

Suggested fields:

| Field | Type | Description |
|---|---|---|
| `recipient_id` | string | UID of receiving user |
| `recipient_role` | string | requester, distributor, or admin |
| `request_id` | string | Related request document ID |
| `title` | string | Notification title |
| `message` | string | Notification body |
| `read` | boolean | Read/unread state |
| `created_at` | timestamp | Creation timestamp |

Sample:

```json
{
  "recipient_id": "firebase_uid_001",
  "recipient_role": "requester",
  "request_id": "request_doc_001",
  "title": "Request Scheduled",
  "message": "Your water delivery has been scheduled for tomorrow at 9:00 AM.",
  "read": false,
  "created_at": "serverTimestamp()"
}
```

### `stations`

Purpose:

- Store water station data instead of hard-coding `aquabea` and `bluetap`.

Suggested fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | Station display name |
| `slug` | string | Stable station ID |
| `address` | string | Station address |
| `active` | boolean | Whether the station is available |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Update timestamp |

### `audit_logs`

Purpose:

- Track important system actions for accountability.

Suggested fields:

| Field | Type | Description |
|---|---|---|
| `actor_id` | string | UID of user who performed the action |
| `actor_role` | string | Role of actor |
| `action` | string | Action name |
| `target_collection` | string | Affected collection |
| `target_id` | string | Affected document ID |
| `metadata` | map | Extra action details |
| `created_at` | timestamp | Action timestamp |

Example actions:

- `distributor.approved`
- `distributor.rejected`
- `product.created`
- `product.deleted`
- `request.created`
- `request.cancelled`
- `request.scheduled`
- `request.delivered`

## Appendix G: Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Hard-coded admin login | Unauthorized users could inspect or reuse credentials if deployed publicly | Replace with Firebase Auth admin users and rules |
| Missing Firestore rules in repo | Data may be exposed or writable if Firebase Console rules are permissive | Add strict rules and test with emulator |
| Static distributor request screens | End-to-end delivery workflow is incomplete | Connect distributor actions to `requests` collection |
| Local fallback divergence | Local data can differ from Firestore | Add sync queue, sync status, and retry controls |
| Analytics overcounts sales | Pending/cancelled requests may be counted as sales | Count delivered requests separately |
| No automated tests | Regressions may go unnoticed | Add tests for services and role checks |
| Product upload constraints missing | Large or invalid files may be uploaded | Enforce MIME type and size in Storage rules |

## Appendix H: Glossary

| Term | Meaning |
|---|---|
| Requester | Customer who orders water |
| Distributor | Approved delivery/station user |
| Admin | System manager responsible for approvals, products, and analytics |
| Request | A water order placed by a requester |
| Product | A water item with name, price, and optional image |
| Unique ID | Human-readable account ID such as `REQ-000001` or `DIS-000001` |
| Firestore | Firebase NoSQL database used by the app |
| Firebase Storage | File storage service used for product images |
| RoleGate | React component that protects route groups by role |
| Local fallback | Browser or memory cache used when Firebase operations fail |

## Appendix I: Text-Based Entity Relationship Diagram

```text
Firebase Auth User
        |
        | uid
        v
users/{uid}
        |
        | requester_id
        v
requests/{requestDocId}
        |
        | items[].product_id
        v
products/{productId}

counters/unique_ids
        |
        | generates
        v
users.unique_id
```

### Entity Relationship Notes

- A Firebase Auth user should have one matching `users/{uid}` profile.
- A requester user can create many `requests`.
- A request can contain many product line items through `items`.
- Product references are stored inside `requests.items`.
- Distributor assignment fields are prepared in the request schema but not fully used by live distributor workflows yet.
- `counters/unique_ids` supports unique ID generation for requester and distributor profiles.

## Appendix J: Use Case Matrix

| Use Case | Actor | Trigger | Main Data Used | Current Status |
|---|---|---|---|---|
| Register requester | Public user | User submits signup form as requester | Firebase Auth, `users`, `counters` | Implemented |
| Register distributor | Public user | User submits signup form as distributor | Firebase Auth, `users`, `counters` | Implemented |
| Login requester | Requester | User submits valid email/password | Firebase Auth, `users`, local session | Implemented |
| Login distributor | Approved distributor | User submits valid email/password | Firebase Auth, `users`, local session | Implemented |
| Login admin | Admin | User submits prototype admin credentials | Local session | Implemented for prototype |
| Approve distributor | Admin | Admin clicks Accept | `users` | Implemented |
| Reject distributor | Admin | Admin enters reason and saves rejection | `users` | Implemented |
| Add product | Admin | Admin submits product form | `products`, Firebase Storage | Implemented |
| Edit product | Admin | Admin updates product form | `products`, Firebase Storage | Implemented |
| Delete product | Admin | Admin confirms delete | `products`, Firebase Storage | Implemented |
| Browse products | Requester | Requester opens dashboard/request form | `products` | Implemented |
| Create request | Requester | Requester confirms order summary | `requests`, `products`, `users` | Implemented |
| View current request | Requester | Dashboard listener receives request data | `requests` | Implemented |
| View request history | Requester | Requester opens My Orders history tab | `requests` | Implemented |
| Cancel request | Requester | Requester confirms cancellation | `requests` | Implemented for pending requests |
| Accept request | Distributor | Distributor clicks Accept Request | Static/local state | Prototype UI |
| Schedule request | Distributor | Distributor confirms schedule sheet | Static/local state | Prototype UI |
| Start delivery | Distributor | Distributor clicks Start Delivery | Static data | Prototype UI |
| Mark delivered | Distributor | Distributor completes delivery | Static data | Prototype UI |
| View analytics | Admin | Admin opens dashboard/analytics | `users`, `requests`, local caches | Implemented with limitations |
| View notifications | Requester/Distributor | User opens notification page | Static data | Prototype UI |
