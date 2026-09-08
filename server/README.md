# BlueTap OTP on Vercel

The active API is `POST /api/auth/request-email-otp` and
`POST /api/auth/verify-email-otp`. Vercel discovers the two root `api/auth/*.js`
Node handlers. `vercel.json` checks the filesystem (including Functions) before
the Expo SPA fallback. Unknown API paths return 404, not the Expo HTML page.
No Firebase Cloud Functions deployment or Blaze upgrade is needed for this OTP backend.
The legacy `functions/` directory and `firebase.json` are not used by Vercel.

## Existing Production environment

Keep the existing Vercel values: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`,
`EMAIL_OTP_HASH_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`. The service account must belong to the same Firebase
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
Then use signup with the Resend account owner's email and enter the received
code. Check wrong codes, expiry, resend cooldown, and successful Firebase Auth
email verification followed by `/verification`. Authenticated real delivery
requires the deployed environment and cannot be proven by a local Expo build.

`EMAIL_FROM_ADDRESS` remains `BlueTap <onboarding@resend.dev>` as configured.
Resend's development sender only permits testing to the Resend account owner's
email. Other recipients receive a clear test-mode error and remain unverified.
No custom domain or sender changes are performed by this code.

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
Signup still creates a Firebase account before OTP as required by the ID-token flow.

Run `node --test server/emailOtp.test.js` for isolated server security tests,
and `npm run build` for Expo web compilation. No live emails are sent by the tests.
