const assert = require('node:assert/strict');
const test = require('node:test');

const {
  advanceParticipantReadState,
  applyMessageToParticipantState,
  consumeMessageRateLimit,
  messagePreview,
  normalizeClientMutationId,
  normalizeMessageBody,
  normalizeMessagePage,
  receiptState,
} = require('../chatMessageService');

const participants = [
  { principalType: 'user', principalId: 'requester-a', lastReadSeq: 0, lastReadAt: null, lastIncomingSeq: 0, unreadCount: 0, incomingCount: 0, lastReadIncomingCount: 0, accessState: 'active' },
  { principalType: 'branch', principalId: 'branch-a', lastReadSeq: 0, lastReadAt: null, lastIncomingSeq: 0, unreadCount: 0, incomingCount: 0, lastReadIncomingCount: 0, accessState: 'active' },
];

test('text normalization enforces V1 content limits without producing HTML', () => {
  assert.equal(normalizeMessageBody('hello\r\nworld'), 'hello\nworld');
  assert.throws(() => normalizeMessageBody('   \n'), (error) => error.reason === 'CHAT_MESSAGE_REQUIRED');
  assert.throws(() => normalizeMessageBody(null), (error) => error.reason === 'CHAT_MESSAGE_REQUIRED');
  assert.throws(() => normalizeMessageBody('x'.repeat(2001)), (error) => error.reason === 'CHAT_MESSAGE_TOO_LONG');
  assert.equal(normalizeMessageBody('<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(messagePreview('one\n  two ' + 'x'.repeat(200)).length, 140);
});

test('mutation IDs and message pagination are bounded', () => {
  assert.equal(normalizeClientMutationId('retry:123'), 'retry:123');
  assert.throws(() => normalizeClientMutationId('bad id'), (error) => error.reason === 'CHAT_MUTATION_ID_INVALID');
  assert.deepEqual(normalizeMessagePage({}), { limit: 40, beforeSeq: null });
  assert.deepEqual(normalizeMessagePage({ limit: '50', beforeSeq: '8' }), { limit: 50, beforeSeq: 8 });
  assert.throws(() => normalizeMessagePage({ limit: 51 }), (error) => error.reason === 'CHAT_PAGE_SIZE_INVALID');
});

test('send and read metadata preserve exact unread counts without rewriting messages', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const first = applyMessageToParticipantState(participants, { principalType: 'user', principalId: 'requester-a' }, 1, now);
  assert.equal(first.participantState[0].unreadCount, 0);
  assert.equal(first.participantState[1].unreadCount, 1);
  assert.equal(receiptState({ seq: 1 }, { participantState: first.participantState }, { principalType: 'branch', principalId: 'branch-a' }), 'persisted');

  const second = applyMessageToParticipantState(first.participantState, { principalType: 'user', principalId: 'requester-a' }, 2, now);
  assert.equal(second.participantState[0].unreadCount, 0);
  assert.equal(second.participantState[1].unreadCount, 2);

  const read = advanceParticipantReadState(second.participantState, { principalType: 'branch', principalId: 'branch-a' }, 1, first.principalIncomingCounts, now);
  assert.equal(read[1].unreadCount, 1);
  assert.equal(read[1].lastReadSeq, 1);
  assert.equal(receiptState({ seq: 1 }, { participantState: read }, { principalType: 'branch', principalId: 'branch-a' }), 'read');
});

test('persistent rate-limit state enforces burst and sustained thresholds', () => {
  let record = {};
  const start = Date.parse('2026-01-01T00:00:00Z');
  for (let index = 0; index < 5; index += 1) record = consumeMessageRateLimit(record, start + index);
  assert.throws(() => consumeMessageRateLimit(record, start + 5), (error) => error.reason === 'CHAT_RATE_LIMITED' && error.status === 429);

  const attemptsAt = Array.from({ length: 30 }, (_, index) => new Date(start + index * 1000));
  assert.throws(() => consumeMessageRateLimit({ attemptsAt }, start + 30_000), (error) => error.reason === 'CHAT_RATE_LIMITED');
});
