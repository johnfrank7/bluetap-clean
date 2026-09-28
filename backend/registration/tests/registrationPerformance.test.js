const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..', '..', '..');
const signupSource = readFileSync(resolve(root, 'app', 'signup.jsx'), 'utf8');
const registrationSessionSource = readFileSync(resolve(root, 'services', 'registrationSession.js'), 'utf8');

const {
  REGISTRATION_POLICY_CACHE_TTL_MS,
  REGISTRATION_POLICY_STALE_TTL_MS,
  clearRegistrationPolicyCache,
  createRegistrationPolicyLoader,
  readRegistrationPolicyCache,
  writeRegistrationPolicyCache,
} = require('../../../services/registrationPolicyCache');
const { buildRegistrationDisplaySteps, buildRegistrationSteps, REGISTRATION_STEP } = require('../../../services/registrationStepStatus');

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

test('stale-but-usable policy renders immediately and revalidates in the background', async () => {
  const cached = policy(false, true, 4);
  const refreshed = policy(true, true, 5);
  writeRegistrationPolicyCache(cached, 1_000);
  let resolvePublic;
  let reads = 0;
  const loader = createRegistrationPolicyLoader({
    now: () => 1_000 + REGISTRATION_POLICY_CACHE_TTL_MS + 1,
    readPublicPolicy: () => {
      reads += 1;
      return new Promise((resolve) => { resolvePublic = resolve; });
    },
    readBackendPolicy: async () => { throw new Error('backend should not run'); },
  });

  assert.deepEqual(loader.peek(), {
    policy: cached,
    ageMs: REGISTRATION_POLICY_CACHE_TTL_MS + 1,
    fresh: false,
  });
  assert.deepEqual(await loader.get(), cached);
  assert.equal(reads, 1);
  resolvePublic(refreshed);
  await loader.refresh();
  assert.deepEqual(readRegistrationPolicyCache(1_000 + REGISTRATION_POLICY_CACHE_TTL_MS + 1)?.policy, refreshed);
});

test('policy refresh requests are deduplicated', async () => {
  let resolvePublic;
  let reads = 0;
  const loader = createRegistrationPolicyLoader({
    readPublicPolicy: () => {
      reads += 1;
      return new Promise((resolve) => { resolvePublic = resolve; });
    },
    readBackendPolicy: async () => { throw new Error('backend should not run'); },
  });
  const first = loader.refresh();
  const second = loader.refresh();
  assert.equal(first, second);
  assert.equal(reads, 0);
  await Promise.resolve();
  assert.equal(reads, 1);
  resolvePublic(policy(true, false, 6));
  await first;
});

test('expired policy is not used for UI routing', () => {
  writeRegistrationPolicyCache(policy(false, false), 1_000);
  assert.equal(readRegistrationPolicyCache(1_000 + REGISTRATION_POLICY_STALE_TTL_MS + 1), null);
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

test('Firestore failure and slow Render recovery do not prevent the Account step from displaying', async () => {
  let resolveBackend;
  let settled = false;
  const loader = createRegistrationPolicyLoader({
    readPublicPolicy: async () => { throw new Error('permission-denied'); },
    readBackendPolicy: () => new Promise((resolve) => { resolveBackend = resolve; }),
  });
  const recovery = loader.refresh().finally(() => { settled = true; });
  while (!resolveBackend) await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.deepEqual(buildRegistrationDisplaySteps(null), [
    REGISTRATION_STEP.account, REGISTRATION_STEP.personal, REGISTRATION_STEP.credentials,
  ]);
  assert.match(signupSource, /step === STEP\.account && <View style=\{styles\.roleList\}>/);
  resolveBackend(policy(true, true));
  await recovery;
});

test('signup keeps the stepper and form visible while policy recovery is local and retryable', () => {
  assert.match(signupSource, /<RegistrationStepper[\s\S]*visibleSteps=\{displayedRegistrationSteps\}/);
  assert.doesNotMatch(signupSource, /Loading registration steps/);
  assert.match(signupSource, /!securityPolicyReady && policyResolving/);
  assert.match(signupSource, /<RegistrationNotice tone="error"[\s\S]*actionLabel="Try again"[\s\S]*setPolicyRetry/);
  assert.match(signupSource, /\(securityPolicyReady \|\| step === STEP\.account \|\| step === STEP\.personal\)/);

  const policyEffectStart = signupSource.indexOf("    setPolicyError('');");
  const policyEffectEnd = signupSource.indexOf('  }, [registrationSessionId, policyRetry]);', policyEffectStart);
  assert.ok(policyEffectStart >= 0 && policyEffectEnd > policyEffectStart);
  assert.doesNotMatch(signupSource.slice(policyEffectStart, policyEffectEnd), /setForm\(/);
});

test('policy recovery is bounded and landing/login prefetch share the signup cache', () => {
  assert.match(registrationSessionSource, /REGISTRATION_POLICY_PUBLIC_TIMEOUT_MS = 2500/);
  assert.match(registrationSessionSource, /REGISTRATION_POLICY_FALLBACK_TIMEOUT_MS = 4000/);
  assert.match(registrationSessionSource, /callRegistrationApi\('\/api\/auth\/registration-policy', \{\}, REGISTRATION_POLICY_FALLBACK_TIMEOUT_MS\)/);
  assert.match(registrationSessionSource, /const registrationPolicyLoader = createRegistrationPolicyLoader/);
  assert.match(registrationSessionSource, /prefetchRegistrationPolicy = \(\) => registrationPolicyLoader\.prefetch\(\)/);
  assert.match(registrationSessionSource, /getCachedRegistrationPolicy = \(\) => registrationPolicyLoader\.peek\(\)/);
  assert.match(registrationSessionSource, /revalidateRegistrationPolicy = \(\) => registrationPolicyLoader\.refresh\(\)/);
  for (const relativePath of [resolve('app', 'index.jsx'), resolve('app', 'login.jsx')]) {
    assert.match(readFileSync(resolve(root, relativePath), 'utf8'), /prefetchRegistrationPolicy/);
  }
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

test('unresolved policy displays only known base steps without assuming optional security is disabled', () => {
  assert.deepEqual(buildRegistrationDisplaySteps(null), [
    REGISTRATION_STEP.account, REGISTRATION_STEP.personal, REGISTRATION_STEP.credentials,
  ]);
  assert.deepEqual(buildRegistrationDisplaySteps(policy(true, true)), [
    REGISTRATION_STEP.account, REGISTRATION_STEP.personal, REGISTRATION_STEP.identity,
    REGISTRATION_STEP.credentials, REGISTRATION_STEP.verifyEmail,
  ]);
});

test('registration UI cache does not replace backend policy authority', () => {
  const session = readFileSync(resolve(root, 'backend', 'registration', 'registrationSession.js'), 'utf8');
  const registration = readFileSync(resolve(root, 'backend', 'registration', 'registration.js'), 'utf8');
  assert.match(session, /loadRegistrationSecurity\(db, \{ strict: true \}\)/);
  assert.match(session, /securityPolicySnapshot/);
  assert.match(registration, /securityPolicySnapshot/);
});
