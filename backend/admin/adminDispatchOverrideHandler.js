const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireAdmin } = require('../auth/authorization');
const { canonicalAccountStatus } = require('../auth/accountStatus');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { scheduleTimestampMillis } = require('../utils/scheduleTimestamp');
const { schedulingEvent } = require('../utils/schedulingEvent');
const { planDispatchTransition, stageDistributorGuard } = require('../utils/distributorCapacityGuard');
const { requireTripEmulator, validateTrip, validateResources, verifyManifest, tripInterval } = require('../utils/deliveryTripFoundation');
const { readDistributorGuard } = require('../utils/distributorCapacityGuard');
const { readOrderLoadEpoch, verifiedOrderCargo } = require('../utils/orderLoadSnapshot');
const { assignmentVersionForTransition, getAssignmentVersion } = require('../utils/relationshipEpochs');
const { reconcileOrderLifecycleInTransaction } = require('../chat/conversationLifecycleService');
const { effectiveDeliveryDays, isAllowedDeliveryDate } = require('../../services/productOrderPolicy');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const safeNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const fullName = (data = {}) => clean(data.fullName || `${data.firstName || ''} ${data.lastName || ''}`, 160);
const distributorStatus = (data = {}) => clean(data.distributorStatus || data.approvalStatus || data.status, 40).toLowerCase();

const isEligibleDistributor = (data = {}, branchId = '') =>
  data.role === 'distributor' &&
  clean(data.branchId, 128) === branchId &&
  ['active', 'approved'].includes(distributorStatus(data)) &&
  canonicalAccountStatus(data) === 'active' &&
  data.mustChangePassword !== true;
const OVERRIDE_ELIGIBLE_STATUSES = new Set(['awaiting_distributor_assignment', 'distributor_assigned', 'accepted', 'scheduled', 'delivery_failed']);
const requireOverrideEligible = (data) => {
  if (!OVERRIDE_ELIGIBLE_STATUSES.has(clean(data.status, 80).toLowerCase())) throw new OtpError(409, 'ORDER_NOT_OVERRIDE_ELIGIBLE', 'This order is not eligible for distributor override.');
};
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !value.includes('/');
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const timestampKey = (value) => value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds) ? `${value.seconds}:${value.nanoseconds}` : null;

