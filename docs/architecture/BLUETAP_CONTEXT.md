# BlueTap Context

This document explains the current BlueTap application for another engineer who may continue the project.

BlueTap is an Expo Router / React Native app for mineral water ordering. It uses Firebase Authentication, Firestore, and Firebase Storage, with browser `localStorage` or in-memory fallbacks for several flows.

## Tech Stack

- Expo SDK 54, React 19, React Native 0.81
- Expo Router for file-based navigation
- Firebase Auth for requester and distributor email/password accounts
- Firestore for users, products, and requests
- Firebase Storage for product images
- NativeWind/Tailwind config is present, but most UI is plain `StyleSheet`
- `react-native-reanimated-carousel` is used on the requester dashboard product carousel

## Folder Structure

```text
.
|-- app/
|   |-- _layout.jsx                 # Root Expo Router stack
|   |-- index.jsx                   # Cover/landing screen
|   |-- login.jsx                   # Login, password reset, missing-profile setup
|   |-- signup.jsx                  # Requester/distributor registration
|   |-- admin/
|   |   |-- _layout.jsx             # Admin RoleGate wrapper
|   |   |-- dashboard.jsx           # Admin dashboard and approved distributors
|   |   |-- products.jsx            # Product CRUD
|   |   `-- request.jsx             # Pending distributor review
|   |-- distributor/
|   |   |-- _layout.jsx             # Distributor RoleGate wrapper
|   |   |-- d_dashboard.jsx         # Static current request dashboard
|   |   |-- d_requests.jsx          # Static pending requests
|   |   |-- d_scheduled_requests.jsx# Static scheduled requests
|   |   |-- d_history.jsx           # Static request history
|   |   |-- d_profile.jsx           # Distributor profile read from Firestore
|   |   `-- d_notification.jsx      # Static notification page
|   `-- requester/
|       |-- _layout.jsx             # Requester RoleGate, header, bottom nav
|       |-- r_dashboard.jsx         # Products carousel and current requests
|       |-- requestform.jsx         # New order form
|       |-- r_request.jsx           # Request history
|       |-- r_profile.jsx           # Profile display/edit/logout
|       |-- r_notification.jsx      # Static notifications
|       `-- bluetap_AI.jsx          # Static helper screen
|-- components/
|   |-- RequesterHeader.jsx         # Shared requester top header
|   `-- RoleGate.jsx                # Role-based route protection
|-- services/
|   |-- authSession.js              # Session persistence and role validation
|   |-- products.js                 # Product subscriptions/CRUD/local fallback
|   `-- requests.js                 # Request subscriptions/create/cancel/local fallback
|-- assets/icons/                  # App logos and navigation icons
|-- firebase.js                    # Firebase app/auth/firestore/storage setup
|-- localUsers.js                  # Local user cache and distributor status helpers
|-- package.json
`-- app.json
```

## Navigation

The app uses Expo Router file routes.

### Public Routes

- `/` renders `app/index.jsx`, a BlueTap cover screen with an Enter button.
- `/login` handles regular login, admin secret login, password reset, and missing app-profile completion.
- `/signup` registers requesters and distributor applicants.

### Role Layouts

Each role route group is wrapped in `RoleGate`:

- `/admin/*` uses `app/admin/_layout.jsx` with `role="admin"`.
- `/requester/*` uses `app/requester/_layout.jsx` with `role="requester"`.
- `/distributor/*` uses `app/distributor/_layout.jsx` with `role="distributor"`.

`RoleGate` listens to Firebase Auth state and local session changes, then calls `validateRoleAccess()` from `services/authSession.js`. Unauthorized users are redirected to `/login`; role mismatches are redirected to the correct role home.

### Admin Navigation

Admin pages render their own sidebar:

- `/admin/dashboard`: overview stats and registered distributors.
- `/admin/products`: product list and product add/edit/delete modal.
- `/admin/request`: pending distributor applications with approve/reject actions.
- "Profile" exists as a sidebar item but has no route behavior.

### Requester Navigation

The requester layout provides:

- Shared top header through `components/RequesterHeader.jsx`.
- Bottom navigation:
  - Home -> `/requester/r_dashboard`
  - Middle button -> `/requester/r_request` from dashboard/history/notification, otherwise `/requester/requestform`
  - Profile -> `/requester/r_profile`

Requester routes:

- `/requester/r_dashboard`: product carousel and active/current requests.
- `/requester/requestform`: creates a new water request.
- `/requester/r_request`: full request history and detail modal.
- `/requester/r_profile`: profile info, edit profile, logout, BlueTap AI entry.
- `/requester/r_notification`: static notification messages.
- `/requester/bluetap_AI`: static helper UI.

### Distributor Navigation

Distributor screens each implement their own bottom nav:

- Home -> `/distributor/d_dashboard`
- Requests -> `/distributor/d_requests`
- Profile -> `/distributor/d_profile`

Additional distributor routes:

- `/distributor/d_scheduled_requests`
- `/distributor/d_history`
- `/distributor/d_notification`

The distributor request, schedule, history, and notification pages currently use hard-coded sample data, not Firestore.

## Authentication

Firebase Auth is initialized in `firebase.js`.

### Regular Accounts

Requester and distributor accounts use Firebase email/password auth:

- Sign up calls `createUserWithEmailAndPassword`.
- Login calls `signInWithEmailAndPassword`.
- Forgot password calls `fetchSignInMethodsForEmail` and `sendPasswordResetEmail`.
- User profile metadata is stored in Firestore under `users/{uid}`.

### Admin Account

Admin login is a client-side secret flow in `app/login.jsx`:

```text
email: bluetapadmin
password: 12345678
```

This bypasses Firebase Auth and saves an admin session with `isAdminSecret: true`.

### Session Storage

`services/authSession.js` stores role sessions in:

- `bluetapActiveAuthSession`
- `bluetapModuleAuthSessions`

Storage uses `globalThis.localStorage` when available. If not available, it falls back to an in-memory global object.

### Role Validation

`validateRoleAccess(expectedRole)`:

1. Verifies the expected role is one of `admin`, `requester`, or `distributor`.
2. Allows the secret admin session if the expected role is admin and Firebase has no current user.
3. Requires a Firebase current user for requester/distributor.
4. Reads `users/{uid}` from Firestore.
5. Saves the profile locally when a role exists.
6. Redirects users if their actual role differs from the requested route.
7. Blocks distributor login unless their application status is `approved`.

## Roles

### Admin

Admin users manage:

- Distributor application approval/rejection
- Registered distributor list
- Product catalog
- Basic dashboard metrics

The implemented admin access path is currently the hard-coded secret login.

### Requester

Requesters can:

- Sign up and immediately log in
- Browse products
- Create water requests
- View current requests
- Cancel pending requests
- View request history
- Edit profile details locally and in Firestore

Requester accounts are saved with:

```text
role: requester
approvalStatus: approved
status: Approved
```

### Distributor

Distributors can:

- Sign up as applicants
- Wait for admin review
- Log in only after approval
- View profile after approval

Distributor accounts are saved with:

```text
role: distributor
approvalStatus: pending | approved | rejected
status: Pending | Approved | Rejected
rejectionReason: string | null
```

The distributor operational screens are mostly UI mockups and do not yet consume live request data.

## Firestore Collections

### `users`

Used by auth, role checks, profile pages, and admin distributor review.

Typical fields:

```text
uid: string
firstName: string
lastName: string
email: string
phone: string
barangay: string
address: string
role: "requester" | "distributor" | "admin"
approvalStatus: "pending" | "approved" | "rejected"
status: "Pending" | "Approved" | "Rejected"
rejectionReason: string | null
createdAt: Firestore timestamp
updatedAt: Firestore timestamp
reviewedAt: Firestore timestamp
removedAt: Firestore timestamp
waterStation: string
```

Notes:

- Requester profile editing updates `firstName`, `lastName`, `phone`, `address`, and `updatedAt`.
- Admin approval/rejection updates distributor status fields and `reviewedAt`.
- Admin remove distributor marks the user as rejected and sets `removedAt`; it does not delete the Firebase Auth user.

### `products`

Used by admin product management and requester product selection.

Service constant: `PRODUCTS_COLLECTION = "products"`.

Fields written by `services/products.js`:

```text
product_name: string
price: number
image: string              # Firebase Storage download URL or data URL fallback
imagePath: string          # Firebase Storage path
created_at: Firestore timestamp
updated_at: Firestore timestamp
```

The product normalizer also reads optional legacy/display fields such as `productName`, `capacity`, `subtext`, `createdAt`, and `updatedAt`.

Images are uploaded to Firebase Storage under:

```text
products/{productId}/{timestamp}-{sanitizedFileName}
```

### `requests`

Used by requester order creation, requester dashboard current requests, requester request history, and admin dashboard metrics.

Service constant: `REQUESTS_COLLECTION = "requests"`.

Fields written by `services/requests.js`:

```text
request_id: string         # Generated as BT-xxxxx
requester_id: string       # Firebase uid
requester_name: string
contact_number: string
address: string
product_id: string         # First item id for backward compatibility
product_name: string       # Comma-separated item names for backward compatibility
product_price: number      # First item price for backward compatibility
quantity: number           # Total quantity
items: array<{
  product_id: string
  product_name: string
  product_price: number
  quantity: number
  line_total: number
}>
container: string
water_station: string
delivery_date: string
total_cost: number
status: string             # Starts as Pending
created_at: Firestore timestamp
updated_at: Firestore timestamp
canceled_at: Firestore timestamp
```

Queries:

- Requester subscriptions query `requests` with `where("requester_id", "==", requesterId)`.
- Admin dashboard listens to all `requests` for metrics.

## Local Persistence

Several modules keep local fallbacks for resilience or optimistic UI.

### `localUsers.js`

Key: `bluetapLocalUsers`

Responsibilities:

- Save local user profiles.
- Find user records by email or Firebase Auth user.
- Match a local user to a specific role.
- Update distributor application status locally.
- Notify subscribers through `bluetapLocalUsersChanged` and `storage`.

### `services/authSession.js`

Keys:

- `bluetapActiveAuthSession`
- `bluetapModuleAuthSessions`

Responsibilities:

- Persist the active role session.
- Save role-specific sessions.
- Save the secret admin session.
- Clear one role session or all sessions.
- Validate route access.

### `services/products.js`

Key: `bluetapLocalProducts`

Responsibilities:

- Subscribe to products from Firestore and local cache.
- Merge Firestore products with local products.
- Create and update products locally first.
- Try to sync product writes and image uploads to Firebase in the background.
- Delete products from Firestore/Storage or local cache.

### `services/requests.js`

Key: `bluetapLocalRequests`

Responsibilities:

- Subscribe to requester-specific requests from Firestore and local cache.
- Merge Firestore and local request changes.
- Create requests in Firestore, falling back to local saved requests on failure.
- Cancel pending requests in Firestore, falling back to local cancellation on failure.
- Filter current requests by excluding cancelled/canceled/delivered/rejected statuses.

## Services

### `services/authSession.js`

Important exports:

- `getRoleHomePath(role)`
- `isValidRole(role)`
- `saveRoleSession(profile)`
- `saveAdminSession()`
- `clearModuleSession(role)`
- `clearAllAuthSessions()`
- `subscribeAuthSessionChanges(listener)`
- `fetchFirestoreUserProfile(user)`
- `validateRoleAccess(expectedRole)`
- `signOutAndClearSessions()`

### `services/products.js`

Important exports:

- `subscribeProducts(listener, onError)`
- `createProduct({ product_name, price, imageFile, imageDataUrl })`
- `updateProduct(productId, payload)`
- `deleteProduct(product)`
- `getLocalProducts()`
- `upsertLocalProduct(product)`
- `removeLocalProduct(productId)`

Implementation detail:

- Product create/update returns the local product immediately.
- Firebase sync is launched in the background with `void sync...`.
- Firebase operations have a 12-second timeout wrapper.

### `services/requests.js`

Important exports:

- `subscribeRequesterRequests(requesterId, listener, onError)`
- `subscribeRequesterCurrentRequests(requesterId, listener, onError)`
- `createRequest(requestData)`
- `cancelRequest(request)`
- `getLocalRequests()`
- `isCurrentRequesterRequest(request)`

Implementation detail:

- Request creation uses Firestore `setDoc` with a generated document ID.
- If creation fails, the request is stored locally and the thrown error gets `savedLocal = true`.
- Cancellation is only allowed while the normalized status is `pending`.

## Business Logic

### Distributor Applications

1. A user signs up as distributor.
2. Firebase Auth account is created.
3. A `users/{uid}` profile is saved with `approvalStatus: "pending"` and `status: "Pending"`.
4. The user is signed out and told to wait for admin approval.
5. Admin opens `/admin/request`.
6. Admin can approve or reject:
   - Approve sets `approvalStatus: "approved"` and `status: "Approved"`.
   - Reject requires a rejection reason and sets `approvalStatus: "rejected"` and `status: "Rejected"`.
7. Distributor login is blocked until the profile status normalizes to `approved`.

### Products

1. Admin opens `/admin/products`.
2. Products are loaded through `subscribeProducts`.
3. Add/edit validates name and non-negative numeric price.
4. Image upload is available only when `globalThis.document` exists, so this is designed for web browser admin usage.
5. Create/update writes local state immediately, then attempts Firebase Storage upload and Firestore write.
6. Requesters see the product catalog on `/requester/r_dashboard` and `/requester/requestform`.

### Request Creation

1. Requester opens the dashboard and selects a product, or opens the request form directly.
2. `requestform.jsx` loads products and requester profile data.
3. The form supports multiple products, quantity increments/decrements, container choice, and water station choice.
4. Delivery date defaults to the current date formatted as `MM - DD - YYYY`.
5. The summary modal shows products and total cost.
6. Confirming calls `createRequest`.
7. The request starts as `status: "Pending"`.
8. The requester is sent back to `/requester/r_dashboard`.

### Current Request Filtering

Requester dashboard "Current Request" uses `subscribeRequesterCurrentRequests`, which filters out requests whose normalized status is:

```text
cancelled
canceled
delivered
rejected
```

All other statuses are considered current.

## Order Lifecycle

The currently implemented persisted lifecycle is:

```text
Pending -> Cancelled
```

Details:

- Requests are created as `Pending`.
- Requesters may cancel only `Pending` requests.
- Cancelling writes `status: "Cancelled"`, `updated_at`, and `canceled_at`.
- Cancelled requests are removed from the requester dashboard current list but still appear in request history.

The UI implies a longer future lifecycle:

```text
Pending -> Accepted/Approved -> Scheduled -> Out for delivery -> Delivered
```

However, the distributor pages that show accepting, scheduling, delivery, history, and notifications currently use hard-coded arrays or static messages. They do not update Firestore request status yet.

## Distributor Workflow

Implemented:

1. Sign up as distributor.
2. Wait for admin approval.
3. Login after approval.
4. Access protected distributor route group.
5. View profile data from `users/{uid}`.
6. Logout.

Mocked/static:

- Current request card on `d_dashboard.jsx`
- Pending request list on `d_requests.jsx`
- Scheduled request list on `d_scheduled_requests.jsx`
- History list on `d_history.jsx`
- Delivered notification on `d_notification.jsx`
- "Accept request" and "Deliver request" buttons have no Firestore behavior

## Admin Workflow

1. Login with secret admin credentials.
2. Admin dashboard:
   - Shows registered user count.
   - Shows product sales as the sum of request quantities.
   - Shows station count using default stations plus request `water_station` values.
   - Lists approved distributors.
   - Can remove a distributor by marking them rejected.
3. Products page:
   - Lists products.
   - Supports search by product name.
   - Adds/edits products.
   - Deletes products.
4. Request page:
   - Lists pending distributor applications.
   - Accepts distributor applications.
   - Rejects distributor applications with a required rejection reason.
5. Logout clears local role sessions and signs out Firebase Auth when present.

Admin currently does not manage customer water requests, assign orders, or update order status.

## Requester Workflow

1. Sign up as requester.
2. Profile is saved with approved requester status.
3. User is routed to `/requester/r_dashboard`.
4. Dashboard:
   - Shows products from Firestore/local cache.
   - Lets requester start an order for a selected product.
   - Shows current requests for the logged-in requester.
   - Lets requester cancel pending current requests.
5. Request form:
   - Loads requester info.
   - Adds one or more products.
   - Calculates total quantity and total cost.
   - Submits a pending request.
6. Request history:
   - Lists requester requests.
   - Shows details and total cost in a modal.
7. Profile:
   - Displays cached/local/Firestore profile data.
   - Lets requester edit full name, phone, and address.
   - Saves locally first, then attempts Firestore update.
8. Notifications and BlueTap AI:
   - UI exists but content is currently static.

## Known Limitations

- Admin credentials are hard-coded in the client (`bluetapadmin` / `12345678`).
- Role protection is client-side. Real security must be enforced with Firebase Auth custom claims, server-side checks, and Firestore/Storage security rules.
- Firebase config is committed in `firebase.js`.
- No Firestore rules or Storage rules are included in this repo.
- Distributor request handling is not connected to Firestore. Accepting, scheduling, delivering, and history are not implemented.
- Order assignment to distributors or water stations is not implemented.
- Customer order status transitions beyond `Pending -> Cancelled` are not persisted.
- Notifications are static for both requester and distributor.
- BlueTap AI is a static helper screen, not an AI/chat integration.
- Product image upload depends on `globalThis.document`, so it works only in a web browser admin flow.
- Local fallback behavior is optimistic but not a full sync queue. Locally saved requests/products may diverge from Firestore.
- In non-web React Native environments, `localStorage` may not exist; the fallback is in-memory and will not survive app restarts.
- Distributor removal marks the Firestore profile as rejected but does not delete the Firebase Auth account.
- Admin dashboard metrics are simple aggregates, not analytics-grade reporting.
- Search inputs on some admin pages are visual only or partially implemented.
- Some UI text appears with encoding artifacts in source files, such as checkmarks or icons rendered as mojibake.
- There are no automated tests in the repo.
- Error handling is mostly user alerts and console logs; there is no central logging/monitoring.
- Several pages duplicate layout/sidebar/bottom-nav code instead of sharing components.
