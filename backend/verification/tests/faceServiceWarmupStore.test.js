const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaceServiceWarmupStore } = require('../../../services/faceServiceWarmupStore');

function fixture() {
  let clock = 0;
  const timers = [];
  const stages = [];
  const store = createFaceServiceWarmupStore({
    now: () => clock,
    schedule: (fn) => { timers.push(fn); return fn; },
    cancel: (fn) => { const index = timers.indexOf(fn); if (index >= 0) timers.splice(index, 1); },
    logger: { info: (_label, value) => stages.push(value.stage) },
  });
  return { store, timers, stages, advance: (ms) => { clock += ms; }, tick: async () => { const timer = timers.shift(); if (timer) timer(); await Promise.resolve(); await Promise.resolve(); } };
}

test('Step 3 hydrates from a shared ready prewarm without another poll', () => {
  const f = fixture();
  f.store.publishPrewarm('ready');
  let calls = 0;
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus: async () => { calls += 1; return { status: 'ready' }; } });
  assert.equal(f.store.getSnapshot().status, 'ready');
  assert.equal(calls, 0);
});

test('Step 3 transitions when the shared poll becomes ready and stops immediately', async () => {
  const f = fixture();
  const updates = [];
  f.store.subscribe((state) => updates.push(state.status));
  let calls = 0;
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus: async () => ({ status: ++calls === 1 ? 'starting' : 'ready' }) });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.store.getSnapshot().status, 'starting');
  await f.tick();
  assert.equal(f.store.getSnapshot().status, 'ready');
  assert.equal(f.timers.length, 0);
  assert.ok(updates.includes('ready'));
  assert.ok(f.stages.includes('FACE_STEP3_POLL_STOPPED'));
});

test('remounts and repeated renders reuse one cached ready state and one poller', async () => {
  const f = fixture();
  let calls = 0;
  const checkStatus = async () => { calls += 1; return { status: 'starting' }; };
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus });
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(f.timers.length, 1);
  f.store.publishPrewarm('ready');
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus });
  assert.equal(calls, 1);
  assert.equal(f.store.getSnapshot().status, 'ready');
});

test('a genuinely warming service remains preparing and becomes unavailable only at 75 seconds', async () => {
  const f = fixture();
  f.store.start({ registrationSessionId: 'session-a', required: true, checkStatus: async () => ({ status: 'starting' }) });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.store.getSnapshot().status, 'starting');
  f.advance(74_999);
  await f.tick();
  assert.equal(f.store.getSnapshot().status, 'starting');
  f.advance(1);
  await f.tick();
  assert.equal(f.store.getSnapshot().status, 'unavailable');
});
