const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createPasswordRecoveryHandler } = require('../passwordRecoveryHandler');

const emulatorReady = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST &&
  (!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === 'demo-bluetap');

test('real Firestore transaction persists wrong recovery attempts and locks the code',
  { skip: !emulatorReady }, async () => {
    const id = randomUUID();
    const email = `recovery-${id}@example.test`;
    const app = initializeApp({ projectId: 'demo-bluetap' }, `recovery-${id}`);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const sent = [];
    const previousSecret = process.env.EMAIL_OTP_HASH_SECRET;
    process.env.EMAIL_OTP_HASH_SECRET = `local-recovery-${id}`;
    try {
      await auth.createUser({ uid: id, email, password: 'LocalOnlyPassword123' });
      await db.collection('users').doc(id).set({ role: 'requester', accountStatus: 'active', email });
      const handler = createPasswordRecoveryHandler(() => ({ auth, db }), {
        checkTransport: () => {},
        send: async (message) => { sent.push(message); return { provider: 'captured-test', providerStatus: 200 }; },
        logger: { info() {}, error() {} },
      });
      const invoke = async (body) => {
        const res = {
          setHeader() {}, status(value) { this.statusCode = value; return this; },
          json(value) { this.body = value; return this; }, end() { return this; },
        };
        await handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' }, body }, res);
        return res;
      };
      const requested = await invoke({ action: 'request', email });
      assert.equal(requested.statusCode, 200);
      assert.equal(sent.length, 1);
      const code = sent[0].text.match(/\b\d{6}\b/)[0];
      const wrong = code === '000000' ? '000001' : '000000';
      const sessionRef = db.collection('passwordResetSessions').doc(requested.body.recoverySessionId);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const result = await invoke({ action: 'verify', recoverySessionId: sessionRef.id, code: wrong });
        assert.equal(result.statusCode, attempt < 5 ? 400 : 429);
        assert.equal((await sessionRef.get()).data().attempts, attempt);
      }
      const locked = (await sessionRef.get()).data();
      assert.equal(locked.status, 'locked');
      assert.equal(locked.otpHash, null);
      const correctAfterLock = await invoke({ action: 'verify', recoverySessionId: sessionRef.id, code });
      assert.equal(correctAfterLock.statusCode, 429);
    } finally {
      if (previousSecret === undefined) delete process.env.EMAIL_OTP_HASH_SECRET;
      else process.env.EMAIL_OTP_HASH_SECRET = previousSecret;
      await deleteApp(app);
    }
  });
