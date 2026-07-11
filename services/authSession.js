import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { saveLocalUser } from '../localUsers';

const ACTIVE_SESSION_KEY = 'bluetapActiveAuthSession';
const MODULE_SESSIONS_KEY = 'bluetapModuleAuthSessions';
export const AUTH_SESSION_CHANGED_EVENT = 'bluetapAuthSessionChanged';

const ROLE_HOME_PATHS = {
  admin: '/admin/dashboard',
  requester: '/requester/r_dashboard',
  distributor: '/distributor/d_dashboard',
};

const validRoles = new Set(Object.keys(ROLE_HOME_PATHS));

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

export const isValidRole = (role) => validRoles.has(normalizeRole(role));

export const getModuleSession = (role) =>
  getModuleSessions()[normalizeRole(role)] || null;

export const saveRoleSession = (profile = {}) => {
  const role = normalizeRole(profile.role);

  if (!isValidRole(role)) {
    clearAllAuthSessions();
    return null;
  }

  const existingSession = getModuleSession(role);
  const nextSession = {
    uid: profile.uid || profile.id || '',
    email: (profile.email || '').toString().trim().toLowerCase(),
    role,
    isAdminSecret: !!profile.isAdminSecret,
  };
  const hasSameIdentity =
    existingSession &&
    existingSession.uid === nextSession.uid &&
    existingSession.email === nextSession.email &&
    existingSession.role === nextSession.role &&
    !!existingSession.isAdminSecret === nextSession.isAdminSecret;
  const session = hasSameIdentity
    ? existingSession
    : {
        ...nextSession,
        updatedAt: Date.now(),
      };

  setSessions(session, { [role]: session });
  return session;
};

export const saveAdminSession = () =>
  saveRoleSession({
    uid: 'secret-admin',
    email: 'bluetapadmin',
    role: 'admin',
    isAdminSecret: true,
  });

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
  setSessions(null, {});
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

const getDistributorApplicationStatus = (profile = {}) =>
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

  const snapshot = await getDoc(doc(db, 'users', user.uid));

  if (!snapshot.exists()) {
    return null;
  }

  const profile = buildFirestoreProfile(user, snapshot.data());

  if (profile.role) {
    saveLocalUser(profile);
  }

  return profile;
};

const getAdminSessionAccess = () => {
  const adminSession = getModuleSession('admin');

  if (!adminSession?.isAdminSecret) {
    return null;
  }

  return {
    status: 'authorized',
    profile: adminSession,
  };
};

export const validateRoleAccess = async (expectedRole) => {
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

  if (expected === 'admin' && !currentUser) {
    const adminAccess = getAdminSessionAccess();

    if (adminAccess) {
      return adminAccess;
    }
  }

  if (!currentUser) {
    return {
      status: 'unauthenticated',
      message: 'Unauthorized Access',
      redirectTo: '/login',
      clearRole: expected,
    };
  }

  let profile = null;

  try {
    profile = await fetchFirestoreUserProfile(currentUser);
  } catch (error) {
    console.log('Role validation profile read error:', error.message);

    return {
      status: 'unauthorized',
      message: 'Unauthorized Access',
      redirectTo: '/login',
      shouldSignOut: true,
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

  if (
    profile.role === 'distributor' &&
    getDistributorApplicationStatus(profile) !== 'approved'
  ) {
    return {
      status: 'unauthorized',
      message: 'Unauthorized Access',
      redirectTo: '/login',
      shouldSignOut: true,
      clearRole: expected,
    };
  }

  saveRoleSession(profile);

  return {
    status: 'authorized',
    profile,
  };
};

export const signOutAndClearSessions = async () => {
  clearAllAuthSessions();

  try {
    await signOut(auth);
  } catch (error) {
    console.log('Sign out error:', error.message);
  }
};
