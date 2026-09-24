const { randomUUID } = require('node:crypto');
const { getFirebaseAdmin } = require('../firebase/firebaseAdmin');
const { requireRequester } = require('../auth/authorization');
const { applyCors } = require('../utils/cors');
const { OtpError } = require('../utils/otpError');
const { safeProduct } = require('../admin/productManagementHandler');
const { safeBranch } = require('../admin/branchManagementHandler');
const { DEFAULT_SERVICE_RADIUS_KM } = require('../../constants/toledoBarangays.json');
const { isActiveRequesterOrderStatus } = require('../../constants/requesterOrderStatus');

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const coordinate = (value, minimum, maximum) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};
const validBranchLocation = (branch = {}) =>
  coordinate(branch.latitude, -90, 90) !== null && coordinate(branch.longitude, -180, 180) !== null;
const serviceRadiusKm = (branch = {}) => {
  const radius = Number(branch.serviceRadiusKm);
  return Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_SERVICE_RADIUS_KM;
};
const radians = (degrees) => degrees * (Math.PI / 180);
const distanceKm = (from, to) => {
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, a));
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded)) * 10) / 10;
};
const fullNameFor = (profile = {}) => clean(profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`, 160);
const profileAddressFor = (profile = {}) => clean(
  profile.completeAddress || [profile.address, profile.barangay, profile.city].filter(Boolean).join(', '),
  300
);
const profileContactFor = (profile = {}) => clean(profile.phone || profile.contactNumber, 40);
const profileSummary = (profile = {}) => {
  const fullName = fullNameFor(profile);
  const contactNumber = profileContactFor(profile);
  const address = profileAddressFor(profile);
  return {
    fullName,
    contactNumber,
    address,
    email: clean(profile.email, 240).toLowerCase(),
    uniqueId: clean(profile.unique_id || profile.uniqueId || profile.uid, 80),
    complete: Boolean(fullName && contactNumber && address),
    defaultDeliveryLocation: profile.defaultDeliveryLocation || null,
  };
};
const productAvailableAtBranch = (product, branchId) => {
  const branchIds = Array.isArray(product.branchIds)
    ? product.branchIds
    : product.branchId ? [product.branchId] : [];
  return branchIds.length === 0 || branchIds.includes(branchId);
};
const safeOrder = (id, data = {}) => ({ id, ...data });

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); }
  catch { throw new OtpError(400, 'INVALID_REQUEST', 'The request body is invalid.'); }
}

async function activeCatalog(db) {
  const [branchSnapshot, productSnapshot] = await Promise.all([
    db.collection('branches').get(),
    db.collection('products').get(),
  ]);
  const branches = branchSnapshot.docs
    .map((item) => safeBranch(item.id, item.data()))
    .filter((branch) => branch.status === 'active' && validBranchLocation(branch));
  const products = productSnapshot.docs
    .map((item) => safeProduct(item.id, item.data()))
    .filter((product) => product.active && product.product_name && product.price !== null);
  return { branches, products };
}

function responseError(res, error) {
  const known = error instanceof OtpError;
  return res.status(known ? error.status : 500).json({ error: {
    reason: known ? error.reason : 'service-unavailable',
    message: known ? error.message : 'Ordering is temporarily unavailable.',
  } });
}

function createRequesterCatalogHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=30');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET.' } });
    try {
      const { auth, db } = getAdmin();
      const { profile } = await requireRequester(req, auth, db);
      const catalog = await activeCatalog(db);
      return res.status(200).json({ ...catalog, profile: profileSummary(profile) });
    } catch (error) { return responseError(res, error); }
  };
}

function requestItems(body) {
  const source = Array.isArray(body.items) && body.items.length
    ? body.items
    : [{ productId: body.productId || body.product_id, quantity: body.quantity }];
  if (source.length > 20) throw new OtpError(400, 'TOO_MANY_ORDER_ITEMS', 'Choose no more than 20 products.');
  return source.map((item) => {
    const productId = clean(item.productId || item.product_id, 128);
    const quantity = Number(item.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new OtpError(400, 'INVALID_ORDER_ITEM', 'Each product needs a quantity between 1 and 100.');
    }
    return { productId, quantity };
  });
}

async function buildTrustedOrder(db, requester, body) {
  const branchId = clean(body.branchId, 128);
  const latitude = coordinate(body.deliveryLocation?.latitude, -90, 90);
  const longitude = coordinate(body.deliveryLocation?.longitude, -180, 180);
  const accuracyNum = Number(body.deliveryLocation?.accuracy);
  const accuracy = Number.isFinite(accuracyNum) && accuracyNum >= 0 ? Math.round(accuracyNum * 10) / 10 : null;
  if (!branchId) throw new OtpError(400, 'BRANCH_REQUIRED', 'Select a provider branch.');
  if (latitude === null || longitude === null) throw new OtpError(400, 'DELIVERY_LOCATION_REQUIRED', 'Choose a valid delivery location.');
  const summary = profileSummary(requester.profile);
  if (!summary.complete) throw new OtpError(409, 'PROFILE_INCOMPLETE', 'Complete your profile before placing an order.');
  const branchSnapshot = await db.collection('branches').doc(branchId).get();
  const branch = branchSnapshot.exists ? safeBranch(branchId, branchSnapshot.data()) : null;
  if (!branch) throw new OtpError(404, 'BRANCH_NOT_FOUND', 'The selected provider branch no longer exists.');
  if (branch.status !== 'active' || !validBranchLocation(branch)) {
    throw new OtpError(409, 'BRANCH_UNAVAILABLE', 'The selected provider branch is unavailable.');
  }
  const submittedItems = requestItems(body);
  const items = await Promise.all(submittedItems.map(async (item) => {
    const snapshot = await db.collection('products').doc(item.productId).get();
    if (!snapshot.exists) throw new OtpError(404, 'PRODUCT_NOT_FOUND', 'A selected product no longer exists.');
    const product = safeProduct(snapshot.id, snapshot.data());
    if (!product.active || product.price === null || !productAvailableAtBranch(product, branchId)) {
      throw new OtpError(409, 'PRODUCT_UNAVAILABLE', `${product.product_name || 'A selected product'} is not available from this branch.`);
    }
    const lineTotal = Math.round(product.price * item.quantity * 100) / 100;
    return {
      productId: product.id,
      productNameSnapshot: product.product_name,
      unitPriceAtOrder: product.price,
      quantity: item.quantity,
      totalAtOrder: lineTotal,
      containerTypeSnapshot: product.containerType || '',
      sizeSnapshot: product.size || '',
    };
  }));
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAtOrder = Math.round(items.reduce((sum, item) => sum + item.totalAtOrder, 0) * 100) / 100;
  const deliveryLocation = { latitude, longitude, ...(accuracy !== null ? { accuracy } : {}) };
  const distanceKmSnapshot = distanceKm(deliveryLocation, branch);
  const serviceRadiusKmSnapshot = serviceRadiusKm(branch);
  const outsideServiceArea = distanceKmSnapshot > serviceRadiusKmSnapshot;
  return {
    requesterUid: requester.decoded.uid,
    requester_id: requester.decoded.uid,
    requesterNameSnapshot: summary.fullName,
    requester_name: summary.fullName,
    requesterUniqueIdSnapshot: summary.uniqueId,
    requester_unique_id: summary.uniqueId,
    contactNumberSnapshot: summary.contactNumber,
    contact_number: summary.contactNumber,
    addressSnapshot: summary.address,
    address: summary.address,
    branchId,
    initialBranchId: branchId,
    currentBranchId: branchId,
    branchNameSnapshot: branch.name,
    initialBranchNameSnapshot: branch.name,
    branchAddressSnapshot: [branch.address, branch.barangay, branch.city].filter(Boolean).join(', '),
    water_station: branch.name,
    deliveryLocation,
    distanceKmSnapshot,
    serviceRadiusKmSnapshot,
    outsideServiceArea,
    items,
    productId: items[0]?.productId || '',
    product_id: items[0]?.productId || '',
    productNameSnapshot: items.map((item) => item.productNameSnapshot).join(', '),
    product_name: items.map((item) => item.productNameSnapshot).join(', '),
    unitPriceAtOrder: items[0]?.unitPriceAtOrder || 0,
    product_price: items[0]?.unitPriceAtOrder || 0,
    quantity,
    totalAtOrder,
    total_cost: totalAtOrder,
    container: clean(body.container, 80),
    expectedDeliveryDate: body.expectedDeliveryDate ? clean(body.expectedDeliveryDate, 40) : '',
    delivery_date: body.expectedDeliveryDate ? clean(body.expectedDeliveryDate, 40) : '',
    status: outsideServiceArea ? 'outside_radius_pending_approval' : 'Pending',
  };
}

const inFlightRequesterCreations = new Set();

function createRequesterOrdersHandler(getAdmin = getFirebaseAdmin) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!applyCors(req, res)) return;
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) return res.status(405).json({ error: { reason: 'method-not-allowed', message: 'Use GET, POST, or PATCH.' } });
    try {
      const { auth, db } = getAdmin();
      const requester = await requireRequester(req, auth, db);
      if (req.method === 'GET') {
        const snapshot = await db.collection('requests').where('requesterUid', '==', requester.decoded.uid).get();
        return res.status(200).json({ orders: snapshot.docs.map((item) => safeOrder(item.id, item.data())) });
      }
      const body = bodyOf(req);
      if (req.method === 'PATCH') {
        const orderId = clean(body.orderId, 128);
        const ref = db.collection('requests').doc(orderId);
        const snapshot = orderId ? await ref.get() : null;
        const current = snapshot?.data();
        if (!snapshot?.exists || (current.requesterUid || current.requester_id) !== requester.decoded.uid) throw new OtpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
        if (!['pending', 'outside_radius_pending_approval'].includes(String(current.status).toLowerCase())) throw new OtpError(409, 'ORDER_NOT_CANCELLABLE', 'Only pending orders can be cancelled.');
        const now = new Date();
        await ref.update({ status: 'Cancelled', updatedAt: now, updated_at: now, cancelledAt: now });
        const guardRef = db.collection('requesterActiveOrders').doc(requester.decoded.uid);
        if (typeof guardRef.delete === 'function') {
          await guardRef.delete().catch(() => {});
        }
        return res.status(200).json({ order: safeOrder(orderId, { ...current, status: 'Cancelled', updatedAt: now, updated_at: now, cancelledAt: now }) });
      }

      // Check process-level in-flight creation (local optimization against rapid double-clicks)
      if (inFlightRequesterCreations.has(requester.decoded.uid)) {
        throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
      }
      inFlightRequesterCreations.add(requester.decoded.uid);
      try {
        // 1. Check existing orders for active order (to quickly catch non-terminal orders)
        const existingSnapshot = await db.collection('requests').where('requesterUid', '==', requester.decoded.uid).get();
        const hasActive = existingSnapshot.docs.some((doc) => isActiveRequesterOrderStatus(doc.data()?.status));
        if (hasActive) {
          throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
        }

        // 2. Build trusted order
        const trusted = await buildTrustedOrder(db, requester, body);
        const guardRef = db.collection('requesterActiveOrders').doc(requester.decoded.uid);
        const userRef = db.collection('users').doc(requester.decoded.uid);
        const ref = db.collection('requests').doc();
        const now = new Date();
        const requestNumber = `BT-${now.getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
        const saved = { ...trusted, requestId: requestNumber, request_id: requestNumber, createdAt: now, created_at: now, updatedAt: now, updated_at: now };

        const shouldSaveDefault = !requester.profile.defaultDeliveryLocation || body.saveAsDefaultLocation === true;
        const defaultDeliveryLocation = shouldSaveDefault ? {
          latitude: trusted.deliveryLocation.latitude,
          longitude: trusted.deliveryLocation.longitude,
          ...(trusted.deliveryLocation.accuracy != null ? { accuracy: trusted.deliveryLocation.accuracy } : {}),
          formattedAddress: trusted.addressSnapshot,
          barangay: clean(requester.profile.barangay, 120),
          updatedAt: now,
        } : null;

        if (typeof db.runTransaction === 'function') {
          await db.runTransaction(async (tx) => {
            if (typeof tx.get === 'function') {
              const guardSnap = await tx.get(guardRef);
              if (guardSnap && guardSnap.exists) {
                const guardData = guardSnap.data() || {};
                if (guardData.orderId) {
                  const activeDocRef = db.collection('requests').doc(guardData.orderId);
                  const activeSnap = await tx.get(activeDocRef);
                  if (activeSnap && activeSnap.exists && isActiveRequesterOrderStatus(activeSnap.data()?.status)) {
                    throw new OtpError(409, 'ACTIVE_ORDER_EXISTS', 'You already have an active order in progress. You can only place one order at a time.');
                  }
                }
              }
            }
            tx.set(ref, saved);
            tx.set(guardRef, {
              orderId: ref.id,
              requestId: requestNumber,
              requesterUid: requester.decoded.uid,
              status: saved.status,
              createdAt: now,
            });
            if (defaultDeliveryLocation) {
              if (typeof tx.update === 'function') {
                tx.update(userRef, { defaultDeliveryLocation, updatedAt: now });
              } else if (typeof tx.set === 'function') {
                tx.set(userRef, { defaultDeliveryLocation, updatedAt: now });
              }
            }
          });
        } else {
          await ref.set(saved);
          await guardRef.set({
            orderId: ref.id,
            requestId: requestNumber,
            requesterUid: requester.decoded.uid,
            status: saved.status,
            createdAt: now,
          });
          if (defaultDeliveryLocation && typeof userRef.update === 'function') {
            await userRef.update({ defaultDeliveryLocation, updatedAt: now });
          }
        }
        return res.status(201).json({ order: safeOrder(ref.id, saved) });
      } finally {
        inFlightRequesterCreations.delete(requester.decoded.uid);
      }
    } catch (error) { return responseError(res, error); }
  };
}

module.exports = { createRequesterCatalogHandler, createRequesterOrdersHandler, distanceKm, productAvailableAtBranch, serviceRadiusKm };
