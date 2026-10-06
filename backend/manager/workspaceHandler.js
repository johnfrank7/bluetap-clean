const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { safeProduct } = require('../admin/productManagementHandler');
const { productDeliveryDays, productLimit } = require('../../services/productOrderPolicy');
const { resolveEffectiveProductPolicy } = require('../utils/effectiveProductPolicy');
const { approveDistributorInTransaction } = require('../utils/distributorApproval');
const { BRANCH_SUSPENSION_REASONS, getBranchSuspensionLabel } = require('../../constants/branchSuspensionReasons');

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(String(req.body || '{}'));
  } catch {
    throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.');
  }
}

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const distributorState = (profile = {}) => clean(profile.distributorStatus || profile.approvalStatus || profile.status, 40).toLowerCase();
const fullName = (profile = {}) => clean(profile.fullName || profile.full_name || `${profile.firstName || ''} ${profile.lastName || ''}`, 160);
const branchDistributor = (profile = {}, branchId) => profile.role === 'distributor'
  && clean(profile.branchId, 128) === branchId
  && ['active', 'approved', 'suspended'].includes(distributorState(profile))
  && !['inactive', 'disabled'].includes(clean(profile.accountStatus, 40).toLowerCase())
  && profile.mustChangePassword !== true;
const activeDistributor = branchDistributor;
const visibleProduct = (product = {}, branchId) => product.active !== false
  && (!Array.isArray(product.branchIds) || product.branchIds.length === 0 || product.branchIds.includes(branchId));
const safeAccount = (id, profile = {}, branchId = '') => {
  const isBranchSuspended = Boolean(
    (branchId && profile.branchSuspensions?.[branchId]?.suspended) ||
    (profile.role === 'distributor' && (distributorState(profile) === 'suspended' || profile.branchSuspended === true))
  );
  return {
    id,
    uid: id,
    role: clean(profile.role, 32),
    fullName: fullName(profile),
    email: clean(profile.email, 240).toLowerCase(),
    phone: clean(profile.phone || profile.contactNumber || profile.contact_number, 40),
    address: clean(profile.address || profile.completeAddress, 300),
    barangay: clean(profile.barangay, 120),
    publicUid: clean(profile.publicUid || profile.displayUid || profile.uniqueId || profile.unique_id, 80),
    displayUid: clean(profile.displayUid || profile.publicUid || profile.uniqueId || profile.unique_id, 80),
    uniqueId: clean(profile.publicUid || profile.displayUid || profile.uniqueId || profile.unique_id, 80),
    createdAt: profile.createdAt || profile.created_at || null,
    distributorStatus: distributorState(profile),
    branchSuspended: isBranchSuspended,
    branchSuspensionReasonCode: (branchId && profile.branchSuspensions?.[branchId]?.reasonCode) || profile.branchSuspensionReasonCode || '',
    branchSuspensionReason: (branchId && profile.branchSuspensions?.[branchId]?.reason) || profile.branchSuspensionReason || '',
  };
};
const safeOrder = (id, order = {}) => ({
  id,
  requestId: clean(order.requestId || order.request_id, 80),
  requesterUid: clean(order.requesterUid || order.requester_id, 128),
  requesterName: clean(order.requesterNameSnapshot || order.requester_name, 160),
  requesterUniqueId: clean(order.requesterUniqueIdSnapshot || order.requester_unique_id, 80),
  requesterAddress: clean(order.addressSnapshot || order.address, 300),
  requesterContact: clean(order.contactNumberSnapshot || order.contact_number, 40),
  status: clean(order.status, 80),
  quantity: number(order.quantity),
  totalAtOrder: number(order.totalAtOrder ?? order.total_cost),
  items: Array.isArray(order.items) ? order.items.map((item) => ({
    productId: clean(item.productId || item.product_id, 128),
    productNameSnapshot: clean(item.productNameSnapshot || item.product_name, 160),
    quantity: number(item.quantity),
    totalAtOrder: number(item.totalAtOrder ?? item.line_total),
  })) : [],
  createdAt: order.createdAt || order.created_at || null,
  updatedAt: order.updatedAt || order.updated_at || null,
  deliveredAt: order.deliveredAt || order.delivered_at || null,
});

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Manager workspace data is temporarily unavailable.',
  } });
}

function createManagerWorkspaceHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET or POST.' } });
    try {
      const { auth, db } = getAdmin();
      const manager = await requireActiveManager(req, auth, db);
      const branchId = manager.branch.id;
      if (req.method === 'POST') {
        const body = bodyOf(req);
        if (body.action === 'approveDistributor') {
          const distributorUid = clean(body.distributorUid, 128);
          if (!distributorUid) throw new OtpError(400, 'DISTRIBUTOR_REQUIRED', 'Choose a Distributor application to approve.');
          const targetRef = db.collection('users').doc(distributorUid);
          let approval;
          await db.runTransaction(async (tx) => {
            approval = await approveDistributorInTransaction({
              actorRole: 'manager',
              actorUid: manager.decoded.uid,
              branchId,
              db,
              enforceRequestedBranch: true,
              idempotent: true,
              targetRef,
              tx,
            });
          });
          return res.status(200).json({
            distributor: safeAccount(distributorUid, { ...approval.data, ...approval.changes }, branchId),
            idempotent: approval.idempotent,
          });
        }
        if (body.action === 'updateProductPolicy') {
          const productId = clean(body.productId, 128);
          const productSnapshot = productId ? await db.collection('products').doc(productId).get() : null;
          if (!productSnapshot?.exists || !visibleProduct(productSnapshot.data(), branchId)) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'This product is not available to your branch.');
          if (!Array.isArray(body.deliveryDays) || productDeliveryDays(body.deliveryDays).length !== body.deliveryDays.length) throw new OtpError(400, 'INVALID_PRODUCT_DELIVERY_DAYS', 'Choose valid delivery weekdays.');
          const limit = body.maxQuantityPerRequester === null || body.maxQuantityPerRequester === '' ? null : productLimit(body.maxQuantityPerRequester);
          if (body.maxQuantityPerRequester !== null && body.maxQuantityPerRequester !== '' && limit === null) throw new OtpError(400, 'INVALID_PRODUCT_ORDER_LIMIT', 'Requester order limit must be an integer from 1 to 100.');
          const branchRef = db.collection('branches').doc(branchId);
          const now = new Date();
          await db.runTransaction(async (tx) => {
            const currentSnapshot = await tx.get(branchRef);
            if (!currentSnapshot.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Your assigned branch no longer exists.');
            const current = currentSnapshot.data() || {};
            const overrides = current.productPolicyOverrides && typeof current.productPolicyOverrides === 'object' ? { ...current.productPolicyOverrides } : {};
            const before = overrides[productId] || null;
            overrides[productId] = { deliveryDays: productDeliveryDays(body.deliveryDays), maxQuantityPerRequester: limit, updatedAt: now, updatedBy: manager.decoded.uid };
            tx.update(branchRef, { productPolicyOverrides: overrides, updatedAt: now, updatedBy: manager.decoded.uid });
            tx.set(db.collection('adminAuditLogs').doc(), { action: 'MANAGER_BRANCH_PRODUCT_POLICY_UPDATED', actorUid: manager.decoded.uid, branchId, productId, before, after: overrides[productId], createdAt: now });
          });
          return res.status(200).json({ productId, policy: { deliveryDays: productDeliveryDays(body.deliveryDays), maxQuantityPerRequester: limit, source: 'branch_override' } });
        }
        if (body.action === 'updateDeliveryPricing') {
          const baseDeliveryFee = number(body.baseDeliveryFee);
          const includedRadiusKm = number(body.includedRadiusKm);
          const outsideRadiusFeePerKm = number(body.outsideRadiusFeePerKm);
          const serviceRadiusKm = number(body.serviceRadiusKm);
          if (baseDeliveryFee < 0 || baseDeliveryFee > 10000 ||
              includedRadiusKm < 0 || includedRadiusKm > 500 ||
              outsideRadiusFeePerKm < 0 || outsideRadiusFeePerKm > 10000 ||
              serviceRadiusKm < 0 || serviceRadiusKm > 500) {
            throw new OtpError(400, 'INVALID_DELIVERY_PRICING', 'Delivery pricing values are invalid.');
          }
          const branchRef = db.collection('branches').doc(branchId);
          const now = new Date();
          const pricing = { baseDeliveryFee, includedRadiusKm, outsideRadiusFeePerKm, serviceRadiusKm };
          await db.runTransaction(async (tx) => {
            const currentSnapshot = await tx.get(branchRef);
            if (!currentSnapshot.exists) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'Your assigned branch no longer exists.');
            const current = currentSnapshot.data() || {};
            const before = {
              baseDeliveryFee: number(current.baseDeliveryFee),
              includedRadiusKm: number(current.includedRadiusKm ?? current.serviceRadiusKm),
              outsideRadiusFeePerKm: number(current.outsideRadiusFeePerKm),
              serviceRadiusKm: number(current.serviceRadiusKm),
            };
            tx.update(branchRef, { ...pricing, updatedAt: now, updatedBy: manager.decoded.uid });
            tx.set(db.collection('adminAuditLogs').doc(), {
              action: 'MANAGER_BRANCH_DELIVERY_PRICING_UPDATED',
              actorUid: manager.decoded.uid,
              actorPublicUid: clean(manager.profile?.publicUid || manager.profile?.displayUid || manager.profile?.uniqueId, 80),
              actorRole: 'manager',
              branchId,
              before,
              after: pricing,
              createdAt: now,
            });
          });
          return res.status(200).json({ branchId, pricing });
        }
        if (body.action === 'suspendBranchUser') {
          const targetUid = clean(body.targetUid, 128);
          const reasonCode = clean(body.reasonCode, 64);
          const customReason = clean(body.reason, 500);
          if (!targetUid) throw new OtpError(400, 'TARGET_REQUIRED', 'Choose an account to suspend from your branch.');
          if (!reasonCode && !customReason) {
            throw new OtpError(400, 'REASON_REQUIRED', 'Provide a reason for the branch suspension.');
          }
          if (reasonCode && !getBranchSuspensionLabel(reasonCode)) {
            throw new OtpError(400, 'INVALID_SUSPENSION_REASON', 'Choose a valid suspension reason from the list.');
          }
          const reasonLabel = getBranchSuspensionLabel(reasonCode) || customReason;
          const reasonText = customReason || reasonLabel;
          if (targetUid === manager.decoded.uid) throw new OtpError(400, 'SELF_ACTION_FORBIDDEN', 'You cannot suspend your own account.');

          const targetRef = db.collection('users').doc(targetUid);
          const now = new Date();
          const branchName = clean(manager.branch?.name || manager.branch?.branchName, 128) || 'Branch';
          let resultUser;
          await db.runTransaction(async (tx) => {
            const targetSnap = await tx.get(targetRef);
            if (!targetSnap.exists) throw new OtpError(404, 'USER_NOT_FOUND', 'Account not found.');
            const target = targetSnap.data() || {};
            if (['admin', 'manager'].includes(target.role)) {
              throw new OtpError(403, 'PRIVILEGED_TARGET_FORBIDDEN', 'Managers cannot suspend Admin or Manager accounts.');
            }
            const targetPublicUid = clean(target.publicUid || target.displayUid || target.uniqueId, 80);

            if (target.role === 'distributor') {
              if (clean(target.branchId, 128) !== branchId) {
                throw new OtpError(403, 'CROSS_BRANCH_FORBIDDEN', 'You can only suspend Distributors assigned to your branch.');
              }
              const beforeState = distributorState(target);
              tx.update(targetRef, {
                distributorStatus: 'suspended',
                branchSuspended: true,
                branchSuspensionReasonCode: reasonCode || null,
                branchSuspensionReason: reasonLabel,
                branchSuspensionUpdatedAt: now,
                branchSuspensionUpdatedBy: manager.decoded.uid,
                updatedAt: now,
              });
              tx.set(db.collection('adminAuditLogs').doc(), {
                action: 'MANAGER_DISTRIBUTOR_SUSPENDED',
                actorUid: manager.decoded.uid,
                actorPublicUid: clean(manager.profile?.publicUid || manager.profile?.displayUid, 80),
                actorRole: 'manager',
                branchId,
                targetUid,
                targetPublicUid,
                targetRole: 'distributor',
                reasonCode: reasonCode || null,
                reasonLabel,
                reason: reasonText,
                before: { distributorStatus: beforeState, branchSuspended: target.branchSuspended === true },
                after: { distributorStatus: 'suspended', branchSuspended: true, reasonCode: reasonCode || null, reason: reasonLabel },
                createdAt: now,
              });
              resultUser = safeAccount(targetUid, {
                ...target,
                distributorStatus: 'suspended',
                branchSuspended: true,
                branchSuspensionReasonCode: reasonCode || null,
                branchSuspensionReason: reasonLabel,
              }, branchId);
            } else if (target.role === 'requester') {
              const branchSuspensions = target.branchSuspensions && typeof target.branchSuspensions === 'object' ? { ...target.branchSuspensions } : {};
              const beforeSuspension = branchSuspensions[branchId] || null;
              branchSuspensions[branchId] = {
                suspended: true,
                reasonCode: reasonCode || null,
                reason: reasonLabel,
                updatedAt: now,
                updatedBy: manager.decoded.uid,
              };
              tx.update(targetRef, { branchSuspensions, updatedAt: now });

              const orderingRestrRef = db.collection('orderingRestrictions').doc(targetUid);
              const orderingRestrSnap = await tx.get(orderingRestrRef);
              const orderingBranches = orderingRestrSnap.exists ? (orderingRestrSnap.data()?.branches || {}) : {};
              orderingBranches[branchId] = {
                restricted: true,
                scope: 'branch_ordering',
                branchId,
                branchNameSnapshot: branchName,
                reasonCode: reasonCode || null,
                reasonCategory: 'BRANCH_SUSPENSION',
                reason: reasonLabel,
                startsAt: now,
                endsAt: null,
                updatedAt: now,
              };
              tx.set(orderingRestrRef, { branches: orderingBranches, updatedAt: now }, { merge: true });

              const chatRestrRef = db.collection('chatRestrictions').doc(targetUid);
              const chatRestrSnap = await tx.get(chatRestrRef);
              const chatBranches = chatRestrSnap.exists ? (chatRestrSnap.data()?.branches || {}) : {};
              chatBranches[branchId] = {
                restricted: true,
                scope: 'branch_chat',
                branchId,
                branchNameSnapshot: branchName,
                reasonCode: reasonCode || null,
                reasonCategory: 'BRANCH_SUSPENSION',
                reason: reasonLabel,
                startsAt: now,
                endsAt: null,
                updatedAt: now,
              };
              tx.set(chatRestrRef, { branches: chatBranches, updatedAt: now }, { merge: true });

              tx.set(db.collection('adminAuditLogs').doc(), {
                action: 'MANAGER_REQUESTER_BRANCH_SUSPENDED',
                actorUid: manager.decoded.uid,
                actorPublicUid: clean(manager.profile?.publicUid || manager.profile?.displayUid, 80),
                actorRole: 'manager',
                branchId,
                targetUid,
                targetPublicUid,
                targetRole: 'requester',
                reasonCode: reasonCode || null,
                reasonLabel,
                reason: reasonText,
                before: beforeSuspension,
                after: branchSuspensions[branchId],
                createdAt: now,
              });
              resultUser = safeAccount(targetUid, { ...target, branchSuspensions }, branchId);
            } else {
              throw new OtpError(400, 'UNSUPPORTED_ROLE', 'Cannot suspend accounts of this role.');
            }

            const userNoticeDoc = db.collection('moderationNotices').doc(targetUid);
            if (typeof userNoticeDoc.collection === 'function') {
              const noticeRef = userNoticeDoc.collection('items').doc();
              const noticeId = noticeRef.id;
              const notice = {
                schemaVersion: 1,
                actionId: noticeId,
                type: 'suspend_branch_access',
                title: `Branch access suspended: ${branchName}`,
                category: 'BRANCH_SUSPENSION',
                scope: 'branch',
                branchId,
                branchName,
                reasonCode: reasonCode || null,
                reasonLabel,
                reason: reasonText,
                startsAt: now,
                endsAt: null,
                createdAt: now,
                acknowledgedAt: null,
                seenAt: null,
              };
              tx.set(noticeRef, notice);
            }
            tx.set(db.collection('moderationActivity').doc(`user_${targetUid}`), {
              uid: targetUid,
              updatedAt: now,
              revision: `${Date.now()}`,
            });
          });
          return res.status(200).json({ ok: true, user: resultUser });
        }
        if (body.action === 'restoreBranchUser') {
          const targetUid = clean(body.targetUid, 128);
          const reason = clean(body.reason || 'Restored by manager', 500);
          if (!targetUid) throw new OtpError(400, 'TARGET_REQUIRED', 'Choose an account to restore in your branch.');
          if (targetUid === manager.decoded.uid) throw new OtpError(400, 'SELF_ACTION_FORBIDDEN', 'You cannot act on your own account.');

          const targetRef = db.collection('users').doc(targetUid);
          const now = new Date();
          const branchName = clean(manager.branch?.name || manager.branch?.branchName, 128) || 'Branch';
          let resultUser;
          await db.runTransaction(async (tx) => {
            const targetSnap = await tx.get(targetRef);
            if (!targetSnap.exists) throw new OtpError(404, 'USER_NOT_FOUND', 'Account not found.');
            const target = targetSnap.data() || {};
            if (['admin', 'manager'].includes(target.role)) {
              throw new OtpError(403, 'PRIVILEGED_TARGET_FORBIDDEN', 'Managers cannot modify Admin or Manager accounts.');
            }
            const targetPublicUid = clean(target.publicUid || target.displayUid || target.uniqueId, 80);

            if (target.role === 'distributor') {
              if (clean(target.branchId, 128) !== branchId) {
                throw new OtpError(403, 'CROSS_BRANCH_FORBIDDEN', 'You can only restore Distributors assigned to your branch.');
              }
              const beforeState = distributorState(target);
              tx.update(targetRef, {
                distributorStatus: 'active',
                branchSuspended: false,
                branchSuspensionReasonCode: null,
                branchSuspensionReason: '',
                branchSuspensionUpdatedAt: now,
                branchSuspensionUpdatedBy: manager.decoded.uid,
                updatedAt: now,
              });
              tx.set(db.collection('adminAuditLogs').doc(), {
                action: 'MANAGER_DISTRIBUTOR_RESTORED',
                actorUid: manager.decoded.uid,
                actorPublicUid: clean(manager.profile?.publicUid || manager.profile?.displayUid, 80),
                actorRole: 'manager',
                branchId,
                targetUid,
                targetPublicUid,
                targetRole: 'distributor',
                reason,
                before: { distributorStatus: beforeState, branchSuspended: target.branchSuspended === true },
                after: { distributorStatus: 'active', branchSuspended: false },
                createdAt: now,
              });
              resultUser = safeAccount(targetUid, {
                ...target,
                distributorStatus: 'active',
                branchSuspended: false,
                branchSuspensionReasonCode: null,
                branchSuspensionReason: '',
              }, branchId);
            } else if (target.role === 'requester') {
              const branchSuspensions = target.branchSuspensions && typeof target.branchSuspensions === 'object' ? { ...target.branchSuspensions } : {};
              const beforeSuspension = branchSuspensions[branchId] || null;
              delete branchSuspensions[branchId];
              tx.update(targetRef, { branchSuspensions, updatedAt: now });

              const orderingRestrRef = db.collection('orderingRestrictions').doc(targetUid);
              const orderingRestrSnap = await tx.get(orderingRestrRef);
              if (orderingRestrSnap.exists) {
                const orderingBranches = orderingRestrSnap.data()?.branches || {};
                delete orderingBranches[branchId];
                tx.update(orderingRestrRef, { branches: orderingBranches, updatedAt: now });
              }

              const chatRestrRef = db.collection('chatRestrictions').doc(targetUid);
              const chatRestrSnap = await tx.get(chatRestrRef);
              if (chatRestrSnap.exists) {
                const chatBranches = chatRestrSnap.data()?.branches || {};
                delete chatBranches[branchId];
                tx.update(chatRestrRef, { branches: chatBranches, updatedAt: now });
              }

              tx.set(db.collection('adminAuditLogs').doc(), {
                action: 'MANAGER_REQUESTER_BRANCH_RESTORED',
                actorUid: manager.decoded.uid,
                actorPublicUid: clean(manager.profile?.publicUid || manager.profile?.displayUid, 80),
                actorRole: 'manager',
                branchId,
                targetUid,
                targetPublicUid,
                targetRole: 'requester',
                reason,
                before: beforeSuspension,
                after: null,
                createdAt: now,
              });
              resultUser = safeAccount(targetUid, { ...target, branchSuspensions }, branchId);
            } else {
              throw new OtpError(400, 'UNSUPPORTED_ROLE', 'Cannot restore accounts of this role.');
            }

            const userNoticeDoc = db.collection('moderationNotices').doc(targetUid);
            if (typeof userNoticeDoc.collection === 'function') {
              const noticeRef = userNoticeDoc.collection('items').doc();
              const noticeId = noticeRef.id;
              const notice = {
                schemaVersion: 1,
                actionId: noticeId,
                type: 'restore_branch_access',
                title: `Branch access restored: ${branchName}`,
                category: 'BRANCH_RESTORATION',
                scope: 'branch',
                branchId,
                branchName,
                reason: 'Branch access has been restored.',
                startsAt: now,
                endsAt: null,
                createdAt: now,
                acknowledgedAt: null,
                seenAt: null,
              };
              tx.set(noticeRef, notice);
            }
            tx.set(db.collection('moderationActivity').doc(`user_${targetUid}`), {
              uid: targetUid,
              updatedAt: now,
              revision: `${Date.now()}`,
            });
          });
          return res.status(200).json({ ok: true, user: resultUser });
        }
        throw new OtpError(400, 'INVALID_MANAGER_ACTION', 'Choose a valid Manager action.');
      }
      const [usersSnapshot, requestsSnapshot, productsSnapshot] = await Promise.all([
        db.collection('users').get(),
        db.collection('requests').where('branchId', '==', branchId).get(),
        db.collection('products').get(),
      ]);
      const orders = requestsSnapshot.docs.map((item) => safeOrder(item.id, item.data()));
      const requesterIds = new Set(orders.map((order) => order.requesterUid).filter(Boolean));
      const userById = new Map(usersSnapshot.docs.map((item) => [item.id, item.data() || {}]));
      const distributors = usersSnapshot.docs
        .filter((item) => branchDistributor(item.data(), branchId))
        .map((item) => safeAccount(item.id, item.data(), branchId))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      const pendingDistributors = usersSnapshot.docs
        .filter((item) => item.data()?.role === 'distributor'
          && clean(item.data()?.requestedBranchId, 128) === branchId
          && distributorState(item.data()) === 'pending')
        .map((item) => safeAccount(item.id, item.data(), branchId))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      const requesters = [...requesterIds].map((uid) => {
        const profile = userById.get(uid);
        if (profile?.role === 'requester') return safeAccount(uid, profile, branchId);
        const order = orders.find((item) => item.requesterUid === uid) || {};
        return { id: uid, uid, role: 'requester', fullName: order.requesterName, email: '', phone: order.requesterContact, address: order.requesterAddress, barangay: '', uniqueId: order.requesterUniqueId, createdAt: order.createdAt, branchSuspended: false, branchSuspensionReason: '' };
      }).sort((left, right) => left.fullName.localeCompare(right.fullName));
      const products = productsSnapshot.docs
        .map((item) => safeProduct(item.id, item.data()))
        .filter((product) => visibleProduct(product, branchId))
        .map((product) => ({ ...product, effectivePolicy: resolveEffectiveProductPolicy(product, manager.branch) }))
        .sort((left, right) => left.product_name.localeCompare(right.product_name));
      const productSales = orders.reduce((total, order) => total + (order.quantity || order.items.reduce((sum, item) => sum + item.quantity, 0)), 0);
      return res.status(200).json({
        manager: safeAccount(manager.decoded.uid, manager.profile, branchId),
        branch: { id: branchId, name: clean(manager.branch.name, 160), status: 'active', barangay: clean(manager.branch.barangay, 120), city: clean(manager.branch.city, 120), baseDeliveryFee: number(manager.branch.baseDeliveryFee), includedRadiusKm: number(manager.branch.includedRadiusKm ?? manager.branch.serviceRadiusKm), outsideRadiusFeePerKm: number(manager.branch.outsideRadiusFeePerKm), serviceRadiusKm: number(manager.branch.serviceRadiusKm) },
        distributors,
        pendingDistributors,
        requesters,
        products,
        orders,
        stats: { registeredUsers: distributors.length + requesters.length, registeredDistributors: distributors.length, registeredRequesters: requesters.length, productSales, stations: 1 },
      });
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { activeDistributor, branchDistributor, createManagerWorkspaceHandler, safeAccount, safeOrder, visibleProduct };
