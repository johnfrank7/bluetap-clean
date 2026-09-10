const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('@babel/core');
const machine = require('../services/nativeChallengeMachine');
const source = transformSync(fs.readFileSync(require.resolve('../services/nativeFaceChallenge.native.js'), 'utf8'), {
  babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;
const face = (yaw) => ({ trackingID: 1, headEulerAngleX: 0, headEulerAngleY: yaw, headEulerAngleZ: 0,
  frame: { origin: { x: 200, y: 100 }, size: { x: 240, y: 280 } } });
function fixture({ finalInvalid = false, backendUnavailable = false, cancel = false } = {}) {
  let clock = 0, captures = 0, detected = 0, evaluated = 0, completed = 0;
  const deleted = [];
  class Detector {
    async initialize() { this.status = 'ready'; }
    async detectFaces() {
      detected++;
      return { faces: finalInvalid && detected === 10 ? [] : [face(detected <= 3 ? 0 : detected <= 6 ? -30 : 0)] };
    }
  }
  const exports = {};
  vm.runInNewContext(source, { exports, Date: class extends Date { static now() { clock += 100; return clock; } },
    setTimeout: (callback) => { callback(); },
    require: (name) => {
      if (name === 'expo') return { requireOptionalNativeModule: () => ({}) };
      if (name === 'expo-file-system') return { File: class { constructor(uri) { this.uri = uri; this.exists = true; } delete() { deleted.push(this.uri); } } };
      if (name.includes('mlkit-face-detection')) return { RNMLKitFaceDetector: Detector };
      if (name === './nativeChallengeMachine') return machine;
      throw new Error(name);
    },
  });
  return { run: () => exports.runNativeFaceChallenge({
    camera: () => ({ takePictureAsync: async () => ({ uri: `file://capture-${++captures}`, base64: '/9j/2Q==', width: 640, height: 480 }) }),
    challenge: { challengeType: 'turn_left', instruction: 'Turn your head left', expiresAt: 20000 },
    assertActive: () => { if (cancel && captures > 0) throw new Error('cancelled'); }, showInstruction() {},
    evaluate: async (evidence) => { evaluated++; assert.equal(evidence.length, 3); if (backendUnavailable) throw new Error('unavailable'); return { challengePassed: true }; },
    complete: async () => { completed++; return { faceVerification: { status: 'verified' } }; },
  }), counts: () => ({ captures, detected, evaluated, completed, deleted: deleted.length }) };
}
test('native runner validates final photo before trusted backend handoff and cleans files', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.counts(), { captures: 10, detected: 10, evaluated: 1, completed: 1, deleted: 10 });
});
test('invalid final photo, cancellation and backend outage never complete enrollment', async () => {
  for (const options of [{ finalInvalid: true }, { cancel: true }, { backendUnavailable: true }]) {
    const f = fixture(options); await assert.rejects(f.run());
    const counts = f.counts(); assert.equal(counts.completed, 0); assert.equal(counts.deleted, counts.captures);
    if (!options.backendUnavailable) assert.equal(counts.evaluated, 0);
  }
});
