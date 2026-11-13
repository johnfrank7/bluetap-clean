const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { EventEmitter } = require('node:events');

const helper = path.resolve(__dirname, '../../../scripts/local-qa-reusable-accounts.js');
const controller = path.resolve(__dirname, '../../../scripts/local-qa-password-controller.js');
const safe = {
  APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', BLUETAP_QA_ACCOUNT_SETUP: '1',
  FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa', GCLOUD_PROJECT: 'demo-bluetap-local-qa',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-test-only',
};

test('reusable account helper fails closed for hosted or unapproved environments', () => {
  for (const override of [
    { BLUETAP_QA_ACCOUNT_SETUP: '' }, { FIREBASE_PROJECT_ID: 'bluetap-8c98d' },
    { FIREBASE_AUTH_EMULATOR_HOST: 'example.test:9099' },
    { FIRESTORE_EMULATOR_HOST: 'example.test:8080' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'example.json' },
  ]) {
    const result = spawnSync(process.execPath, [helper, 'discover'], {
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...safe, ...override },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Local account setup failed/);
  }
});

test('local mail controller refuses missing opt-in and non-emulator targets', () => {
  for (const override of [
    { BLUETAP_QA_REUSABLE_ACCOUNTS: '' },
    { BLUETAP_QA_REUSABLE_ACCOUNTS: '1', BLUETAP_QA_PASSWORD_MAIL: '' },
    { BLUETAP_QA_REUSABLE_ACCOUNTS: '1', BLUETAP_QA_PASSWORD_MAIL: '1', FIRESTORE_EMULATOR_HOST: 'example.test:8080' },
  ]) {
    const result = spawnSync(process.execPath, [controller], {
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, ...safe, ...override },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('local mail controller copies only a matching disposable account code without logging it', () => {
  const code = '314159';
  const child = new EventEmitter();
  child.kill = () => {};
  const input = new EventEmitter();
  input.close = () => {};
  const messages = [];
  let copied = null;
  const fakeProcess = new EventEmitter();
  fakeProcess.env = { BLUETAP_QA_REUSABLE_ACCOUNTS: '1', BLUETAP_QA_PASSWORD_MAIL: '1',
    BLUETAP_QA_REQUESTER_EMAIL: 'requester@example.test', BLUETAP_QA_DISTRIBUTOR_EMAIL: 'distributor@example.test',
    BLUETAP_QA_MANAGER_EMAIL: 'manager@example.test', BLUETAP_QA_ADMIN_EMAIL: 'admin@example.test' };
  fakeProcess.stdin = {};
  const load = (name) => {
    if (name === 'node:child_process') return { fork: () => child, spawn: () => {
      const copy = new EventEmitter();
      copy.stdin = new EventEmitter();
      copy.stdin.end = (value) => { copied = value; };
      return copy;
    } };
    if (name === 'node:readline') return { createInterface: () => input };
    if (name === 'node:path') return path;
    if (name === '../backend/config/localQaIsolation') return { assertLocalQaServerEnvironment: () => true };
    throw new Error('Unexpected dependency');
  };
  new Function('require', 'process', 'console', '__dirname', readFileSync(controller, 'utf8'))(
    load, fakeProcess, { log: (message) => messages.push(message), error: (message) => messages.push(message) }, '/local-qa');
  child.emit('message', { type: 'local-qa-password-mail', recipient: 'other@example.test', code });
  input.emit('line', 'copy otp requester');
  assert.equal(copied, null);
  child.emit('message', { type: 'local-qa-password-mail', recipient: 'requester@example.test', code });
  input.emit('line', 'copy otp requester');
  assert.equal(copied, code);
  assert.equal(messages.some((message) => message.includes(code)), false);
});
