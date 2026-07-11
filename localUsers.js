const STORAGE_KEY = 'bluetapLocalUsers';
export const LOCAL_USERS_CHANGED_EVENT = 'bluetapLocalUsersChanged';

const normalizeEmail = (email) => email?.trim().toLowerCase() || '';
const normalizeRole = (role) => role?.toString().trim().toLowerCase() || '';

const getMemoryStore = () => {
  if (!globalThis.__bluetapLocalUsers) {
    globalThis.__bluetapLocalUsers = [];
  }

  return globalThis.__bluetapLocalUsers;
};

export const getLocalUsers = () => {
  try {
    if (globalThis.localStorage) {
      const storedUsers = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(storedUsers) ? storedUsers : [];
    }
  } catch (error) {
    console.log('Local users read error:', error.message);
  }

  return getMemoryStore();
};

export const saveLocalUser = (userData) => {
  const users = getLocalUsers();
  const normalizedUserData = {
    ...userData,
    email: normalizeEmail(userData.email),
  };
  const nextUsers = [
    ...users.filter(
      (user) =>
        user.uid !== normalizedUserData.uid &&
        normalizeEmail(user.email) !== normalizedUserData.email
    ),
    normalizedUserData,
  ];

  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUsers));
    } else {
      globalThis.__bluetapLocalUsers = nextUsers;
    }
  } catch (error) {
    console.log('Local users save error:', error.message);
    globalThis.__bluetapLocalUsers = nextUsers;
  }

  try {
    globalThis.dispatchEvent?.(new Event(LOCAL_USERS_CHANGED_EVENT));
  } catch (error) {
    console.log('Local users event error:', error.message);
  }

  return nextUsers;
};

export const findLocalUserByEmail = (email) =>
  getLocalUsers().find((user) => normalizeEmail(user.email) === normalizeEmail(email));

export const findLocalUserForAuthUser = (authUser) => {
  const uid = authUser?.uid || '';
  const email = normalizeEmail(authUser?.email);

  if (!uid && !email) return null;

  return (
    getLocalUsers().find(
      (user) =>
        (uid && user.uid === uid) ||
        (email && normalizeEmail(user.email) === email)
    ) || null
  );
};

export const findLocalUserForAuthRole = (authUser, role) => {
  const localUser = findLocalUserForAuthUser(authUser);

  if (!localUser || normalizeRole(localUser.role) !== normalizeRole(role)) {
    return null;
  }

  return localUser;
};

const toApplicationStatus = (approvalStatus) => {
  const normalizedStatus = (approvalStatus || '').toString().trim().toLowerCase();

  if (normalizedStatus === 'approved') return 'Approved';
  if (normalizedStatus === 'rejected') return 'Rejected';

  return 'Pending';
};

export const updateLocalUserStatus = (uid, approvalStatus, options = {}) => {
  const normalizedStatus = (approvalStatus || '').toString().trim().toLowerCase();
  const nextUsers = getLocalUsers().map((user) =>
    user.uid === uid
      ? {
          ...user,
          approvalStatus: normalizedStatus,
          status: toApplicationStatus(normalizedStatus),
          rejectionReason:
            normalizedStatus === 'rejected'
              ? options.rejectionReason || user.rejectionReason || ''
              : null,
        }
      : user
  );

  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUsers));
    } else {
      globalThis.__bluetapLocalUsers = nextUsers;
    }
  } catch (error) {
    console.log('Local users update error:', error.message);
    globalThis.__bluetapLocalUsers = nextUsers;
  }

  try {
    globalThis.dispatchEvent?.(new Event(LOCAL_USERS_CHANGED_EVENT));
  } catch (error) {
    console.log('Local users event error:', error.message);
  }

  return nextUsers;
};

export const subscribeLocalUsers = (listener) => {
  if (!globalThis.addEventListener) {
    return () => {};
  }

  const handleStorage = (event) => {
    if (!event || event.key === STORAGE_KEY) {
      listener();
    }
  };

  globalThis.addEventListener(LOCAL_USERS_CHANGED_EVENT, listener);
  globalThis.addEventListener('storage', handleStorage);

  return () => {
    globalThis.removeEventListener?.(LOCAL_USERS_CHANGED_EVENT, listener);
    globalThis.removeEventListener?.('storage', handleStorage);
  };
};
