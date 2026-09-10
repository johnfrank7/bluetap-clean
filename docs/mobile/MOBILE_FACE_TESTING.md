# Android/iOS face challenge testing

## Build configuration

Expo SDK 54.0.37 / React Native 0.81.5 (New Architecture), Expo Camera 17.0.10,
Infinite Red ML Kit face detection 5.0.0 (pinned), Expo development client 6.0.21.
The maintainer maps SDK 54 to detector 5.x:
https://github.com/infinitered/react-native-mlkit#compatibility

**Use a custom development build, not Expo Go.** `expo-dev-client` and device-build
scripts are installed. ML Kit face/core modules autolink; no separate ML Kit config
plugin is required. The existing Expo Camera plugin remains configured.

`app.json` now explicitly declares Android CAMERA and iOS
NSCameraUsageDescription. The camera plugin has recordAudioAndroid:false and
microphonePermission:false, plus android.blockedPermissions removes RECORD_AUDIO
from dependency manifest merging; this flow neither asks for microphone access nor saves
to the gallery. Expo config introspection confirmed CAMERA and the expected iOS
camera description, no microphone usage description, and a `tools:node="remove"`
marker for RECORD_AUDIO in the generated Android manifest. Native dependency
manifest merging must still be checked when producing a binary.

Camera configuration reference:
https://docs.expo.dev/versions/v54.0.0/sdk/camera/

No production native application IDs, signing credentials, EAS project or store
deployment were provisioned. Use the project's chosen native IDs when Expo prompts
on its first native build; retain those IDs for subsequent testing.

## Android: exact device steps

1. Install Android Studio with its SDK/platform tools and a supported JDK; configure
   ANDROID_HOME and PATH. Enable Developer options and USB debugging on the phone.
2. Connect the phone by USB, accept its debugging authorization, and run
   `adb devices`. The device must appear as authorized.
3. In the BlueTap app directory run `npm ci`.
4. In the ignored `.env.local`, configure the public Render backend origin:
   `EXPO_PUBLIC_API_BASE_URL=https://<service>.onrender.com`.
   Never put Render credentials in this file or any public variable.
5. Run `npm run build:android:device`. Select the phone and set the intended Android
   application ID if Expo asks. This generates/builds/installs the custom native app.
6. For subsequent JS sessions run `npm run dev:mobile`. Open the installed BlueTap
   development client, not Expo Go. If USB Metro connectivity is needed, run
   `adb reverse tcp:8081 tcp:8081`; otherwise use a shared LAN.
7. Go through Account -> Personal -> Identity. Allow camera permission, position
   one face in the oval, then select Begin challenge. Follow the server-selected
   left/right turn and return to neutral. Observe all three progress segments.
8. Repeat the test matrix below and record phone model, Android version, orientation,
   lighting, observed instruction direction, and whether tracking remains stable.
   Do not record face images, base64, or embeddings in diagnostic logs.

## iOS: exact device steps

1. On a Mac install Xcode and its command-line tools; use a physical iPhone/iPad.
   Connect/trust the device and enable Developer Mode where required.
2. In this app directory run `npm ci` and configure the same ignored `.env.local`
   with the public Render origin above.
3. Run `npm run build:ios:device`, select the physical device, and configure the
   intended bundle identifier and development signing team when prompted. If
   signing requires Xcode, open the generated `.xcworkspace`, select the team and
   physical device, then build/run.
4. Run `npm run dev:mobile` for subsequent JS sessions and open the installed
   development client. Keep phone and Mac on the same network.
5. Complete Account and Personal, enter Identity, and accept the camera prompt.
   Confirm the iOS permission sheet does not cancel initialization. Follow a
   randomized head turn and its return-to-neutral instruction.
6. Run the same matrix; record device/OS and orientation results. The ML Kit
   maintainer recommends real iOS hardware rather than simulator testing.

Rebuild native binaries after dependency/config changes; a web/backend redeploy or
Metro reload alone cannot add ML Kit to an installed app. Export success is not
proof that Gradle/CocoaPods compilation or real hardware execution succeeds.

