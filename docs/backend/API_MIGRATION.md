# Vercel-to-Render API migration map

The first migration pass preserves every existing path and JSON contract. Render
serves the route table in `backend/routes/index.js`; the root Vercel `api/` files
remain active fallbacks that invoke the same implementation modules.

| Existing and Render path | Method | Implementation | Authentication or trust boundary | Server environment | Frontend call site | Migration status |
|---|---|---|---|---|---|---|
| `/api/auth/check-username` | POST | `backend/username/usernameHandler.js` (`check`) | Public validated username | Firebase Admin variables | `services/usernameAuth.js` | Render implemented; Vercel fallback active |
| `/api/auth/login-with-username` | POST | `backend/username/usernameHandler.js` (`login`) | Credentials verified through Firebase; IP rate limit | Firebase Admin variables, `FIREBASE_WEB_API_KEY`, `EMAIL_OTP_HASH_SECRET` | `services/usernameAuth.js` | Render implemented; Vercel fallback active |
| `/api/auth/create-registration-session` | POST | `backend/registration/registrationSessionHandler.js` (`create`) | Public validated data; opaque server session | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render implemented; Vercel fallback active |
| `/api/auth/registration-session-status` | POST | `backend/registration/registrationSessionHandler.js` (`status`) | Opaque registration session ID | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render implemented; Vercel fallback active |
| `/api/auth/start-registration-face-verification` | POST | `backend/registration/registrationSessionHandler.js` (`start`) | Opaque session; public bypass remains disabled | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `app/signup.jsx` through the registration service | Render implemented; Vercel fallback active |
| `/api/auth/accept-registration-terms` | POST | `backend/registration/registrationSessionHandler.js` (`terms`) | Opaque registration session ID | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/registrationSession.js` | Render implemented; Vercel fallback active |
| `/api/auth/request-registration-otp` | POST | `backend/registration/registrationHandler.js` (`request`) | Verified face/session and accepted terms | Firebase Admin variables, Gmail variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render implemented; Vercel fallback active |
| `/api/auth/complete-registration` | POST | `backend/registration/registrationHandler.js` (`complete`) | Signed challenge and correct OTP | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render implemented; Vercel fallback active |
| `/api/auth/request-email-otp` | POST | `backend/auth/otpHandler.js` (`request`) | Revocation-checked Firebase bearer token | Firebase Admin variables, Gmail variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render implemented; Vercel fallback active |
| `/api/auth/verify-email-otp` | POST | `backend/auth/otpHandler.js` (`verify`) | Revocation-checked Firebase bearer token | Firebase Admin variables, `EMAIL_OTP_HASH_SECRET` | `services/emailVerification.js` | Render implemented; Vercel fallback active |
| `/api/verification/verify-face` | POST | `backend/verification/faceVerification.js` | Opaque session; backend controls state | Firebase Admin variables, `DEEPFACE_API_URL`, `DEEPFACE_API_KEY` | `services/faceVerification.js` | Render implemented; Vercel fallback active |
| `/api/verification/registration-face` | POST | `backend/verification/registrationFaceHandler.js` | Opaque session and server-issued challenge; `web-complete` remains backend-verified and fail closed | Firebase Admin variables, `DEEPFACE_API_URL`, `DEEPFACE_API_KEY` | `services/faceVerification.js` | Render implemented; Vercel fallback active |

Firebase Admin variables means `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`. Gmail variables means `GMAIL_USER` and
`GMAIL_APP_PASSWORD`. No frontend file reads these values.

`GET /health` is new on Render and uses no authentication, Firebase connection, or
external service. All API routes also support CORS preflight with `OPTIONS`.

## Switchover state

- `services/apiClient.js` is the single frontend base-URL resolver.
- With `EXPO_PUBLIC_API_BASE_URL` set, calls go directly to Render.
- Without it, Expo web uses relative `/api` paths and continues through Vercel.
- Native builds require the public base URL and fail safely when it is absent.
- No Vercel route is ready for deletion until the deployed Render service passes
  health, endpoint, Firebase, Gmail, and protected face-service smoke tests.
