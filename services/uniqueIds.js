import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';

import { db } from '../firebase';

const USERS_COLLECTION = 'users';
const COUNTERS_COLLECTION = 'counters';
const UNIQUE_ID_COUNTER_DOC = 'unique_ids';

const ROLE_CONFIG = {
  requester: {
    counterField: 'requester',
    prefix: 'REQ',
  },
  distributor: {
    counterField: 'distributor',
    prefix: 'DIS',
  },
};

export const normalizeUniqueIdRole = (role) =>
  role?.toString().trim().toLowerCase() || '';

export const getProfileUniqueId = (profile = {}) => {
  const safeProfile = profile || {};

  return (safeProfile.unique_id || safeProfile.uniqueId || '').toString().trim();
};

export const getUniqueIdConfig = (role) =>
  ROLE_CONFIG[normalizeUniqueIdRole(role)] || null;

export const formatUniqueId = (role, number) => {
  const config = getUniqueIdConfig(role);

  if (!config) return '';

  return `${config.prefix}-${String(Number(number) || 0).padStart(6, '0')}`;
};

const parseUniqueIdNumber = (role, uniqueId) => {
  const config = getUniqueIdConfig(role);
  const normalizedUniqueId = (uniqueId || '').toString().trim();

  if (!config || !normalizedUniqueId) return 0;

  const match = normalizedUniqueId.match(
    new RegExp(`^${config.prefix}-(\\d{6})$`)
  );
  const parsedNumber = Number(match?.[1] || 0);

  return Number.isFinite(parsedNumber) ? parsedNumber : 0;
};

const getHighestExistingUniqueIdNumber = async (role) => {
  const config = getUniqueIdConfig(role);

  if (!config) return 0;

  try {
    const usersQuery = query(
      collection(db, USERS_COLLECTION),
      where('unique_id', '>=', `${config.prefix}-000000`),
      where('unique_id', '<=', `${config.prefix}-999999`),
      orderBy('unique_id', 'desc'),
      limit(1)
    );
    const snapshot = await getDocs(usersQuery);
    const highestUniqueId = getProfileUniqueId(snapshot.docs[0]?.data());

    return parseUniqueIdNumber(role, highestUniqueId);
  } catch (error) {
    console.log('Unique ID max lookup error:', error.message);
    return 0;
  }
};

export const saveUserProfileWithUniqueId = async (uid, role, profileData = {}) => {
  const normalizedRole = normalizeUniqueIdRole(role || profileData.role);
  const config = getUniqueIdConfig(normalizedRole);
  const normalizedUid = (uid || profileData.uid || profileData.id || '')
    .toString()
    .trim();

  if (!normalizedUid || !config) {
    return {
      ...profileData,
      uid: normalizedUid,
      role: normalizedRole || profileData.role,
    };
  }

  const observedHighestNumber = await getHighestExistingUniqueIdNumber(
    normalizedRole
  );
  const userRef = doc(db, USERS_COLLECTION, normalizedUid);
  const counterRef = doc(db, COUNTERS_COLLECTION, UNIQUE_ID_COUNTER_DOC);

  return runTransaction(db, async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const counterSnapshot = await transaction.get(counterRef);
    const existingProfile = userSnapshot.exists() ? userSnapshot.data() : {};
    const existingUniqueId =
      getProfileUniqueId(existingProfile) ||
      (userSnapshot.exists() ? getProfileUniqueId(profileData) : '');
    const counterData = counterSnapshot.exists() ? counterSnapshot.data() : {};
    const currentCounterNumber = Number(counterData[config.counterField] || 0);
    const safeCounterNumber = Number.isFinite(currentCounterNumber)
      ? currentCounterNumber
      : 0;
    const profilePayload = {
      ...profileData,
      uid: normalizedUid,
      role: normalizedRole,
    };

    if (existingUniqueId) {
      const existingUniqueNumber = parseUniqueIdNumber(
        normalizedRole,
        existingUniqueId
      );

      if (existingUniqueNumber > safeCounterNumber) {
        transaction.set(
          counterRef,
          { [config.counterField]: existingUniqueNumber },
          { merge: true }
        );
      }

      transaction.set(
        userRef,
        {
          ...profilePayload,
          unique_id: existingUniqueId,
        },
        { merge: true }
      );

      return {
        ...existingProfile,
        ...profilePayload,
        unique_id: existingUniqueId,
      };
    }

    const nextNumber =
      Math.max(safeCounterNumber, observedHighestNumber || 0) + 1;
    const uniqueId = formatUniqueId(normalizedRole, nextNumber);

    transaction.set(
      counterRef,
      { [config.counterField]: nextNumber },
      { merge: true }
    );
    transaction.set(
      userRef,
      {
        ...profilePayload,
        unique_id: uniqueId,
      },
      { merge: true }
    );

    return {
      ...existingProfile,
      ...profilePayload,
      unique_id: uniqueId,
    };
  });
};

export const ensureUserUniqueId = async (user, profile = {}) => {
  const safeProfile = profile || {};
  const uid =
    typeof user === 'string'
      ? user
      : user?.uid || safeProfile.uid || safeProfile.id;
  const role = normalizeUniqueIdRole(safeProfile.role);

  if (!uid || !getUniqueIdConfig(role)) {
    return safeProfile;
  }

  const existingUniqueId = getProfileUniqueId(safeProfile);

  if (existingUniqueId) {
    return {
      ...safeProfile,
      unique_id: existingUniqueId,
    };
  }

  try {
    return await saveUserProfileWithUniqueId(uid, role, {
      ...safeProfile,
      uid,
      role,
    });
  } catch (error) {
    console.log('Unique ID assignment error:', error.message);
    return safeProfile;
  }
};
