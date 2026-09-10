import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { CHALLENGE_CONFIG, createChallengeMachine, assessFaceFrame } from './nativeChallengeMachine';

const hints = {
  'no-face': 'Position your face inside the oval', 'multiple-faces': 'Only one person should be visible',
  'too-far': 'Move closer to the camera', 'too-close': 'Move a little farther from the camera',
  'outside-frame': 'Keep your whole face inside the camera frame', 'off-center': 'Move your face toward the center of the oval',
  'invalid-frame': 'Face position could not be read. Try better lighting.',
  'tracking-unavailable': 'Keep your face visible in good lighting', 'invalid-pose': 'Keep your head upright and look toward the camera',
};

export const nativeChallengeAvailable = () => !!requireOptionalNativeModule('RNMLKitFaceDetection');

export async function runNativeFaceChallenge({ camera, challenge, assertActive, showInstruction, onProgress = () => {}, evaluate, complete }) {
  if (!nativeChallengeAvailable()) throw new Error('Face detection requires a custom Android or iOS build. It is not available in Expo Go.');
  // Delayed loading lets Expo Go show a useful message instead of crashing.
  const { RNMLKitFaceDetector } = require('@infinitered/react-native-mlkit-face-detection');
  const detector = new RNMLKitFaceDetector({}, true);
  await detector.initialize({ performanceMode: 'accurate', landmarkMode: true, contourMode: false, classificationMode: true, isTrackingEnabled: true, minFaceSize: 0.15 });
  if (detector.status !== 'ready') throw new Error('The native face detector could not start.');
  assertActive();
  const machine = createChallengeMachine(challenge.challengeType);
  const evidence = [];
  let finalImage;
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt <= CHALLENGE_CONFIG.maxChallengeMs && Date.now() < challenge.expiresAt) {
      assertActive();
      let photo;
      try {
        // Serial camera snapshots: each is actually evaluated by ML Kit. This
        // is continuous sampled analysis, not a high-FPS video frame processor.
        const capturedAt = Date.now();
        photo = await camera().takePictureAsync({ quality: 0.4, base64: true, exif: false, skipProcessing: false, shutterSound: false, mirror: false });
        assertActive();
        const result = await detector.detectFaces(photo.uri);
        assertActive();
        if (!result || result.success === false || !Array.isArray(result.faces)) throw new Error('Face analysis failed. Please try again.');
        if (Date.now() >= challenge.expiresAt || Date.now() - startedAt > CHALLENGE_CONFIG.maxChallengeMs) break;
        const quality = assessFaceFrame(result.faces, photo);
        const stale = Date.now() - capturedAt > CHALLENGE_CONFIG.maximumFrameGapMs;
        const state = machine.update(quality || stale ? [] : result.faces, capturedAt);
        if (state.reason === 'expired') break;
        if (state.stage === 'neutral') evidence.length = 0;
        if (state.transition) {
          if (!photo.base64 || photo.base64.length > 1398104) throw new Error('The face image is too large. Please try again.');
          evidence.push(`data:image/jpeg;base64,${photo.base64}`);
        }
        const reason = quality || (stale ? 'stale-frame' : state.reason);
        showInstruction(reason ? hints[reason] || 'Hold still in good lighting while the camera catches up' : state.stage === 'neutral' ? 'Look straight at the camera' : state.stage === 'turn' ? challenge.instruction : 'Return to looking straight at the camera');
        onProgress({ stage: state.stage, completed: { neutral: 0, turn: 1, return: 2, passed: 3 }[state.stage], reason });
        if (state.challengePassed) {
          // Local motion pass alone never writes trusted registration state.
          if (evidence.length !== 3) throw new Error('Challenge evidence is incomplete. Please try again.');
          showInstruction('Motion observed. Hold still for your final photo.');
          let finalPhoto;
          try {
            finalPhoto = await camera().takePictureAsync({ quality: 0.45, base64: true, exif: false, skipProcessing: false, shutterSound: false, mirror: false });
            assertActive();
            const finalResult = await detector.detectFaces(finalPhoto.uri);
            assertActive();
            const finalQuality = assessFaceFrame(finalResult?.faces, finalPhoto);
            const finalFace = finalResult?.faces?.[0];
            if (finalResult?.success === false || finalQuality || !Number.isFinite(finalFace?.headEulerAngleY) || Math.abs(finalFace.headEulerAngleY) > CHALLENGE_CONFIG.returnYaw ||
                !Number.isFinite(finalFace?.headEulerAngleX) || Math.abs(finalFace.headEulerAngleX) > CHALLENGE_CONFIG.maxPitch ||
                !Number.isFinite(finalFace?.headEulerAngleZ) || Math.abs(finalFace.headEulerAngleZ) > CHALLENGE_CONFIG.maxRoll ||
                finalFace.trackingID !== result.faces[0].trackingID) throw new Error('The final photo was not clear and centered. Please try the challenge again.');
            if (!finalPhoto.base64 || finalPhoto.base64.length > 1398104) throw new Error('The final photo is too large. Please try again.');
            finalImage = `data:image/jpeg;base64,${finalPhoto.base64}`;
          } finally { if (finalPhoto?.uri) { const file = new File(finalPhoto.uri); if (file.exists) file.delete(); } }
          assertActive();
          if (Date.now() >= challenge.expiresAt) throw new Error('The face challenge expired. Please try again.');
          onProgress({ stage: 'processing', completed: 3, reason: null });
          showInstruction('Checking your identity...');
          const trusted = await evaluate(evidence);
          assertActive();
          if (trusted?.challengePassed !== true) return trusted;
          return await complete(evidence[2], finalImage);
        }
      } finally {
        if (photo?.uri) { const file = new File(photo.uri); if (file.exists) file.delete(); }
        photo = undefined;
      }
      // Yield and bound device load. Elapsed time never advances the machine.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The face challenge expired. Please try again.');
  } finally { evidence.length = 0; finalImage = undefined; }
}
