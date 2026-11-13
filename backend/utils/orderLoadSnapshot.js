// These records are written only by trusted order transactions. A snapshot on
// an order alone is not evidence that a legacy client did not supply it.
const { OtpError } = require('./otpError');
const unknown = () => { throw new OtpError(409, 'TRIP_LOAD_UNKNOWN', 'Order load provenance requires review.'); };
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128 && id.trim() === id && !id.includes('/');
const CLASSES = new Set(['STANDARD_5_GALLON', 'OTHER_CARGO', 'UNKNOWN']);
const validEpoch = (epoch) => typeof epoch === 'string' && /^[a-f0-9]{64}$/.test(epoch);

async function readOrderLoadEpoch(tx, db) {
  const snap = await tx.get(db.collection('orderLoadSnapshotSecurity').doc('current'));
  const data = snap.exists ? snap.data() : null;
  return data?.enabled === true && validEpoch(data.epoch) ? data.epoch : null;
}

function createOrderLoadSnapshot(orderId, items, epoch) {
  if (!validEpoch(epoch) || !validId(orderId) || !Array.isArray(items) || !items.length || items.length > 20) return null;
  const entries = [];
  for (const item of items) {
    if (!item || !validId(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
        !CLASSES.has(item.loadClassificationSnapshot) || typeof item.productNameSnapshot !== 'string' || item.productNameSnapshot.length > 160 ||
        typeof item.containerTypeSnapshot !== 'string' || item.containerTypeSnapshot.length > 80 || typeof item.sizeSnapshot !== 'string' || item.sizeSnapshot.length > 80) return null;
    entries.push({ productId: item.productId, quantity: item.quantity, classification: item.loadClassificationSnapshot,
      description: item.productNameSnapshot, containerType: item.containerTypeSnapshot, size: item.sizeSnapshot });
  }
  return { schemaVersion: 1, epoch, orderId, items: entries };
}

function verifiedOrderSnapshot(orderId, items, proof, epoch) {
  const expected = createOrderLoadSnapshot(orderId, items, epoch);
  if (!expected || !proof || proof.schemaVersion !== 1 || proof.epoch !== epoch || proof.orderId !== orderId || !Array.isArray(proof.items) || proof.items.length !== expected.items.length) unknown();
  for (let i = 0; i < expected.items.length; i++) {
    const item = expected.items[i]; const verified = proof.items[i];
    if (!verified || Object.keys(verified).length !== Object.keys(item).length || Object.keys(item).some((key) => verified[key] !== item[key])) unknown();
  }
  return expected.items;
}

function verifiedOrderCargo(orderId, items, proof, epoch) {
  const entries = verifiedOrderSnapshot(orderId, items, proof, epoch);
  if (entries.some((item) => item.classification === 'UNKNOWN')) unknown();
  return entries.map((item) => ({ productId: item.productId, quantity: item.quantity, description: item.description,
    classification: item.classification === 'STANDARD_5_GALLON' ? 'standard_5_gallon' : 'other' }));
}

// Existing lines keep their proven order-time identity. A legacy or ambiguous
// existing line cannot be upgraded merely because today's catalog is verified.
function preserveOrderLoadSnapshots(currentItems, entries, nextItems) {
  const existingIds = new Set((Array.isArray(currentItems) ? currentItems : []).map((item) => item?.productId || item?.product_id).filter(validId));
  const proven = new Map();
  const oldQuantities = new Map(); const newQuantities = new Map();
  for (const entry of entries || []) {
    oldQuantities.set(entry.productId, (oldQuantities.get(entry.productId) || 0) + entry.quantity);
    const identity = JSON.stringify([entry.classification, entry.description, entry.containerType, entry.size]);
    const prior = proven.get(entry.productId);
    if (!prior) proven.set(entry.productId, { identity, entry });
    else if (prior.identity !== identity) proven.set(entry.productId, { identity: null, entry: null });
  }
  for (const item of nextItems) newQuantities.set(item.productId, (newQuantities.get(item.productId) || 0) + item.quantity);
  return nextItems.map((item) => {
    if (!existingIds.has(item.productId)) return item;
    const entry = proven.get(item.productId)?.entry;
    if (!entry) return { ...item, loadClassificationSnapshot: 'UNKNOWN' };
    const increased = newQuantities.get(item.productId) > oldQuantities.get(item.productId);
    const changedCargo = item.loadClassificationSnapshot !== entry.classification || item.containerTypeSnapshot !== entry.containerType || item.sizeSnapshot !== entry.size;
    return { ...item, productNameSnapshot: entry.description, containerTypeSnapshot: entry.containerType,
      sizeSnapshot: entry.size, loadClassificationSnapshot: increased && changedCargo ? 'UNKNOWN' : entry.classification };
  });
}

module.exports = { readOrderLoadEpoch, createOrderLoadSnapshot, verifiedOrderSnapshot, verifiedOrderCargo, preserveOrderLoadSnapshots };
