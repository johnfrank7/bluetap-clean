const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(resolve(__dirname, '../../../services/passwordRecovery.js'), 'utf8')
  .replace(/^import[^\n]+\n/, '')
  .replace(/export const /g, 'const ');

const client = (fetch) => vm.runInNewContext(`${source}\n({ requestPasswordRecovery })`, {
  fetch,
  getApiUrl: (path) => path,
  AbortController,
  setTimeout,
  clearTimeout,
  Error,
});

test('password recovery explains missing mail configuration without changing API error identity', async () => {
  const recovery = client(async () => ({
    ok: false,
    json: async () => ({ error: {
      code: 'MAIL_PROVIDER_CONFIG_MISSING',
      message: 'Unable to send verification email. Please try again.',
    } }),
  }));
  await assert.rejects(recovery.requestPasswordRecovery('local@example.test'), (error) => {
    assert.equal(error.code, 'MAIL_PROVIDER_CONFIG_MISSING');
    assert.match(error.message, /unavailable in this environment.*contact BlueTap support/);
    return true;
  });
});

test('password recovery retains rate-limit and ordinary delivery errors', async () => {
  for (const [code, message] of [
    ['PASSWORD_RECOVERY_RATE_LIMITED', 'Please wait before requesting another code.'],
    ['MAIL_RELAY_UNAVAILABLE', 'Unable to send verification email. Please try again.'],
  ]) {
    const recovery = client(async () => ({ ok: false, json: async () => ({ error: { code, message } }) }));
    await assert.rejects(recovery.requestPasswordRecovery('local@example.test'), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      return true;
    });
  }
});
