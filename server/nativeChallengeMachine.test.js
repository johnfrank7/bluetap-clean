const test = require('node:test');
const assert = require('node:assert/strict');
const { createChallengeMachine } = require('../services/nativeChallengeMachine');
const face = (yaw = 0, extra = {}) => ({ trackingID: 1, headEulerAngleY: yaw, headEulerAngleX: 0, headEulerAngleZ: 0, leftEyeOpenProbability: 0.95, rightEyeOpenProbability: 0.95, ...extra });
function harness(type, options) {
  const machine = createChallengeMachine(type, options);
  let time = 0;
  return { machine, frames: (yaw, extra = {}, n = 3) => {
    let result; for (let i = 0; i < n; i++) { time += 200; result = machine.update([face(yaw, extra)], time); } return result;
  }, absent: () => machine.update([], time += 200), multiple: () => machine.update([face(), face()], time += 200) };
}
test('left and right require sustained neutral, correct turn and neutral return', () => {
  for (const [type, yaw] of [['turn_left', -30], ['turn_right', 30]]) {
    const h = harness(type);
    assert.equal(h.frames(yaw).challengePassed, false);
    assert.equal(h.frames(0).stage, 'turn');
    assert.equal(h.frames(-yaw).stage, 'turn');
    assert.equal(h.frames(yaw).stage, 'return');
    assert.equal(h.frames(yaw).challengePassed, false);
    assert.equal(h.frames(0).challengePassed, true);
  }
});
test('one-frame spikes, ambiguous pose and missing/tracking changes cannot pass', () => {
  const h = harness('turn_left'); h.frames(0);
  h.frames(-30, {}, 1); assert.equal(h.frames(0).stage, 'turn');
  h.frames(-30); h.absent(); assert.equal(h.frames(0).stage, 'turn');
  h.frames(-30); h.multiple(); assert.equal(h.frames(0).stage, 'turn');
  h.frames(-30); assert.equal(h.frames(0, { trackingID: 2 }).stage, 'turn');
  assert.equal(h.frames(0, { trackingID: null }).reason, 'tracking-unavailable');
  assert.equal(h.frames(0, { headEulerAngleY: NaN }).reason, 'invalid-pose');
  assert.equal(h.frames(0, { headEulerAngleX: 40 }).reason, 'invalid-pose');
});
test('stale frames, gaps and expiration cannot be used as proof', () => {
  const m = createChallengeMachine('turn_left');
  m.update([face()], 0); m.update([face()], 200); m.update([face()], 400);
  assert.equal(m.update([face(-30)], 400).reason, 'stale-frame');
  assert.equal(m.update([face(-30)], 2500).stage, 'neutral');
  assert.equal(m.update([face()], 61000).reason, 'expired');
});
test('blink is disabled in production; opted-in logic needs two bilateral close/reopen cycles', () => {
  assert.throws(() => createChallengeMachine('blink_twice'));
  const h = harness('blink_twice', { blinkEnabled: true });
  assert.equal(h.frames(0).stage, 'close');
  assert.equal(h.frames(0, { leftEyeOpenProbability: 0.1 }).stage, 'close');
  const closed = { leftEyeOpenProbability: 0.1, rightEyeOpenProbability: 0.1 };
  assert.equal(h.frames(0, closed).stage, 'open');
  assert.equal(h.frames(0).blinks, 1);
  assert.equal(h.frames(0).challengePassed, false);
  h.frames(0, closed);
  assert.equal(h.frames(0).challengePassed, true);
  const missing = harness('blink_twice', { blinkEnabled: true });
  assert.equal(missing.frames(0, { leftEyeOpenProbability: null }).reason, 'eyes-unavailable');
});
