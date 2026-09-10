# Native challenge validation

For the current custom-development-client setup, permission configuration, framing
checks and exact device commands, see [MOBILE_FACE_TESTING.md](../mobile/MOBILE_FACE_TESTING.md).
The mobile continuation adds expo-dev-client and device build scripts; historical
inspection notes below describe the setup before that addition.

## Current implementation and remaining trust boundary

Android/iOS camera snapshots now run through actual on-device Google ML Kit face
detection. A local challenge pass is computed from native pose readings; neither
timers nor buttons grant a pass. This is prototype motion validation, not validated
presentation-attack detection. A replayed video may satisfy these checks.

After local validation, the app captures the final image and submits the retained
challenge images to the BlueTap backend evaluation endpoint. Only a trusted server
pass permits the final image to reach the existing duplicate/enrollment stage.
`backend/verification/livenessDetector.js` still reports unavailable: client observations and
client booleans cannot become trusted proof by posting them to an API. Therefore
**signup remains blocked at server confirmation**, even when native motion passes.
Finishing that boundary needs server-evaluated liveness evidence or a verifiable
provider attestation bound to the session/capture. Render recognition and the
existing signup/OTP security gates were not weakened or changed.

## Package and build requirements

The project uses Expo 54.0.37, React Native 0.81.5, New Architecture, and Expo Camera
17.0.10. It now includes the native face detector, `expo-dev-client`, stable native
identifiers, and an EAS internal-distribution development profile. No generated native
project is committed.

Installed and pinned `@infinitered/react-native-mlkit-face-detection` 5.0.0, with
its ML Kit core 5.0.0 dependency. The maintainer's compatibility table explicitly
maps Expo SDK 54 to ML Kit wrapper 5.x:
https://github.com/infinitered/react-native-mlkit#compatibility

This package wraps native Swift/Kotlin ML Kit and exposes image-URI detection:
https://docs.infinite.red/react-native-mlkit/face-detection/

It requires a custom native build; **it does not run in Expo Go**. Expo Go gets a
clear unavailable message through optional native-module lookup, not an import
crash. Standard Expo module autolinking resolves the face detector and its core for
both Android and iOS. No config plugin is needed for this module. The existing
Expo Camera plugin supplies camera permission configuration.

Build with `npx expo run:android --device` after installing/configuring the Android
SDK, or `npx expo run:ios --device` on macOS with Xcode/signing. The configured EAS
development profile can also create an internal-distribution development client.
A backend or web redeploy cannot install a native module on a phone; native binaries must
be rebuilt.

The maintainer recommends a physical iOS device rather than the simulator.
Both native platforms require actual-device testing before claiming support is
verified. Only JavaScript bundle compilation and native autolinking were tested.

## Analysis and outputs

The existing Expo Camera takes sequential, oriented, unmirrored JPEG snapshots.
One capture/detection is in flight at a time. Each image URI goes to
`RNMLKitFaceDetector.detectFaces`; native cache files are deleted in `finally`.
This is continuous sampled image analysis, **not high-FPS video frame processing**.
It may be slow on some devices. Only the neutral/turn/return transition images are
retained in memory for server evaluation. No pose traces, photos, or embeddings
are persisted by this client.

Detector options: accurate performance, landmarks and classification enabled,
contours disabled, tracking enabled, minimum face size 0.15.

Outputs used: face count; `headEulerAngleY` (yaw), `headEulerAngleX` (pitch),
`headEulerAngleZ` (roll), and `trackingID`. Missing/nonfinite pose or tracking
values block progress. Exactly one tracked face must remain visible. Tracking
IDs help maintain continuity but are not recognition or proof of identity.

Both native implementations also expose `leftEyeOpenProbability` and
`rightEyeOpenProbability`. Their optional `has*` flags are not consistently emitted
by this wrapper; the code checks numeric values and rejects any explicit false flag.

## Configurable development thresholds

`services/nativeChallengeMachine.js` exports CHALLENGE_CONFIG. These are conservative
starting points for testing, not calibrated universal biometric thresholds:

| Setting | Default | Purpose |
| --- | --- | --- |
| Neutral yaw | absolute yaw <= 8 degrees | Establish frontal starting pose |
| Turn yaw | signed yaw >= 25 degrees | Require a deliberate requested turn |
| Return yaw | absolute yaw <= 10 degrees | Separate return and turn thresholds |
| Pitch / roll | absolute <= 20 / 15 degrees | Reject excessive tilt |
| Debounce | 3 consecutive qualifying frames spanning >= 300 ms | Reject one-frame noise |
| Maximum gap | 1500 ms | Reset after sampling/tracking interruption |
| Maximum attempt | 60 seconds, also bounded by server expiry | Stop stale attempts; never proves motion |
| Eye open / closed | both >= 0.8 / both <= 0.2 | Hysteresis in opt-in blink state machine |

ML Kit Euler Y positive means looking toward camera-right; negative means
camera-left. The adapter requests unmirrored captures. `leftYawSign` is configurable
and defaults to -1. **Verify instruction direction, image orientation, tracking
stability, sampling cadence and thresholds on real front cameras on each OS.**
Do not infer anatomical direction from a mirrored preview alone.
ML Kit concepts: https://developers.google.com/ml-kit/vision/face-detection/face-detection-concepts

A noisy or ambiguous frame clears the current debounce streak. Face loss,
multiple faces, tracking changes, invalid pose or stale timestamps reset progress.
Back/cancel/background invalidate the active asynchronous run and discard evidence.

## Blink limitation and server randomization

The server still randomly selects `turn_left` or `turn_right` and now includes a
machine-readable `challengeType` in its response. No client-selected challenge
can mark the trusted session passed. Older server deployments without this field
display a service-update message on native.

The blink state machine implements stable bilateral open -> closed -> open,
repeated twice, with independent open/closed thresholds and multi-frame debounce.
Winks, missing probabilities and nonfrontal poses do not count. It is unit-tested
but **disabled in production** (`blinkEnabled:false`) and never randomly selected.
Still-photo capture cannot reliably observe short normal blinks. Enabling blink
requires a validated faster frame pipeline and per-device probability/cadence
testing; eye fields existing does not establish reliable blink capture.

## Web and validation

Web resolves `nativeFaceChallenge.js`, which imports no native ML Kit module.
Android/iOS resolve `nativeFaceChallenge.native.js`. Browser-compatible liveness
is still required; the existing blocked web flow is preserved.

The complete backend suite currently has 60 passing Node tests, including head-turn direction, complete return, spikes, face
loss/multiplicity, tracking changes, missing outputs, stale frames, expiry, and
disabled/opt-in blink behavior. Web, Android and iOS Expo exports pass. Both native
platforms resolve the ML Kit autolinking modules. The generated web JS excludes
the native detector and Render secret references. No lint script is configured.

Native compilation and physical camera validation were not run: Android SDK is
not installed in this workspace; iOS compilation needs macOS/Xcode. No real human
liveness or successful production enrollment is claimed by these results.

Files changed: package.json, package-lock.json,
components/RegistrationFaceCapture.jsx, services/nativeFaceChallenge.js,
services/nativeFaceChallenge.native.js, services/nativeChallengeMachine.js,
backend/verification/registrationFace.js (challenge response type only),
backend/verification/tests/nativeChallengeMachine.test.js, and face-verification documentation.
