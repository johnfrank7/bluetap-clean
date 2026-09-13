# Vercel-to-Render API migration map

Render preserves every existing path and JSON contract through the route table
in `backend/routes/index.js`. Expo web, Android, and iOS now call the Render Node
backend directly. The root Vercel `api/` files remain temporarily for rollback
and can be removed only after deployed smoke testing and explicit approval.

| Existing and Render path | Method | Implementation | Authentication or trust boundary | Server environment | Frontend call site | Migration status |
|---|---|---|---|---|---|---|
| `/api/auth/check-username` | POST | `backend/username/usernameHandler.js` (`check`) | Public validated username | Firebase Admin variables | `services/usernameAuth.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/login-with-username` | POST | `backend/username/usernameHandler.js` (`login`) | Credentials verified through Firebase; IP rate limit | Firebase Admin variables, `FIREBASE_WEB_API_KEY`, `EMAIL_OTP_HASH_SECRET` | `services/usernameAuth.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/create-registration-session` | POST | `backend/registration/registrationSessionHandler.js` (`create`) | Public validated data; opaque server session | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/registration-session-status` | POST | `backend/registration/registrationSessionHandler.js` (`status`) | Opaque registration session ID | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/start-registration-face-verification` | POST | `backend/registration/registrationSessionHandler.js` (`start`) | Opaque session; public bypass remains disabled | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | No active client caller | Render available; obsolete Vercel wrapper retained |
| `/api/auth/accept-registration-terms` | POST | `backend/registration/registrationSessionHandler.js` (`terms`) | Opaque registration session ID | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/request-registration-otp` | POST | `backend/registration/registrationHandler.js` (`request`) | Verified face/session and accepted terms | Firebase Admin variables, Resend variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/complete-registration` | POST | `backend/registration/registrationHandler.js` (`complete`) | Signed challenge and correct OTP | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/request-email-otp` | POST | `backend/auth/otpHandler.js` (`request`) | Revocation-checked Firebase bearer token | Firebase Admin variables, Resend variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/auth/verify-email-otp` | POST | `backend/auth/otpHandler.js` (`verify`) | Revocation-checked Firebase bearer token | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/verification/verify-face` | POST | `backend/verification/faceVerification.js` | Opaque session; backend controls state | Firebase Admin variables, `DEEPFACE_API_URL`, `DEEPFACE_API_KEY` | `services/faceVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/verification/registration-face` | POST | `backend/verification/registrationFaceHandler.js` | Opaque session and server-issued challenge; `web-complete` remains backend-verified and fail closed | Firebase Admin variables, `DEEPFACE_API_URL`, `DEEPFACE_API_KEY` | `services/faceVerification.js` | Render authoritative; Vercel wrapper retained |
| `/api/admin/registration-security` | GET, PATCH | `backend/admin/registrationSecurityHandler.js` | Firebase ID token, admin custom claim, and Firestore admin role | Firebase Admin variables | `services/adminRegistrationSecurity.js` | Render authoritative; Vercel rewrite retained temporarily |

Firebase Admin variables means `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`. Resend variables means server-only `RESEND_API_KEY` and
`EMAIL_FROM_ADDRESS`; `EMAIL_PROVIDER=resend` may be set explicitly. No frontend
file reads these values.

`GET /health` is new on Render and uses no authentication, Firebase connection, or
external service. All API routes also support CORS preflight with `OPTIONS`.

## Switchover state

- `services/apiClientConfig.js` is the shared frontend base-URL resolver.
- Web and native use `EXPO_PUBLIC_API_BASE_URL` and default to
  `https://bluetap-clean.onrender.com`.
- The protected Python face API remains server-only behind the Node backend.
- Vercel wrappers are retained only until deployed Render smoke tests complete
  and their deletion is explicitly approved.
