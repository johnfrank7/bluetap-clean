const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { sendEmail: defaultSendEmail, emailProviderConfigStatus } = require('../email/emailProvider');

const SUBJECT = 'BlueTap Account Access Notice';
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const emailHash = (value) => createHash('sha256').update(normalizeEmail(value)).digest('hex');
const validEmail = (value) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length <= 254;
const requestIdFor = (intentId) => {
  const hex = createHash('sha256').update(`account-notice:${intentId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

function assertNoticeTransportConfigured(sender = defaultSendEmail, env = process.env) {
  if (sender && sender !== defaultSendEmail) return;
  const config = emailProviderConfigStatus(env);
  const ready = config.provider === 'resend'
    ? Boolean(env.RESEND_API_KEY && env.EMAIL_FROM_ADDRESS)
    : config.provider === 'vercel-relay'
      && config.relayUrlConfigured && config.relaySecretConfigured;
  if (!ready) throw new OtpError(503, 'ACCOUNT_NOTICE_TRANSPORT_UNAVAILABLE',
    'Account access changes are unavailable until secure notice delivery is configured.');
}

async function verifiedRecipient(auth, uid, profile) {
  const user = await auth.getUser(uid);
  const email = normalizeEmail(user?.email);
  if (user?.uid !== uid || user.emailVerified !== true
    || !validEmail(email) || normalizeEmail(profile?.email) !== email) {
    throw new OtpError(409, 'ACCOUNT_NOTICE_RECIPIENT_UNVERIFIED',
      'The account needs a verified email address before this access change.');
  }
  return { email, hash: emailHash(email) };
}

function noticeMessage(action) {
  const label = action === 'deactivate' ? 'deactivation'
    : ['suspend', 'suspend_account'].includes(action) ? 'suspension' : 'termination';
  const text = `BlueTap account access notice\n\nAn Administrator has started a ${label} of your BlueTap account. Your access may be restricted while this action is processed. This message does not confirm that the action has finished. Please contact BlueTap support if you need help or wish to request review.\n\nDo not reply with passwords or verification codes.`;
  const html = `<html><body><h1>BlueTap account access notice</h1><p>An Administrator has started a ${label} of your BlueTap account. Your access may be restricted while this action is processed. This message does not confirm that the action has finished.</p><p>Please contact BlueTap support if you need help or wish to request review.</p><p>Do not reply with passwords or verification codes.</p></body></html>`;
  return { subject: SUBJECT, text, html };
}

async function ensureNoticeAccepted({ db, auth, intentId, ownerId, generation, now,
  sendEmail = defaultSendEmail }) {
  const ref = db.collection('accountActionIntents').doc(intentId);
  const snap = await ref.get();
  const intent = snap.data();
  if (!snap.exists || !intent?.desiredAuthDisabled || !intent.noticeDelivery) {
    throw new OtpError(409, 'ACCOUNT_NOTICE_INVALID', 'The account notice requires reconciliation.');
  }
  if (intent.noticeDelivery.state === 'accepted') return intent.noticeDelivery;
  const profileSnap = await db.collection('users').doc(intent.targetUid).get();
  const recipient = await verifiedRecipient(auth, intent.targetUid, profileSnap.data());
  if (recipient.hash !== intent.noticeDelivery.recipientHash) {
    throw new OtpError(409, 'ACCOUNT_NOTICE_RECIPIENT_CHANGED', 'The notice recipient requires review.');
  }
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const data = current.data();
    if (!current.exists || data?.lease?.ownerId !== ownerId
      || data.lease.generation !== generation || data.noticeDelivery?.state !== 'pending') {
      throw new OtpError(409, 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN',
        'The account notice requires manual reconciliation.');
    }
    tx.update(ref, { noticeDelivery: { ...data.noticeDelivery,
      state: 'sending', startedAt: now() }, revision: data.revision + 1, updatedAt: now() });
  });
  const message = noticeMessage(intent.action);
  let accepted;
  try {
    accepted = await sendEmail({ to: recipient.email, ...message,
      requestId: intent.noticeDelivery.requestId });
  } catch (error) {
    // A provider error or timeout may have occurred after acceptance. Do not
    // resend an uncertain message through a relay without provider idempotency.
    throw new OtpError(503, 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN',
      'Notice delivery is uncertain. The account action remains pending.');
  }
  if (!accepted || !['resend', 'vercel-relay', 'test'].includes(accepted.provider)
    || !Number.isInteger(accepted.providerStatus)
    || accepted.providerStatus < 200 || accepted.providerStatus >= 300) {
    throw new OtpError(503, 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN',
      'Notice delivery is uncertain. The account action remains pending.');
  }
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const data = current.data();
    if (!current.exists || data?.noticeDelivery?.state !== 'sending'
      || data.noticeDelivery.requestId !== intent.noticeDelivery.requestId) {
      throw new OtpError(409, 'ACCOUNT_NOTICE_DELIVERY_UNCERTAIN',
        'The account notice requires manual reconciliation.');
    }
    tx.update(ref, { noticeDelivery: { ...data.noticeDelivery, state: 'accepted',
      provider: accepted.provider, providerStatus: accepted.providerStatus,
      acceptedAt: now(), deliveryConfirmed: false },
    revision: data.revision + 1, updatedAt: now() });
  });
  return { state: 'accepted', deliveryConfirmed: false };
}

module.exports = { SUBJECT, assertNoticeTransportConfigured, emailHash, ensureNoticeAccepted, noticeMessage,
  requestIdFor, verifiedRecipient };
