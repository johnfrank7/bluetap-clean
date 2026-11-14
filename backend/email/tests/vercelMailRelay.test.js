const test = require('node:test');
const assert = require('node:assert/strict');
const { createInternalMailRelayHandler } = require('../vercelMailRelay');
const { createEmailProvider } = require('../emailProvider');

const validBody = {
  to: 'recipient@example.test',
  subject: 'BlueTap Email Verification Code',
  text: 'BlueTap verification code: 123456. It expires in 10 minutes. Do not share it.',
  html: '<p>BlueTap verification code: <strong>123456</strong>. It expires in 10 minutes. Do not share it.</p>',
  requestId: '123e4567-e89b-42d3-a456-426614174000',
};

const validPasswordResetBody = {
  ...validBody,
  subject: 'BlueTap Password Reset Code',
  text: 'BlueTap password reset code: 123456. It expires in 10 minutes. Do not share it.',
  html: '<p>BlueTap password reset code: <strong>123456</strong>. It expires in 10 minutes. Do not share it.</p>',
};

function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function invoke(handler, { method = 'POST', authorization = 'Bearer relay-secret', body = validBody } = {}) {
  const res = response();
  await handler({ method, headers: { authorization }, body }, res);
  return res;
}

test('Vercel relay requires POST and constant-time bearer authentication', async () => {
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => { throw new Error('must not send'); },
    logger: { info() {}, error() {} },
  });
  assert.equal((await invoke(handler, { method: 'GET' })).statusCode, 405);
  assert.equal((await invoke(handler, { authorization: '' })).statusCode, 401);
  assert.equal((await invoke(handler, { authorization: 'Bearer wrong-secret' })).statusCode, 403);
  assert.equal((await invoke(handler, { authorization: 'Basic relay-secret' })).statusCode, 401);
});

test('Vercel relay validates a narrow transport-only payload before SMTP', async () => {
  let transportCreated = false;
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => { transportCreated = true; },
    logger: { info() {}, error() {} },
  });
  for (const body of [
    { ...validBody, to: 'invalid' },
    { ...validBody, subject: 'Arbitrary email' },
    { ...validBody, uid: 'client-controlled' },
    { ...validBody, requestId: 'invalid' },
  ]) assert.equal((await invoke(handler, { body })).statusCode, 400);
  assert.equal(transportCreated, false);
});

test('Vercel relay uses Gmail SMTP only after auth and returns sanitized success', async () => {
  let config;
  let mail;
  const logs = [];
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app password' },
    createTransport: (value) => {
      config = value;
      return { sendMail: async (message) => { mail = message; return { accepted: [message.to], rejected: [] }; } };
    },
    logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
  });
  const res = await invoke(handler);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(config.host, 'smtp.gmail.com');
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.deepEqual(config.auth, { user: 'sender@example.test', pass: 'apppassword' });
  assert.equal(mail.from, 'BlueTap <sender@example.test>');
  assert.equal(mail.to, validBody.to);
  const serialized = JSON.stringify(logs);
  assert.ok(serialized.includes('RELAY_CONFIGURATION'));
  for (const sensitive of ['relay-secret', 'app password', 'apppassword', validBody.to, '123456']) assert.equal(serialized.includes(sensitive), false);
});

test('Vercel relay accepts the password recovery OTP template', async () => {
  let mail;
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({
      sendMail: async (message) => {
        mail = message;
        return { accepted: [message.to], rejected: [] };
      },
    }),
    logger: { info() {}, error() {} },
  });

  const res = await invoke(handler, { body: validPasswordResetBody });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(mail.subject, 'BlueTap Password Reset Code');
});

test('Vercel relay accepts the password change OTP template', async () => {
  let mail;
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({
      sendMail: async (message) => {
        mail = message;
        return { accepted: [message.to], rejected: [] };
      },
    }),
    logger: { info() {}, error() {} },
  });
  const body = {
    ...validBody,
    subject: 'BlueTap Password Change Code',
    text: 'Your BlueTap password change code is 123456. It expires in 10 minutes. Do not share this code.',
    html: '<p>Your BlueTap password change code is <strong>123456</strong>.</p><p>It expires in 10 minutes. Do not share this code.</p>',
  };
  const res = await invoke(handler, { body });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.equal(mail.subject, 'BlueTap Password Change Code');
});

test('Vercel relay accepts only the factual account access notice template', async () => {
  let mail;
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({ sendMail: async (message) => {
      mail = message; return { accepted: [message.to], rejected: [] };
    } }),
    logger: { info() {}, error() {} },
  });
  const body = { ...validBody, subject: 'BlueTap Account Access Notice',
    text: 'An Administrator has started a suspension of your BlueTap account.',
    html: '<p>An Administrator has started a suspension of your BlueTap account.</p>' };
  const result = await invoke(handler, { body });
  assert.equal(result.statusCode, 200);
  assert.equal(mail.subject, body.subject);
});

test('Vercel relay does not claim acceptance when SMTP accepted a different recipient', async () => {
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({ sendMail: async () => ({ accepted: ['other@example.test'], rejected: [] }) }),
    logger: { info() {}, error() {} },
  });
  const result = await invoke(handler);
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error.reason, 'EMAIL_SEND_FAILED');
});

