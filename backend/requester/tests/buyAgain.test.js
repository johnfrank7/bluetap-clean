const assert = require('node:assert/strict');
const test = require('node:test');
const { buildBuyAgainDraft, canBuyAgain } = require('../../../services/buyAgain');

const catalog = { products: [
  { id: 'refill', price: 45, active: true, branchIds: ['near', 'far'] },
  { id: 'dispenser', price: 180, active: true, branchIds: ['far'] },
  { id: 'retired', price: 5, active: false, branchIds: ['near'] },
] };
const branches = [{ id: 'near', distanceKm: 1 }, { id: 'far', distanceKm: 4 }];
const available = (product, branchId) => product.branchIds.includes(branchId);

test('Buy Again action is offered only for delivered History orders', () => {
  assert.equal(canBuyAgain({ status: 'Delivered' }, true), true);
  assert.equal(canBuyAgain({ status: 'Pending' }, false), false);
  assert.equal(canBuyAgain({ status: 'Cancelled' }, true), false);
});

test('Buy Again copies quantities but selects current products, prices, and branch availability', () => {
  const previous = { status: 'delivered', branchId: 'old', assignedDistributorUid: 'old-driver', scheduledAt: '2020-01-01', items: [
    { productId: 'refill', quantity: 2, unitPriceAtOrder: 25 },
    { productId: 'dispenser', quantity: 1, unitPriceAtOrder: 100 },
  ] };
  const draft = buildBuyAgainDraft(previous, catalog, branches, available);
  assert.equal(draft.branchId, 'far');
  assert.deepEqual(draft.items, [{ productId: 'refill', quantity: 2 }, { productId: 'dispenser', quantity: 1 }]);
  assert.equal(draft.currentSubtotal, 270);
  assert.equal(draft.assignedDistributorUid, undefined);
  assert.equal(draft.scheduledAt, undefined);
});

test('Buy Again skips inactive products and preserves available items from the best current branch', () => {
  const draft = buildBuyAgainDraft({ items: [{ productId: 'retired', quantity: 1 }, { productId: 'refill', quantity: 3 }] }, catalog, branches, available);
  assert.equal(draft.branchId, 'near');
  assert.deepEqual(draft.items, [{ productId: 'refill', quantity: 3 }]);
  assert.equal(draft.unavailableCount, 1);
});

test('Buy Again returns no draft when all historical products are unavailable', () => {
  assert.equal(buildBuyAgainDraft({ items: [{ productId: 'retired', quantity: 1 }] }, catalog, branches, available), null);
});
