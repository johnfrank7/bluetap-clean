const assert = require('node:assert/strict');
const test = require('node:test');

const {
  requestedDateNeedsApproval,
  resolveEffectiveProductPolicy,
} = require('../effectiveProductPolicy');

test('effective product policy uses Admin defaults when no branch override exists', () => {
  const policy = resolveEffectiveProductPolicy({
    id: 'refill',
    deliveryDays: ['monday', 'wednesday'],
    maxQuantityPerRequester: 10,
  }, { id: 'north' });

  assert.deepEqual(policy.deliveryDays, ['monday', 'wednesday']);
  assert.equal(policy.maxQuantityPerRequester, 10);
  assert.equal(policy.source, 'admin_default');
});

test('valid Manager branch override takes precedence over Admin defaults', () => {
  const policy = resolveEffectiveProductPolicy({
    id: 'refill',
    deliveryDays: ['monday'],
    maxQuantityPerRequester: 10,
  }, {
    productPolicyOverrides: {
      refill: { deliveryDays: ['tuesday', 'thursday'], maxQuantityPerRequester: 6 },
    },
  });

  assert.deepEqual(policy.deliveryDays, ['tuesday', 'thursday']);
  assert.equal(policy.maxQuantityPerRequester, 6);
  assert.equal(policy.source, 'branch_override');
});

test('unset legacy policy means daily availability and no quantity limit', () => {
  const policy = resolveEffectiveProductPolicy({ id: 'legacy' }, {});

  assert.deepEqual(policy.deliveryDays, [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  ]);
  assert.equal(policy.maxQuantityPerRequester, null);
});

test('invalid stored branch override falls back to valid Admin defaults', () => {
  const policy = resolveEffectiveProductPolicy({
    id: 'refill', deliveryDays: ['wednesday'], maxQuantityPerRequester: 8,
  }, {
    productPolicyOverrides: { refill: { deliveryDays: ['not-a-day'], maxQuantityPerRequester: 999 } },
  });

  assert.deepEqual(policy.deliveryDays, ['wednesday']);
  assert.equal(policy.maxQuantityPerRequester, 8);
  assert.equal(policy.source, 'admin_default');
});

test('non-standard requested delivery day requires Manager approval', () => {
  assert.equal(requestedDateNeedsApproval('2026-09-29T02:00:00.000Z', ['monday']), true);
  assert.equal(requestedDateNeedsApproval('2026-09-28T02:00:00.000Z', ['monday']), false);
  assert.equal(requestedDateNeedsApproval(null, ['monday']), false);
});
