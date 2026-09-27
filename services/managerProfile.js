import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function managerProfileRequest({ method = 'GET', body } = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    const error = new Error('Manager authentication is required.');
    error.code = 'AUTHENTICATION_REQUIRED';
    throw error;
  }
  const response = await fetch(getApiUrl('/api/manager/profile'), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'Manager profile could not be saved.');
    error.code = result?.error?.reason || 'service-unavailable';
    error.status = response.status;
    error.fieldErrors = result?.error?.fieldErrors || null;
    throw error;
  }
  return result?.profile || null;
}

export function profileImagePayload(asset) {
  if (!asset) return null;
  const uriType = /^data:([^;,]+);base64,/i.exec(String(asset.uri || ''))?.[1] || '';
  const extension = String(asset.fileName || asset.uri || '').split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  const extensionType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : '';
  const contentType = String(asset.mimeType || uriType || extensionType).toLowerCase();
  const dataBase64 = String(asset.base64 || '').replace(/^data:[^;,]+;base64,/i, '');
  const estimatedBytes = Math.floor(dataBase64.length * 3 / 4);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error('Use a JPG, PNG, or WebP profile picture.');
  if (!dataBase64 || estimatedBytes <= 0 || estimatedBytes > MAX_AVATAR_BYTES) throw new Error('Profile pictures must be 3 MB or smaller.');
  return {
    contentType,
    dataBase64,
    fileName: String(asset.fileName || 'profile-picture').replace(/[\\/\u0000-\u001f\u007f]/g, '-').slice(0, 120),
  };
}

export const ensureManagerProfile = () => managerProfileRequest();

export const updateManagerProfile = (changes, imageAsset = null) => managerProfileRequest({
  method: 'PATCH',
  body: { ...changes, ...(imageAsset ? { imageUpload: profileImagePayload(imageAsset) } : {}) },
});
