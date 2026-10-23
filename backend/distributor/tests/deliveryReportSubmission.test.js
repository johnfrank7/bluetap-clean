const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeliveryReportSubmission } = require('../../../services/deliveryReportSubmission');

const draft = { failureReasonCode: 'NO_RESPONSE', reportFormat: 'structured-v1', reportEvidence: {
  contactAttempts: [{ method: 'PHONE_CALL', outcome: 'NO_ANSWER' }],
} };

test('rapid duplicate taps start only one report and one mutation ID', async () => {
  let sendCount = 0;
  let resolveSend;
  const coordinator = createDeliveryReportSubmission({
    makeId: () => 'stable-report-id',
    readOrder: async () => ({ status: 'out_for_delivery' }),
    send: () => { sendCount += 1; return new Promise((resolve) => { resolveSend = resolve; }); },
  });
  const first = coordinator.submit('order-a', draft);
  assert.deepEqual(await coordinator.submit('order-a', draft), { ignored: true });
  assert.equal(sendCount, 1);
  resolveSend({ status: 'delivery_failed' });
  assert.deepEqual(await first, { order: { status: 'delivery_failed' } });
  assert.equal(coordinator.hasPending(), false);
});

test('uncertain retry reads the order and resends the frozen payload with the same mutation ID', async () => {
  const sent = [];
  let readCount = 0;
  const coordinator = createDeliveryReportSubmission({
    makeId: () => 'stable-report-id',
    readOrder: async () => { readCount += 1; return { status: 'delivery_failed' }; },
    send: async (_orderId, payload) => {
      sent.push(payload);
      if (sent.length === 1) { const error = new Error('Network result unknown'); error.uncertain = true; throw error; }
      return { status: 'delivery_failed' };
    },
  });
  await assert.rejects(coordinator.submit('order-a', draft), /unknown/);
  assert.equal(coordinator.hasPending(), true);
  const changedDraft = JSON.parse(JSON.stringify(draft));
  changedDraft.reportEvidence.contactAttempts[0].method = 'SMS';
  assert.deepEqual(await coordinator.submit('order-a', changedDraft), { order: { status: 'delivery_failed' } });
  assert.equal(readCount, 1);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(sent[1].clientMutationId, 'stable-report-id');
  assert.equal(sent[1].reportEvidence.contactAttempts[0].method, 'PHONE_CALL');
  assert.equal(coordinator.hasPending(), false);
});

test('retry stops on stale order and definite validation failure permits a new submission', async () => {
  let sendCount = 0;
  const coordinator = createDeliveryReportSubmission({
    makeId: () => 'stable-report-id',
    readOrder: async () => ({ status: 'scheduled' }),
    send: async () => { sendCount += 1; const error = new Error('Unknown'); error.uncertain = true; throw error; },
  });
  await assert.rejects(coordinator.submit('order-a', draft), /Unknown/);
  await assert.rejects(coordinator.submit('order-a', draft), /changed/);
  assert.equal(sendCount, 1);
  assert.equal(coordinator.hasPending(), false);

  const rejected = createDeliveryReportSubmission({
    makeId: () => 'stable-report-id', readOrder: async () => ({}),
    send: async () => { const error = new Error('Invalid'); error.uncertain = false; throw error; },
  });
  await assert.rejects(rejected.submit('order-a', draft), /Invalid/);
  assert.equal(rejected.hasPending(), false);
});

test('retry retains an uncertain report when refresh fails but clears it on a definite server conflict', async () => {
  let checks = 0;
  let sends = 0;
  const coordinator = createDeliveryReportSubmission({
    makeId: () => 'stable-report-id',
    readOrder: async () => {
      checks += 1;
      if (checks === 1) throw new Error('Refresh unavailable');
      return { status: 'delivery_failed' };
    },
    send: async () => {
      sends += 1;
      const error = new Error(sends === 1 ? 'Unknown result' : 'Replay conflict');
      error.uncertain = sends === 1;
      throw error;
    },
  });
  await assert.rejects(coordinator.submit('order-a', draft), /Unknown result/);
  await assert.rejects(coordinator.submit('order-a', draft), /Refresh unavailable/);
  assert.equal(coordinator.hasPending(), true);
  assert.equal(sends, 1);
  await assert.rejects(coordinator.submit('order-a', draft), /Replay conflict/);
  assert.equal(coordinator.hasPending(), false);
});
