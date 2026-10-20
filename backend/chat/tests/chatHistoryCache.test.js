const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { appendHistoryPage, runScopedHistoryRequest, shouldRefreshHistory, verifiedHistoryPage, visibleHistory } = require('../../../components/chat/chatHistoryCache');

test('simultaneous History loads for one principal share one request', async () => {
  const inFlight = { current: null };
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = runScopedHistoryRequest(inFlight, 'manager:user:branch-a', () => { calls++; return pending; });
  const second = runScopedHistoryRequest(inFlight, 'manager:user:branch-a', () => { calls++; return pending; });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(inFlight.current, null);
  await runScopedHistoryRequest(inFlight, 'manager:user:branch-a', () => { calls++; return []; });
  assert.equal(calls, 2);
});

test('fresh session history reopens immediately and refreshes after activity or age', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const cached = { loaded: true, loading: false, loadingMore: false, error: '', summaryVersion: 4, refreshedAt: now - 5_000 };
  assert.equal(shouldRefreshHistory(cached, 4, now), false);
  assert.equal(shouldRefreshHistory(cached, 5, now), true);
  assert.equal(shouldRefreshHistory({ ...cached, refreshedAt: now - 60_001 }, 4, now), true);
  assert.equal(shouldRefreshHistory({ ...cached, loading: true }, 5, now), false);
  assert.equal(shouldRefreshHistory({ ...cached, error: 'offline' }, 4, now), false);
  assert.equal(shouldRefreshHistory({ ...cached, error: 'offline' }, 5, now), true);
  assert.equal(shouldRefreshHistory({ ...cached, loaded: false }, 4, now), true);
});

test('history pagination deduplicates by original archive ID and expired entries disappear', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const first = [{ historyId: 'order-a', readAccessEndsAt: new Date(now + 1000) }];
  const merged = appendHistoryPage(first, [{ historyId: 'order-a' }, { historyId: 'order-b', readAccessEndsAt: new Date(now - 1) }]);
  assert.deepEqual(merged.map((item) => item.historyId), ['order-a', 'order-b']);
  assert.deepEqual(visibleHistory(merged, now).map((item) => item.historyId), ['order-a']);
  assert.deepEqual(visibleHistory(merged, now + 1000), []);
});

test('History pages require the updated backend contract and original delivered-order context', () => {
  const item = { id: 'conversation-a', historyId: 'history-a', historyOrderId: 'order-a',
    readAccessEndsAt: new Date(Date.now() + 1000), orderContext: { id: 'order-a', status: 'delivered' } };
  const page = { view: 'history', conversations: [item], nextCursor: null };
  assert.equal(verifiedHistoryPage(page), page);
  assert.throws(() => verifiedHistoryPage({ conversations: [item] }), /updated BlueTap backend/);
  assert.throws(() => verifiedHistoryPage({ ...page, conversations: [{ id: 'conversation-a' }] }), /updated BlueTap backend/);
  assert.throws(() => verifiedHistoryPage({ ...page, conversations: [{ ...item, orderContext: { id: 'order-b', status: 'delivered' } }] }), /updated BlueTap backend/);
  assert.throws(() => verifiedHistoryPage({ ...page, conversations: [{ ...item, orderContext: { id: 'order-a', status: 'in_transit' } }] }), /updated BlueTap backend/);
  assert.throws(() => verifiedHistoryPage({ ...page, conversations: [item, item] }), /updated BlueTap backend/);
});

test('History state is scoped to the authenticated role and branch in the provider', () => {
  const provider = readFileSync(resolve(__dirname, '../../../components/chat/ChatDataProvider.jsx'), 'utf8');
  const list = readFileSync(resolve(__dirname, '../../../components/chat/ChatConversationList.jsx'), 'utf8');
  assert.match(provider, /const historyScope = accessReadiness === 'ready' \? JSON\.stringify\(\[role, uid, historyBranchId\]\)/);
  assert.match(provider, /selectedSeed\.historyScope !== historyScope/);
  assert.match(provider, /historyScopeRef\.current !== historyScope/);
  assert.match(provider, /historyInFlightRef\.current\?\.scope === historyScope/);
  assert.match(provider, /historyCache\.visibleHistory/);
  assert.equal((provider.match(/historyCache\.verifiedHistoryPage\(page\)/g) || []).length, 2);
  assert.match(list, /historyLoaded/);
  assert.match(list, /historyError \? 'History unavailable'/);
  assert.match(list, /historyCursor \? 'More history may be available'/);
  assert.doesNotMatch(list, /loadConversationHistory\(/);
});
