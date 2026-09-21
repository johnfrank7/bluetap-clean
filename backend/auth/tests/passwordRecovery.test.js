const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordRecoveryHandler } = require('../passwordRecoveryHandler');
const { OtpError } = require('../../utils/otpError');

function fixture({ missingUser = false, failSend = false, role = 'requester' } = {}) {
  let time = 1800000000000;
  let autoId = 0;
  const records = new Map([
    ['users/recovery-user', {
      uid: 'recovery-user',
      role,
      accountStatus: 'active',
      ...(role === 'manager' ? { managerStatus: 'active', branchId: 'branch-a' } : {}),
      mustChangePassword: true,
    }],
  ]);
  const sent = [];
  const logs = [];
  const authEvents = [];
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const refFor = (collection, id) => {
    const key = `${collection}/${id || `auto-${++autoId}`}`;
    return {
      key,
      get: async () => snapshot(key),
      set: async (data) => { records.set(key, data); },
      update: async (data) => { records.set(key, { ...records.get(key), ...data }); },
    };
  };
  const db = {
    collection(collection) {
      return {
        doc: (id) => refFor(collection, id),
        add: async (data) => { records.set(refFor(collection).key, data); },
      };
    },
    async runTransaction(run) {
      const writes = [];
      const result = await run({
        get: async (ref) => snapshot(ref.key),
        set: (ref, data) => writes.push(['set', ref.key, data]),
        update: (ref, data) => writes.push(['set', ref.key, { ...records.get(ref.key), ...data }]),
        delete: (ref) => writes.push(['delete', ref.key]),
      });
      for (const [operation, key, data] of writes) {
        if (operation === 'delete') records.delete(key);
        else records.set(key, data);
      }
      return result;
    },
  };
  const auth = {
    async getUserByEmail(email) {
      if (missingUser) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      assert.equal(email, 'recovery@example.test');
      return { uid: 'recovery-user', email, disabled: false };
    },
    async updateUser(uid, changes) { authEvents.push(['update', uid, changes]); },
    async revokeRefreshTokens(uid) { authEvents.push(['revoke', uid]); },
  };
  const send = async (message) => {
    sent.push(message);
    if (failSend) {
      throw new OtpError(503, 'EMAIL_SEND_FAILED', 'provider detail', {
        provider: 'vercel-relay',
        providerStatus: 400,
      });
    }
    return { provider: 'vercel-relay', providerStatus: 200 };
  };
  const logger = {
    info: (...values) => logs.push(values),
    error: (...values) => logs.push(values),
  };
  const handler = createPasswordRecoveryHandler(() => ({ auth, db }), {
    now: () => time,
    send,
    logger,
  });
  const invoke = async (body) => {
    const headers = {};
    const res = {
      setHeader: (key, value) => { headers[key] = value; },
      getHeader: (key) => headers[key],
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; },
    };
    await handler({ method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' }, body }, res);
    return { ...res, headers };
  };
  return {
    invoke,
    records,
    sent,
    logs,
    authEvents,
    advance: (milliseconds) => { time += milliseconds; },
  };
}

async function withHashSecret(run) {
  const previous = process.env.EMAIL_OTP_HASH_SECRET;
  const previousProvider = process.env.EMAIL_PROVIDER;
  process.env.EMAIL_OTP_HASH_SECRET = 'isolated-password-recovery-test-key';
  process.env.EMAIL_PROVIDER = 'vercel-relay';
  try { await run(); } finally {
    if (previous === undefined) delete process.env.EMAIL_OTP_HASH_SECRET;
    else process.env.EMAIL_OTP_HASH_SECRET = previous;
    if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
    else process.env.EMAIL_PROVIDER = previousProvider;
  }
}

test('password recovery uses PASSWORD_RESET, safe stage logs, and consumes verified authorization', async () => {
  await withHashSecret(async () => {
    const f = fixture();
    const requested = await f.invoke({ action: 'request', email: 'recovery@example.test' });
    assert.equal(requested.statusCode, 200);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].subject, 'BlueTap Password Reset Code');
    const code = f.sent[0].text.match(/\b\d{6}\b/)[0];
    const sessionKey = `passwordResetSessions/${requested.body.recoverySessionId}`;
    const session = f.records.get(sessionKey);
    assert.equal(session.purpose, 'PASSWORD_RESET');
    assert.equal(session.status, 'active');
    assert.match(session.otpHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(session).includes(code), false);

    const verified = await f.invoke({
      action: 'verify',
      recoverySessionId: requested.body.recoverySessionId,
      code,
    });
    assert.equal(verified.statusCode, 200);
    assert.ok(verified.body.resetAuthorization);

    const completed = await f.invoke({
      action: 'complete',
      recoverySessionId: requested.body.recoverySessionId,
      resetAuthorization: verified.body.resetAuthorization,
      newPassword: 'NewPassword123',
    });
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(completed.body, { changed: true });
    assert.deepEqual(f.authEvents, [
      ['update', 'recovery-user', { password: 'NewPassword123' }],
      ['revoke', 'recovery-user'],
    ]);
    assert.equal(f.records.get(sessionKey).status, 'consumed');
    assert.equal(f.records.get('users/recovery-user').mustChangePassword, false);

    const serializedLogs = JSON.stringify(f.logs);
    for (const stage of [
      'PASSWORD_RECOVERY_REQUEST_RECEIVED',
      'PASSWORD_RECOVERY_ACCOUNT_RESOLVED',
      'PASSWORD_RECOVERY_OTP_CREATED',
      'PASSWORD_RECOVERY_MAIL_SEND_STARTED',
      'PASSWORD_RECOVERY_MAIL_RELAY_RESPONSE',
      'PASSWORD_RECOVERY_SENT',
    ]) assert.ok(serializedLogs.includes(stage));
    for (const sensitive of [code, 'recovery@example.test', 'NewPassword123', verified.body.resetAuthorization]) {
      assert.equal(serializedLogs.includes(sensitive), false);
    }
  });
});

