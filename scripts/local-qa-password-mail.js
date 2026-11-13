// Test-controller-only mail capture. This module is never registered by the
// production server and deliberately exposes no HTTP inbox or log output.
const { assertLocalQaServerEnvironment } = require('../backend/config/localQaIsolation');
const { createPasswordChangeOtpHandler } = require('../backend/auth/passwordChangeOtpHandler');

function assertPasswordMailIsolation(getAdmin) {
  if (process.env.BLUETAP_QA_PASSWORD_MAIL !== '1' || !assertLocalQaServerEnvironment() ||
      typeof process.send !== 'function' || !process.connected) {
    throw new Error('Password mail capture requires the isolated local-QA test controller.');
  }
  const { auth, db } = getAdmin();
  if (auth?.app?.options?.projectId !== 'demo-bluetap-local-qa' ||
      db?.projectId !== 'demo-bluetap-local-qa' || db?._settings?.servicePath !== '127.0.0.1' ||
      db?._settings?.port !== 8080 || db?._settings?.ssl !== false ||
      auth?.app?.options?.credential?.constructor?.name !== 'ApplicationDefaultCredential') {
    throw new Error('Password mail capture requires matching local emulators.');
  }
}

function createLocalQaPasswordMailHandler(getAdmin) {
  assertPasswordMailIsolation(getAdmin);
  return createPasswordChangeOtpHandler(getAdmin, {
    checkTransport: () => assertPasswordMailIsolation(getAdmin),
    send: async ({ to, text }) => {
      assertPasswordMailIsolation(getAdmin);
      if (!/^[a-z0-9._%+-]+@example\.test$/i.test(String(to || ''))) {
        throw new Error('Password mail capture only accepts disposable QA accounts.');
      }
      const code = /\b\d{6}\b/.exec(String(text || ''))?.[0];
      if (!code) throw new Error('Password mail capture did not receive a valid code.');
      await new Promise((resolve, reject) => {
        process.send({ type: 'local-qa-password-mail', recipient: to, code }, (error) =>
          error ? reject(error) : resolve());
      });
    },
  });
}

module.exports = { assertPasswordMailIsolation, createLocalQaPasswordMailHandler };
