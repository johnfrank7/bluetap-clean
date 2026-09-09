# Registration face verification

Native continuation: [NATIVE_FACE_CHALLENGE.md](NATIVE_FACE_CHALLENGE.md) documents
the installed SDK-54-compatible ML Kit detector, on-device head-turn evaluation,
disabled blink sampling, and custom-build requirements. Native local motion can
now be evaluated; trusted server-side liveness confirmation is still unavailable.
The details below describe the existing server/web integration.

Status: camera/challenge orchestration and the source-matched Render adapter are
implemented. **Liveness detection is not implemented. Production registration
remains blocked.** No timer, button, client status, or pairwise result can bypass it.

## Frontend and challenge flow

Expo SDK 54 `expo-camera` supplies CameraView and camera permissions on web,
Android, and iOS. Expo's existing file-system dependency is declared directly so
native temporary capture files can be deleted. Camera preview was tested in
headless Edge with a simulated camera; physical Android/iOS cameras still need
manual testing. Native builds must be rebuilt for the camera config plugin.
Web camera use requires a secure context (HTTPS or localhost).

`RegistrationFaceCapture` mounts the front camera only during capture, handles
permission denial/camera errors, and unmounts on cancel/back/background. It never
loads a gallery photo. A server-issued UUID challenge randomly requests a left or
right head turn and expires after two minutes. Three evidence frames represent
neutral, requested head turn, and return to neutral. Timing only spaces frames;
a trusted detector must evaluate motion, exactly one face, continuous identity,
and replay/spoof resistance. Three frames may be insufficient for a robust detector;
the evidence format must be adapted and validated with the chosen detector.

`server/livenessDetector.js` is explicitly unavailable and throws 503. It has no
client override or environment switch that can manufacture success. A real
server-side detector must replace this boundary and honor the abort signal.
There is no native ML Kit detector in the app and SFace/YuNet is not liveness.
Current UI allows camera positioning but disables the challenge when unavailable.

After a trusted challenge pass, the app captures the final clear photo. The server
checks its pairwise match against the last detector-evaluated neutral frame. A
SHA-256 hash binds that reference to the issued challenge without storing its image.
Then it searches for duplicates and enrolls only a clear result.

## Vercel endpoints and trust

`POST /api/verification/registration-face` accepts JSON:

* `action: begin`, `registrationSessionId`: issues a challenge or returns existing
  fully verified state. Ten challenges/session, ten seconds between starts.
* `action: evaluate`, session ID, `challengeId`, `frames`: three JPEG/PNG data URLs.
  Only the server detector can move the challenge from issued to passed.
* `action: complete`, session ID, challenge ID, `referenceImage`, `image`: binds
  the last challenge frame to the final capture, searches, then enrolls.

Images are bounded to 1 MiB decoded each with signature/base64 validation; Render
fully decodes them. Requests have a 40-second server deadline, 55-second client
limit, and 60-second Vercel function duration. Retries are manual. HTTP errors,
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

Only clear duplicate search plus enrollment success after trusted liveness sets
`status:verified`, a Firestore server timestamp, `duplicateCheck:clear`,
`livenessPassed:true`, the enrollment reference, `model:SFace`, and
`detectorBackend:yunet`. Possible matches store review_required/flagged. Liveness
failure stores failed/liveness_failed. Upstream unavailability leaves unverified.

No raw image, base64, vector, or embedding is stored in Firestore. Photos exist
in request memory. Expo Camera creates a native cache file; capture deletes it in
a finally block. Abrupt process termination before cleanup can leave an OS cache
file; there is no gallery save or permanent image store. Render closes its spooled
temporary upload files. Dedicated Render storage currently contains embeddings in
`face-data/embeddings.json`, separate from BlueTap user/session documents.

After OTP, existing account creation revalidates the session and copies only
allowlisted metadata into users/{uid}, records userUid on the completed session,
and preserves the session enrollment reference in the user profile. That reference
is the durable BlueTap-side association. Render has no rebind endpoint, so its
subject remains the session ID; no invented rebind call is made. Successful signup
does not request another face check.

Firebase client rules must deny reads/writes to registrationSessions and
faceServiceLocks (alongside the existing private auth collections). No rules source
is present here, so deployed Firebase rules were not verified.

## Remaining face-service work before enabling registration

1. Implement and validate a real active liveness detector with replay resistance;
   the current runtime explicitly has ANTI_SPOOFING=False.
2. Make embedding storage durable. The source hardcodes a relative JSON file and
   rewrites it directly; no persistent-volume configuration was found. Persistence
   across Render restarts/deploys is not established.
3. Add atomic/crash-safe storage and cross-process uniqueness. The current lock
   protects only one Python process, not multiple workers or instances.
4. Add idempotent enrollment/status lookup and orphan cleanup. Retrying an existing
   enrollment currently finds its own face as a duplicate before replacement. A
   Vercel timeout after sending enrollment leaves faceEnrollmentPending and blocks
   automatic retries until reconciliation; no success is guessed.
5. Add abandoned-session enrollment expiry/removal. Signup can be abandoned before
   OTP, and the current service has no delete/expiry route.
6. Optionally add a server-only reference-to-UID rebind route. None exists now.
7. Add typed response schemas and HTTP integration tests. Existing Python tests
   cover image processing, model loading, and local embedding storage; they do not
   establish deployed persistence or a complete enrollment lifecycle.

## Verification

Server tests use injected detector/Render fixtures to cover successful sequencing,
no/multiple faces, failed challenges, duplicate review, enrollment races, outages,
uncertain enrollment, expiry/replay, reference substitution, and safe final UID
binding. They do not establish actual liveness accuracy or live biometric success.

The headless Edge test uses fake camera media and mocked session/challenge routes:
video opens, unavailable liveness disables challenge and Continue, cancel closes
camera, and reload returns to unverified signup without enrollment calls. A second
browser test captured real JPEGs from simulated camera media, mocked a trusted
challenge pass, checked final capture/enrollment request ordering, and reached
Credentials after mocked enrollment success. This is not a real detector test. Expo
web, Android, and iOS bundle exports pass; physical-device permission/capture tests
remain pending. No live biometric uploads or enrollment mutations were performed.
There is no lint script configured. Frontend/bundle scans must remain free of
Render secrets and direct Render URLs.

Final checks: 49 server tests passed; both Vercel face route modules load; web,
Android and iOS exports passed; both simulated-camera browser checks passed;
frontend and generated-bundle scans found no Render URL or server-variable names.

## Files changed in this continuation

* Camera UI/config: `app/signup.jsx`, `components/RegistrationFaceCapture.jsx`,
  `app.json`, `package.json`, `package-lock.json`.
* Client flow: `services/faceVerification.js`, `services/cameraCapture.js`,
  `services/faceCaptureFlow.js`.
* Backend: `api/verification/registration-face.js`, `server/registrationFace.js`,
  `server/registrationFaceHandler.js`, `server/renderFaceClient.js`,
  `server/livenessDetector.js`, `server/registrationSession.js`,
  `server/registration.js`.
* Verification/docs: `server/registrationFace.test.js`,
  `server/registration.test.js`, `server/README.md`, `server/FACE_VERIFICATION.md`.