test('unknown recovery email stays generic and creates no OTP', async () => {
  await withHashSecret(async () => {
    const f = fixture({ missingUser: true });
    const result = await f.invoke({ action: 'request', email: 'unknown@example.test' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.generic, true);
    assert.equal(f.sent.length, 0);
    assert.equal([...f.records.keys()].some((key) => key.startsWith('passwordResetSessions/')), false);
  });
});

test('active Manager recovery uses the same PASSWORD_RESET flow', async () => {
  await withHashSecret(async () => {
    const f = fixture({ role: 'manager' });
    const requested = await f.invoke({ action: 'request', email: 'recovery@example.test' });
    assert.equal(requested.statusCode, 200);
    assert.equal(f.sent.length, 1);
    const code = f.sent[0].text.match(/\b\d{6}\b/)[0];
    const sessionKey = `passwordResetSessions/${requested.body.recoverySessionId}`;
    const session = f.records.get(sessionKey);
    assert.equal(session.purpose, 'PASSWORD_RESET');
    assert.equal(session.uid, 'recovery-user');

    const verified = await f.invoke({
      action: 'verify',
      recoverySessionId: requested.body.recoverySessionId,
      code,
    });
    assert.equal(verified.statusCode, 200);

    const completed = await f.invoke({
      action: 'complete',
      recoverySessionId: requested.body.recoverySessionId,
      resetAuthorization: verified.body.resetAuthorization,
      newPassword: 'ManagerPassword123',
    });
    assert.equal(completed.statusCode, 200);
    assert.equal(f.records.get(sessionKey).status, 'consumed');
    assert.equal(f.records.get('users/recovery-user').mustChangePassword, false);
    assert.deepEqual(f.authEvents, [
      ['update', 'recovery-user', { password: 'ManagerPassword123' }],
      ['revoke', 'recovery-user'],
    ]);
  });
});

test('mail failure invalidates the OTP, releases cooldown reservations, and returns a safe code', async () => {
  await withHashSecret(async () => {
    const f = fixture({ failSend: true });
    const result = await f.invoke({ action: 'request', email: 'recovery@example.test' });
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.code, 'MAIL_RELAY_UNAVAILABLE');
    assert.equal(result.body.error.message, 'Unable to send verification email. Please try again.');
    assert.equal([...f.records.keys()].some((key) => key.startsWith('passwordResetRateLimits/')), false);
    const session = [...f.records.entries()].find(([key]) => key.startsWith('passwordResetSessions/'))[1];
    assert.equal(session.status, 'send-failed');
    assert.equal(session.otpHash, null);
    const serializedLogs = JSON.stringify(f.logs);
    assert.ok(serializedLogs.includes('PASSWORD_RECOVERY_MAIL_RELAY_RESPONSE'));
    assert.ok(serializedLogs.includes('PASSWORD_RECOVERY_MAIL_SEND_FAILED'));
    assert.ok(serializedLogs.includes('MAIL_RELAY_UNAVAILABLE'));
    assert.equal(serializedLogs.includes('provider detail'), false);
  });
});

test('password recovery cooldown returns a retry duration without creating another email', async () => {
  await withHashSecret(async () => {
    const f = fixture();
    await f.invoke({ action: 'request', email: 'recovery@example.test' });
    f.advance(10_000);
    const limited = await f.invoke({ action: 'request', email: 'recovery@example.test' });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body.error.code, 'PASSWORD_RECOVERY_RATE_LIMITED');
    assert.equal(limited.body.error.retryAfterSeconds, 50);
    assert.equal(limited.headers['Retry-After'], '50');
    assert.equal(f.sent.length, 1);
  });
});
