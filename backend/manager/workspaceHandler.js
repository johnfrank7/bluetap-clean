const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireActiveManager } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { safeProduct } = require('../admin/productManagementHandler');
const { productDeliveryDays, productLimit } = require('../../services/productOrderPolicy');
const { resolveEffectiveProductPolicy } = require('../utils/effectiveProductPolicy');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const distributorState = (profile = {}) => clean(profile.distributorStatus || profile.approvalStatus || profile.status, 40).toLowerCase();
const fullName = (profile = {}) => clean(profile.fullName || profile.full_name || `${profile.firstName || ''} ${profile.lastName || ''}`, 160);
const activeDistributor = (profile = {}, branchId) => profile.role === 'distributor'
  && clean(profile.branchId, 128) === branchId
  && ['active', 'approved'].includes(distributorState(profile))
  && !['inactive', 'disabled'].includes(clean(profile.accountStatus, 40).toLowerCase())
  && profile.mustChangePassword !== true;
const visibleProduct = (product = {}, branchId) => product.active !== false
  && (!Array.isArray(product.branchIds) || product.branchIds.length === 0 || product.branchIds.includes(branchId));
const safeAccount = (id, profile = {}) => ({
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
});
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
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        if (body.action !== 'updateProductPolicy') throw new OtpError(400, 'INVALID_MANAGER_ACTION', 'Choose a valid Manager action.');
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
      const [usersSnapshot, requestsSnapshot, productsSnapshot] = await Promise.all([
        db.collection('users').get(),
        db.collection('requests').where('branchId', '==', branchId).get(),
        db.collection('products').get(),
      ]);
      const orders = requestsSnapshot.docs.map((item) => safeOrder(item.id, item.data()));
      const requesterIds = new Set(orders.map((order) => order.requesterUid).filter(Boolean));
      const userById = new Map(usersSnapshot.docs.map((item) => [item.id, item.data() || {}]));
      const distributors = usersSnapshot.docs
        .filter((item) => activeDistributor(item.data(), branchId))
        .map((item) => safeAccount(item.id, item.data()))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      const pendingDistributors = usersSnapshot.docs
        .filter((item) => item.data()?.role === 'distributor'
          && clean(item.data()?.requestedBranchId, 128) === branchId
          && distributorState(item.data()) === 'pending')
        .map((item) => safeAccount(item.id, item.data()))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      const requesters = [...requesterIds].map((uid) => {
        const profile = userById.get(uid);
        if (profile?.role === 'requester') return safeAccount(uid, profile);
        const order = orders.find((item) => item.requesterUid === uid) || {};
        return { id: uid, uid, role: 'requester', fullName: order.requesterName, email: '', phone: order.requesterContact, address: order.requesterAddress, barangay: '', uniqueId: order.requesterUniqueId, createdAt: order.createdAt };
      }).sort((left, right) => left.fullName.localeCompare(right.fullName));
      const products = productsSnapshot.docs
        .map((item) => safeProduct(item.id, item.data()))
        .filter((product) => visibleProduct(product, branchId))
        .map((product) => ({ ...product, effectivePolicy: resolveEffectiveProductPolicy(product, manager.branch) }))
        .sort((left, right) => left.product_name.localeCompare(right.product_name));
      const productSales = orders.reduce((total, order) => total + (order.quantity || order.items.reduce((sum, item) => sum + item.quantity, 0)), 0);
      return res.status(200).json({
        manager: safeAccount(manager.decoded.uid, manager.profile),
        branch: { id: branchId, name: clean(manager.branch.name, 160), status: 'active', barangay: clean(manager.branch.barangay, 120), city: clean(manager.branch.city, 120), baseDeliveryFee: number(manager.branch.baseDeliveryFee), includedRadiusKm: number(manager.branch.includedRadiusKm || manager.branch.serviceRadiusKm), outsideRadiusFeePerKm: number(manager.branch.outsideRadiusFeePerKm), serviceRadiusKm: number(manager.branch.serviceRadiusKm) },
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

module.exports = { activeDistributor, createManagerWorkspaceHandler, safeAccount, safeOrder, visibleProduct };
