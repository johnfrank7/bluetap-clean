const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveDistributor } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { safeOrder, owningBranchId } = require('../manager/dispatchHandler');
const { OtpError } = require('../utils/otpError');
const { assignmentVersionForTransition, getAssignmentVersion } = require('../utils/relationshipEpochs');
const { FAILED_DELIVERY_CHAT_GRACE_MS } = require('../chat/chatAuthorization');
const { postOrderAccessEndsAt, reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');
const { prepareOrderAbuseIncidentInTransaction } = require('../moderation/moderationService');
const { attemptIdFor, prepareDeliveryAttemptTransition, stageDeliveryAttemptWrites } = require('../delivery/deliveryAttemptService');
const { normalizeFailureReport, matchesCommittedReport } = require('../delivery/deliveryReportEvidence');

const clean = (value, max = 128) => String(value || '').trim().slice(0, max);
const history = (value) => Array.isArray(value) ? value : [];
const statusOf = (order = {}) => clean(order.status, 80).toLowerCase();

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

async function updateOrder(db, orderId, prepare) {
  const ref = db.collection('requests').doc(orderId);
  if (typeof db.runTransaction === 'function') {
    return db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The assigned delivery was not found.');
      const current = snapshot.data() || {};
      const { update, moderationWrite, attemptWrites, replay } = await prepare(current, tx);
      if (replay) return replay;
      let activeOrderGuard = null;
      let completedRequesterUid = '';
      if (statusOf(update) === 'delivered') {
        const requesterUid = clean(current.requesterUid || current.requester_id, 128);
        if (requesterUid) {
          completedRequesterUid = requesterUid;
          const guardRef = db.collection('requesterActiveOrders').doc(requesterUid);
          const guard = await tx.get(guardRef);
          if (guard.exists && guard.data()?.orderId === orderId) activeOrderGuard = guardRef;
        }
      }
      await reconcileOrderLifecycleInTransaction({
        tx,
        db,
        before: { id: orderId, ...current },
        after: { id: orderId, ...current, ...update },
        event: update.distributorDeliveryHistory?.[update.distributorDeliveryHistory.length - 1]?.event || 'ORDER_UPDATED',
        now: update.updatedAt || new Date(),
      });
      if (moderationWrite) tx.set(moderationWrite.ref, moderationWrite.data, { merge: true });
      stageDeliveryAttemptWrites(tx, attemptWrites);
      tx.update(ref, update);
      if (completedRequesterUid) tx.set(db.collection('moderationActivity').doc(`user_${completedRequesterUid}`),
        { updatedAt: update.updatedAt || new Date() }, { merge: true });
      if (activeOrderGuard) tx.delete(activeOrderGuard);
      return { ...current, ...update };
    });
  }
  throw new OtpError(500, 'CHAT_RECONCILIATION_REQUIRED', 'Delivery lifecycle updates require transactional chat reconciliation.');
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Assigned deliveries are temporarily unavailable.',
  } });
}

