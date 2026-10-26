import { connectAuthEmulator, getAuth } from 'firebase/auth';

import { app } from './firebaseApp';
import { resolveLocalQaClient } from './services/stagingConfig';

export const auth = getAuth(app);
const localQa = resolveLocalQaClient();
if (localQa) {
  const connections = globalThis.__bluetapLocalQaAuthConnections ||= new WeakMap();
  const existing = connections.get(auth);
  if (existing && existing !== localQa.authUrl) throw new Error('Local QA Auth emulator target changed.');
  if (!existing) {
    connectAuthEmulator(auth, localQa.authUrl, { disableWarnings: true });
    connections.set(auth, localQa.authUrl);
  }
}
