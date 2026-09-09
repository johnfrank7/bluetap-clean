# Render face integration

The Vercel route is `POST /api/verification/verify-face`. Its JSON body accepts
`registrationSessionId`, `referenceImage`, and `probeImage`. Each image must be a
base64 JPEG/PNG data URL, at most 1 MiB decoded. MIME signatures and encoding are
checked locally; Render decodes the image and validates face detection.

The server reads `DEEPFACE_API_URL` and `DEEPFACE_API_KEY`, checks `/ready`, then
sends multipart `image1` (reference) and `image2` (current probe) to `/verify-face`
with bearer authentication. Only those images are forwarded. No keys, images,
embeddings, identities, or upstream diagnostic bodies are logged or returned.
The shared upstream timeout is 40 seconds; the client timeout is 55 seconds and
the Vercel function duration is 60 seconds. Retry is manual, limited to ten
attempts/session with 45 seconds between attempts.

Session IDs must be UUID v4, exist in `registrationSessions`, be uncompleted, and
not expired. Expiry/completion/review flags are checked again transactionally
before saving the result. The random session ID is a bearer capability: do not
publish it. Production Firebase rules must deny client access to this collection;
there is no rules source in this repository, so deployed rules were not verified.

Only a boolean `verified` from Render determines verified/failed. Success records
a Firestore server timestamp and allowlisted comparison metadata. Liveness remains
null and duplicate check unknown. Account creation copies safe metadata, never
photos, and does not manufacture liveness or duplicate clearance. Temporary status
no longer permits signup, terms acceptance, or OTP. Existing username, email OTP,
terms, and distributor approval logic otherwise remains in place.

## Observed deployed contract and remaining work

On 2026-09-10, public `https://bluetap-face-api.onrender.com/openapi.json` showed:

* `/verify-face`: multipart `image1`, `image2`, bearer authentication.
* `/check-duplicate`: multipart `image`, bearer authentication.
* `/enroll-face`: multipart `subject_id`, `image`, bearer authentication.
* `/ready`: observed `status: ready`, `modelLoaded: true`, SFace/YuNet.

The comparison is pairwise, not identification or proof of liveness. Both client
photos are untrusted; a pairwise match does not establish a real-world identity.
No capture or reference/enrollment source exists in the current BlueTap UI.
Signup calls the proxy but receives `face-reference-required` and cannot continue.
Do not send the same selfie twice or invent a reference to bypass this condition.

Duplicate/enrollment endpoints exist, but their OpenAPI response schemas are empty.
They are not wired into registration: their response contract, persistence,
subject lifecycle, and atomic duplicate-check/enrollment behavior still require
verification from the Render source or authenticated integration fixtures. Reuse
those existing routes when implementing enrollment; do not invent replacements.
No live biometric POSTs or enrollment mutations were performed for this change.

Remaining work: implement capture and a meaningful reference source, confirm the
duplicate/enrollment contracts and durable database, bind enrollment to completed
BlueTap users without retaining images in profiles, and add a separate liveness
implementation if required. Existing-account verification also needs a separate
authenticated handoff; registration sessions must not be repurposed for it.

Redeploy Vercel frontend and API routes together to activate this code. The existing
production Render variables remain server-only. **Registration will remain blocked
at the face step until capture/reference integration is implemented.**
