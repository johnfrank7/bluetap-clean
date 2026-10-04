import AsyncStorage from '@react-native-async-storage/async-storage';

export const ASSISTANT_STORAGE_VERSION = 1;
export const MAX_STORED_MESSAGES = 40;

const memoryStore = new Map();

/**
 * Returns YYYY-MM-DD for the given date in local calendar time.
 * @param {Date|number|string} [date]
 * @returns {string}
 */
export function getLocalDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    const year = fallback.getFullYear();
    const month = String(fallback.getMonth() + 1).padStart(2, '0');
    const day = String(fallback.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Builds a stable per-user storage key.
/**
 * Builds a stable per-user storage key scoped by role.
 * One stable key per user ensures old transcripts do not accumulate across calendar dates,
 * while role-scoping isolates Requester and Distributor transcripts.
 * @param {string|object} userIdOrParams
 * @param {string} [role='requester']
 * @returns {string}
 */
export function buildAssistantStorageKey(userIdOrParams, role = 'requester') {
  let userId = userIdOrParams;
  let targetRole = role;
  if (userIdOrParams && typeof userIdOrParams === 'object') {
    userId = userIdOrParams.userId;
    targetRole = userIdOrParams.role || role;
  }
  const safeUser = String(userId || '').trim();
  if (!safeUser || safeUser === 'anonymous') return '';
  const safeRole = String(targetRole || 'requester').trim().toLowerCase();
  return `bluetap-assistant:${safeRole}:${safeUser}`;
}

/**
 * Sanitizes messages before persisting to storage.
 * Bounded to maxCount (default 40).
 * Strips confidential/token fields and preserves UI presentation essentials.
 * @param {Array} messages
 * @param {number} [maxCount]
 * @returns {Array}
 */
export function sanitizeMessagesForStorage(messages, maxCount = MAX_STORED_MESSAGES) {
  if (!Array.isArray(messages)) return [];
  const bounded = messages.slice(-maxCount);

  return bounded.map((msg, index) => {
    if (!msg || typeof msg !== 'object') {
      return {
        id: `msg-${index}`,
        role: 'assistant',
        text: '',
        timestamp: Date.now(),
      };
    }

    const cleanMsg = {
      id: String(msg.id || `msg-${Date.now()}-${index}`),
      role: msg.role === 'user' ? 'user' : 'assistant',
      text: typeof msg.text === 'string' ? msg.text : '',
      timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
    };

    if (Array.isArray(msg.cards) && msg.cards.length > 0) {
      cleanMsg.cards = msg.cards.map((card) => {
        if (!card || typeof card !== 'object') return {};
        // Strip sensitive internal fields, tokens, or reporter identities
        const {
          internalNotes,
          reporterId,
          reporterUid,
          privateNotes,
          evidenceNotes,
          rawLocation,
          authToken,
          ...displaySafeCard
        } = card;
        return displaySafeCard;
      });
    }

    if (Array.isArray(msg.actions) && msg.actions.length > 0) {
      cleanMsg.actions = msg.actions.map((act) => {
        if (!act || typeof act !== 'object') return {};
        const { authToken, headers, secret, credential, ...displaySafeAction } = act;
        return displaySafeAction;
      });
    }

    if (typeof msg.intent === 'string') {
      cleanMsg.intent = msg.intent;
    }

    return cleanMsg;
  });
}

async function storageGetItem(key) {
  if (!key) return null;
  try {
    if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
      const val = await AsyncStorage.getItem(key);
      if (val !== null && val !== undefined) return val;
    }
  } catch (err) {
    // Fall back to memoryStore (e.g., in headless test environments where window is undefined)
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

async function storageSetItem(key, val) {
  if (!key) return;
  memoryStore.set(key, val);
  try {
    if (AsyncStorage && typeof AsyncStorage.setItem === 'function') {
      await AsyncStorage.setItem(key, val);
    }
  } catch (err) {
    // Memory store already set
  }
}

async function storageRemoveItem(key) {
  if (!key) return;
  memoryStore.delete(key);
  try {
    if (AsyncStorage && typeof AsyncStorage.removeItem === 'function') {
      await AsyncStorage.removeItem(key);
    }
  } catch (err) {
    // Memory store already cleared
  }
}

/**
 * Cleans up legacy date-specific keys (e.g. bluetap-assistant:user:2026-10-04)
 * for this specific user so they do not accumulate in storage.
 * @param {string} userId
 */
async function cleanupLegacyUserKeys(userId) {
  const safeUser = String(userId || '').trim();
  if (!safeUser || safeUser === 'anonymous') return;
  const legacyPrefix = `bluetap-assistant:${safeUser}:`;

  // Clean from memoryStore
  for (const k of memoryStore.keys()) {
    if (k.startsWith(legacyPrefix)) {
      memoryStore.delete(k);
    }
  }

  // Clean from AsyncStorage
  try {
    if (AsyncStorage && typeof AsyncStorage.getAllKeys === 'function') {
      const allKeys = await AsyncStorage.getAllKeys();
      const legacyKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith(legacyPrefix));
      if (legacyKeys.length > 0 && typeof AsyncStorage.multiRemove === 'function') {
        await AsyncStorage.multiRemove(legacyKeys);
      }
    }
  } catch (err) {
    // Ignore legacy cleanup errors
  }
}

/**
 * Retrieves the raw persisted record for testing / verification.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.role='requester']
 * @returns {Promise<object|null>}
 */
export async function getRawAssistantStorageRecord({ userId, role = 'requester' } = {}) {
  const key = buildAssistantStorageKey(userId, role);
  if (!key) return null;
  const raw = await storageGetItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Loads today's persisted assistant messages for a user.
 * If the date has changed, stale transcript data is explicitly deleted from storage,
 * returning a fresh empty array so old transcripts never accumulate.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.role='requester']
 * @param {Date|string} [params.date]
 * @returns {Promise<Array>}
 */
export async function loadDailyAssistantChat({ userId, role = 'requester', date = new Date() } = {}) {
  try {
    const key = buildAssistantStorageKey(userId, role);
    if (!key) return [];

    // Trigger cleanup of any legacy date-suffixed keys for this user
    await cleanupLegacyUserKeys(userId);

    const dateKey = getLocalDateKey(date);
    let raw = await storageGetItem(key);

    // If not found under scoped key and role is requester, check legacy un-scoped key and migrate safely
    if (!raw && role === 'requester') {
      const legacyKey = `bluetap-assistant:${String(userId).trim()}`;
      const legacyRaw = await storageGetItem(legacyKey);
      if (legacyRaw) {
        raw = legacyRaw;
        await storageSetItem(key, legacyRaw);
        await storageRemoveItem(legacyKey);
      }
    }

    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      await storageRemoveItem(key);
      return [];
    }

    // If dateKey does not match today's local date, or version mismatch:
    // Calendar date has transitioned: remove stale yesterday data so it does not accumulate.
    if (parsed.version !== ASSISTANT_STORAGE_VERSION || parsed.dateKey !== dateKey) {
      await storageRemoveItem(key);
      return [];
    }

    if (!Array.isArray(parsed.messages)) {
      await storageRemoveItem(key);
      return [];
    }

    return sanitizeMessagesForStorage(parsed.messages);
  } catch (err) {
    // On parse error or corrupt data, return empty array safely
    return [];
  }
}

