# Registration face verification

Current Android/iOS device instructions and framing checks:
[MOBILE_FACE_TESTING.md](../mobile/MOBILE_FACE_TESTING.md). Web is the primary
capstone registration flow: it opens the browser's front-facing camera, captures
two short-interval JPEG frames, and sends them only to the BlueTap backend.

Native continuation: [NATIVE_FACE_CHALLENGE.md](NATIVE_FACE_CHALLENGE.md) documents
the installed SDK-54-compatible ML Kit detector, on-device head-turn evaluation,
disabled blink sampling, and custom-build requirements. Android and iOS retain
that native-only implementation for future development.

Status: web camera capture, server-side pair verification, and duplicate search
are implemented. Capture sets `passed_pending_finalization`; it creates no Render
enrollment. The Vercel registration finalizer enrolls only after OTP, Firebase
Auth, and the user profile succeed.
This is a capstone capture check, not production-grade presentation-attack or
active liveness detection.

## Frontend and challenge flow

On web, `WebRegistrationFaceCapture.web.jsx` uses
`navigator.mediaDevices.getUserMedia` with a user-facing camera preference. It
requests permission only after the user starts the check, shows a live preview
with an oval guide, stops all media tracks on cancel, unmount, and capture, and
works in a secure context (HTTPS or localhost). Camera-denied, unavailable, and
unsupported-browser states stay blocked with a retry message.

Expo Camera and the native ML Kit flow remain in `RegistrationFaceCapture.jsx`
for Android and iOS. Native builds must be rebuilt for the camera config plugin.

The web component waits for a short stable preview, captures two compressed JPEG
frames about 700 ms apart, removes the stream, and calls the server. It does not
use gallery input or browser storage. The oval and stable hold are positioning aids;
the browser does not claim to detect face count, centering, or spoofing. The
protected face service validates usable images and performs the pair and duplicate
checks before enrollment.

Native uses the existing server-issued left/right challenge. Its three evidence
frames represent neutral, requested head turn, and return to neutral. That native
path is unchanged and still requires a trusted detector.

`backend/verification/livenessDetector.js` remains explicitly unavailable. It has
no client override or environment switch that can manufacture a native challenge
pass. SFace/YuNet pair matching and duplicate search are not active liveness.
The web capture route is therefore documented as a capstone identity/duplicate
check, not proof against presentation attacks.

After a native challenge pass, the server binds the final image to the detector
reference with a SHA-256 hash. The web route instead accepts two fresh browser
captures while the server-issued session challenge is in `issued` state. Both paths
perform the same protected pair check, duplicate search, and enrollment before a
clear session can proceed.

## BlueTap backend endpoints and trust

`POST /api/verification/registration-face` accepts JSON:

* `action: begin`, `registrationSessionId`: issues a challenge or returns existing
  fully verified state. Ten challenges/session, ten seconds between starts.
* `action: evaluate`, session ID, `challengeId`, `frames`: three JPEG/PNG data URLs.
  Only the server detector can move the challenge from issued to passed.
* `action: complete`, session ID, challenge ID, `referenceImage`, `image`: binds
  the last challenge frame to the final capture and searches finalized faces.
* `action: web-complete`, session ID, challenge ID, `referenceImage`, `image`:
  accepts two browser camera JPEG data URLs for the issued session challenge, then
  performs the same server-side match and duplicate search. It does
  not accept client verification fields.

Images are bounded to 1 MiB decoded each with signature/base64 validation; Render
fully decodes them. Requests have a 40-second server deadline, 55-second client
limit, and bounded host request duration. Retries are manual. HTTP errors,
malformed results, service preparation, failed challenges, expiry and replay all
fail closed. Raw upstream errors and identity fields are never returned.

The existing `/api/verification/verify-face` pairwise proxy and its validation,
readiness check, authentication and metadata behavior remain in place. **Pairwise
status alone no longer qualifies a registration for terms acceptance or OTP.**

Both endpoints use `DEEPFACE_API_URL` and `DEEPFACE_API_KEY` only on the server.
The session must be an existing, unexpired, uncompleted UUID v4 registration
session. State changes use Firestore transactions and single-use challenge states.
A Firestore `faceServiceLocks/enrollment` lease serializes this app's search/enroll
calls; Render also rechecks duplicates inside enrollment under its process lock.

## Actual Render contract inspected from source

Inspected these files in the separate project
`C:/Users/HOME/Documents/CAPSTONE/bluetap-face-api`: `app.py`, `face_service.py`,
`runtime.py`, `image_utils.py`, `preload.py`, `requirements.txt`, and both test files.
No files in that project were changed. Its route bodies, not empty OpenAPI schemas,
are the authority for the adapter. The local source matches the live request
schema, but its exact deployed revision has not been independently verified.

All POSTs use bearer authentication and multipart bodies:

