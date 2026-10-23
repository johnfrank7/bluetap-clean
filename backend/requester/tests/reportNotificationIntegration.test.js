const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createRequesterReportFeed, combineLoadedNotifications, countLoadedUnseen,
  PAGE_SIZE, MAX_CONTINUATION_PAGES } = require('../../../services/requesterReportNotificationFeed');
const { createRoleNotificationSeenStore } = require('../../../services/roleNotificationSeenStore');
const { notificationSeverity, compactNotificationStatus } = require('../../../components/notificationPresentation');

const root = path.resolve(__dirname, '../../..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const id = (number) => number.toString(16).padStart(64, '0');
const report = (number, orderId = 'order-one') => ({
  attemptId: id(number), orderId, attemptNumber: number,
  reportedStatus: 'reported_by_distributor', reviewState: 'awaiting_review',
  reportReceivedAt: new Date(Date.UTC(2026, 9, 23, 0, number)).toISOString(),
  reportedReasonNote: 'private distributor note', distributorUid: 'private-distributor',
});
const page = (reports, nextCursor = null) => ({ reports, nextCursor });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

test('Requester feed discovers reports by protected global pages and retains distinct attempts after rescheduling', async () => {
  const calls = [];
  const feed = createRequesterReportFeed({ fetchPage: async (uid, options) => {
    calls.push({ uid, ...options });
    return options.cursor ? page([report(2, 'rescheduled-order'), report(1)], null)
      : page([report(3, 'rescheduled-order'), report(2, 'rescheduled-order')], 'older');
  } });
  assert.deepEqual((await feed.refresh()).events, []);
  feed.setUid('requester-one');
  await feed.refresh();
  assert.equal(calls[0].uid, 'requester-one');
  assert.deepEqual(calls[0], { uid: 'requester-one', cursor: '', limit: PAGE_SIZE });
  assert.deepEqual(feed.getState().events.map((event) => event.id), [3, 2].map((number) => `delivery-report:${id(number)}`));
  assert.equal(feed.getState().hasMore, true);
  await feed.loadOlder();
  assert.deepEqual(feed.getState().events.map((event) => event.attemptId), [3, 2, 1].map(id));
  assert.equal(feed.getState().historyComplete, true);
  assert.ok(feed.getState().events.every((event) => !JSON.stringify(event).includes('private')));
});

test('empty pages with cursors continue only within a bounded budget, and older loading resumes', async () => {
  const cursors = [];
  const feed = createRequesterReportFeed({ fetchPage: async (_, { cursor }) => {
    cursors.push(cursor);
    return page([], `cursor-${cursors.length}`);
  } });
  feed.setUid('requester-one');
  await feed.refresh();
  assert.equal(cursors.length, MAX_CONTINUATION_PAGES);
  assert.equal(feed.getState().loaded, true);
  assert.deepEqual(feed.getState().events, []);
  assert.equal(feed.getState().hasMore, true);
  assert.equal(feed.getState().nextCursor, `cursor-${MAX_CONTINUATION_PAGES}`);
  await feed.loadOlder();
  assert.equal(cursors.length, MAX_CONTINUATION_PAGES * 2);
  assert.equal(cursors[MAX_CONTINUATION_PAGES], `cursor-${MAX_CONTINUATION_PAGES}`);
});

test('repeated cursor fails visibly without looping, and a forced retry can recover', async () => {
  let broken = true;
  let calls = 0;
  const feed = createRequesterReportFeed({ fetchPage: async () => {
    calls += 1;
    return broken ? page([], 'same-cursor') : page([report(4)], null);
  } });
  feed.setUid('requester-one');
  await feed.refresh();
  assert.equal(calls, 2);
  assert.match(feed.getState().error, /did not advance/);
  assert.equal(feed.getState().loaded, false);
  broken = false;
  await feed.refresh({ force: true });
  assert.equal(feed.getState().error, '');
  assert.equal(feed.getState().events[0].attemptId, id(4));
});

test('foreground refresh is throttled, manual refresh is immediate, and older loaded reports survive refresh', async () => {
  let clock = 1_000;
  let calls = 0;
  const feed = createRequesterReportFeed({ now: () => clock, fetchPage: async (_, { cursor }) => {
    calls += 1;
    return cursor ? page([report(1)], null) : page([report(3), report(2)], 'older');
  } });
  feed.setUid('requester-one');
  await feed.refresh();
  await feed.loadOlder();
  assert.equal(calls, 2);
  await feed.refresh();
  assert.equal(calls, 2);
  clock += 30_000;
  await feed.refresh();
  assert.equal(calls, 3);
  assert.deepEqual(feed.getState().events.map((event) => event.attemptId), [3, 2, 1].map(id));
  await feed.refresh({ force: true });
  assert.equal(calls, 4);
});

test('logout and account switch clear reports immediately and discard late responses', async () => {
  const old = deferred();
  const feed = createRequesterReportFeed({ fetchPage: (uid) => uid === 'old' ? old.promise : Promise.resolve(page([report(5)], null)) });
  feed.setUid('old');
  const pending = feed.refresh();
  feed.setUid('new');
  assert.deepEqual(feed.getState().events, []);
  await feed.refresh();
  old.resolve(page([report(1)], null));
  await pending;
  assert.equal(feed.getState().uid, 'new');
  assert.deepEqual(feed.getState().events.map((event) => event.attemptId), [id(5)]);
  feed.setUid('');
  assert.deepEqual(feed.getState().events, []);
  assert.equal(feed.getState().uid, '');
});

test('loaded-unseen count and bell cap do not discard deliberately loaded report pages', () => {
  const base = Array.from({ length: 150 }, (_, number) => ({ id: `order:${number}`, at: new Date(1_000 + number) }));
  const reports = [report(1), report(2)].map((entry) => ({
    id: `delivery-report:${entry.attemptId}`, at: new Date(entry.reportReceivedAt), kind: 'delivery_report',
  }));
  const allEvents = combineLoadedNotifications(base, reports);
  assert.equal(allEvents.length, 152);
  assert.equal(allEvents.slice(0, 150).length, 150);
  assert.equal(allEvents.filter((event) => event.kind === 'delivery_report').length, 2);
  assert.equal(countLoadedUnseen(allEvents, new Set([reports[0].id])), 151);
  assert.equal(new Set(allEvents.map((event) => event.id)).size, 152);
});

test('seen IDs persist on device across relogin, stay role and UID isolated, and retain the 500-ID cap', async () => {
  const device = new Map();
  const storage = { getItem: async (key) => device.get(key) || null,
    setItem: async (key, value) => { device.set(key, value); } };
  const first = createRoleNotificationSeenStore(storage);
  const key = first.keyFor('requester', 'r1');
  let notified;
  const unsubscribe = first.subscribe(key, (next) => { notified = next; });
  await first.write(key, new Set(Array.from({ length: 501 }, (_, number) => `event-${number}`)));
  assert.equal(notified.size, 500);
  assert.equal(notified.has('event-0'), false);
  unsubscribe();
  const relogin = createRoleNotificationSeenStore(storage);
  assert.equal((await relogin.read(key)).size, 500);
  assert.equal((await relogin.read(relogin.keyFor('requester', 'r2'))).size, 0);
  assert.equal((await relogin.read(relogin.keyFor('distributor', 'r1'))).size, 0);
});

test('report styling is neutral in both themes and Requester UI navigates only with the exact report target', () => {
  assert.equal(notificationSeverity('delivery_report').kind, 'info');
  assert.equal(notificationSeverity('delivery_report', true).kind, 'info');
  assert.equal(compactNotificationStatus('delivery_report'), 'Delivery report');
  const provider = source('components/RoleNotifications.jsx');
  const screen = source('app/requester/r_notification.jsx');
  const header = source('components/BlueTapHeader.jsx');
  assert.match(provider, /role === 'requester' && roleData\.readiness === 'READY'/);
  assert.match(provider, /fetchRequesterDeliveryReports\(undefined, options\)/);
  assert.match(provider, /AppState\.addEventListener/);
  assert.match(screen, /reportNotificationTarget\(entry\.item\)/);
  assert.match(screen, /reportOrderId: target\.orderId, reportAttemptId: target\.attemptId/);
  assert.match(screen, /Load older reports/);
  assert.match(screen, /Seen status is saved on this device/);
  assert.match(header, /loaded unseen/);
  assert.ok(!screen.includes('reportedReasonNote'));
  assert.ok(!screen.includes('clientMutationId'));
});
