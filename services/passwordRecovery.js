import { getApiUrl } from './apiClient';

const request = async (body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(getApiUrl('/api/auth/password-recovery'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(data?.error?.message || 'Password recovery is temporarily unavailable. Please try again.'); error.code = data?.error?.code || 'RECOVERY_UNAVAILABLE'; error.retryAfterSeconds = data?.error?.retryAfterSeconds; throw error; }
    return data || {};
  } catch (error) {
    if (error.code) throw error;
    const network = new Error('Password recovery is temporarily unavailable. Please try again.'); network.code = 'RECOVERY_UNAVAILABLE'; throw network;
  } finally { clearTimeout(timeout); }
};

export const requestPasswordRecovery = (email) => request({ action: 'request', email });
export const verifyPasswordRecovery = (recoverySessionId, code) => request({ action: 'verify', recoverySessionId, code });
export const completePasswordRecovery = (recoverySessionId, resetAuthorization, newPassword) => request({ action: 'complete', recoverySessionId, resetAuthorization, newPassword });