| Route | Fields | Actual result |
| --- | --- | --- |
| `/verify-face` | `image1`, `image2` | `verified`, `distance`, `threshold`, `model`, `detector_backend`, `similarity_metric` |
| `/check-duplicate` | `image` | `duplicateDetected`, `distance` (null for empty database), `threshold`, `reviewRequired` |
| `/enroll-face` | `subject_id`, `image` | Success: `enrolled:true`, `duplicateDetected:false`, `reviewRequired:false`; duplicate: `enrolled:false` plus duplicate result fields |

The duplicate route does not return `duplicate` or `similarity`. Enrollment does
not return a reference or echo subject_id. BlueTap uses its server-selected
registrationSessionId as both subject_id and verificationReference. Enrollment
repeats duplicate search itself, so a new match at enrollment also requires review.

## Metadata, storage, and final Firebase binding

Only clear duplicate search sets temporary `status:passed_pending_finalization`.
After OTP and account/profile creation, final enrollment sets `status:verified`,
a Firestore server timestamp, `duplicateCheck:clear`, the final UID enrollment reference,
`model:SFace`, and `detectorBackend:yunet`. The existing `livenessPassed` field
also remains true for a server-approved `web-camera-capture` session so the
existing registration gate remains compatible; it means the capture workflow was
approved by the backend, not that active presentation-attack liveness was proven.
Possible matches store review_required/flagged. Upstream unavailability leaves the
session unverified.

No raw image, base64, vector, or embedding is stored in Firestore. Photos exist
in request memory. Expo Camera creates a native cache file; capture deletes it in
a finally block. Abrupt process termination before cleanup can leave an OS cache
file; there is no gallery save or permanent image store. Render closes its spooled
temporary upload files. Dedicated Render storage currently contains embeddings in
`face-data/embeddings.json`, separate from BlueTap user/session documents.

After OTP, account creation revalidates the session, creates a profile marked
`face_enrollment_pending`, and the trusted Vercel backend enrolls the final
capture with `subject_id` set to the Firebase UID. Only enrollment success marks
the profile/session complete. If final enrollment fails, protected access remains
blocked and the account requires safe operational recovery; it is never presented
as fully verified. Raw captures remain in process memory only and are never stored
in Firestore.

Firebase client rules must deny reads/writes to registrationSessions and
faceServiceLocks (alongside the existing private auth collections). No rules source
is present here, so deployed Firebase rules were not verified.

## Remaining face-service work before enabling registration

1. Implement and validate a real active liveness detector with replay resistance;
   the current runtime explicitly has ANTI_SPOOFING=False. This is required before
   calling the web capture flow production-grade biometric verification.
2. Make embedding storage durable. The source hardcodes a relative JSON file and
   rewrites it directly; no persistent-volume configuration was found. Persistence
   across Render restarts/deploys is not established.
3. Add atomic/crash-safe storage and cross-process uniqueness. The current lock
   protects only one Python process, not multiple workers or instances.
4. Add idempotent enrollment/status lookup and orphan cleanup. Retrying an existing
   enrollment currently finds its own face as a duplicate before replacement. A
   A hosting timeout after sending enrollment leaves faceEnrollmentPending and blocks
   automatic retries until reconciliation; no success is guessed.
5. Add a protected list/delete-by-subject endpoint for historical orphan cleanup.
   New sessions create no Render enrollment before OTP. The dry-run tool
   `scripts/cleanup-orphaned-faces.js` identifies legacy orphan candidates but
   deliberately refuses `--apply` until this verified Render contract exists.
6. Optionally add a server-only reference-to-UID rebind route. None exists now.
7. Add typed response schemas and HTTP integration tests. Existing Python tests
   cover image processing, model loading, and local embedding storage; they do not
   establish deployed persistence or a complete enrollment lifecycle.

## Verification

Server tests use injected detector/Render fixtures to cover native challenge
sequencing, web capture completion, rejected pairs, duplicate review, enrollment
races, outages, expiry/replay, and safe final UID binding. They do not establish
browser hardware compatibility, actual liveness accuracy, or live biometric success.

No physical browser-camera, Android, or iOS camera test was performed in this
workspace. Expo web, Android, and iOS bundle exports passed in this workspace.
Frontend/bundle scans must remain free of Render secrets and direct face-service URLs.

## Relevant implementation files

* Web camera UI: `components/WebRegistrationFaceCapture.web.jsx`
* Shared platform/gate helpers: `services/webFaceCaptureCore.js`
* Native camera and ML Kit flow: `components/RegistrationFaceCapture.jsx`,
  `services/nativeFaceChallenge.native.js`
* Client endpoint calls: `services/faceVerification.js`
* Trusted server completion: `backend/verification/registrationFace.js` and
  `backend/verification/registrationFaceHandler.js`
