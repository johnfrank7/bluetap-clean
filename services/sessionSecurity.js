import { getApiUrl } from './apiClient';
import { auth } from '../firebase';

const safeDefaults = {
  requester: { idleTimeoutMinutes: 30, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
  distributor: { idleTimeoutMinutes: 30, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
  manager: { idleTimeoutMinutes: 15, absoluteSessionHours: 24, forceLogoutAfterPasswordChange: true },
};

export async function getSessionPolicy(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!safeDefaults[normalizedRole]) return null;
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : '';
    const response = await fetch(getApiUrl('/api/auth/session-policy'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ role: normalizedRole }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.policy) throw new Error('Session policy unavailable.');
    return result.policy;
  } catch {
    return safeDefaults[normalizedRole];
  }
}
