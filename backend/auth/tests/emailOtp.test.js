const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmailOtpService } = require('../emailOtp');
const { OtpError } = require('../../utils/otpError');

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

test('missing OTP signing secret fails safely before storing or sending a code', async () => {
  let touchedStorage = false;
  let sent = false;
  const service = createEmailOtpService({
    auth: { getUser: async () => ({ uid: 'owner', email: 'owner@example.test', emailVerified: false }) },
    db: { collection: () => { touchedStorage = true; throw new Error('must not store'); } },
    sendEmailOtp: async () => { sent = true; },
    hashSecret: '',
  });
  await assert.rejects(service.request('owner'), (error) =>
    error.status === 503 && error.reason === 'OTP_SECRET_MISSING');
  assert.equal(touchedStorage, false);
  assert.equal(sent, false);
});

test('Render OTP handlers reject unauthenticated requests and handle preflight', async () => {
  const { createOtpHandler } = require('../otpHandler');
  for (const action of ['request', 'verify']) {
    const handler = createOtpHandler(action);
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

test('Resend HTTPS provider sends BlueTap OTP content without SMTP', async () => {
  const { createEmailProvider, RESEND_EMAILS_ENDPOINT } = require('../../email/emailProvider');
  const calls = [];
  const logs = [];
  const provider = createEmailProvider({
    env: {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-api-key',
      EMAIL_FROM_ADDRESS: 'BlueTap <verify@example.test>',
      GMAIL_USER: 'must-not-be-used@example.test',
      GMAIL_APP_PASSWORD: 'must-not-be-used',
    },
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, status: 200 };
    },
    logger: {
      info: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  });
  const message = { recipient: 'recipient@example.test', code: '123456', requestId: 'request-id' };
  await provider.sendEmailOtp(message);

  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, RESEND_EMAILS_ENDPOINT);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer test-api-key');
  assert.equal(options.headers['User-Agent'], 'BlueTap-Backend/1.0');
  assert.equal(options.headers['Idempotency-Key'], 'bluetap-otp/request-id');
  const body = JSON.parse(options.body);
  assert.equal(body.from, 'BlueTap <verify@example.test>');
  assert.deepEqual(body.to, [message.recipient]);
  assert.ok(body.text.includes(message.code));
  assert.ok(body.text.includes('10 minutes'));
  assert.ok(body.text.includes('Do not share'));
  assert.ok(body.html.includes(message.code));
  assert.equal(JSON.stringify(calls).includes('smtp.gmail.com'), false);
  assert.equal(JSON.stringify(calls).includes('must-not-be-used'), false);
  assert.ok(JSON.stringify(logs).includes('EMAIL_TRANSPORT_READY'));
  assert.ok(JSON.stringify(logs).includes('EMAIL_SEND_SUCCEEDED'));
});

test('Resend HTTPS provider maps configuration and provider failures safely', async () => {
  const { createEmailProvider } = require('../../email/emailProvider');
  const message = { recipient: 'recipient@example.test', code: '123456' };
  const safeError = (reason) => (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.reason, reason);
    return true;
  };
  const response = (status, name, retryAfter) => ({
    ok: false,
    status,
    headers: { get: (key) => key === 'retry-after' ? retryAfter : null },
    json: async () => ({ name, message: 'secret provider detail recipient@example.test 123456' }),
  });

  for (const env of [
    { EMAIL_PROVIDER: 'resend', EMAIL_FROM_ADDRESS: 'BlueTap <verify@example.test>' },
    { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-api-key' },
    { EMAIL_PROVIDER: 'smtp', RESEND_API_KEY: 'test-api-key', EMAIL_FROM_ADDRESS: 'BlueTap <verify@example.test>' },
  ]) {
    let called = false;
    const provider = createEmailProvider({
      env,
      fetchImpl: async () => { called = true; },
      logger: { info() {}, error() {} },
    });
    await assert.rejects(provider.sendEmailOtp(message), safeError('EMAIL_TRANSPORT_NOT_CONFIGURED'));
    assert.equal(called, false);
  }

  const cases = [
    [response(403, 'invalid_api_key'), 'EMAIL_TRANSPORT_AUTH_FAILED'],
    [response(403, 'validation_error'), 'EMAIL_SENDER_NOT_VERIFIED'],
    [response(422, 'invalid_from_address'), 'EMAIL_SENDER_NOT_VERIFIED'],
    [response(429, 'rate_limit_exceeded', '12'), 'EMAIL_SEND_RATE_LIMITED'],
    [response(500, 'internal_server_error'), 'EMAIL_SEND_FAILED'],
  ];
  for (const [providerResponse, reason] of cases) {
    const logs = [];
    const provider = createEmailProvider({
      env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-api-key', EMAIL_FROM_ADDRESS: 'BlueTap <verify@example.test>' },
      fetchImpl: async () => providerResponse,
      logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    });
    await assert.rejects(provider.sendEmailOtp(message), safeError(reason));
    const serialized = JSON.stringify(logs);
    assert.ok(serialized.includes(reason));
    for (const sensitive of ['test-api-key', message.recipient, message.code, 'secret provider detail']) {
      assert.equal(serialized.includes(sensitive), false);
    }
  }

  const networkProvider = createEmailProvider({
    env: { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-api-key', EMAIL_FROM_ADDRESS: 'BlueTap <verify@example.test>' },
    fetchImpl: async () => { throw new Error('secret network error'); },
    logger: { info() {}, error() {} },
  });
  await assert.rejects(networkProvider.sendEmailOtp(message), safeError('EMAIL_SEND_FAILED'));
});

test('Render provider sends OTP content only to the authenticated Vercel HTTPS relay', async () => {
  const { createEmailProvider } = require('../../email/emailProvider');
  const calls = [];
  const logs = [];
  const env = {
    EMAIL_PROVIDER: 'vercel-relay',
    VERCEL_MAIL_RELAY_URL: 'https://bluetap-beta.vercel.app/api/internal/send-otp-email',
    INTERNAL_MAIL_RELAY_SECRET: 'relay-secret',
    GMAIL_USER: 'render-must-ignore@example.test',
    GMAIL_APP_PASSWORD: 'render-must-ignore',
  };
  const provider = createEmailProvider({
    env,
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });
  await provider.sendEmailOtp({
    recipient: 'recipient@example.test',
    code: '123456',
    requestId: '123e4567-e89b-42d3-a456-426614174000',
  });

  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, env.VERCEL_MAIL_RELAY_URL);
  assert.equal(options.headers.Authorization, 'Bearer relay-secret');
  const body = JSON.parse(options.body);
  assert.deepEqual(Object.keys(body).sort(), ['html', 'requestId', 'subject', 'text', 'to']);
  assert.equal(body.to, 'recipient@example.test');
  assert.ok(body.text.includes('123456'));
  assert.equal(JSON.stringify(calls).includes('render-must-ignore'), false);
  assert.equal(JSON.stringify(calls).includes('smtp.gmail.com'), false);
  assert.ok(JSON.stringify(logs).includes('EMAIL_SEND_SUCCEEDED'));
});

test('Render provider safely maps Vercel relay authentication, configuration, and delivery failures', async () => {
  const { createEmailProvider } = require('../../email/emailProvider');
  const baseEnv = {
    EMAIL_PROVIDER: 'vercel-relay',
    VERCEL_MAIL_RELAY_URL: 'https://bluetap-beta.vercel.app/api/internal/send-otp-email',
    INTERNAL_MAIL_RELAY_SECRET: 'relay-secret',
  };
  const message = { recipient: 'recipient@example.test', code: '123456', requestId: '123e4567-e89b-42d3-a456-426614174000' };
  const run = (response, env = baseEnv) => createEmailProvider({
    env,
    fetchImpl: async () => response,
    logger: { info() {}, error() {} },
  }).sendEmailOtp(message);
  const errorResponse = (status, reason) => ({ ok: false, status, json: async () => ({ error: { reason, private: 'do-not-forward' } }) });

  await assert.rejects(run(errorResponse(403, 'INVALID_RELAY_SECRET')), (error) => error.reason === 'EMAIL_TRANSPORT_AUTH_FAILED');
  await assert.rejects(run(errorResponse(503, 'EMAIL_TRANSPORT_NOT_CONFIGURED')), (error) => error.reason === 'EMAIL_TRANSPORT_NOT_CONFIGURED');
  await assert.rejects(run(errorResponse(503, 'EMAIL_SEND_FAILED')), (error) => error.reason === 'EMAIL_SEND_FAILED');
  await assert.rejects(run({ ok: true, status: 200, json: async () => ({ success: false }) }), (error) => error.reason === 'EMAIL_SEND_FAILED');
  await assert.rejects(run({ ok: true, status: 200, json: async () => ({ success: true }) }, { ...baseEnv, VERCEL_MAIL_RELAY_URL: 'http://unsafe.test/api/internal/send-otp-email' }), (error) => error.reason === 'EMAIL_TRANSPORT_NOT_CONFIGURED');
});

test('handler rejects invalid tokens before touching account or Firestore', async () => {
  const { createOtpHandler } = require('../otpHandler');
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
  const { createOtpHandler } = require('../otpHandler');
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
