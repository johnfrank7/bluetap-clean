import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALLATION_ID_KEY = 'bluetapInstallationId';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let installationIdPromise = null;

function createUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure installation identity generation is unavailable.');
  }
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function getInstallationId() {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
      if (UUID_PATTERN.test(existing || '')) return existing;
      const created = createUuid();
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, created);
      return created;
    })().catch((error) => {
      installationIdPromise = null;
      throw error;
    });
  }
  return installationIdPromise;
}
