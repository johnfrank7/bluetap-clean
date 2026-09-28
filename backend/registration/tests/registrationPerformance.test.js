const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const {
  REGISTRATION_POLICY_CACHE_TTL_MS,
  clearRegistrationPolicyCache,
  createRegistrationPolicyLoader,
  writeRegistrationPolicyCache,
} = require('../../../services/registrationPolicyCache');
const { buildRegistrationSteps, REGISTRATION_STEP } = require('../../../services/registrationStepStatus');

const policy = (faceVerificationRequired, emailOtpRequired, policyVersion = 1) => ({
  faceVerificationRequired,
  emailOtpRequired,
  policyVersion,
});

test.afterEach(() => clearRegistrationPolicyCache());

test('cached registration policy renders without waiting for a network read', async () => {
  writeRegistrationPolicyCache(policy(false, true, 4), 1_000);
  let reads = 0;
  const loader = createRegistrationPolicyLoader({
    now: () => 1_000 + REGISTRATION_POLICY_CACHE_TTL_MS - 1,
    readPublicPolicy: async () => { reads += 1; return policy(true, true); },
    readBackendPolicy: async () => { reads += 1; return policy(true, true); },
  });
  assert.deepEqual(await loader.get(), policy(false, true, 4));
  assert.equal(reads, 0);
});

test('registration policy uses public policy first and falls back to the authoritative backend', async () => {
  const publicLoader = createRegistrationPolicyLoader({
    readPublicPolicy: async () => policy(false, true, 2),
    readBackendPolicy: async () => { throw new Error('backend should not run'); },
  });
  assert.deepEqual(await publicLoader.get({ force: true }), policy(false, true, 2));

  clearRegistrationPolicyCache();
  const fallbackLoader = createRegistrationPolicyLoader({
    readPublicPolicy: async () => { throw new Error('missing mirror'); },
    readBackendPolicy: async () => policy(true, true, 3),
  });
  assert.deepEqual(await fallbackLoader.get({ force: true }), policy(true, true, 3));
});

test('registration policy failures settle as an error instead of loading forever', async () => {
  const loader = createRegistrationPolicyLoader({
    readPublicPolicy: async () => { throw new Error('public unavailable'); },
    readBackendPolicy: async () => { throw new Error('backend unavailable'); },
  });
  await assert.rejects(loader.get({ force: true }), /backend unavailable/);
});

test('policy-derived registration steps preserve face and OTP combinations', () => {
  assert.deepEqual(buildRegistrationSteps(policy(false, true)), [
    REGISTRATION_STEP.account, REGISTRATION_STEP.personal, REGISTRATION_STEP.credentials, REGISTRATION_STEP.verifyEmail,
  ]);
  assert.deepEqual(buildRegistrationSteps(policy(true, true)), [
    REGISTRATION_STEP.account, REGISTRATION_STEP.personal, REGISTRATION_STEP.identity,
    REGISTRATION_STEP.credentials, REGISTRATION_STEP.verifyEmail,
  ]);
});

test('registration UI cache does not replace backend policy authority', () => {
  const root = resolve(__dirname, '..', '..', '..');
  const session = readFileSync(resolve(root, 'backend', 'registration', 'registrationSession.js'), 'utf8');
  const registration = readFileSync(resolve(root, 'backend', 'registration', 'registration.js'), 'utf8');
  assert.match(session, /loadRegistrationSecurity\(db, \{ strict: true \}\)/);
  assert.match(session, /securityPolicySnapshot/);
  assert.match(registration, /securityPolicySnapshot/);
});
