import { Platform } from 'react-native';

export const getApiBaseUrl = () =>
  (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function getApiUrl(path, createUnavailableError) {
  const baseUrl = getApiBaseUrl();
  if (Platform.OS !== 'web' && !baseUrl) {
    throw typeof createUnavailableError === 'function'
      ? createUnavailableError()
      : new Error('The BlueTap API is unavailable in this app build.');
  }
  return `${baseUrl}${path}`;
}
