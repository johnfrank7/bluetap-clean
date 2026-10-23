const { createHash } = require('node:crypto');
const { OtpError } = require('../utils/otpError');
const { getAssignmentVersion } = require('../utils/relationshipEpochs');

const clean = (value) => String(value || '').trim();
const attemptIdFor = (orderId, number) => createHash('sha256').update(`${orderId}|${number}`).digest('hex');

function nextAttemptNumber(order) {
  const current = order.deliveryAttemptSeq === undefined ? 0 : order.deliveryAttemptSeq;
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new OtpError(409, 'DELIVERY_ATTEMPT_SEQUENCE_INVALID', 'The delivery attempt sequence requires repair.');
  }
  return current + 1;
}

function mutationIdOf(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) {
    throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
  }
  return value;
}

async function prepareDeliveryAttemptTransition({ tx, db, orderId, order, action, distributorUid, branchId, now, failureReasonCode, failureReasonLabel, failureReasonNote, reportFormat, reportEvidence, clientMutationId }) {
  if (!['start-delivery', 'fail-delivery', 'mark-delivered'].includes(action)) return { orderUpdate: {}, writes: [] };
  const mutationId = mutationIdOf(clientMutationId);
  const requesterUid = clean(order.requesterUid || order.requester_id);
  const assignmentVersion = getAssignmentVersion(order);
  const eventRef = (id, kind) => db.collection('deliveryAttemptEvents').doc(`${id}_${kind}`);
  const event = (id, number, kind, extra = {}) => ({
    schemaVersion: 1, attemptId: id, attemptNumber: number, orderId,
    distributorUid, branchId, actorUid: distributorUid, actorRole: 'distributor',
    kind, createdAt: now, clientMutationId: mutationId, ...extra,
  });
  const attempt = (id, number, startedAt, startTimeKnown, outcome) => ({
    schemaVersion: 1, orderId, requesterUid, distributorUid, branchId,
    assignmentVersion, attemptNumber: number, outcome, responsibility: 'undetermined',
    reviewState: outcome === 'failed' ? 'reported' : 'not_applicable',
    startedAt, startTimeKnown, endedAt: outcome === 'in_progress' ? null : now,
    createdAt: now, updatedAt: now, startMutationId: outcome === 'in_progress' ? mutationId : null,
    outcomeMutationId: outcome === 'in_progress' ? null : mutationId,
    reportedReasonCode: outcome === 'failed' ? failureReasonCode : null,
    reportedReasonLabel: outcome === 'failed' ? failureReasonLabel : null,
    reportedReasonNote: outcome === 'failed' ? failureReasonNote : null,
    ...(outcome === 'failed' ? { reportFormat: reportFormat || null, reportEvidence: reportEvidence ?? null, reportReceivedAt: now } : {}),
  });

  if (action === 'start-delivery') {
    if (clean(order.activeDeliveryAttemptId)) {
      throw new OtpError(409, 'DELIVERY_ATTEMPT_ACTIVE', 'An active delivery attempt already exists.');
    }
    const number = nextAttemptNumber(order);
    const id = attemptIdFor(orderId, number);
    const ref = db.collection('deliveryAttempts').doc(id);
    return {
      orderUpdate: { deliveryAttemptSeq: number, activeDeliveryAttemptId: id },
      writes: [
        { method: 'create', ref, data: attempt(id, number, now, true, 'in_progress') },
        { method: 'create', ref: eventRef(id, 'created'), data: event(id, number, 'ATTEMPT_STARTED') },
      ],
    };
  }

  const outcome = action === 'fail-delivery' ? 'failed' : 'delivered';
  const activeId = clean(order.activeDeliveryAttemptId);
  let id = activeId;
  let number;
  let legacy = false;
  const writes = [];
  if (activeId) {
    const ref = db.collection('deliveryAttempts').doc(activeId);
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : null;
    if (!current || current.orderId !== orderId || current.distributorUid !== distributorUid
      || current.branchId !== branchId || current.assignmentVersion !== assignmentVersion
      || current.outcome !== 'in_progress' || !Number.isSafeInteger(current.attemptNumber)
      || current.attemptNumber !== order.deliveryAttemptSeq
      || activeId !== attemptIdFor(orderId, current.attemptNumber)) {
      throw new OtpError(409, 'DELIVERY_ATTEMPT_INVALID', 'The active delivery attempt requires repair.');
    }
    number = current.attemptNumber;
    writes.push({ method: 'update', ref, data: {
      outcome, endedAt: now, updatedAt: now, outcomeMutationId: mutationId,
      reviewState: outcome === 'failed' ? 'reported' : 'not_applicable',
      reportedReasonCode: outcome === 'failed' ? failureReasonCode : null,
      reportedReasonLabel: outcome === 'failed' ? failureReasonLabel : null,
      reportedReasonNote: outcome === 'failed' ? failureReasonNote : null,
      ...(outcome === 'failed' ? { reportFormat: reportFormat || null, reportEvidence: reportEvidence ?? null, reportReceivedAt: now } : {}),
    } });
  } else {
    // Orders already out for delivery before this schema have no trustworthy start time.
    if (order.deliveryAttemptSeq !== undefined && order.deliveryAttemptSeq !== 0) {
      throw new OtpError(409, 'DELIVERY_ATTEMPT_INVALID', 'The active delivery attempt requires repair.');
    }
    legacy = true;
    number = nextAttemptNumber(order);
    id = attemptIdFor(orderId, number);
    writes.push({ method: 'create', ref: db.collection('deliveryAttempts').doc(id), data: attempt(id, number, null, false, outcome) });
    writes.push({ method: 'create', ref: eventRef(id, 'created'), data: event(id, number, 'LEGACY_ATTEMPT_RECORDED', { startTimeKnown: false }) });
  }
  writes.push({ method: 'create', ref: eventRef(id, 'outcome'), data: event(id, number, outcome === 'failed' ? 'ATTEMPT_FAILED' : 'ATTEMPT_DELIVERED', {
    outcome, reportedReasonCode: outcome === 'failed' ? failureReasonCode : null,
    ...(outcome === 'failed' ? { reportFormat: reportFormat || null, reportEvidence: reportEvidence ?? null, reportReceivedAt: now } : {}),
  }) });
  return { orderUpdate: { activeDeliveryAttemptId: null, ...(legacy ? { deliveryAttemptSeq: number } : {}) }, writes };
}

function stageDeliveryAttemptWrites(tx, writes) {
  for (const { method, ref, data } of writes) tx[method](ref, data);
}

module.exports = { attemptIdFor, prepareDeliveryAttemptTransition, stageDeliveryAttemptWrites };
