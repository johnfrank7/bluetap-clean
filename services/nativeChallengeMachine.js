// Development starting points, not calibrated biometric security thresholds.
// Degrees follow ML Kit Euler Y in an unmirrored captured image (positive right
// of camera). Physical front-camera direction must be checked on both platforms.
const CHALLENGE_CONFIG = Object.freeze({
  neutralYaw: 8, turnYaw: 25, returnYaw: 10, maxPitch: 20, maxRoll: 15,
  consecutiveFrames: 3, minimumStableMs: 300, maximumFrameGapMs: 1500,
  maxChallengeMs: 60000, eyeOpen: 0.8, eyeClosed: 0.2,
  // Still-photo analysis cannot guarantee capture of a normal brief blink.
  blinkEnabled: false, leftYawSign: -1,
});

function createChallengeMachine(type, overrides = {}) {
  const config = { ...CHALLENGE_CONFIG, ...overrides };
  if (!['turn_left', 'turn_right', 'blink_twice'].includes(type) || (type === 'blink_twice' && !config.blinkEnabled)) throw new Error('This challenge is not supported by the native detector capture mode.');
  let stage = 'neutral', count = 0, stableSince = null, lastTime = null, startedAt = null, trackingId = null, blinks = 0;
  const reset = () => { stage = 'neutral'; count = 0; stableSince = null; trackingId = null; blinks = 0; };
  const output = (transition = null, reason = null) => ({ challengePassed: stage === 'passed', stage, transition, blinks, reason });
  return {
    update(faces, time) {
      if (!Number.isFinite(time) || (lastTime !== null && time <= lastTime)) { reset(); return output(null, 'stale-frame'); }
      if (startedAt === null) startedAt = time;
      if (time - startedAt > config.maxChallengeMs) { reset(); return output(null, 'expired'); }
      if (lastTime !== null && time - lastTime > config.maximumFrameGapMs) reset();
      lastTime = time;
      if (!Array.isArray(faces) || faces.length !== 1) { reset(); return output(null, 'one-face-required'); }
      const face = faces[0];
      const yaw = face.headEulerAngleY, pitch = face.headEulerAngleX, roll = face.headEulerAngleZ;
      if (![yaw, pitch, roll].every(Number.isFinite) || Math.abs(pitch) > config.maxPitch || Math.abs(roll) > config.maxRoll || face.hasHeadEulerAngleY === false) { reset(); return output(null, 'invalid-pose'); }
      if (!Number.isInteger(face.trackingID)) { reset(); return output(null, 'tracking-unavailable'); }
      if (trackingId !== null && trackingId !== face.trackingID) reset();
      trackingId = face.trackingID;
      let observed;
      if (type === 'blink_twice') {
        const eyes = [face.leftEyeOpenProbability, face.rightEyeOpenProbability];
        if (!eyes.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || face.hasLeftEyeOpenProbability === false || face.hasRightEyeOpenProbability === false || Math.abs(yaw) > config.neutralYaw) { reset(); return output(null, 'eyes-unavailable'); }
        observed = stage === 'close' ? eyes.every((v) => v <= config.eyeClosed) : eyes.every((v) => v >= config.eyeOpen);
      } else {
        const sign = type === 'turn_left' ? config.leftYawSign : -config.leftYawSign;
        observed = stage === 'neutral' ? Math.abs(yaw) <= config.neutralYaw : stage === 'turn' ? yaw * sign >= config.turnYaw : Math.abs(yaw) <= config.returnYaw;
      }
      if (!observed) { count = 0; stableSince = null; return output(); }
      if (stableSince === null) stableSince = time;
      count++;
      if (count < config.consecutiveFrames || time - stableSince < config.minimumStableMs) return output();
      const previous = stage;
      count = 0; stableSince = null;
      if (type === 'blink_twice') {
        if (stage === 'neutral' || stage === 'open') {
          if (stage === 'open') blinks++;
          stage = blinks === 2 ? 'passed' : 'close';
        } else stage = 'open';
      } else stage = stage === 'neutral' ? 'turn' : stage === 'turn' ? 'return' : 'passed';
      return output(previous);
    },
  };
}
module.exports = { CHALLENGE_CONFIG, createChallengeMachine };
