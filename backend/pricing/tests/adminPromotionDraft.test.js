const test = require('node:test');
const assert = require('node:assert/strict');
const { promotionStatus, samplePromotionTiers, promotionDraftFingerprint } = require('../../../services/adminPromotionDraft');
const { createAdminProductsHandler } = require('../../admin/productManagementHandler');

test('sample tiers scale from the unit price and respect branch limits', () => {
  assert.deepEqual(samplePromotionTiers(2500), [{ quantity: '3', price: '70.00' }, { quantity: '5', price: '115.00' }, { quantity: '10', price: '220.00' }]);
  assert.deepEqual(samplePromotionTiers(2000, 4), [{ quantity: '3', price: '56.00' }]);
  assert.deepEqual(samplePromotionTiers(2000, 2), []);
  assert.deepEqual(samplePromotionTiers(0), []);
  assert.ok(samplePromotionTiers(1).every((tier) => Number(tier.price) > 0));
});

test('statuses derive only from the saved active flag, explicit disable metadata and schedule', () => {
  const now = Date.parse('2027-01-01T00:00:00Z');
  assert.equal(promotionStatus(null, now), 'Draft');
  assert.equal(promotionStatus({ active: false, startsAt: '2026-01-01T00:00:00Z' }, now), 'Draft');
  assert.equal(promotionStatus({ active: false, disabledAt: '2026-06-01T00:00:00.000Z' }, now), 'Disabled');
  assert.equal(promotionStatus({ active: false, disabledAt: 'invalid-date' }, now), 'Unavailable');
  assert.equal(promotionStatus({ active: true, startsAt: '2028-01-01T00:00:00Z' }, now), 'Scheduled');
  assert.equal(promotionStatus({ active: true, endsAt: '2026-01-01T00:00:00Z' }, now), 'Expired');
  assert.equal(promotionStatus({ active: true }, now), 'Active');
});

test('unchanged drafts compare normalized saved values without writing', () => {
  const saved = { title: 'Bundle', commercialEligibility: 'refill_verified', branchIds: ['b', 'a'], containerChoices: ['Exchange'], tiers: [{ quantity: 3, bundlePriceCentavos: 7000 }], startsAt: '2028-01-01T00:00:00Z', endsAt: null };
  assert.equal(promotionDraftFingerprint(saved), promotionDraftFingerprint({ ...saved, branchIds: ['a', 'b'], startMode: 'scheduled', startsAt: '2028-01-01T08:00:00+08:00' }));
  assert.notEqual(promotionDraftFingerprint(saved), promotionDraftFingerprint({ ...saved, tiers: [{ quantity: 3, bundlePriceCentavos: 6900 }] }));
});

test('draft-only endpoint cannot change an active promotion', async () => {
  let writes = 0;
  const admin = { exists: true, data: () => ({ role: 'admin', accountStatus: 'active' }) };
  const product = { exists: true, data: () => ({ product_name: 'Refill', price: 25, bundlePromotion: { active: true, version: 1 } }) };
  const ref = { get: async () => product };
  const db = { collection: (name) => ({ doc: () => name === 'users' ? { get: async () => admin } : ref }), runTransaction: (fn) => fn({ get: async (target) => target === ref ? product : admin, update: () => { writes += 1; }, set: () => { writes += 1; } }) };
  const auth = { verifyIdToken: async () => ({ uid: 'admin', admin: true }) };
  const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await createAdminProductsHandler(() => ({ auth, db }), { promotionDraftOnly: true, logger: {} })({ method: 'PATCH', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: { productId: 'refill', bundlePromotion: { active: false, expectedVersion: 1 } } }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.error.reason, 'BUNDLE_PROMOTION_ACTIVE'); assert.equal(writes, 0);
});

