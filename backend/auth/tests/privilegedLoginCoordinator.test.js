const assert = require('node:assert/strict');
const test = require('node:test');

const {
  completePrivilegedLoginValidation,
  resetPrivilegedLoginValidation,
  runPrivilegedLoginValidation,
  shouldValidateExistingSession,
} = require('../../../services/privilegedLoginCoordinator');

test('auth listener handles one persisted user once across repeated effect callbacks', () => {
  const role = 'admin-listener-test';
  const user = { uid: 'admin-1' };
  resetPrivilegedLoginValidation(role);
  assert.equal(shouldValidateExistingSession(role, user, false), true);
  assert.equal(shouldValidateExistingSession(role, user, false), false);
  assert.equal(shouldValidateExistingSession(role, user, false), false);
  assert.equal(shouldValidateExistingSession(role, user, true), false);
});

test('parallel validation callers reuse one in-flight promise', async () => {
  const role = 'admin-inflight-test';
  const user = { uid: 'admin-2' };
  resetPrivilegedLoginValidation(role);
  let calls = 0;
  let release;
  const validate = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = runPrivilegedLoginValidation(role, user, validate);
  const second = runPrivilegedLoginValidation(role, user, validate);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ status: 'authorized' });
  await first;
});

test('successful validation is terminal across remounts until an explicit new login', async () => {
  const role = 'admin-completed-test';
  const user = { uid: 'admin-3' };
  resetPrivilegedLoginValidation(role);
  let calls = 0;
  await runPrivilegedLoginValidation(role, user, async () => {
    calls += 1;
    completePrivilegedLoginValidation(role, user.uid);
    return { status: 'authorized' };
  });
  assert.equal(shouldValidateExistingSession(role, user, false), false);
  assert.deepEqual(await runPrivilegedLoginValidation(role, user, async () => { calls += 1; }), { skipped: 'completed' });
  assert.equal(calls, 1);

  resetPrivilegedLoginValidation(role);
  assert.equal(shouldValidateExistingSession(role, user, false), true);
});