// Advisory only; Manager approval rechecks every constraint transactionally.
async function adminSelectableTrips(db, auth, admin, orderId) {
  const orderRef = db.collection('requests').doc(orderId); const initial = await orderRef.get();
  if (!initial.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
  const branchId = clean(initial.data()?.currentBranchId || initial.data()?.branchId, 128);
  requireOverrideEligible(initial.data() || {});
  if (!validId(branchId)) throw new OtpError(409, 'BRANCH_NOT_SET', 'The order branch requires reconciliation.');
  const candidates = await db.collection('deliveryTrips').where('branchId', '==', branchId).get();
  const trips = [];
  for (const candidate of candidates.docs) {
    const data = candidate.data() || {};
    if (!['planning', 'approved'].includes(data.state) || !validId(data.distributorUid)) continue;
    if (typeof auth.getUser === 'function') { const account = await auth.getUser(data.distributorUid).catch(() => null); if (!account || account.disabled === true) continue; }
    const trip = await db.runTransaction(async (tx) => {
      const [order, actor, branch, snapshot, driver, resourceSnap, proof, epoch] = await Promise.all([
        tx.get(orderRef), tx.get(db.collection('users').doc(admin.uid)), tx.get(db.collection('branches').doc(branchId)), tx.get(candidate.ref),
        tx.get(db.collection('users').doc(data.distributorUid)), tx.get(db.collection('branchDeliveryResources').doc(branchId)),
        tx.get(db.collection('orderLoadSnapshots').doc(orderId)), readOrderLoadEpoch(tx, db),
      ]);
      const actorData = actor.data() || {}; const current = order.data() || {};
      if (!actor.exists || actorData.role !== 'admin' || canonicalAccountStatus(actorData) !== 'active' || actorData.mustChangePassword === true || actorData.accountActionHoldIntentId) throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access has changed.');
      if (!order.exists || clean(current.currentBranchId || current.branchId, 128) !== branchId || !branch.exists || branch.data()?.status !== 'active') throw new OtpError(409, 'ORDER_STATE_CHANGED', 'The order or branch changed.');
      requireOverrideEligible(current);
      if (!snapshot.exists) return null;
      const target = validateTrip(snapshot.data(), snapshot.id);
      if (target.branchId !== branchId || target.distributorUid !== data.distributorUid || !['planning', 'approved'].includes(target.state) || target.resourceId !== null) return null;
      if (!driver.exists || !isEligibleDistributor(driver.data(), branchId) || driver.data()?.accountActionHoldIntentId) return null;
      const interval = tripInterval(target.plannedDeparture, target.estimatedReturn);
      if (!interval || interval.end < Date.now() - 5 * 60 * 1000 || !target.scheduleConfirmedBy || !validId(target.plannedResourceId)) return null;
      const resources = validateResources(resourceSnap.exists ? resourceSnap.data() : null, branchId);
      if (!resources.resources.some((item) => item.id === target.plannedResourceId)) throw new OtpError(409, 'TRIP_RESOURCES_INVALID', 'Delivery resources require verification.');
      const guard = await readDistributorGuard(tx, db.collection('distributorDispatchGuards').doc(target.distributorUid));
      if (guard.reservations.some((entry) => entry.orderId === orderId || target.members.some((member) => member.orderId === entry.orderId))) throw new OtpError(409, 'TRIP_LEGACY_UNRESOLVED', 'Distributor reservations require reconciliation.');
      if (target.members.length) await verifyManifest(tx, db, target);
      const cargo = verifiedOrderCargo(orderId, current.items, proof.exists ? proof.data() : null, epoch);
      const amount = cargo.reduce((sum, item) => sum + (item.classification === 'standard_5_gallon' ? item.quantity : 0), 0);
      const projected = target.standardContainers + (target.members.some((member) => member.orderId === orderId) ? 0 : amount);
      if (!Number.isSafeInteger(projected) || projected > 60) return null;
      return { tripId: snapshot.id, distributorUid: target.distributorUid, status: target.state, plannedDeparture: new Date(interval.start).toISOString(), estimatedReturn: new Date(interval.end).toISOString(), standardContainers: target.standardContainers, projectedStandardContainers: projected, hasOtherCargo: target.hasOtherCargo || cargo.some((item) => item.classification === 'other') };
    });
    if (trip) trips.push(trip);
  }
  return trips;
}

async function proposeTripOverride({ auth, db, admin, body }) {
  const { orderId, distributorUid, tripId, clientMutationId } = body;
  if (![orderId, distributorUid, tripId].every(validId) || typeof clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clientMutationId)) throw new OtpError(400, 'INVALID_INPUT', 'Provide a valid order, Distributor, trip, and proposal ID.');
  const reason = clean(body.reason, 240); const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (!reason) throw new OtpError(400, 'OVERRIDE_REASON_REQUIRED', 'Explain why this emergency reassignment is needed.');
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
  if (typeof auth.getUser === 'function') { const account = await auth.getUser(distributorUid).catch(() => null); if (!account || account.disabled === true) throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'That distributor account is currently disabled.'); }
  const orderRef = db.collection('requests').doc(orderId); const proposalRef = orderRef.collection('adminTripOverrideProposals').doc(clientMutationId);
  return db.runTransaction(async (tx) => {
    const [orderSnap, existing, actorSnap, targetSnap, targetTripSnap, reservation] = await Promise.all([
      tx.get(orderRef), tx.get(proposalRef), tx.get(db.collection('users').doc(admin.uid)), tx.get(db.collection('users').doc(distributorUid)), tx.get(db.collection('deliveryTrips').doc(tripId)), tx.get(db.collection('deliveryTripOrderReservations').doc(orderId)),
    ]);
    const actor = actorSnap.data() || {};
    if (!actorSnap.exists || actor.role !== 'admin' || canonicalAccountStatus(actor) !== 'active' || actor.mustChangePassword === true || actor.accountActionHoldIntentId) throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access has changed.');
    if (!orderSnap.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
    const order = orderSnap.data() || {}; const branchId = clean(order.currentBranchId || order.branchId, 128); const target = targetSnap.data() || {}; const targetTrip = targetTripSnap.data() || {};
    const fingerprint = JSON.stringify([orderId, distributorUid, tripId, scheduledAt.toISOString(), reason]);
    if (existing.exists) {
      const prior = existing.data() || {};
      if (prior.fingerprint !== fingerprint || prior.adminUid !== admin.uid || prior.orderId !== orderId) throw new OtpError(409, 'ADMIN_OVERRIDE_PROPOSAL_CONFLICT', 'This proposal ID was already used for different details.');
      return prior;
    }
    requireOverrideEligible(order);
    if (!validId(branchId)) throw new OtpError(409, 'BRANCH_NOT_SET', 'The order branch requires reconciliation.');
    if (clean(target.branchId, 128) !== branchId) throw new OtpError(403, 'CROSS_BRANCH_ASSIGNMENT_FORBIDDEN', 'Admin override cannot assign a Distributor from a different branch.');
    if (!targetSnap.exists || !isEligibleDistributor(target, branchId) || target.accountActionHoldIntentId) throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'The selected Distributor is not eligible.');
    if (!targetTripSnap.exists || targetTrip.schemaVersion !== 1 || targetTrip.tripId !== tripId || targetTrip.branchId !== branchId || targetTrip.distributorUid !== distributorUid || !revision(targetTrip.revision) || !revision(targetTrip.manifestRevision)) throw new OtpError(409, 'TRIP_INVALID', 'The target trip requires reconciliation.');
    const sourceUid = clean(order.assignedDistributorUid || order.distributor_id, 128);
    if (order.assignedDistributorUid && order.distributor_id && order.assignedDistributorUid !== order.distributor_id) throw new OtpError(409, 'TRIP_INVALID', 'The assignment requires reconciliation.');
    let source = null;
    if (sourceUid) {
      const membership = reservation.data() || {};
      if (!reservation.exists || membership.orderId !== orderId || membership.branchId !== branchId || !validId(membership.tripId)) throw new OtpError(409, 'TRIP_LEGACY_UNRESOLVED', 'The current assignment requires reconciliation.');
      const sourceSnap = await tx.get(db.collection('deliveryTrips').doc(membership.tripId)); const sourceTrip = sourceSnap.data() || {};
      if (!sourceSnap.exists || sourceTrip.tripId !== membership.tripId || sourceTrip.branchId !== branchId || sourceTrip.distributorUid !== sourceUid || !revision(sourceTrip.revision) || !revision(sourceTrip.manifestRevision) || !Array.isArray(sourceTrip.members) || !sourceTrip.members.some((item) => item?.orderId === orderId)) throw new OtpError(409, 'TRIP_INVALID', 'The source trip requires reconciliation.');
      source = { tripId: membership.tripId, distributorUid: sourceUid, tripRevision: sourceTrip.revision, manifestRevision: sourceTrip.manifestRevision, state: sourceTrip.state };
    } else if (reservation.exists) throw new OtpError(409, 'TRIP_INVALID', 'The order reservation requires reconciliation.');
    const orderVersion = timestampKey(orderSnap.updateTime);
    if (!orderVersion) throw new OtpError(409, 'ORDER_STATE_CHANGED', 'The order version requires reconciliation.');
    const proposal = { schemaVersion: 1, id: clientMutationId, orderId, branchId, adminUid: admin.uid, action: sourceUid ? 'reassign' : 'assign', distributorUid, tripId, scheduledAt: scheduledAt.toISOString(), reason, fingerprint, orderVersion, assignmentVersion: getAssignmentVersion(order), orderStatus: clean(order.status, 80).toLowerCase(), source, target: { tripRevision: targetTrip.revision, manifestRevision: targetTrip.manifestRevision, plannedResourceId: targetTrip.plannedResourceId || null, plannedDeparture: scheduleTimestampMillis(targetTrip.plannedDeparture), estimatedReturn: scheduleTimestampMillis(targetTrip.estimatedReturn) }, status: 'pending', createdAt: new Date() };
    tx.create(proposalRef, proposal);
    return proposal;
  });
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body || '{}'));
  } catch {
    throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.');
  }
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({
    error: {
      reason: known ? error.reason : 'service-unavailable',
      message: known ? error.message : 'Admin override is temporarily unavailable.',
    },
  });
}

function createAdminDispatchOverrideHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
      return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    }

    try {
      const { auth, db } = getAdmin();
      const admin = await requireAdmin(req, auth, db);

      if (req.method === 'GET') {
        const query = req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
        const orderId = clean(query.orderId, 128);
        if (!orderId) {
          throw new OtpError(400, 'ORDER_ID_REQUIRED', 'Provide an orderId to check override details.');
        }
        if (query.tripOptions === '1') {
          requireTripEmulator(db);
          if (!validId(orderId)) throw new OtpError(400, 'INVALID_INPUT', 'Choose a valid order.');
          return res.status(200).json({ trips: await adminSelectableTrips(db, auth, admin, orderId) });
        }

        const orderSnap = await db.collection('requests').doc(orderId).get();
        if (!orderSnap.exists) {
          throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
        }

        const orderData = orderSnap.data() || {};
        requireOverrideEligible(orderData);
        const branchId = clean(orderData.currentBranchId || orderData.branchId, 128);
        if (!branchId) {
          throw new OtpError(400, 'BRANCH_NOT_SET', 'This order is not associated with an active branch.');
        }

        const branchSnap = await db.collection('branches').doc(branchId).get();
        const branchName = branchSnap.exists ? clean(branchSnap.data()?.name, 160) : 'Branch';

        const distributorsSnap = await db.collection('users').where('role', '==', 'distributor').get();
        const distributorCandidates = distributorsSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((d) => isEligibleDistributor(d, branchId));
        const eligibleDistributors = (await Promise.all(distributorCandidates.map(async (d) => {
          if (typeof auth.getUser === 'function') {
            const account = await auth.getUser(d.id).catch(() => null);
            if (!account || account.disabled === true) return null;
          }
          return {
            uid: d.id,
            name: fullName(d),
            publicUid: clean(d.publicUid, 40),
            phone: clean(d.phone || d.contactNumber, 40),
            branchId: clean(d.branchId, 128),
          };
        })))
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name));

        return res.status(200).json({
          orderId,
          branchId,
          branchName,
          currentDistributorUid: clean(orderData.assignedDistributorUid || orderData.distributor_id, 128),
          currentDistributorName: clean(orderData.assignedDistributorNameSnapshot || orderData.distributor_name, 160),
          status: clean(orderData.status, 80),
          effectiveDeliveryDaysSnapshot: Array.isArray(orderData.effectiveDeliveryDaysSnapshot) ? orderData.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(orderData.items || []),
          scheduledAt: orderData.scheduledAt || null,
          eligibleDistributors,
        });
      }

      // POST or PATCH: Execute Admin Override Assignment/Reassignment
      if (process.env.BLUETAP_TRIP_EMULATOR_MODE === '1') {
        requireTripEmulator(db);
        const body = bodyOf(req);
        if (body.action !== 'propose-trip-override') throw new OtpError(503, 'TRIP_MODE_INTEGRATION_INCOMPLETE', 'Use a proposal for trip-aware dispatch override.');
        const proposal = await proposeTripOverride({ auth, db, admin, body });
        return res.status(200).json({ proposal });
      }
      const body = bodyOf(req);
      const orderId = clean(body.orderId, 128);
      const distributorUid = clean(body.distributorUid, 128);
      const scheduledAtRaw = body.scheduledAt;
      const reason = clean(body.reason, 240);

      if (!orderId || !distributorUid) {
        throw new OtpError(400, 'INVALID_INPUT', 'Provide both orderId and distributorUid.');
      }
      if (!reason) throw new OtpError(400, 'OVERRIDE_REASON_REQUIRED', 'Explain why this emergency reassignment is needed.');

      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      const now = new Date();
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - 5 * 60 * 1000) {
        throw new OtpError(400, 'INVALID_DELIVERY_SCHEDULE', 'Choose a current or future delivery time.');
      }

      if (typeof auth.getUser === 'function') {
        const account = await auth.getUser(distributorUid).catch(() => null);
        if (!account || account.disabled === true) {
          throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'That distributor account is currently disabled.');
        }
      }

      const orderRef = db.collection('requests').doc(orderId);
      const targetRef = db.collection('users').doc(distributorUid);
      const auditRef = db.collection('adminAuditLogs').doc();
      let savedOrder;
      await db.runTransaction(async (tx) => {
        const [orderSnap, targetSnap, actorSnap] = await Promise.all([tx.get(orderRef), tx.get(targetRef), tx.get(db.collection('users').doc(admin.uid))]);
        if (!orderSnap.exists) throw new OtpError(404, 'ORDER_NOT_FOUND', 'The order was not found.');
        if (!targetSnap.exists) throw new OtpError(404, 'DISTRIBUTOR_NOT_FOUND', 'The selected distributor account does not exist.');
        const actorData = actorSnap.data() || {};
        if (!actorSnap.exists || actorData.role !== 'admin' || canonicalAccountStatus(actorData) !== 'active' || actorData.mustChangePassword === true || actorData.accountActionHoldIntentId) throw new OtpError(403, 'ADMIN_REQUIRED', 'Administrator access has changed.');

        const orderData = orderSnap.data() || {};
        const targetData = targetSnap.data() || {};
        requireOverrideEligible(orderData);
        const allowedDays = Array.isArray(orderData.effectiveDeliveryDaysSnapshot) ? orderData.effectiveDeliveryDaysSnapshot : effectiveDeliveryDays(orderData.items || []);
        if (!isAllowedDeliveryDate(scheduledAt, allowedDays)) throw new OtpError(409, 'PRODUCT_DELIVERY_DAY_UNAVAILABLE', allowedDays.length ? 'Choose a delivery day allowed for every product in this order.' : 'These products have no common delivery day. Ask Admin to update the product schedules.');
        const branchId = clean(orderData.currentBranchId || orderData.branchId, 128);
        if (!branchId) throw new OtpError(400, 'BRANCH_NOT_SET', 'This order has no owning branch.');

        // STRICT SAME-BRANCH SECURITY CHECK: Admin CANNOT cross-assign branches.
        if (clean(targetData.branchId, 128) !== branchId) {
          throw new OtpError(403, 'CROSS_BRANCH_ASSIGNMENT_FORBIDDEN', 'Admin override cannot assign a distributor from a different branch. The distributor must belong to the order\'s branch.');
        }
        if (!isEligibleDistributor(targetData, branchId)) {
          throw new OtpError(409, 'DISTRIBUTOR_NOT_ELIGIBLE', 'The selected distributor is not active or approved for this branch.');
        }

        const previousDistributorUid = clean(orderData.assignedDistributorUid || orderData.distributor_id, 128);
        const previousDistributorName = clean(orderData.assignedDistributorNameSnapshot || orderData.distributor_name, 160);
        const targetName = fullName(targetData);
        const targetPublicUid = clean(targetData.publicUid || targetData.displayUid || targetData.unique_id, 80);
        const assignmentEpoch = assignmentVersionForTransition(orderData, distributorUid);
        const event = 'ADMIN_DISPATCH_OVERRIDE';
        const updatePayload = {
          status: 'distributor_assigned',
          assignmentVersion: assignmentEpoch.assignmentVersion,
          assignedDistributorUid: distributorUid,
          distributorChatGraceUntil: null,
          assignedDistributorNameSnapshot: targetName,
          assignedDistributorUniqueIdSnapshot: targetPublicUid,
          distributorUniqueId: targetPublicUid,
          distributor_unique_id: targetPublicUid,
          distributor_id: distributorUid,
          distributor_name: targetName,
          scheduledAt,
          scheduled_at: scheduledAt,
          expectedDeliveryDate: scheduledAt.toISOString(),
          delivery_date: scheduledAt.toISOString(),
          assignedByAdminUid: admin.uid,
          latestSchedulingEvent: schedulingEvent(orderData, event, now),
          adminOverride: true,
          assignmentHistory: [...(Array.isArray(orderData.assignmentHistory) ? orderData.assignmentHistory : []), {
            event,
            previousDistributorUid: previousDistributorUid || null,
            previousDistributorNameSnapshot: previousDistributorName || null,
            distributorUid,
            distributorNameSnapshot: targetName,
            distributorUniqueIdSnapshot: targetPublicUid,
            assignedByAdminUid: admin.uid,
            assignedAt: now,
            scheduledAt,
            adminOverride: true,
            reason,
          }],
          dispatchEventHistory: [...(Array.isArray(orderData.dispatchEventHistory) ? orderData.dispatchEventHistory : []), {
            event, actorUid: admin.uid, role: 'admin', branchId, createdAt: now,
          }],
          updatedAt: now,
          updated_at: now,
        };

        const guardPlans = await planDispatchTransition(tx, db, { orderId, before: orderData, after: { ...orderData, ...updatePayload }, forceCheck: true });
        await reconcileOrderLifecycleInTransaction({
          tx,
          db,
          before: { id: orderId, ...orderData },
          after: { id: orderId, ...orderData, ...updatePayload },
          event,
          now,
        });
        guardPlans.forEach((plan) => stageDistributorGuard(tx, plan));
        tx.update(orderRef, updatePayload);
        tx.set(auditRef, {
          action: 'ADMIN_DISTRIBUTOR_OVERRIDE',
          adminUid: admin.uid,
          orderId,
          branchId,
          previousDistributorUid: previousDistributorUid || null,
          newDistributorUid: distributorUid,
          newDistributorName: targetName,
          assignmentVersion: assignmentEpoch.assignmentVersion,
          scheduledAt: scheduledAt.toISOString(),
          reason,
          createdAt: now,
          timestamp: now,
        });
        savedOrder = { ...orderData, ...updatePayload };
      });

      return res.status(200).json({
        success: true,
        message: 'Distributor reassigned successfully via Admin Override.',
        order: { id: orderId, ...savedOrder },
      });
    } catch (error) {
      return responseError(res, error);
    }
  };
}

module.exports = {
  createAdminDispatchOverrideHandler,
  isEligibleDistributor,
};
