const assert = require('node:assert/strict');
const test = require('node:test');
const { WEEKDAYS, effectiveDeliveryDays, isAllowedDeliveryDate, limitViolations, manilaScheduleDate, scheduledWeekday } = require('../../../services/productOrderPolicy');

test('legacy unrestricted products permit every weekday', () => {
  assert.deepEqual(effectiveDeliveryDays([{ productId: 'legacy' }]), WEEKDAYS);
  assert.deepEqual(effectiveDeliveryDays([{ deliveryDaysSnapshot: [] }]), WEEKDAYS);
});

test('multiple restricted products permit only their weekday intersection', () => {
  const items = [
    { productId: 'one', deliveryDaysSnapshot: ['monday', 'wednesday', 'friday'] },
    { productId: 'two', deliveryDaysSnapshot: ['wednesday', 'friday'] },
    { productId: 'legacy', deliveryDaysSnapshot: [] },
  ];
  assert.deepEqual(effectiveDeliveryDays(items), ['wednesday', 'friday']);
  assert.deepEqual(effectiveDeliveryDays([{ deliveryDaysSnapshot: ['monday'] }, { deliveryDaysSnapshot: ['friday'] }]), []);
});

test('delivery weekday uses Philippines time for schedules', () => {
  const schedule = manilaScheduleDate(2, 9);
  const day = scheduledWeekday(schedule);
  assert.equal(isAllowedDeliveryDate(schedule, [day]), true);
  assert.equal(isAllowedDeliveryDate(schedule, WEEKDAYS.filter((candidate) => candidate !== day)), false);
});

test('duplicate product lines aggregate quantity against the snapshotted limit', () => {
  const violations = limitViolations([
    { productId: 'one', productNameSnapshot: 'Refill', quantity: 2, maxQuantityPerRequesterSnapshot: 3 },
    { productId: 'one', productNameSnapshot: 'Refill', quantity: 2, maxQuantityPerRequesterSnapshot: 3 },
  ]);
  assert.deepEqual(violations, [{ productId: 'one', productNameSnapshot: 'Refill', requestedQuantity: 4, configuredLimit: 3 }]);
});