## Motion and framing checks

The motion sequence remains neutral -> requested turn -> neutral return. Yaw,
pitch, roll and tracking ID come from actual ML Kit detection. Three consecutive
qualifying frames spanning at least 300 ms are required for each phase. Timers only
limit attempts and device load; they never prove completion. Blink stays disabled.

All development thresholds remain in CHALLENGE_CONFIG:

* Neutral yaw <=8 degrees; requested signed turn >=25; return yaw <=10.
* Pitch <=20 and roll <=15 degrees; gaps >1500 ms reset progress.
* Face bounding-box width must be 20-75% of captured-image width.
* Bounding box must remain at least 4% from every captured-image edge.
* Its center must be within 18% of the image center on both axes.

Missing/multiple faces, invalid bounds, too-small/large faces, clipping, off-center
position, invalid tracking and stale samples reset progress and show live guidance.
The oval is a positioning aid; detection quality checks use captured-image
coordinates. Verify preview cropping/orientation and left/right yaw sign on devices.
These are configurable starting points, not calibrated biometric guarantees.

The final image is captured only after local motion passes, then checked again for
one centered, sufficiently large, frontal face with the same tracking ID. Files
are deleted in finally blocks. Cancellation/backgrounding invalidates pending
callbacks; normal iOS permission-sheet inactivity is handled separately.

## Device test matrix and expected results

| Test | Expected result |
| --- | --- |
| First permission grant | Camera opens; iOS permission sheet does not cancel startup |
| Deny / permanently deny | Clear explanation, retry or Settings; no pass |
| Re-enable permission in Settings | Next start refreshes permission state |
| No face / two faces | Specific guidance; progress resets |
| Far away / very close | Move closer/farther guidance; no progress |
| Clipped / off-center face | Reposition guidance; no progress |
| Single noisy yaw frame / wrong turn | Does not complete the turn |
| Neutral -> requested turn -> neutral | Three phases complete from actual observations |
| Leave frame / change tracked face | Sequence resets |
| Timeout / cancellation / background | Attempt stops; no client verification write |
| Move away during final capture | Final-photo validation fails; retry required |
| Backend unavailable | Safe error; Continue remains disabled |
| Web | Mobile-app notice; no camera/face calls; Step 3 stays blocked |

## Critical remaining boundary

The server's trusted liveness evaluator is still unavailable. Native motion is
prototype-grade local evidence, not remotely verifiable proof or presentation-
attack protection. After local pass the final photo is captured, but the existing
server evaluation must approve the challenge before that photo is sent to final
duplicate/enrollment processing. **Expected current device result: local motion
can finish, server confirmation stops registration, and Continue stays disabled.**

Do not replace this with client `livenessPassed:true`. Completion needs trusted
server-evaluated evidence or a verifiable provider proof bound to the capture and
session. The protected recognition service and BlueTap backend security gates remain unchanged.
Existing Render persistence/idempotency/lifecycle gaps are documented separately
in [FACE_VERIFICATION.md](../verification/FACE_VERIFICATION.md).

## Checks performed here

60 Node tests and all 17 Expo Doctor checks passed. `expo-image` 3.0.11 and
`expo-keep-awake` 15.0.8 are pinned to SDK 54 versions because ML Kit core declares
broad Expo dependencies. Expo config introspection passed for camera permissions.
Native autolinking resolves the ML Kit modules on Android/iOS. Tests cover frame quality, motion sequencing,
final-photo rejection, cache cleanup, cancellation and backend failure. Native
runner tests use mocked ML Kit/camera outputs; they do not measure detector accuracy.
Expo web/Android/iOS bundle exports pass. A headless browser check confirms the
mobile-only notice, no mounted camera/face API calls, and disabled Continue.

No physical-device or signed native binary test was possible here: this Windows
workspace has no Android SDK, and iOS compilation requires macOS/Xcode. Remaining
work includes native compilation, actual permission UX, yaw-sign calibration,
tracking continuity, framing/cropping, low-light performance, and capture latency.
