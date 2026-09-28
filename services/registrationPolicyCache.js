const REGISTRATION_POLICY_CACHE_KEY = 'bluetap.registration-policy.v1';
const REGISTRATION_POLICY_CACHE_TTL_MS = 5 * 60 * 1000;
const REGISTRATION_POLICY_STALE_TTL_MS = 30 * 60 * 1000;

let memoryEntry = null;
let hydrated = false;

function validPolicy(policy) {
  return typeof policy?.faceVerificationRequired === 'boolean' &&
    typeof policy?.emailOtpRequired === 'boolean' &&
    (policy.policyVersion === undefined || Number.isInteger(policy.policyVersion));
}

function sessionStore() {
  try { return globalThis.sessionStorage || null; }
  catch { return null; }
}

function hydrateCache() {
  if (hydrated) return;
  hydrated = true;
  try {
    const parsed = JSON.parse(sessionStore()?.getItem(REGISTRATION_POLICY_CACHE_KEY) || 'null');
    if (validPolicy(parsed?.policy) && Number.isFinite(parsed?.cachedAt)) memoryEntry = parsed;
  } catch { /* A malformed browser cache is ignored. */ }
}

function readRegistrationPolicyCache(now = Date.now()) {
  hydrateCache();
  if (!memoryEntry || !validPolicy(memoryEntry.policy)) return null;
  const ageMs = Math.max(0, now - memoryEntry.cachedAt);
  if (ageMs > REGISTRATION_POLICY_STALE_TTL_MS) return null;
  return { policy: memoryEntry.policy, ageMs, fresh: ageMs <= REGISTRATION_POLICY_CACHE_TTL_MS };
}

function writeRegistrationPolicyCache(policy, now = Date.now()) {
  if (!validPolicy(policy)) throw new Error('The registration policy is unavailable. Please try again.');
  memoryEntry = { policy: {
    faceVerificationRequired: policy.faceVerificationRequired,
    emailOtpRequired: policy.emailOtpRequired,
    ...(Number.isInteger(policy.policyVersion) ? { policyVersion: policy.policyVersion } : {}),
  }, cachedAt: now };
  hydrated = true;
  try { sessionStore()?.setItem(REGISTRATION_POLICY_CACHE_KEY, JSON.stringify(memoryEntry)); }
  catch { /* In-memory caching remains available when browser storage is blocked. */ }
  return memoryEntry.policy;
}

function clearRegistrationPolicyCache() {
  memoryEntry = null;
  hydrated = true;
  try { sessionStore()?.removeItem(REGISTRATION_POLICY_CACHE_KEY); }
  catch { /* Nothing else to clear. */ }
}

function createRegistrationPolicyLoader({ readPublicPolicy, readBackendPolicy, now = Date.now }) {
  let inFlight = null;
  const refresh = () => {
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(readPublicPolicy)
      .catch(() => readBackendPolicy())
      .then((policy) => writeRegistrationPolicyCache(policy, now()))
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  return {
    peek() { return readRegistrationPolicyCache(now()); },
    refresh,
    get({ force = false } = {}) {
      const cached = force ? null : readRegistrationPolicyCache(now());
      if (!cached) return refresh();
      if (!cached.fresh) refresh().catch(() => {});
      return Promise.resolve(cached.policy);
    },
    prefetch() { return this.get().catch(() => null); },
    prime(policy) { return writeRegistrationPolicyCache(policy, now()); },
    clear: clearRegistrationPolicyCache,
  };
}

module.exports = {
  REGISTRATION_POLICY_CACHE_KEY,
  REGISTRATION_POLICY_CACHE_TTL_MS,
  REGISTRATION_POLICY_STALE_TTL_MS,
  clearRegistrationPolicyCache,
  createRegistrationPolicyLoader,
  readRegistrationPolicyCache,
  validPolicy,
  writeRegistrationPolicyCache,
};