test('Vercel relay maps missing Gmail config and SMTP failures without leaking details', async () => {
  const quiet = { info() {}, error() {} };
  const missing = createInternalMailRelayHandler({ env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret' }, logger: quiet });
  const missingResult = await invoke(missing);
  assert.equal(missingResult.statusCode, 503);
  assert.equal(missingResult.body.error.reason, 'EMAIL_TRANSPORT_NOT_CONFIGURED');

  for (const [failure, reason] of [
    [Object.assign(new Error('secret SMTP detail'), { code: 'EAUTH', responseCode: 535 }), 'EMAIL_TRANSPORT_AUTH_FAILED'],
    [Object.assign(new Error('secret network detail'), { code: 'ETIMEDOUT' }), 'EMAIL_SEND_FAILED'],
  ]) {
    const logs = [];
    const handler = createInternalMailRelayHandler({
      env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
      createTransport: () => ({ sendMail: async () => { throw failure; } }),
      logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    });
    const result = await invoke(handler);
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.error.reason, reason);
    const serialized = JSON.stringify([logs, result.body]);
    assert.ok(serialized.includes('GMAIL_TRANSPORT_FAILED'));
    assert.equal(serialized.includes('secret SMTP detail'), false);
    assert.equal(serialized.includes('secret network detail'), false);
    assert.equal(serialized.includes('app-password'), false);
    assert.equal(serialized.includes(validBody.to), false);
    assert.equal(serialized.includes('123456'), false);
  }
});

test('concurrent registration OTP delivery remains independent of a failed account notice', async () => {
  const delivered = [];
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({ sendMail: async (message) => {
      if (message.subject === 'BlueTap Account Access Notice') throw new Error('notice-only failure');
      delivered.push(message);
      return { accepted: [message.to], rejected: [] };
    } }),
    logger: { info() {}, error() {} },
  });
  const provider = createEmailProvider({
    env: { EMAIL_PROVIDER: 'vercel-relay', VERCEL_MAIL_RELAY_URL: 'https://mail.example.test/api/internal/send-otp-email', INTERNAL_MAIL_RELAY_SECRET: 'relay-secret' },
    fetchImpl: async (_url, options) => {
      const res = await invoke(handler, { body: JSON.parse(options.body) });
      return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
        json: async () => res.body };
    },
    logger: { info() {}, error() {} },
  });
  const [otp, notice] = await Promise.allSettled([
    provider.sendEmailOtp({ recipient: 'registrant@example.test', code: '123456', requestId: validBody.requestId }),
    provider.sendEmail({ to: 'account@example.test', subject: 'BlueTap Account Access Notice',
      text: 'An Administrator has started a suspension of your BlueTap account.',
      html: '<p>An Administrator has started a suspension of your BlueTap account.</p>',
      requestId: '223e4567-e89b-42d3-a456-426614174000' }),
  ]);
  assert.equal(otp.status, 'fulfilled');
  assert.equal(otp.value.providerStatus, 200);
  assert.equal(notice.status, 'rejected');
  assert.equal(notice.reason.reason, 'EMAIL_SEND_FAILED');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, 'registrant@example.test');
  assert.equal(delivered[0].subject, 'BlueTap Email Verification Code');
  assert.match(delivered[0].text, /123456/);
});

test('shared SMTP outage fails independently and a later registration OTP can retry', async () => {
  let outage = true;
  let accepted = 0;
  const handler = createInternalMailRelayHandler({
    env: { INTERNAL_MAIL_RELAY_SECRET: 'relay-secret', GMAIL_USER: 'sender@example.test', GMAIL_APP_PASSWORD: 'app-password' },
    createTransport: () => ({ sendMail: async (message) => {
      if (outage) throw Object.assign(new Error('SMTP unavailable'), { code: 'ETIMEDOUT' });
      accepted++;
      return { accepted: [message.to], rejected: [] };
    } }),
    logger: { info() {}, error() {} },
  });
  const provider = createEmailProvider({
    env: { EMAIL_PROVIDER: 'vercel-relay', VERCEL_MAIL_RELAY_URL: 'https://mail.example.test/api/internal/send-otp-email', INTERNAL_MAIL_RELAY_SECRET: 'relay-secret' },
    fetchImpl: async (_url, options) => {
      const res = await invoke(handler, { body: JSON.parse(options.body) });
      return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
        json: async () => res.body };
    },
    logger: { info() {}, error() {} },
  });
  const failures = await Promise.allSettled([
    provider.sendEmailOtp({ recipient: 'registrant@example.test', code: '123456', requestId: validBody.requestId }),
    provider.sendEmail({ to: 'account@example.test', subject: 'BlueTap Account Access Notice',
      text: 'An Administrator has started a suspension of your BlueTap account.',
      html: '<p>An Administrator has started a suspension of your BlueTap account.</p>',
      requestId: '223e4567-e89b-42d3-a456-426614174000' }),
  ]);
  assert.deepEqual(failures.map((result) => result.status), ['rejected', 'rejected']);
  assert.deepEqual(failures.map((result) => result.reason.reason), ['EMAIL_SEND_FAILED', 'EMAIL_SEND_FAILED']);
  assert.equal(accepted, 0);
  outage = false;
  const retried = await provider.sendEmailOtp({ recipient: 'registrant@example.test', code: '654321',
    requestId: '323e4567-e89b-42d3-a456-426614174000' });
  assert.equal(retried.providerStatus, 200);
  assert.equal(accepted, 1);
});
