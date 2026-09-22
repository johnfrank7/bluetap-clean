import { getApiUrl } from './apiClient';
import { getInstallationId } from './installationId';

export const callRegistrationApi = async (path, body, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getApiUrl(path, () => new Error('Registration verification is unavailable in this app build.')), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Registration verification is temporarily unavailable.');
      error.code = `registration/${data?.error?.reason || 'service-unavailable'}`;
      throw error;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      const error = new Error('The registration service update is not available yet. Please deploy the latest BlueTap version and try again.');
      error.code = 'registration/invalid-response';
      throw error;
    }
    return data;
  } catch (error) {
    if (String(error.code || '').startsWith('registration/')) throw error;
    const network = new Error('We could not reach the registration verification service.');
    network.code = 'registration/network';
    throw network;
  } finally { clearTimeout(timeout); }
};

export const createRegistrationSession = async (personalInfo) => {
  const result = await callRegistrationApi('/api/auth/create-registration-session', {
    ...personalInfo,
    installationId: await getInstallationId(),
  });
  if (typeof result.registrationSessionId !== 'string' || !result.registrationSessionId) {
    const error = new Error('The registration service returned an incomplete response. Please try again.');
    error.code = 'registration/invalid-response';
    throw error;
  }
  return result;
};
export const getRegistrationSecurityPolicy = async () => {
  const result = await callRegistrationApi('/api/auth/registration-policy', {});
  const policy = result?.securityPolicy;
  if (typeof policy?.faceVerificationRequired !== 'boolean' || typeof policy?.emailOtpRequired !== 'boolean') {
    const error = new Error('The registration policy is unavailable. Please try again.');
    error.code = 'registration/invalid-response';
    throw error;
  }
  return policy;
};
export const getRegistrationBranches = async () => {
  const result = await callRegistrationApi('/api/auth/registration-branches', {});
  if (!Array.isArray(result?.branches)) {
    const error = new Error('BlueTap branches are temporarily unavailable. Please try again.');
    error.code = 'registration/invalid-response';
    throw error;
  }
  return result.branches.filter((branch) => typeof branch?.id === 'string' && typeof branch?.name === 'string');
};
export const getRegistrationSessionStatus = (registrationSessionId) => callRegistrationApi('/api/auth/registration-session-status', { registrationSessionId });
export const acceptRegistrationTerms = (registrationSessionId) => callRegistrationApi('/api/auth/accept-registration-terms', { registrationSessionId });