test('draft save fails closed when existing promotion records conflict', async () => {
  let writes = 0;
  const admin = { exists: true, data: () => ({ role: 'admin', accountStatus: 'active' }) };
  const product = { exists: true, data: () => ({ product_name: 'Refill', price: 25, bundlePromotion: [{ active: true }, { active: false }] }) };
  const ref = { get: async () => product };
  const db = { collection: (name) => ({ doc: () => name === 'users' ? { get: async () => admin } : ref }), runTransaction: (fn) => fn({ get: async (target) => target === ref ? product : admin, update: () => { writes += 1; }, set: () => { writes += 1; } }) };
  const auth = { verifyIdToken: async () => ({ uid: 'admin', admin: true }) };
  const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await createAdminProductsHandler(() => ({ auth, db }), { promotionDraftOnly: true, logger: {} })({ method: 'PATCH', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: { productId: 'refill', bundlePromotion: { active: false, expectedVersion: 0 } } }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.error.reason, 'PROMOTION_CONFLICT'); assert.equal(writes, 0);
});

test('Requester cannot save an Admin promotion draft', async () => {
  let writes = 0;
  const requester = { exists: true, data: () => ({ role: 'requester', accountStatus: 'active' }) };
  const db = { collection: () => ({ doc: () => ({ get: async () => requester }) }), runTransaction: () => { writes += 1; } };
  const auth = { verifyIdToken: async () => ({ uid: 'requester' }) };
  const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await createAdminProductsHandler(() => ({ auth, db }), { promotionDraftOnly: true, logger: {} })({ method: 'PATCH', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: { productId: 'refill', bundlePromotion: { active: false, expectedVersion: 0 } } }, res);
  assert.equal(res.statusCode, 403); assert.equal(writes, 0);
});

test('Admin may disable an active promotion while publishing remains disabled', async () => {
  const admin = { exists: true, data: () => ({ role: 'admin', accountStatus: 'active' }) };
  const product = { exists: true, data: () => ({ product_name: 'Refill', price: 25, bundlePromotion: { id: 'promo', active: true, version: 1 } }) };
  const productRef = { get: async () => product };
  let update; let audit;
  const db = { collection: (name) => ({ doc: () => name === 'users' ? { get: async () => admin } : productRef }),
    runTransaction: async (fn) => fn({ get: async (target) => target === productRef ? product : admin, update: (_ref, value) => { update = value; }, set: (_ref, value) => { audit = value; } }) };
  const auth = { verifyIdToken: async () => ({ uid: 'admin', admin: true }) };
  const call = async (action) => {
    const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
    await createAdminProductsHandler(() => ({ auth, db }), { logger: {} })({ method: 'PATCH', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: { productId: 'refill', bundlePromotionAction: action, expectedVersion: 1 } }, res);
    return res;
  };
  assert.equal((await call('publish')).body.error.reason, 'BUNDLE_PROMOTIONS_UNAVAILABLE');
  assert.equal(update, undefined);
  assert.equal((await call('disable')).statusCode, 200);
  assert.equal(update.bundlePromotion.active, false);
  assert.equal(update.bundlePromotion.version, 2);
  assert.equal(audit.action, 'BUNDLE_PROMOTION_DISABLED');
});

test('promotion writes reject an Admin deactivated before the transaction', async () => {
  let writes = 0;
  const activeAdmin = { exists: true, data: () => ({ role: 'admin', accountStatus: 'active' }) };
  const suspendedAdmin = { exists: true, data: () => ({ role: 'admin', accountStatus: 'suspended' }) };
  const product = { exists: true, data: () => ({ product_name: 'Refill', price: 25, bundlePromotion: { active: true, version: 1 } }) };
  const productRef = { get: async () => product };
  const db = { collection: (name) => ({ doc: () => name === 'users' ? { get: async () => activeAdmin } : productRef }),
    runTransaction: (fn) => fn({ get: async (target) => target === productRef ? product : suspendedAdmin, update: () => { writes++; }, set: () => { writes++; } }) };
  const auth = { verifyIdToken: async () => ({ uid: 'admin', admin: true }) };
  const res = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await createAdminProductsHandler(() => ({ auth, db }), { logger: {} })({ method: 'PATCH', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: { productId: 'refill', bundlePromotionAction: 'disable', expectedVersion: 1 } }, res);
  assert.equal(res.statusCode, 403); assert.equal(writes, 0);
});
