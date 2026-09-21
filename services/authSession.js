import { signOut } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { saveLocalUser } from '../localUsers';
import { isFaceVerified, normalizeFaceVerification } from './faceVerification';
import { getManagerContext } from './managerAccess';
import { clearAdminDataCache } from './adminDataCache';

const ACTIVE_SESSION_KEY = 'bluetapActiveAuthSession';
const MODULE_SESSIONS_KEY = 'bluetapModuleAuthSessions';
export const AUTH_SESSION_CHANGED_EVENT = 'bluetapAuthSessionChanged';

const ROLE_HOME_PATHS = {
  admin: '/admin/dashboard',
  manager: '/manager/dashboard',
  requester: '/requester/r_dashboard',
  distributor: '/distributor/d_dashboard',
};

const validRoles = new Set(Object.keys(ROLE_HOME_PATHS));
const PRIVILEGED_VALIDATION_TTL_MS = 2 * 60 * 1000;
let privilegedValidationCache = null;
const privilegedValidationInFlight = new Map();

const clearPrivilegedValidationCache = () => {
  privilegedValidationCache = null;
  privilegedValidationInFlight.clear();
};

export const cacheValidatedPrivilegedAccess = (profile = {}) => {
  const role = normalizeRole(profile.role);
  const uid = String(profile.uid || profile.id || '');
  if (!uid || !['admin', 'manager'].includes(role)) return;
  privilegedValidationCache = { uid, role, profile, validatedAt: Date.now() };
};

export const getCachedPrivilegedAccess = (user, role) => {
  const cached = privilegedValidationCache;
  if (!cached) return null;
  if (cached.uid !== user?.uid || cached.role !== role ||
      Date.now() - cached.validatedAt > PRIVILEGED_VALIDATION_TTL_MS) {
    clearPrivilegedValidationCache();
    return null;
  }
  console.info('[admin-performance]', { stage: 'ADMIN_AUTH_CACHE_HIT', role, ageMs: Date.now() - cached.validatedAt });
  return cached.profile;
};

const getMemorySessionStore = () => {
  if (!globalThis.__bluetapAuthSessionStore) {
    globalThis.__bluetapAuthSessionStore = {
      activeSession: null,
      moduleSessions: {},
    };
  }

  return globalThis.__bluetapAuthSessionStore;
};

const readJson = (key, fallback) => {
  try {
    if (globalThis.localStorage) {
      const value = globalThis.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    }
  } catch (error) {
    console.log('Auth session read error:', error.message);
  }

  const memoryStore = getMemorySessionStore();
  return key === ACTIVE_SESSION_KEY
    ? memoryStore.activeSession || fallback
    : memoryStore.moduleSessions || fallback;
};

const writeJson = (key, value) => {
  try {
    if (globalThis.localStorage) {
      if (value === null) {
        globalThis.localStorage.removeItem(key);
      } else {
        globalThis.localStorage.setItem(key, JSON.stringify(value));
      }
    }
  } catch (error) {
    console.log('Auth session save error:', error.message);
  }

  const memoryStore = getMemorySessionStore();
  if (key === ACTIVE_SESSION_KEY) {
    memoryStore.activeSession = value;
  } else {
    memoryStore.moduleSessions = value || {};
  }
};

const dispatchAuthSessionChanged = () => {
  try {
    globalThis.dispatchEvent?.(new Event(AUTH_SESSION_CHANGED_EVENT));
  } catch (error) {
    console.log('Auth session event error:', error.message);
  }
};

const getModuleSessions = () => readJson(MODULE_SESSIONS_KEY, {}) || {};
const getActiveSession = () => readJson(ACTIVE_SESSION_KEY, null);

const setSessions = (activeSession, moduleSessions) => {
  const previousActive = getActiveSession();
  const previousModules = getModuleSessions();
  const nextActiveJson = JSON.stringify(activeSession || null);
  const nextModulesJson = JSON.stringify(moduleSessions || {});

  writeJson(ACTIVE_SESSION_KEY, activeSession || null);
  writeJson(MODULE_SESSIONS_KEY, moduleSessions || {});

  if (
    JSON.stringify(previousActive || null) !== nextActiveJson ||
    JSON.stringify(previousModules || {}) !== nextModulesJson
  ) {
    dispatchAuthSessionChanged();
  }
};

