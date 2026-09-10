# BlueTap Render backend

BlueTap now has a Render-compatible Node entrypoint at `backend/app.js`. It exposes
the same `/api/...` paths and delegates to the same tested backend modules used by
the Vercel handlers. `GET /health` returns `{ "status": "ok" }` without contacting
Firebase, Gmail, or the face service.

This is the first migration pass. The root `api/` handlers remain active Vercel
fallbacks until the Render deployment has passed production smoke testing. They are
not proxies and do not call Render; both hosts currently execute the shared modules
under `backend/`. The legacy `functions/` directory remains inactive.

## Endpoint map

All API endpoints accept `OPTIONS` and otherwise require `POST`, except `/health`.

| Endpoint | Authentication/trust | Main dependencies |
|---|---|---|
| `GET /health` | None | None |
| `POST /api/auth/check-username` | Public validated body | Firestore username registry |
| `POST /api/auth/login-with-username` | Public credentials; rate limited by IP | Firebase Admin, Firebase Auth REST API |
| `POST /api/auth/create-registration-session` | Public validated personal-info digest | Firestore, session HMAC |
| `POST /api/auth/registration-session-status` | Opaque registration session ID | Firestore, session HMAC |
| `POST /api/auth/start-registration-face-verification` | Opaque registration session ID; fails closed | Firestore |
| `POST /api/auth/accept-registration-terms` | Opaque registration session ID | Firestore |
| `POST /api/auth/request-registration-otp` | Verified session, accepted terms, email and username | Firebase Admin, Firestore, Gmail SMTP, HMAC |
| `POST /api/auth/complete-registration` | Signed challenge and correct OTP | Firebase Admin/Auth, Firestore |
| `POST /api/auth/request-email-otp` | Revocation-checked Firebase bearer token | Firebase Admin, Firestore, Gmail SMTP, HMAC |
| `POST /api/auth/verify-email-otp` | Revocation-checked Firebase bearer token | Firebase Admin/Auth, Firestore, HMAC |
| `POST /api/verification/verify-face` | Opaque registration session ID | Firebase Admin, protected DeepFace service |
| `POST /api/verification/registration-face` | Opaque session and server-issued challenge | Firebase Admin, protected DeepFace service, liveness boundary |

## Render environment

Configure these values in the Render service dashboard. `backend/.env.example`
contains names only.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | Set to `production` on Render |
| `PORT` | Supplied by Render; the server defaults to `3000` locally |
| `ALLOWED_ORIGINS` | Comma-separated Vercel production/preview origins allowed by browser CORS |
| `FIREBASE_PROJECT_ID` | Firebase Admin project |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key; escaped newlines are normalized |
| `FIREBASE_WEB_API_KEY` | Firebase Auth REST API key used only for username/password verification |
| `GMAIL_USER` | Gmail SMTP account and sender |
| `GMAIL_APP_PASSWORD` | Gmail application password |
| `EMAIL_OTP_HASH_SECRET` | HMAC secret for OTPs, sessions, challenges, and rate-limit identifiers |
| `DEEPFACE_API_URL` | HTTPS origin of the separate protected face service |
| `DEEPFACE_API_KEY` | Bearer credential sent only from this backend to the face service |

Never create `EXPO_PUBLIC_` versions of server credentials.

## Frontend environment

Set `EXPO_PUBLIC_API_BASE_URL` to the public Render origin, without a trailing
slash, after Render is deployed, for example `https://<service>.onrender.com`.
This value is public and contains no credential. If it is absent, Expo web keeps
using same-origin `/api` Vercel fallbacks. Native builds fail safely without it.

## Deployment and testing

The committed Render Blueprint uses:

```text
Build command: npm ci
Start command: npm run start:backend
Health check: /health
```

Configure every server variable, deploy, confirm `/health`, then smoke-test each
JSON endpoint before setting the frontend public base URL. Keep the Vercel server
variables during this migration pass because its fallback handlers remain active.
Authenticated email delivery and live Firebase/DeepFace behavior require the
deployed environment and are not proven by fixture-based local tests.

Both request handlers import `sendEmailOtp` from `backend/email/emailProvider.js`.
That shared server-only helper uses Nodemailer with `smtp.gmail.com`, port 465,
TLS enabled, and sender `BlueTap <${process.env.GMAIL_USER}>`. There is no Resend
fallback. Gmail authentication/delivery failures return a generic 503; server logs
contain only allowlisted error categories and numeric SMTP status codes, not raw
responses, credentials, recipients, or OTPs. SMTP acceptance is not proof of inbox delivery.
Redeploy Production after installing Nodemailer and configuring the Gmail variables.
The legacy Firebase `functions/emailProvider.js` still uses Resend, but is not imported
by the active shared backend and is not deployed by Render or Vercel. It is retained unchanged.

## Security and limits

