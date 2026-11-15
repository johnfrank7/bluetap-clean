const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const babel = require('@babel/core');
const { appealReasonError, createRequesterAppealRegistry, reportNotificationTarget } =
  require('../../../services/requesterDeliveryReportFlow');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const attemptId = 'a'.repeat(64);
const appeal = (reason) => ({ attemptId, orderId: 'order-one', state: 'submitted', appealReason: reason,
  submittedAt: '2026-10-25T00:00:00.000Z' });

test('appeal validation matches backend bounds and exact appeal notification targets', () => {
  assert.ok(appealReasonError('short'));
  assert.ok(appealReasonError('a'.repeat(1001)));
  assert.equal(appealReasonError('I dispute this finding on the evidence.'), '');
  assert.deepEqual(reportNotificationTarget({ id: `moderation:appeal_res_${attemptId}`,
    kind: 'delivery_appeal_resolved', status: 'delivery_appeal_resolved', orderId: 'order-one', attemptId }),
  { orderId: 'order-one', attemptId });
  assert.equal(reportNotificationTarget({ id: `moderation:appeal_res_${attemptId}`,
    kind: 'delivery_appeal_resolved', status: 'delivery_appeal_resolved', orderId: 'another-order',
    attemptId: 'b'.repeat(64) }), null);
});

test('duplicate taps send once, uncertain retry freezes payload, and different accounts remain isolated', async () => {
  let release;
  const requests = [];
  const registry = createRequesterAppealRegistry({ makeId: () => 'stable-mutation-1', send: async (payload) => {
    requests.push(payload);
    if (requests.length === 1) return new Promise((resolve, reject) => { release = () => reject(new Error('network')); });
    return { appeal: appeal(payload.appealReason) };
  } });
  const flow = registry.get('requester-a', 'order-one', attemptId);
  const first = flow.submit('order-one', attemptId, 'I dispute this finding on the evidence.');
  assert.equal((await flow.submit('order-one', attemptId, 'I dispute this finding on the evidence.')).ignored, true);
  assert.equal(requests.length, 1);
  release();
  await assert.rejects(first);
  assert.equal(flow.getState().pending.uncertain, true);
  assert.equal(registry.pendingAttemptId('requester-a', 'order-one'), attemptId);
  assert.equal(registry.pendingAttemptId('requester-b', 'order-one'), '');
  await assert.rejects(flow.submit('order-one', attemptId, 'Changed explanation after uncertainty'),
    (error) => error.status === 409);
  assert.equal(requests.length, 1);
  const second = await registry.get('requester-a', 'order-one', attemptId)
    .submit('order-one', attemptId, 'I dispute this finding on the evidence.');
  assert.equal(second.appeal.state, 'submitted');
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[1].clientMutationId, 'stable-mutation-1');
  assert.equal(flow.hasPending(), false);
});

test('confirmed conflict cannot become success and does not preserve a stale retry', async () => {
  const flow = createRequesterAppealRegistry({ makeId: () => 'mutation-1', send: async () => {
    const error = new Error('Already appealed'); error.status = 409; throw error;
  } }).get('requester-a', 'order-one', attemptId);
  await assert.rejects(flow.submit('order-one', attemptId, 'A sufficient factual appeal reason.'),
    (error) => error.status === 409);
  assert.equal(flow.hasPending(), false);
  assert.equal(flow.getState().confirmedAppeal, null);
  assert.equal(flow.getState().terminalConflict, true);
});

test('appeal UI and protected clients parse; requester form is conditional and Admin decision is confirmed', () => {
  for (const path of ['components/RequesterDeliveryReportDialog.jsx', 'components/AdminDeliveryAppealsWorkspace.jsx',
    'app/admin/reports-safety.jsx', 'components/RoleNotifications.jsx', 'app/requester/r_notification.jsx',
    'services/adminDeliveryAppeals.js', 'services/requesterDeliveryAppeals.js']) {
    assert.ok(babel.transformSync(read(path), { filename: resolve(root, path), babelrc: false, configFile: false,
      presets: ['babel-preset-expo'] }).code);
  }
  assert.match(read('components/RequesterDeliveryReportDialog.jsx'), /appealRegistry\.get\(ownerUid, orderId, selectedId\)/);
  assert.match(read('components/AdminDeliveryAppealsWorkspace.jsx'), /Confirm appeal resolution/);
  assert.doesNotMatch(read('services/adminDeliveryAppeals.js') + read('services/requesterDeliveryAppeals.js'),
    /collection\(|deliveryAttemptEvents/);
});
