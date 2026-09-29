const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');

const MAX_MESSAGE_CHARACTERS = 2000;
const MAX_PREVIEW_CHARACTERS = 140;
const DEFAULT_MESSAGE_PAGE_SIZE = 40;
const MAX_MESSAGE_PAGE_SIZE = 50;
const MAX_CLIENT_MUTATION_ID_CHARACTERS = 128;
const BURST_LIMIT = 5;
const BURST_WINDOW_MS = 10_000;
const SUSTAINED_LIMIT = 30;
const SUSTAINED_WINDOW_MS = 60_000;

const clean = (value) => String(value || '').trim();
const millis = (value) => Number(value?.toMillis?.() || value?.getTime?.() || value || 0);

function normalizeMessageBody(value) {
  if (typeof value !== 'string') {
    throw new OtpError(400, 'CHAT_MESSAGE_REQUIRED', 'Enter a text message.');
  }
  const body = value.replace(/\r\n?/g, '\n').normalize('NFC');
  if (!body.trim()) throw new OtpError(400, 'CHAT_MESSAGE_REQUIRED', 'Enter a text message.');
  if ([...body].length > MAX_MESSAGE_CHARACTERS) {
    throw new OtpError(400, 'CHAT_MESSAGE_TOO_LONG', `Messages may contain at most ${MAX_MESSAGE_CHARACTERS} characters.`);
  }
  return body;
}

function messagePreview(body) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim();
  return [...normalized].slice(0, MAX_PREVIEW_CHARACTERS).join('');
}

function normalizeClientMutationId(value) {
  if (typeof value !== 'string') {
    throw new OtpError(400, 'CHAT_MUTATION_ID_REQUIRED', 'clientMutationId is required.');
  }
  const id = value.trim();
  if (!id || [...id].length > MAX_CLIENT_MUTATION_ID_CHARACTERS || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new OtpError(400, 'CHAT_MUTATION_ID_INVALID', 'Use a valid bounded clientMutationId.');
  }
  return id;
}

function normalizeMessagePage({ limit, beforeSeq } = {}) {
  const parsedLimit = limit === undefined || limit === null || limit === '' ? DEFAULT_MESSAGE_PAGE_SIZE : Number(limit);
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_MESSAGE_PAGE_SIZE) {
    throw new OtpError(400, 'CHAT_PAGE_SIZE_INVALID', `Message page size must be between 1 and ${MAX_MESSAGE_PAGE_SIZE}.`);
  }
  if (beforeSeq === undefined || beforeSeq === null || beforeSeq === '') return { limit: parsedLimit, beforeSeq: null };
  const parsedCursor = Number(beforeSeq);
  if (!Number.isSafeInteger(parsedCursor) || parsedCursor < 1) {
    throw new OtpError(400, 'CHAT_PAGE_CURSOR_INVALID', 'The message cursor is invalid.');
  }
  return { limit: parsedLimit, beforeSeq: parsedCursor };
}

function principalKey(principal = {}) {
  const principalType = clean(principal.principalType);
  const principalId = clean(principal.principalId);
  if (!['user', 'branch'].includes(principalType) || !principalId) {
    throw new OtpError(500, 'CHAT_PRINCIPAL_INVALID', 'Chat principal state is invalid.');
  }
  return `${principalType}:${principalId}`;
}

function normalizeParticipantState(state = {}) {
  return {
    principalType: clean(state.principalType),
    principalId: clean(state.principalId),
    lastReadSeq: Number.isSafeInteger(state.lastReadSeq) && state.lastReadSeq >= 0 ? state.lastReadSeq : 0,
    lastReadAt: state.lastReadAt || null,
    lastIncomingSeq: Number.isSafeInteger(state.lastIncomingSeq) && state.lastIncomingSeq >= 0 ? state.lastIncomingSeq : 0,
    unreadCount: Number.isSafeInteger(state.unreadCount) && state.unreadCount >= 0 ? state.unreadCount : 0,
    incomingCount: Number.isSafeInteger(state.incomingCount) && state.incomingCount >= 0 ? state.incomingCount : Number(state.unreadCount || 0),
    lastReadIncomingCount: Number.isSafeInteger(state.lastReadIncomingCount) && state.lastReadIncomingCount >= 0 ? state.lastReadIncomingCount : 0,
    accessState: ['active', 'read_only', 'closed'].includes(state.accessState) ? state.accessState : 'active',
  };
}