export const normalizeRole = (role) => role?.toString().trim().toLowerCase() || '';

export const getRoleHomePath = (role) => ROLE_HOME_PATHS[normalizeRole(role)] || '/login';
export const getRoleLoginPath = (role) => normalizeRole(role) === 'admin' ? '/admin/login' : '/login';

const isFaceRequirementSatisfied = (profile = {}) =>
  profile.faceVerification?.status === 'not_required' && profile.faceVerification?.required === false
    ? true
    : isFaceVerified(profile);

export const getPostAuthenticationDestination = (profile = {}) => {
  const role = normalizeRole(profile.role);
  if (profile.mustChangePassword === true) return '/required-password-change';
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'manager') return '/manager/dashboard';
  if (!['requester', 'distributor'].includes(role)) return '/login';
  if (profile.onboardingStatus === 'face_enrollment_pending' || profile.registrationCompleted === false) {
    return '/registration-status';
  }
  if (!isFaceRequirementSatisfied(profile)) return '/verification';
  if (role === 'distributor' && !['approved', 'active'].includes(getDistributorApplicationStatus(profile))) {
    return '/registration-status';
  }
  return getRoleHomePath(role);
};

export const isValidRole = (role) => validRoles.has(normalizeRole(role));

export const getModuleSession = (role) =>
  getModuleSessions()[normalizeRole(role)] || null;

