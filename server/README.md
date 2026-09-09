# BlueTap OTP on Vercel

The active API is `POST /api/auth/request-email-otp` and
`POST /api/auth/verify-email-otp`, plus the registration endpoints below. Vercel discovers the root `api/auth/*.js`
Node handlers. `vercel.json` checks the filesystem (including Functions) before
the Expo SPA fallback. Unknown API paths return 404, not the Expo HTML page.
No Firebase Cloud Functions deployment or Blaze upgrade is needed for this OTP backend.
The legacy `functions/` directory and `firebase.json` are not used by Vercel.

## Existing Production environment

Use server-only Vercel values: `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`EMAIL_OTP_HASH_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`, plus `FIREBASE_WEB_API_KEY` for username/password login.
The Web API key is the public Firebase project configuration value, kept centrally
in the server environment. The service account must belong to the same Firebase
project as the client (`bluetap-8c98d`) and have Auth and Firestore access.
Private key literal newline escapes are normalized on the server.
Do not put these credentials in Expo public environment variables or files.

The frontend uses same-origin URLs on production web. For native Expo builds and
local Expo web, set the non-secret `EXPO_PUBLIC_API_BASE_URL` to the deployed
backend origin, e.g. `https://bluetap-beta.vercel.app`, and restart/rebuild Expo.
Native builds fail safely if this public URL is missing. Local web can instead
run through Vercel's local environment to serve same-origin API routes.

## Deployment and testing

Deploy this repository to Vercel (the existing Expo build command and `dist`
output remain). Redeploy Production to pick up the new endpoints and configured
environment. Preview deployments need their own environment configuration if
they are used for testing; Production variables do not automatically apply there.
Check an unauthenticated POST returns JSON HTTP 401, not HTML or 404.
Then use signup with a recipient email and enter the received
code. Check wrong codes, expiry, resend cooldown, and successful Firebase Auth
email verification followed by `/verification`. Authenticated real delivery
requires the deployed environment and cannot be proven by a local Expo build.

Both request handlers import `sendEmailOtp` from `server/emailProvider.js`.
That shared server-only helper uses Nodemailer with `smtp.gmail.com`, port 465,
TLS enabled, and sender `BlueTap <${process.env.GMAIL_USER}>`. There is no Resend
fallback. Gmail authentication/delivery failures return a generic 503; server logs
contain only allowlisted error categories and numeric SMTP status codes, not raw
responses, credentials, recipients, or OTPs. SMTP acceptance is not proof of inbox delivery.
Redeploy Production after installing Nodemailer and configuring the Gmail variables.
The legacy Firebase `functions/emailProvider.js` still uses Resend, but is not imported
by any Vercel API route and is not deployed by the Vercel build. It is retained unchanged.

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
The Render proxy at `POST /api/verification/verify-face` owns pairwise results;
see [FACE_VERIFICATION.md](FACE_VERIFICATION.md) for the contract and remaining
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
is additionally limited to 20 send requests/IP/hour using Vercel's forwarded client
IP. IP identifiers are HMAC hashed; no raw IPs are stored. Existing signed-in users
continue using the two authenticated email-OTP routes.

Deploy the registration-session API routes, registration API updates, and frontend
together. No new secrets are required for the session layer itself; the chosen face
verification provider may require its own server-only configuration.
This fixes registration writes through Admin; other app screens still require
appropriate Firestore rules for their normal client reads and writes.

There is no `firestore.rules` source in this repository. Before deployment, the
Firebase Console rules must deny all client reads/writes to `registrationSessions`,
`usernameReservations`, `emailOtpVerifications`, and `authRateLimits`. Do not add
an isolated deny to a broad wildcard allow: any matching allow grants access.

Run `node --test server/emailOtp.test.js server/registration.test.js server/registrationSession.test.js server/usernameHandler.test.js` for isolated server security tests,
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
