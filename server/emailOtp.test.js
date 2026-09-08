const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailOtpService } = require('./emailOtp');
const { OtpError } = require('./otpError');

function fixture() {
  let time = 1800000000000;
  let record;
  let queue = Promise.resolve();
  let failSend = false;
  let failUpdate = false;
  const sent = [];
  const user = { uid: 'owner', email: 'owner@example.test', emailVerified: false };
  const auth = {
    getUser: async (uid) => { assert.equal(uid, 'owner'); return { ...user }; },
    updateUser: async (uid, changes) => {
      assert.equal(uid, 'owner');
      if (failUpdate) throw new Error('Simulated Auth outage');
      Object.assign(user, changes);
    },
  };
  const db = {
    collection: (name) => {
      assert.equal(name, 'emailOtpVerifications');
      return { doc: (uid) => { assert.equal(uid, 'owner'); return uid; } };
    },
    runTransaction: (callback) => {
      const next = queue.then(async () => {
        let pending = record && { ...record };
        const result = await callback({
          get: async () => ({ data: () => pending && { ...pending } }),
          set: (ref, data) => { pending = { ...data }; },
          update: (ref, data) => { pending = { ...pending, ...data }; },
        });
        record = pending;
        return result;
      });
      queue = next.catch(() => {});
      return next;
    },
  };
  const service = createEmailOtpService({
    auth, db, hashSecret: 'isolated-test-key', now: () => time,
    sendEmailOtp: async (message) => {
      if (failSend) throw new OtpError(403, 'provider-test-recipient', 'Test sender restriction');
      sent.push(message);
    },
  });
  return {
    service, user, sent, get record() { return record; },
    advance: (ms) => { time += ms; },
    failSend: () => { failSend = true; },
    failUpdate: () => { failUpdate = true; },
  };
}
const rejectsReason = (promise, reason) => assert.rejects(promise, (error) => error.reason === reason);

test('correct code verifies only on server, is hashed at rest and cannot be reused', async () => {
  const f = fixture();
  const result = await f.service.request('owner');
  const code = f.sent[0].code;
  assert.match(code, /^\d{6}$/);
  assert.equal(f.sent[0].recipient, f.user.email);
  assert.match(f.record.otpHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(f.record).includes(code), false);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'resendAfterSeconds']);
  assert.equal(f.user.emailVerified, false);
  assert.deepEqual(await f.service.verify('owner', code), { verified: true });
  assert.equal(f.user.emailVerified, true);
  assert.equal(f.record.otpHash, null);
  f.user.emailVerified = false;
  await rejectsReason(f.service.verify('owner', code), 'no-active-code');
});

test('strict format rejects non-string and embedded non-digits', async () => {
  const f = fixture();
  for (const code of ['12345', '1234567', '12a3456', ' 123456', 123456]) {
    await rejectsReason(f.service.verify('owner', code), 'invalid-code');
  }
});

test('five incorrect attempts lock code; lockout cannot reset send cooldown', async () => {
  const f = fixture();
  await f.service.request('owner');
  for (let i = 0; i < 5; i++) {
    await rejectsReason(f.service.verify('owner', '000000'), i === 4 ? 'attempt-limit-reached' : 'incorrect-code');
  }
  assert.equal(f.record.otpHash, null);
  await rejectsReason(f.service.verify('owner', f.sent[0].code), 'attempt-limit-reached');
  await rejectsReason(f.service.request('owner'), 'resend-too-soon');
  assert.equal(f.user.emailVerified, false);
});

test('expired code fails after ten minutes', async () => {
  const f = fixture();
  await f.service.request('owner');
  f.advance(600000);
  await rejectsReason(f.service.verify('owner', f.sent[0].code), 'code-expired');
  assert.equal(f.record.otpHash, null);
  assert.equal(f.user.emailVerified, false);
});

test('concurrent requests send one email and resends replace the old hash', async () => {
  const f = fixture();
  const responses = await Promise.allSettled([f.service.request('owner'), f.service.request('owner')]);
  assert.equal(responses.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.sent.length, 1);
  const oldRequest = f.record.requestId;
  f.advance(60000);
  await f.service.request('owner');
  assert.notEqual(f.record.requestId, oldRequest);
  assert.equal(f.record.attempts, 0);
  assert.notEqual(f.sent[0].code, f.sent[1].code);
  await rejectsReason(f.service.verify('owner', f.sent[0].code), 'incorrect-code');
  assert.equal(f.record.sendCount, 2);
});