export const saveRoleSession = (profile = {}) => {
  const role = normalizeRole(profile.role);
  const uid = String(profile.uid || profile.id || '');

  if (!uid || !isValidRole(role)) {
    clearAllAuthSessions();
    return null;
  }

  if (
    privilegedValidationCache &&
    (privilegedValidationCache.uid !== uid || privilegedValidationCache.role !== role)
  ) {
    clearPrivilegedValidationCache();
  }

  const existingSession = getModuleSession(role);
  const nextSession = {
    uid,
    email: (profile.email || '').toString().trim().toLowerCase(),
    role,
    branchId: (profile.branchId || '').toString().trim(),
    branchName: (profile.branchName || profile.branch?.name || '').toString().trim(),
    managerStatus: (profile.managerStatus || '').toString().trim().toLowerCase(),
  };
  const hasSameIdentity =
    existingSession &&
    existingSession.uid === nextSession.uid &&
    existingSession.email === nextSession.email &&
    existingSession.role === nextSession.role &&
    existingSession.branchId === nextSession.branchId &&
    existingSession.managerStatus === nextSession.managerStatus;
  const session = hasSameIdentity
    ? existingSession
    : {
        ...nextSession,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

  setSessions(session, { [role]: session });
  return session;
};

export const clearModuleSession = (role) => {
  const normalizedRole = normalizeRole(role);
  const activeSession = getActiveSession();
  const moduleSessions = { ...getModuleSessions() };

  delete moduleSessions[normalizedRole];

  setSessions(
    activeSession?.role === normalizedRole ? null : activeSession,
    moduleSessions
  );
};

export const clearAllAuthSessions = () => {
  clearPrivilegedValidationCache();
  clearAdminDataCache();
  globalThis.__bluetapResetPrivilegedLoginValidations?.();
  setSessions(null, {});
};

export const invalidateAuthStateForUid = (uid) => {
  const normalizedUid = String(uid || '');
  if (!normalizedUid) {
    clearAllAuthSessions();
    return true;
  }

  const storedSessions = [getActiveSession(), ...Object.values(getModuleSessions())]
    .filter(Boolean);
  const hasStaleStoredSession = storedSessions.some(
    (session) => !session.uid || String(session.uid) !== normalizedUid
  );
  const hasStalePrivilegedCache =
    privilegedValidationCache && privilegedValidationCache.uid !== normalizedUid;

  if (hasStaleStoredSession || hasStalePrivilegedCache) {
    clearAllAuthSessions();
    return true;
  }

  return false;
};

export const subscribeAuthSessionChanges = (listener) => {
  if (!globalThis.addEventListener) {
    return () => {};
  }

  const handleStorage = (event) => {
    if (
      !event ||
      event.key === ACTIVE_SESSION_KEY ||
      event.key === MODULE_SESSIONS_KEY
    ) {
      listener();
    }
  };

  globalThis.addEventListener(AUTH_SESSION_CHANGED_EVENT, listener);
  globalThis.addEventListener('storage', handleStorage);

  return () => {
    globalThis.removeEventListener?.(AUTH_SESSION_CHANGED_EVENT, listener);
    globalThis.removeEventListener?.('storage', handleStorage);
  };
};

const normalizeApprovalStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

export const getDistributorApplicationStatus = (profile = {}) =>
  normalizeApprovalStatus(
    profile.approvalStatus ||
      profile.status ||
      profile.accountStatus ||
      'pending'
  );

const buildFirestoreProfile = (user, data = {}) => ({
  ...data,
  uid: user.uid,
  email: (data.email || user.email || '').toString().trim().toLowerCase(),
  role: normalizeRole(data.role),
});

export const fetchFirestoreUserProfile = async (user) => {
  if (!user?.uid) return null;

  // Authentication and authorization routing must use the authoritative
  // server profile. A cached pre-finalization document can otherwise send a
  // newly completed registration back through the legacy verification route.
  const snapshot = await getDocFromServer(doc(db, 'users', user.uid));

  if (!snapshot.exists()) {
    return null;
  }

  let profile = {
    ...buildFirestoreProfile(user, snapshot.data()),
    faceVerification: normalizeFaceVerification(snapshot.data()),
  };

  if (profile.role) {
    saveLocalUser(profile);
  }

  return profile;
};

const validateRoleAccessOnce = async (expectedRole) => {
  const expected = normalizeRole(expectedRole);

  if (!isValidRole(expected)) {
    return {
      status: 'unauthorized',
      message: 'Unauthorized Access',
      redirectTo: '/login',
      shouldSignOut: true,
    };
  }

  const currentUser = auth.currentUser;

  if (!currentUser) {
    clearAllAuthSessions();
    return {
      status: 'unauthenticated',
      message: 'Unauthorized Access',
      redirectTo: getRoleLoginPath(expected),
      clearRole: expected,
    };
  }

  invalidateAuthStateForUid(currentUser.uid);

  const cachedPrivilegedProfile = ['admin', 'manager'].includes(expected)
    ? getCachedPrivilegedAccess(currentUser, expected)
    : null;
  if (cachedPrivilegedProfile) {
    return { status: 'authorized', profile: cachedPrivilegedProfile, cached: true };
  }

  // Admin sign-in performs its one allowed forced refresh. Manager uses the
  // public login, whose custom-token session already contains current claims.
  // Route guards inspect the SDK's current token without forcing another
  // Secure Token request or creating a login/dashboard loop.
  if (expected === 'admin' || expected === 'manager') {
    let token;
    try {
      token = await currentUser.getIdTokenResult();
    } catch (error) {
      console.warn('[role-validation]', {
        stage: 'TOKEN_REFRESH_FAILED',
        expectedRole: expected,
        code: String(error?.code || '').startsWith('auth/') ? error.code : 'auth/token-refresh-failed',
      });
      return {
        status: 'token-refresh-failed',
        message: 'Your secure sign-in session expired. Please sign in again.',
        redirectTo: getRoleLoginPath(expected),
        shouldSignOut: true,
        clearRole: expected,
      };
    }
    const trustedClaim = expected === 'admin'
      ? token.claims?.admin === true || token.claims?.role === 'admin'
      : token.claims?.manager === true || token.claims?.role === 'manager';
    if (!trustedClaim) {
      return {
        status: 'unauthorized',
        message: expected === 'admin' ? 'Administrator access is required.' : 'Manager access is required.',
        redirectTo: getRoleLoginPath(expected),
        shouldSignOut: true,
        clearRole: expected,
      };
    }
  }

  let profile = null;

  try {
    profile = await fetchFirestoreUserProfile(currentUser);
  } catch (error) {
    console.warn('[role-validation]', {
      stage: 'PROFILE_READ_DENIED',
      expectedRole: expected,
      code: error?.code || 'unknown',
    });

    return {
      status: 'unauthorized',
      message: expected === 'admin'
        ? 'Administrator profile could not be verified. Please contact support.'
        : expected === 'manager'
          ? 'Manager profile could not be verified. Please contact support.'
          : 'Unauthorized Access',
      redirectTo: getRoleLoginPath(expected),
      shouldSignOut: true,
      clearRole: expected,
    };
  }

  if (auth.currentUser?.uid !== currentUser.uid) {
    return {
      status: 'unauthenticated',
      message: 'Unauthorized Access',
      redirectTo: getRoleLoginPath(expected),
      clearRole: expected,
    };
  }

  if (!profile?.role || !isValidRole(profile.role)) {
    return {
      status: 'unauthorized',
      message: 'Unauthorized Access',
      redirectTo: '/login',
      shouldSignOut: true,
      clearRole: expected,
    };
  }

  if (profile.mustChangePassword === true) {
    return { status: 'password-change-required', message: 'Change your temporary password to continue.', redirectTo: '/required-password-change', clearRole: expected };
  }

  if (
    (profile.role === 'requester' || profile.role === 'distributor') &&
    profile.emailVerificationRequired === true &&
    !currentUser.emailVerified
  ) {
    return {
      status: 'email-unverified',
      message: 'Verify your email to continue.',
      redirectTo: '/email-verification',
      clearRole: expected,
    };
  }

  if (profile.onboardingStatus === 'face_enrollment_pending' || profile.registrationCompleted === false) {
    return {
      status: 'onboarding-pending',
      message: 'Your account is still completing secure face enrollment.',
      redirectTo: '/registration-status',
      clearRole: expected,
    };
  }

  if ((profile.role === 'requester' || profile.role === 'distributor') && !isFaceRequirementSatisfied(profile)) {
    return {
      status: 'face-unverified',
      message: 'Complete identity verification to continue.',
      redirectTo: '/verification',
      clearRole: expected,
    };
  }

  if (profile.role !== expected) {
    saveRoleSession(profile);

    return {
      status: 'role-mismatch',
      message: 'Unauthorized Access',
      redirectTo: getRoleHomePath(profile.role),
      clearRole: expected,
      actualRole: profile.role,
    };
  }


  if (expected === 'manager') {
    try {
      const context = await getManagerContext();
      profile = { ...profile, ...context.manager, branch: context.branch, branchName: context.branch?.name || '' };
    } catch (error) {
      const inactive = ['MANAGER_INACTIVE', 'BRANCH_INACTIVE', 'BRANCH_ACCESS_DENIED'].includes(error.code);
      return {
        status: inactive ? 'manager-inactive' : 'unauthorized',
        message: error.message || 'Manager access is unavailable.',
        redirectTo: inactive ? `/manager-access-status?reason=${encodeURIComponent(error.code)}` : '/login',
        shouldSignOut: !inactive,
        clearRole: expected,
      };
    }
  }

  if (
    profile.role === 'distributor' &&
    !['approved', 'active'].includes(getDistributorApplicationStatus(profile))
  ) {
    return {
      status: 'unauthorized',
      message: 'Your distributor application is awaiting administrator approval.',
      redirectTo: '/registration-status',
      clearRole: expected,
    };
  }

  saveRoleSession(profile);
  if (expected === 'admin' || expected === 'manager') cacheValidatedPrivilegedAccess(profile);

  return {
    status: 'authorized',
    profile,
  };
};

export const validateRoleAccess = async (expectedRole) => {
  const expected = normalizeRole(expectedRole);
  const key = `${auth.currentUser?.uid || 'signed-out'}:${expected}`;
  if (privilegedValidationInFlight.has(key)) {
    console.info('[admin-performance]', { stage: 'ADMIN_AUTH_VALIDATION_DEDUPED', role: expected });
    return privilegedValidationInFlight.get(key);
  }
  const startedAt = Date.now();
  if (expected === 'admin') console.info('[admin-performance]', { stage: 'ADMIN_AUTH_VALIDATION_STARTED' });
  const request = validateRoleAccessOnce(expected).then((result) => {
    if (expected === 'admin') console.info('[admin-performance]', { stage: 'ADMIN_AUTH_VALIDATION_FINISHED', durationMs: Date.now() - startedAt, status: result.status, cached: result.cached === true });
    return result;
  }).finally(() => privilegedValidationInFlight.delete(key));
  privilegedValidationInFlight.set(key, request);
  return request;
};

export const signOutAndClearSessions = async () => {
  clearAllAuthSessions();

  try {
    await signOut(auth);
  } catch (error) {
    console.log('Sign out error:', error.message);
  }
};
