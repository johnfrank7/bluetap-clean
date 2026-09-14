const assert = require('node:assert/strict');
const test = require('node:test');

const { createHiddenAdminEntryTracker } = require('../../../services/hiddenAdminEntry');

test('hidden Admin entry triggers only on five logo taps inside three seconds', () => {
  let time = 1000;
  let triggers = 0;
  const tracker = createHiddenAdminEntryTracker({ now: () => time, onTrigger: () => { triggers += 1; } });
  for (let index = 0; index < 4; index += 1) {
    assert.equal(tracker.tap(), false);
    time += 400;
  }
  assert.equal(triggers, 0);
  assert.equal(tracker.tap(), true);
  assert.equal(triggers, 1);
});

test('hidden Admin entry resets a slow tap sequence and after a successful trigger', () => {
  let time = 1000;
  let triggers = 0;
  const tracker = createHiddenAdminEntryTracker({ now: () => time, onTrigger: () => { triggers += 1; } });
  for (let index = 0; index < 4; index += 1) { tracker.tap(); time += 500; }
  time += 3100;
  assert.equal(tracker.tap(), false);
  assert.equal(triggers, 0);
  for (let index = 0; index < 4; index += 1) { time += 300; tracker.tap(); }
  assert.equal(triggers, 1);
  time += 100;
  assert.equal(tracker.tap(), false);
});