function applyMessageToParticipantState(states, senderPrincipal, seq, now) {
  if (!Array.isArray(states) || !Number.isSafeInteger(seq) || seq < 1) {
    throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation participant state is invalid.');
  }
  const senderKey = principalKey(senderPrincipal);
  let senderFound = false;
  const seen = new Set();
  const participantState = states.map((raw) => {
    const state = normalizeParticipantState(raw);
    const key = principalKey(state);
    if (seen.has(key)) throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation participant state is duplicated.');
    seen.add(key);
    if (key === senderKey) {
      senderFound = true;
      return {
        ...state,
        lastReadSeq: seq,
        lastReadAt: now,
        lastReadIncomingCount: state.incomingCount,
        unreadCount: 0,
      };
    }
    if (state.incomingCount >= Number.MAX_SAFE_INTEGER) {
      throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation unread state cannot advance safely.');
    }
    const incomingCount = state.incomingCount + 1;
    return { ...state, lastIncomingSeq: seq, incomingCount, unreadCount: incomingCount - state.lastReadIncomingCount };
  });
  if (!senderFound) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'The sender is not a conversation participant.');
  return {
    participantState,
    principalIncomingCounts: participantState.map((state) => ({
      principalType: state.principalType,
      principalId: state.principalId,
      incomingCount: state.incomingCount,
    })),
  };
}

function advanceParticipantReadState(states, principal, lastReadSeq, principalIncomingCounts, now) {
  if (!Array.isArray(states) || !Array.isArray(principalIncomingCounts)) {
    throw new OtpError(409, 'CHAT_STATE_INVALID', 'Conversation read state is invalid.');
  }
  const targetKey = principalKey(principal);
  const countSnapshot = principalIncomingCounts.find((entry) => principalKey(entry) === targetKey);
  if (!countSnapshot || !Number.isSafeInteger(countSnapshot.incomingCount) || countSnapshot.incomingCount < 0) {
    throw new OtpError(409, 'CHAT_STATE_INVALID', 'The message read watermark is invalid.');
  }
  let found = false;
  const participantState = states.map((raw) => {
    const state = normalizeParticipantState(raw);
    if (principalKey(state) !== targetKey) return state;
    found = true;
    if (lastReadSeq <= state.lastReadSeq) return state;
    const lastReadIncomingCount = Math.min(state.incomingCount, countSnapshot.incomingCount);
    return {
      ...state,
      lastReadSeq,
      lastReadAt: now,
      lastReadIncomingCount,
      unreadCount: Math.max(0, state.incomingCount - lastReadIncomingCount),
    };
  });
  if (!found) throw new OtpError(403, 'CHAT_NOT_AUTHORIZED', 'The reader is not a conversation participant.');
  return participantState;
}

function receiptState(message, conversation, recipientPrincipal) {
  if (!message || !Number.isSafeInteger(message.seq)) return 'pending';
  const key = principalKey(recipientPrincipal);
  const state = (conversation?.participantState || []).map(normalizeParticipantState).find((entry) => principalKey(entry) === key);
  return state && state.lastReadSeq >= message.seq ? 'read' : 'persisted';
}

function stableHash(...parts) {
  return createHash('sha256').update(JSON.stringify(parts.map((part) => clean(part)))).digest('hex');
}

function mutationRegistryId(senderPrincipal, clientMutationId) {
  return stableHash(principalKey(senderPrincipal), clientMutationId);
}

function messageBodyHash(conversationId, body, orderId = '') {
  return stableHash(conversationId, body, orderId);
}

function rateLimitDocumentId(uid) {
  return stableHash('chat-rate', uid);
}

function consumeMessageRateLimit(record = {}, nowMs = Date.now()) {
  const previous = Array.isArray(record.attemptsAt) ? record.attemptsAt.map(millis).filter((time) => Number.isFinite(time) && time > nowMs - SUSTAINED_WINDOW_MS) : [];
  const burstCount = previous.filter((time) => time > nowMs - BURST_WINDOW_MS).length;
  if (burstCount >= BURST_LIMIT || previous.length >= SUSTAINED_LIMIT) {
    const relevant = burstCount >= BURST_LIMIT ? previous.filter((time) => time > nowMs - BURST_WINDOW_MS) : previous;
    const windowMs = burstCount >= BURST_LIMIT ? BURST_WINDOW_MS : SUSTAINED_WINDOW_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil(((Math.min(...relevant) + windowMs) - nowMs) / 1000));
    throw new OtpError(429, 'CHAT_RATE_LIMITED', 'Too many messages. Please wait before sending again.', { retryAfterSeconds });
  }
  const attemptsAt = [...previous, nowMs].map((time) => new Date(time));
  return { attemptsAt, resetAt: new Date(nowMs + SUSTAINED_WINDOW_MS), type: 'chat_message' };
}

module.exports = {
  BURST_LIMIT,
  BURST_WINDOW_MS,
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_CLIENT_MUTATION_ID_CHARACTERS,
  MAX_MESSAGE_CHARACTERS,
  MAX_MESSAGE_PAGE_SIZE,
  MAX_PREVIEW_CHARACTERS,
  SUSTAINED_LIMIT,
  SUSTAINED_WINDOW_MS,
  advanceParticipantReadState,
  applyMessageToParticipantState,
  consumeMessageRateLimit,
  messageBodyHash,
  messagePreview,
  mutationRegistryId,
  normalizeClientMutationId,
  normalizeMessageBody,
  normalizeMessagePage,
  normalizeParticipantState,
  principalKey,
  rateLimitDocumentId,
  receiptState,
};