function isDistributorProfileComplete(profile = {}) {
  const fullName = String(profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`).trim();
  const phone = String(profile.phone || profile.contactNumber || '').trim();
  const address = String(profile.completeAddress || profile.address || profile.barangay || '').trim();
  const branchId = String(profile.branchId || '').trim();
  const status = String(profile.distributorStatus || profile.approvalStatus || profile.status || '').trim().toLowerCase();
  return Boolean(fullName && phone && address && branchId && ['active', 'approved'].includes(status));
}

function createDistributorAssignedOrdersHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const distributor = await requireActiveDistributor(req, auth, db);
      if (req.method === 'GET') {
        const [ordersSnapshot, branchesSnapshot] = await Promise.all([
          db.collection('requests').where('assignedDistributorUid', '==', distributor.decoded.uid).get(),
          db.collection('branches').get(),
        ]);
        const branchNames = new Map(branchesSnapshot.docs.map((item) => [item.id, String(item.data()?.name || '').trim()]));
        const branchLocations = new Map(branchesSnapshot.docs.map((item) => {
          const data = item.data() || {};
          const latitude = Number(data.latitude);
          const longitude = Number(data.longitude);
          return [item.id, Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null];
        }));
        const orders = ordersSnapshot.docs
          .map((item) => {
            const order = safeOrder(item.id, item.data(), branchNames);
            return { ...order, branchLocation: order.branchLocation || branchLocations.get(owningBranchId(order)) || null };
          })
          .filter((order) => order.assignedDistributorUid === distributor.decoded.uid && owningBranchId(order) === distributor.branch.id)
          .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')));
        return res.status(200).json({ orders });
      }

      const body = bodyOf(req);
      const orderId = clean(body.orderId);
      const action = clean(body.action, 48).toLowerCase();
      if (!orderId || !['accept-assignment', 'decline-assignment', 'schedule-delivery', 'start-delivery', 'fail-delivery', 'reschedule-delivery', 'mark-delivered'].includes(action)) {
        throw new OtpError(400, 'INVALID_DELIVERY_ACTION', 'Choose a valid delivery action.');
      }
      if (!isDistributorProfileComplete(distributor.profile)) {
        throw new OtpError(409, 'PROFILE_INCOMPLETE', 'Complete your profile before handling deliveries.');
      }
      const now = new Date();
      const saved = await updateOrder(db, orderId, async (current, tx) => {
        if (clean(current.assignedDistributorUid || current.distributor_id) !== distributor.decoded.uid
          || owningBranchId(current) !== distributor.branch.id) {
          throw new OtpError(404, 'ORDER_NOT_FOUND', 'The assigned delivery was not found.');
        }
        const currentStatus = statusOf(current);
        if (action === 'fail-delivery' && currentStatus === 'delivery_failed' && body.clientMutationId) {
          const report = normalizeFailureReport(body, current, now, { replay: true });
          const mutationId = body.clientMutationId;
          if (typeof mutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(mutationId)) {
            throw new OtpError(400, 'DELIVERY_MUTATION_ID_INVALID', 'Use a valid delivery mutation ID.');
          }
          const number = current.deliveryAttemptSeq;
          const attemptId = Number.isSafeInteger(number) && number > 0 ? attemptIdFor(orderId, number) : null;
          const attemptSnapshot = attemptId ? await tx.get(db.collection('deliveryAttempts').doc(attemptId)) : null;
          const attempt = attemptSnapshot?.exists ? attemptSnapshot.data() || {} : null;
          const orderUpdatedAt = current.updatedAt?.toMillis?.() || current.updatedAt?.getTime?.() || new Date(current.updatedAt || 0).getTime();
          const attemptEndedAt = attempt?.endedAt?.toMillis?.() || attempt?.endedAt?.getTime?.() || new Date(attempt?.endedAt || 0).getTime();
          const failedAt = current.deliveryFailedAt?.toMillis?.() || current.deliveryFailedAt?.getTime?.() || new Date(current.deliveryFailedAt || 0).getTime();
          const chatGraceUntil = current.distributorChatGraceUntil?.toMillis?.() || current.distributorChatGraceUntil?.getTime?.() || new Date(current.distributorChatGraceUntil || 0).getTime();
          if (attempt && !current.activeDeliveryAttemptId && attempt.orderId === orderId
            && attempt.distributorUid === distributor.decoded.uid && attempt.branchId === distributor.branch.id
            && attempt.assignmentVersion === getAssignmentVersion(current) && attempt.attemptNumber === number
            && Number.isFinite(orderUpdatedAt) && orderUpdatedAt > 0 && orderUpdatedAt === attemptEndedAt
            && failedAt === attemptEndedAt && chatGraceUntil === attemptEndedAt + FAILED_DELIVERY_CHAT_GRACE_MS
            && current.failureReasonCode === report.code && (current.failureReasonNote || '') === report.note
            && matchesCommittedReport(attempt, report, mutationId)) {
            return { replay: {
              ...current,
              deliveryFailedAt: new Date(failedAt),
              distributorChatGraceUntil: new Date(chatGraceUntil),
              updatedAt: new Date(orderUpdatedAt),
            } };
          }
          throw new OtpError(409, 'DELIVERY_REPORT_REPLAY_CONFLICT', 'This report cannot be replayed because the delivery or submitted details changed.');
        }
        let update;
        let event;
        let failureReason = '';
        let failureReasonCode = '';
        let failureReasonLabel = '';
        let failureReasonNote = '';
        let reportFormat = null;
        let reportEvidence = null;
        let declineReason = '';
        let scheduledAt = null;

        if (action === 'accept-assignment') {
          if (currentStatus !== 'distributor_assigned') {
            throw new OtpError(409, 'ORDER_NOT_ACCEPTABLE', 'Only newly assigned deliveries can be accepted.');
          }
          event = 'ASSIGNMENT_ACCEPTED';
          const scheduledTime = current.scheduledAt?.toDate?.() || new Date(current.scheduledAt || current.scheduled_at || 0);
          const hasSchedule = Number.isFinite(scheduledTime.getTime()) && scheduledTime.getTime() > 0;
          update = { status: hasSchedule ? 'scheduled' : 'accepted', acceptedAt: current.acceptedAt || now };
        } else if (action === 'decline-assignment') {
          if (!['distributor_assigned', 'accepted', 'scheduled'].includes(currentStatus)) {
            throw new OtpError(409, 'ORDER_NOT_DECLINABLE', 'Orders currently out for delivery cannot be declined.');
          }
          declineReason = clean(body.declineReason || body.reason, 240);
          event = 'ASSIGNMENT_DECLINED';
          const assignmentEpoch = assignmentVersionForTransition(current, '');
          update = {
            status: 'awaiting_distributor_assignment',
            assignmentVersion: assignmentEpoch.assignmentVersion,
            assignedDistributorUid: null,
            assignedDistributorNameSnapshot: '',
            assignedDistributorUniqueIdSnapshot: '',
            assignedAt: null,
            distributor_id: '',
            distributor_name: '',
            distributorUniqueId: '',
            distributor_unique_id: '',
            scheduledAt: null,
            scheduled_at: null,
            expectedDeliveryDate: '',
            delivery_date: '',
            assignmentHistory: [...history(current.assignmentHistory), {
              event: 'ASSIGNMENT_DECLINED',
              distributorUid: distributor.decoded.uid,
              distributorNameSnapshot: clean(distributor.decoded.fullName || current.assignedDistributorNameSnapshot, 160),
              declinedAt: now,
              declineReason,
            }],
          };
        } else if (action === 'schedule-delivery') {
          throw new OtpError(409, 'MANAGER_SCHEDULE_REQUIRED', 'Initial scheduling belongs to your Manager. Accept the assignment, then start delivery when ready.');
        } else if (action === 'start-delivery') {
          if (!['accepted', 'scheduled'].includes(currentStatus)) {
            throw new OtpError(409, 'ORDER_NOT_STARTABLE', 'This delivery is not ready to start.');
          }
          const isMultiTripOrder = Boolean(current.tripId || current.tripNumber || ['planning', 'draft'].includes(current.tripStatus));
          const isUnapproved = current.managerApproved === false || (isMultiTripOrder && current.managerApproved !== true);
          if (isUnapproved) {
            throw new OtpError(409, 'TRIP_APPROVAL_REQUIRED', 'This trip requires Manager final approval before delivery can start.');
          }
          event = 'DELIVERY_STARTED';
          update = {
            status: 'out_for_delivery',
            deliveryStartedAt: now,
            ...(isMultiTripOrder ? { tripStatus: 'in_transit' } : {}),
          };
        } else if (action === 'fail-delivery') {
          if (currentStatus !== 'out_for_delivery') {
            throw new OtpError(409, 'ORDER_NOT_FAILABLE', 'Only deliveries that are out for delivery can be reported as failed.');
          }
          const report = normalizeFailureReport(body, current, now);
          failureReasonCode = report.code;
          failureReasonLabel = report.label;
          failureReasonNote = report.note;
          reportFormat = report.format;
          reportEvidence = report.evidence;
          failureReason = failureReasonNote ? `${failureReasonLabel}: ${failureReasonNote}` : failureReasonLabel;
          event = 'DELIVERY_FAILED';
          update = {
            status: 'delivery_failed',
            deliveryFailedAt: now,
            distributorChatGraceUntil: new Date(now.getTime() + FAILED_DELIVERY_CHAT_GRACE_MS),
            failureReason,
            failureReasonCode,
            failureReasonLabel,
            failureReasonNote,
          };
        } else if (action === 'reschedule-delivery') {
          if (currentStatus !== 'delivery_failed') {
            throw new OtpError(409, 'ORDER_NOT_RESCHEDULABLE', 'Only failed deliveries can be rescheduled by the distributor.');
          }
          scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
          if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - (5 * 60 * 1000)) {
            throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
          }
          event = 'DELIVERY_RESCHEDULED';
          update = {
            status: 'scheduled',
            scheduledAt,
            scheduled_at: scheduledAt,
            expectedDeliveryDate: scheduledAt.toISOString(),
            delivery_date: scheduledAt.toISOString(),
            rescheduledAt: now,
            distributorChatGraceUntil: null,
          };
        } else {
          if (currentStatus !== 'out_for_delivery') {
            throw new OtpError(409, 'ORDER_NOT_COMPLETABLE', 'Only an active delivery can be marked delivered.');
          }
          event = 'DELIVERY_COMPLETED';
          const chatAccessEndsAt = postOrderAccessEndsAt(now);
          update = { status: 'delivered', deliveredAt: now, chatAccessEndsAt, postOrderChatAccessEndsAt: chatAccessEndsAt };
        }
        const result = {
          ...update,
          distributorDeliveryHistory: [...history(current.distributorDeliveryHistory), {
            event,
            distributorUid: distributor.decoded.uid,
            branchId: distributor.branch.id,
            ...(failureReason ? { failureReason } : {}),
            ...(failureReasonCode ? { failureReasonCode, failureReasonLabel, failureReasonNote } : {}),
            ...(declineReason ? { declineReason } : {}),
            ...(scheduledAt ? { scheduledAt } : {}),
            createdAt: now,
          }],
          updatedAt: now,
          updated_at: now,
        };
        const attempt = await prepareDeliveryAttemptTransition({
          tx, db, orderId, order: current, action,
          distributorUid: distributor.decoded.uid, branchId: distributor.branch.id, now,
          failureReasonCode, failureReasonLabel, failureReasonNote, reportFormat, reportEvidence,
          clientMutationId: body.clientMutationId,
        });
        Object.assign(result, attempt.orderUpdate);
        let moderationWrite = null;
        if (event === 'DELIVERY_FAILED') {
          const moderation = await prepareOrderAbuseIncidentInTransaction({
            tx,
            db,
            orderId,
            order: current,
            incidentType: 'delivery_failure',
            category: failureReasonCode,
            stage: 'out_for_delivery',
            now,
            deliveryAttemptWrites: attempt.writes,
          });
          moderationWrite = moderation.write;
        }
        return { update: result, moderationWrite, attemptWrites: attempt.writes };
      });
      return res.status(200).json({ order: safeOrder(orderId, saved) });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { createDistributorAssignedOrdersHandler, isDistributorProfileComplete };