test('hourly limit survives failed sends and resets after the window', async () => {
  const f = fixture();
  f.failSend();
  for (let i = 0; i < 6; i++) {
    await rejectsReason(f.service.request('owner'), 'provider-test-recipient');
    assert.equal(f.record.otpHash, null);
    f.advance(60000);
  }
  await rejectsReason(f.service.request('owner'), 'resend-limit-reached');
  assert.equal(f.user.emailVerified, false);
  f.advance(3600000);
  await rejectsReason(f.service.request('owner'), 'provider-test-recipient');
  assert.equal(f.record.sendCount, 1);
});

test('email change invalidates code for previous email', async () => {
  const f = fixture();
  await f.service.request('owner');
  f.user.email = 'changed@example.test';
  await rejectsReason(f.service.verify('owner', f.sent[0].code), 'no-active-code');
  assert.equal(f.user.emailVerified, false);
});

test('Admin update failure does not report success or leave a reusable code', async () => {
  const f = fixture();
  await f.service.request('owner');
  f.failUpdate();
  await assert.rejects(f.service.verify('owner', f.sent[0].code));
  assert.equal(f.user.emailVerified, false);
  assert.equal(f.record.otpHash, null);
});

test('already verified account skips sending', async () => {
  const f = fixture();
  f.user.emailVerified = true;
  assert.deepEqual(await f.service.request('owner'), { alreadyVerified: true });
  assert.equal(f.sent.length, 0);
});

test('Vercel endpoints reject unauthenticated requests and handle preflight', async () => {
  for (const path of ['../api/auth/request-email-otp', '../api/auth/verify-email-otp']) {
    const handler = require(path);
    for (const [method, expected] of [['POST', 401], ['GET', 405], ['OPTIONS', 204]]) {
      const res = {
        headers: {}, setHeader(k, v) { this.headers[k] = v; },
        status(value) { this.statusCode = value; return this; },
        json(value) { this.body = value; }, end() {},
      };
      await handler({ method, headers: {}, body: {} }, res);
      assert.equal(res.statusCode, expected);
      assert.equal(res.headers['Cache-Control'], 'no-store');
      if (expected === 401) assert.equal(res.body.error.reason, 'unauthenticated');
    }
  }
});

test('Resend test-recipient rejection is sanitized and explicit', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM_ADDRESS;
  try {
    process.env.RESEND_API_KEY = 'test-placeholder';
    process.env.EMAIL_FROM_ADDRESS = 'BlueTap <onboarding@resend.dev>';
    global.fetch = async () => ({
      ok: false, status: 403,
      json: async () => ({ message: 'You can only send testing emails to your own email address (private@example.test).' }),
    });
    const { sendEmailOtp } = require('./emailProvider');
    await assert.rejects(sendEmailOtp({ recipient: 'test@example.test', code: '000000', requestId: 'test' }), (error) => {
      assert.equal(error.reason, 'provider-test-recipient');
      assert.equal(error.message.includes('private@example.test'), false);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.EMAIL_FROM_ADDRESS;
    else process.env.EMAIL_FROM_ADDRESS = originalFrom;
  }
});

test('handler rejects invalid tokens before touching account or Firestore', async () => {
  const { createOtpHandler } = require('./otpHandler');
  const handler = createOtpHandler('request', () => ({
    auth: { verifyIdToken: async () => { throw Object.assign(new Error('private detail'), { code: 'auth/id-token-expired' }); } },
  }));
  const res = {
    setHeader() {}, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; },
  };
  await handler({ method: 'POST', headers: { authorization: 'Bearer invalid' }, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.stringify(res.body).includes('private detail'), false);
});

test('handler derives UID from validated token and ignores caller UID/email', async () => {
  const { createOtpHandler } = require('./otpHandler');
  const handler = createOtpHandler('request', () => ({
    auth: {
      verifyIdToken: async (token, checkRevoked) => {
        assert.equal(token, 'test-token');
        assert.equal(checkRevoked, true);
        return { uid: 'owner' };
      },
      getUser: async (uid) => {
        assert.equal(uid, 'owner');
        return { uid, email: 'owner@example.test', emailVerified: true };
      },
    },
  }));
  const res = {
    setHeader() {}, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; },
  };
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-token' }, body: {
    uid: 'someone-else', email: 'other@example.test',
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { alreadyVerified: true });
});