Requests require a Firebase ID token; Admin verifies it (including revocation)
and reads the account's current email. Browser-supplied emails and UIDs are ignored.
OTP generation uses crypto.randomInt, hashes use HMAC-SHA256 bound to UID and email,
and comparisons use timingSafeEqual. Plaintext codes are only in memory for delivery.
Private records live at `emailOtpVerifications/{uid}` for ten minutes, with five
incorrect attempts, a 60-second send cooldown, and six send reservations per hour
(first send plus five resends). Failed sends count too. Invalidating a code clears
its hash but retains rate-limit metadata, so expiry/lockout cannot reset the limit.
Resends invalidate prior codes immediately. Provider failures leave no active code.
Only Admin updates Firebase Auth emailVerified; the client reloads Auth and refreshes
its ID token before continuing. Profile emailVerified fields are not authoritative.

There is no firestore.rules file in this repository. Before live use, check the
existing console rules deny ALL client access to emailOtpVerifications, including
any broad wildcard allows. An explicit deny does not override a matching allow:

```
match /emailOtpVerifications/{document=**} {
  allow read, write: if false;
}
```

No app collection rules were replaced. Existing face verification, distributor
approval and admin code remain unchanged. Face verification is a separate existing
integration; this OTP backend does not configure it or mark faces verified.
## Registration before account creation

Before email OTP, signup creates a 60-minute opaque registration session through
`POST /api/auth/create-registration-session`. The session stores a digest of the
personal details and server-owned face-verification/terms state, not the plaintext
personal details or credentials. The former public start placeholder now fails closed.
The server-side adapter at `POST /api/verification/verify-face` owns pairwise results;
see [FACE_VERIFICATION.md](../verification/FACE_VERIFICATION.md) for the contract and remaining
liveness/storage work. Signup uses `/api/verification/registration-face` and cannot
continue without a detector-validated challenge and successful unique enrollment.

The OTP request requires trusted face status `verified`, provider verification,
liveness true, duplicate clear, an enrollment reference, and server-recorded
Terms/Privacy acceptance. Signup uses
`POST /api/auth/request-registration-otp` with the email, username, and session ID.
No Auth account or `users` profile is created at this point. Private pending OTP
records share the locked-down `emailOtpVerifications` collection, keyed by an HMAC
of the normalized email. Only OTP hashes and delivery/rate-limit metadata are saved.
A signed, expiring registration challenge is returned; it is kept in memory with
the form details. Passwords are never persisted to browser storage, URLs, or Firestore.
Refreshing this screen restarts signup safely, leaving the email available.

`POST /api/auth/complete-registration` validates the challenge, submitted fields,
and OTP before creating the Firebase user with emailVerified true. Admin rechecks
the registration session in the final transaction, binds only safe verification
metadata, records versioned Terms/Privacy acceptance, completes the session, saves
the profile and counter, then issues a custom login token. Existing unverified
signups can recover after OTP verification without duplicate accounts; existing role,
approval and identity status are preserved. Already verified accounts and admin
profiles must use login/password reset. New distributor approval is always pending.
If a new profile write fails and the profile is confirmed absent, the newly created
Auth account is rolled back. Uncertain failures remain recoverable via OTP.

These two registration endpoints intentionally do not require an ID token because
the account does not exist yet. A correct email OTP plus signed challenge is required
to complete registration. Email rate limits remain six sends/hour, and public signup
is additionally limited to 20 send requests/IP/hour using the hosting proxy's forwarded client
IP. IP identifiers are HMAC hashed; no raw IPs are stored. Existing signed-in users
continue using the two authenticated email-OTP routes.

Deploy the Render service before switching the frontend public base URL. No new
secrets are required for the session layer itself; the chosen face
verification provider may require its own server-only configuration.
This fixes registration writes through Admin; other app screens still require
appropriate Firestore rules for their normal client reads and writes.

There is no `firestore.rules` source in this repository. Before deployment, the
Firebase Console rules must deny all client reads/writes to `registrationSessions`,
`usernameReservations`, `emailOtpVerifications`, and `authRateLimits`. Do not add
an isolated deny to a broad wildcard allow: any matching allow grants access.

Run `npm test` for the backend security and workflow tests,
and `npm run build` for Expo web compilation. No live emails are sent by the tests.

## Usernames

`POST /api/auth/check-username` performs a server-side normalized availability
check. Registration reserves `usernameReservations/{normalizedUsername}` for 15
minutes, then the OTP completion transaction creates `usernames/{normalizedUsername}`
with only `uid` and `createdAt`, writes the profile, and removes the reservation.
Passwords and emails are never stored in either username collection.

`POST /api/auth/login-with-username` resolves the UID through the registry, obtains
the Firebase Auth email through Admin, verifies the supplied password through the
official Firebase `accounts:signInWithPassword` REST endpoint, confirms the UID,
and returns only a custom token. Login attempts are limited per IP. Existing users
without username registry records retain temporary email/password login support.