/**
 * Persists today's assistant messages for a user under the stable per-user key.
 * Overwrites previous day data completely.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.role='requester']
 * @param {Array} params.messages
 * @param {Date|string} [params.date]
 * @returns {Promise<boolean>}
 */
export async function saveDailyAssistantChat({ userId, role = 'requester', messages = [], date = new Date() } = {}) {
  try {
    if (!userId || userId === 'anonymous' || !Array.isArray(messages) || messages.length === 0) {
      return false;
    }

    const key = buildAssistantStorageKey(userId, role);
    if (!key) return false;

    const dateKey = getLocalDateKey(date);
    const sanitized = sanitizeMessagesForStorage(messages);
    const payload = {
      version: ASSISTANT_STORAGE_VERSION,
      role: String(role || 'requester').trim().toLowerCase(),
      dateKey,
      userId: String(userId).trim(),
      messages: sanitized,
      updatedAt: Date.now(),
    };

    await storageSetItem(key, JSON.stringify(payload));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Clears today's assistant messages for a user.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.role='requester']
 * @returns {Promise<boolean>}
 */
export async function clearDailyAssistantChat({ userId, role = 'requester' } = {}) {
  try {
    const key = buildAssistantStorageKey(userId, role);
    if (key) await storageRemoveItem(key);
    if (role === 'requester') {
      const legacyKey = `bluetap-assistant:${String(userId).trim()}`;
      await storageRemoveItem(legacyKey);
    }
    await cleanupLegacyUserKeys(userId);
    return true;
  } catch (err) {
    return false;
  }
}

export default {
  ASSISTANT_STORAGE_VERSION,
  MAX_STORED_MESSAGES,
  getLocalDateKey,
  buildAssistantStorageKey,
  sanitizeMessagesForStorage,
  getRawAssistantStorageRecord,
  loadDailyAssistantChat,
  saveDailyAssistantChat,
  clearDailyAssistantChat,
};
