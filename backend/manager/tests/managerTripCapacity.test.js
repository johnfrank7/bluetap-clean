const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRIP_MAX_CONTAINERS,
  SCHEDULE_CONFLICT_WINDOW_MS,
  parseScheduleTime,
  formatIsoSchedule,
  classifyProductItem,
  analyzeOrderCargo,
  calculateOrderContainers,
  describeOrderCargo,
  aggregateCargoItems,
  generateTripId,
  isSameTrip,
  groupOrdersIntoTrips,
  getDistributorWorkloadSummary,
  getSlotCapacityInfo,
  getTripDurationMs,
  getTripTimeWindow,
  isTripOverlapping,
  validateTripAssignment,
} = require('../../../services/managerTripCapacity');

class TestOtpError extends Error {
  constructor(status, reason, message) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

test('classifyProductItem accurately classifies standard 5-gal, other cargo, and unknown items', () => {
  // Standard 5-gallon items
  assert.equal(classifyProductItem({ productNameSnapshot: 'BlueTap 5-Gallon Purified Water' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ productNameSnapshot: 'Alkaline Water Refill' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ containerTypeSnapshot: 'Slim 5-gallon container' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ containerTypeSnapshot: 'Round 5-gallon dispenser' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ sizeSnapshot: '5 Gallon' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ containerTypeSnapshot: 'Exchange container' }), 'standard_5_gallon');
  assert.equal(classifyProductItem({ loadClassificationSnapshot: 'STANDARD_5_GALLON' }), 'standard_5_gallon');

  // Other non-5-gallon cargo (1-gallon water, 24-pack bottles, dispenser, cups)
  assert.equal(classifyProductItem({ productNameSnapshot: 'BlueTap 1-Gallon Purified Water' }), 'other');
  assert.equal(classifyProductItem({ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack' }), 'other');
  assert.equal(classifyProductItem({ productNameSnapshot: 'Mineral Water 500ml Bottle (12-pack)' }), 'other');
  assert.equal(classifyProductItem({ productNameSnapshot: 'Tabletop Water Dispenser' }), 'other');
  assert.equal(classifyProductItem({ sizeSnapshot: '1-Gallon' }), 'other');
  assert.equal(classifyProductItem({ loadClassificationSnapshot: 'OTHER_CARGO' }), 'other');

  // Unknown load items
  assert.equal(classifyProductItem({ productNameSnapshot: 'Custom Electrolyte Blend' }), 'unknown');
  assert.equal(classifyProductItem({}), 'unknown');
  assert.equal(classifyProductItem(null), 'unknown');
});

test('analyzeOrderCargo classifies the exact user reported order (1 × 1-Gal + 1 × 24-Pack) as other cargo, NOT 5-gal', () => {
  const reportedOrder = {
    id: 'reported-order',
    items: [
      { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 1 },
      { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 },
    ],
  };

  const cargo = analyzeOrderCargo(reportedOrder);
  assert.equal(cargo.standard5GallonCount, 0, 'Must have 0 standard 5-gallon containers');
  assert.equal(cargo.otherCargoCount, 2, 'Must count 2 non-5-gallon cargo items');
  assert.equal(cargo.has5Gallon, false);
  assert.equal(cargo.hasOtherCargo, true);
  assert.equal(cargo.hasUnknownCargo, false);
  assert.equal(cargo.isOnlyOther, true);
  assert.equal(cargo.isMixed, false);
  assert.equal(cargo.isPure5Gallon, false);
  assert.equal(cargo.badgeLabel, '📦 Other Cargo (2 items)');
  assert.equal(cargo.badgeTone, 'orange');

  // calculateOrderContainers must return 0 for standard 5-gal count
  assert.equal(calculateOrderContainers(reportedOrder), 0);
});

test('analyzeOrderCargo correctly classifies pure 5-gallon orders', () => {
  const pureOrder = {
    items: [
      { productNameSnapshot: 'Purified Water Refill', quantity: 5 },
      { productNameSnapshot: 'Slim 5-Gallon Container', quantity: 3 },
    ],
  };

  const cargo = analyzeOrderCargo(pureOrder);
  assert.equal(cargo.standard5GallonCount, 8);
  assert.equal(cargo.otherCargoCount, 0);
  assert.equal(cargo.has5Gallon, true);
  assert.equal(cargo.hasOtherCargo, false);
  assert.equal(cargo.hasUnknownCargo, false);
  assert.equal(cargo.isPure5Gallon, true);
  assert.equal(cargo.badgeLabel, '📦 8 × 5-gal');
  assert.equal(cargo.badgeTone, 'blue');
  assert.equal(calculateOrderContainers(pureOrder), 8);
});

test('analyzeOrderCargo correctly classifies mixed orders (5-gal + 24-pack)', () => {
  const mixedOrder = {
    items: [
      { productNameSnapshot: 'Purified Water Refill (5-gal)', quantity: 10 },
      { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 2 },
    ],
  };

  const cargo = analyzeOrderCargo(mixedOrder);
  assert.equal(cargo.standard5GallonCount, 10);
  assert.equal(cargo.otherCargoCount, 2);
  assert.equal(cargo.has5Gallon, true);
  assert.equal(cargo.hasOtherCargo, true);
  assert.equal(cargo.hasUnknownCargo, false);
  assert.equal(cargo.isMixed, true);
  assert.equal(cargo.badgeLabel, '📦 10 × 5-gal + Other Cargo');
  assert.equal(cargo.badgeTone, 'purple');
  assert.equal(calculateOrderContainers(mixedOrder), 10);
});

test('analyzeOrderCargo flags unknown product items with warning badge', () => {
  const unknownOrder = {
    items: [
      { productNameSnapshot: 'Unclassified Water Item', quantity: 2 },
    ],
  };

  const cargo = analyzeOrderCargo(unknownOrder);
  assert.equal(cargo.hasUnknownCargo, true);
  assert.equal(cargo.badgeLabel, '⚠️ Catalog Review Required');
  assert.equal(cargo.badgeTone, 'warning');
});

test('groupOrdersIntoTrips groups orders by tripId and scheduledAt with accurate cargo breakdown', () => {
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setHours(9, 0, 0, 0);
  const time1 = tomorrow.toISOString();

  const laterTomorrow = new Date(tomorrow.getTime() + 4 * 3600000); // 1:00 PM
  const time2 = laterTomorrow.toISOString();

  const orders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: time1,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 15 }],
    },
    {
      id: 'ord-2',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: time1,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 20 }],
    },
    {
      id: 'ord-3',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: time2,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 10 }],
    },
    // Another distributor's order
    {
      id: 'ord-other',
      status: 'scheduled',
      assignedDistributorUid: 'dist-2',
      scheduledAt: time1,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }],
    },
  ];

  const trips = groupOrdersIntoTrips(orders, 'dist-1');
  assert.equal(trips.length, 2, 'Should produce exactly 2 trips for dist-1');

  // Trip 1 (09:00 AM)
  assert.equal(trips[0].tripNumber, 1);
  assert.equal(trips[0].orders.length, 2);
  assert.equal(trips[0].totalContainers, 35, '15 + 20 = 35 containers');
  assert.equal(trips[0].maxCapacity, 60);
  assert.equal(trips[0].remainingCapacity, 25, '60 - 35 = 25 remaining');
  assert.equal(trips[0].isFull, false);

  // Trip 2 (01:00 PM)
  assert.equal(trips[1].tripNumber, 2);
  assert.equal(trips[1].orders.length, 1);
  assert.equal(trips[1].totalContainers, 10);
  assert.equal(trips[1].remainingCapacity, 50);
  assert.equal(trips[1].isFull, false);
});

test('validateTripAssignment blocks assignment of unknown product size/load with 409 TRIP_LOAD_UNKNOWN', () => {
  const targetTime = new Date(Date.now() + 86400000);
  targetTime.setHours(10, 0, 0, 0);

  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders: [],
        currentOrderId: 'ord-unknown',
        targetDistributorUid: 'dist-1',
        targetScheduledAt: targetTime.toISOString(),
        orderToAssign: {
          id: 'ord-unknown',
          items: [{ productNameSnapshot: 'Mystery Item Without Size Or Container', quantity: 5 }],
        },
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.reason, 'TRIP_LOAD_UNKNOWN');
      assert.match(err.message, /unknown/i);
      return true;
    }
  );
});

test('validateTripAssignment permits co-loading into the same trip up to 60 containers', () => {
  const targetTime = new Date(Date.now() + 86400000);
  targetTime.setHours(10, 0, 0, 0);

  const activeOrders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: targetTime.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 45 }],
    },
  ];

  // Adding an order with 15 containers to the same slot (45 + 15 = 60)
  const result = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-2',
    targetDistributorUid: 'dist-1',
    targetScheduledAt: targetTime.toISOString(),
    orderToAssign: { id: 'ord-2', items: [{ productNameSnapshot: 'Purified Refill', quantity: 15 }] },
    OtpErrorClass: TestOtpError,
  });

  assert.equal(result.isNewTrip, false, 'Should be added to existing trip');
  assert.equal(result.tripContainers, 60);
  assert.equal(result.remainingCapacity, 0);
  assert.equal(result.orderContainers, 15);
});

test('validateTripAssignment rejects co-loading if adding the order exceeds 60 containers', () => {
  const targetTime = new Date(Date.now() + 86400000);
  targetTime.setHours(10, 0, 0, 0);

  const activeOrders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: targetTime.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 45 }],
    },
  ];

  // Adding 16 containers when 45 already loaded (45 + 16 = 61 > 60)
  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders,
        currentOrderId: 'ord-2',
        targetDistributorUid: 'dist-1',
        targetScheduledAt: targetTime.toISOString(),
        orderToAssign: { id: 'ord-2', items: [{ productNameSnapshot: 'Purified Refill', quantity: 16 }] },
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.reason, 'TRIP_CAPACITY_EXCEEDED');
      assert.match(err.message, /exceeded/i);
      return true;
    }
  );
});

test('validateTripAssignment permits non-5-gallon other cargo to be co-loaded without exceeding container limits', () => {
  const targetTime = new Date(Date.now() + 86400000);
  targetTime.setHours(10, 0, 0, 0);

  const activeOrders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: targetTime.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 50 }],
    },
  ];

  // Adding an order with 1-gallon bottles and 24-packs (0 5-gallon containers)
  const result = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-other-cargo',
    targetDistributorUid: 'dist-1',
    targetScheduledAt: targetTime.toISOString(),
    orderToAssign: {
      id: 'ord-other-cargo',
      items: [
        { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 },
        { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 },
      ],
    },
    OtpErrorClass: TestOtpError,
  });

  assert.equal(result.isNewTrip, false);
  assert.equal(result.orderContainers, 0);
  assert.equal(result.tripContainers, 50);
  assert.equal(result.hasOtherCargo, true);
});

test('validateTripAssignment rejects schedule conflicts within 30-minute turnaround window of another trip', () => {
  const baseTime = new Date(Date.now() + 86400000);
  baseTime.setHours(10, 0, 0, 0);

  const activeOrders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: baseTime.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 10 }],
    },
  ];

  // Schedule slot 15 minutes after baseTime (within 30 minutes)
  const conflictTime = new Date(baseTime.getTime() + 15 * 60 * 1000);

  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders,
        currentOrderId: 'ord-conflict',
        targetDistributorUid: 'dist-1',
        targetScheduledAt: conflictTime.toISOString(),
        orderToAssign: { id: 'ord-conflict', items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }] },
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
      return true;
    }
  );
});

test('validateTripAssignment permits multiple separate trips when schedules are separated by >= 30 minutes', () => {
  const baseTime = new Date(Date.now() + 86400000);
  baseTime.setHours(10, 0, 0, 0);

  const activeOrders = [
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: baseTime.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 20 }],
    },
  ];

  // Schedule slot 2 hours later (non-conflicting)
  const laterTime = new Date(baseTime.getTime() + 2 * 3600000);

  const result = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-trip-2',
    targetDistributorUid: 'dist-1',
    targetScheduledAt: laterTime.toISOString(),
    orderToAssign: { id: 'ord-trip-2', items: [{ productNameSnapshot: 'Purified Refill', quantity: 30 }] },
    OtpErrorClass: TestOtpError,
  });

  assert.equal(result.isNewTrip, true, 'Should create a new trip');
  assert.equal(result.tripNumber, 2);
  assert.equal(result.tripContainers, 30);
  assert.equal(result.remainingCapacity, 30);
});

test('validateTripAssignment permits more than 5 valid non-overlapping trips without arbitrary limits', () => {
  const tomorrow = new Date(Date.now() + 86400000);
  const activeOrders = [];

  // Create 5 existing non-conflicting trips (spaced 2 hours apart)
  for (let i = 1; i <= 5; i++) {
    const time = new Date(tomorrow.getTime() + i * 2 * 3600000);
    activeOrders.push({
      id: `ord-existing-${i}`,
      status: 'scheduled',
      assignedDistributorUid: 'dist-busy',
      scheduledAt: time.toISOString(),
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 10 }],
    });
  }

  // Attempting a 6th valid non-overlapping trip (e.g. 14 hours into tomorrow)
  const sixthTripTime = new Date(tomorrow.getTime() + 14 * 3600000);
  const sixthResult = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-sixth',
    targetDistributorUid: 'dist-busy',
    targetScheduledAt: sixthTripTime.toISOString(),
    orderToAssign: { id: 'ord-sixth', items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }] },
    OtpErrorClass: TestOtpError,
  });

  assert.equal(sixthResult.isNewTrip, true);
  assert.equal(sixthResult.tripNumber, 6);
  assert.equal(sixthResult.tripContainers, 5);

  // Attempting a 7th valid non-overlapping trip (e.g. 16 hours into tomorrow)
  activeOrders.push({
    id: 'ord-sixth',
    status: 'scheduled',
    assignedDistributorUid: 'dist-busy',
    scheduledAt: sixthTripTime.toISOString(),
    items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }],
  });
  const seventhTripTime = new Date(tomorrow.getTime() + 16 * 3600000);
  const seventhResult = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-seventh',
    targetDistributorUid: 'dist-busy',
    targetScheduledAt: seventhTripTime.toISOString(),
    orderToAssign: { id: 'ord-seventh', items: [{ productNameSnapshot: 'Purified Refill', quantity: 8 }] },
    OtpErrorClass: TestOtpError,
  });

  assert.equal(seventhResult.isNewTrip, true);
  assert.equal(seventhResult.tripNumber, 7);
  assert.equal(seventhResult.tripContainers, 8);
});

test('parseScheduleTime and formatIsoSchedule safely parse Firestore Timestamps, ISO dates, and legacy formats without throwing RangeError', () => {
  const expectedEpochSec = 1731574800; // 2024-11-14T09:00:00.000Z
  const expectedMs = expectedEpochSec * 1000;
  const expectedIso = new Date(expectedMs).toISOString();

  // 1. Client Firestore Timestamp: { seconds, nanoseconds }
  assert.equal(parseScheduleTime({ seconds: expectedEpochSec, nanoseconds: 0 }), expectedMs);
  assert.equal(formatIsoSchedule({ seconds: expectedEpochSec, nanoseconds: 0 }), expectedIso);

  // 2. Admin SDK Timestamp: { _seconds, _nanoseconds }
  assert.equal(parseScheduleTime({ _seconds: expectedEpochSec, _nanoseconds: 0 }), expectedMs);
  assert.equal(formatIsoSchedule({ _seconds: expectedEpochSec, _nanoseconds: 0 }), expectedIso);

  // 3. Object with .toDate()
  const objWithToDate = { toDate: () => new Date(expectedMs) };
  assert.equal(parseScheduleTime(objWithToDate), expectedMs);
  assert.equal(formatIsoSchedule(objWithToDate), expectedIso);

  // 4. Object with .toMillis()
  const objWithToMillis = { toMillis: () => expectedMs };
  assert.equal(parseScheduleTime(objWithToMillis), expectedMs);
  assert.equal(formatIsoSchedule(objWithToMillis), expectedIso);

  // 5. Native Date instance
  assert.equal(parseScheduleTime(new Date(expectedMs)), expectedMs);
  assert.equal(formatIsoSchedule(new Date(expectedMs)), expectedIso);

  // 6. Milliseconds number
  assert.equal(parseScheduleTime(expectedMs), expectedMs);
  assert.equal(formatIsoSchedule(expectedMs), expectedIso);

  // 7. Seconds number
  assert.equal(parseScheduleTime(expectedEpochSec), expectedMs);
  assert.equal(formatIsoSchedule(expectedEpochSec), expectedIso);

  // 8. ISO-8601 string
  assert.equal(parseScheduleTime(expectedIso), expectedMs);
  assert.equal(formatIsoSchedule(expectedIso), expectedIso);

  // 9. Edge cases that must return null without throwing RangeError
  assert.equal(parseScheduleTime(null), null);
  assert.equal(formatIsoSchedule(null), null);
  assert.equal(parseScheduleTime(undefined), null);
  assert.equal(formatIsoSchedule(undefined), null);
  assert.equal(parseScheduleTime(''), null);
  assert.equal(formatIsoSchedule(''), null);
  assert.equal(parseScheduleTime('Invalid Date'), null);
  assert.equal(formatIsoSchedule('Invalid Date'), null);
  assert.equal(parseScheduleTime('null'), null);
  assert.equal(formatIsoSchedule('null'), null);
  assert.equal(parseScheduleTime({}), null);
  assert.equal(formatIsoSchedule({}), null);
  assert.equal(parseScheduleTime(new Date('invalid')), null);
  assert.equal(formatIsoSchedule(new Date('invalid')), null);
});

test('groupOrdersIntoTrips handles Firestore Timestamps, missing schedules, and legacy records without throwing RangeError', () => {
  const ts1 = { seconds: 1731574800, nanoseconds: 0 };
  const ts2 = { _seconds: 1731574800, _nanoseconds: 0 };
  const expectedIso = new Date(1731574800000).toISOString();

  const orders = [
    // Order with client Firestore Timestamp
    {
      id: 'ord-client-ts',
      status: 'scheduled',
      assignedDistributorUid: 'dist-test',
      scheduledAt: ts1,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 10 }],
    },
    // Order with Admin SDK Timestamp (co-loaded at same timestamp)
    {
      id: 'ord-admin-ts',
      status: 'scheduled',
      assignedDistributorUid: 'dist-test',
      scheduledAt: ts2,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 15 }],
    },
    // Order with missing schedule (unscheduled order awaiting assignment)
    {
      id: 'ord-unscheduled',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-test',
      scheduledAt: null,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }],
    },
    // Order with invalid schedule string
    {
      id: 'ord-invalid-date',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-test',
      scheduledAt: 'Invalid Date',
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }],
    },
  ];

  // Must not throw RangeError: Invalid time value
  const trips = groupOrdersIntoTrips(orders, 'dist-test');
  assert.ok(Array.isArray(trips));
  assert.equal(trips.length, 3, 'Should have 1 scheduled trip and 2 separate unscheduled trips');

  // Verify scheduled trip produced valid ISO string
  const scheduledTrip = trips.find((t) => t.orders.some((o) => o.id === 'ord-client-ts'));
  assert.ok(scheduledTrip);
  assert.equal(scheduledTrip.scheduledAt, expectedIso);
  assert.equal(scheduledTrip.orders.length, 2, 'Both orders with same timestamp co-loaded');
  assert.equal(scheduledTrip.totalContainers, 25);

  // Verify unscheduled trips have null scheduledAt and null time (no invented schedule)
  const unscheduledTrip1 = trips.find((t) => t.orders.some((o) => o.id === 'ord-unscheduled'));
  assert.ok(unscheduledTrip1);
  assert.equal(unscheduledTrip1.scheduledAt, null);
  assert.equal(unscheduledTrip1.time, null);

  const unscheduledTrip2 = trips.find((t) => t.orders.some((o) => o.id === 'ord-invalid-date'));
  assert.ok(unscheduledTrip2);
  assert.equal(unscheduledTrip2.scheduledAt, null);
  assert.equal(unscheduledTrip2.time, null);
});

test('validateTripAssignment supports Firestore Timestamps for targetScheduledAt and prevents false turnaround conflicts with unscheduled orders', () => {
  const targetSec = Math.floor(Date.now() / 1000) + 86400; // tomorrow
  const targetTs = { seconds: targetSec, nanoseconds: 0 };

  const activeOrders = [
    // Unscheduled active order
    {
      id: 'ord-unscheduled-1',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-1',
      scheduledAt: null,
      items: [{ productNameSnapshot: 'Purified Refill', quantity: 10 }],
    },
  ];

  const result = validateTripAssignment({
    activeOrders,
    currentOrderId: 'ord-new',
    targetDistributorUid: 'dist-1',
    targetScheduledAt: targetTs,
    orderToAssign: { id: 'ord-new', items: [{ productNameSnapshot: 'Purified Refill', quantity: 20 }] },
    OtpErrorClass: TestOtpError,
  });

  assert.ok(result);
  assert.equal(result.isNewTrip, true);
  assert.equal(result.tripContainers, 20);
});

test('validateTripAssignment rejects invalid or past schedule with 400 INVALID_DELIVERY_SCHEDULE', () => {
  // 1. Missing targetScheduledAt
  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders: [],
        currentOrderId: 'ord-test',
        targetDistributorUid: 'dist-1',
        targetScheduledAt: null,
        orderToAssign: { id: 'ord-test', items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }] },
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.reason, 'INVALID_DELIVERY_SCHEDULE');
      return true;
    }
  );

  // 2. Schedule in the past (> 5 minutes ago)
  const pastTime = new Date(Date.now() - 3600000).toISOString();
  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders: [],
        currentOrderId: 'ord-test',
        targetDistributorUid: 'dist-1',
        targetScheduledAt: pastTime,
        orderToAssign: { id: 'ord-test', items: [{ productNameSnapshot: 'Purified Refill', quantity: 5 }] },
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.reason, 'INVALID_DELIVERY_SCHEDULE');
      return true;
    }
  );
});

test('describeOrderCargo produces accurate human-readable cargo breakdown for various order types', () => {
  // Pure 5-gal order
  const pure = describeOrderCargo({
    items: [{ productNameSnapshot: 'Purified 5-Gallon Refill', quantity: 8 }],
  });
  assert.equal(pure.summary, '8 × 5-gal');
  assert.equal(pure.standard5GallonCount, 8);
  assert.equal(pure.otherCargoCount, 0);
  assert.equal(pure.isPure5Gallon, true);

  // Other cargo only
  const other = describeOrderCargo({
    items: [
      { productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 },
      { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 },
    ],
  });
  assert.equal(other.summary, '2 × BlueTap 1-Gallon Purified Water, 1 × BlueTap Bottled Water — 24 Pack');
  assert.equal(other.standard5GallonCount, 0);
  assert.equal(other.otherCargoCount, 3);
  assert.equal(other.isOnlyOther, true);

  // Mixed order
  const mixed = describeOrderCargo({
    items: [
      { productNameSnapshot: 'Purified 5-Gallon Refill', quantity: 15 },
      { productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 2 },
    ],
  });
  assert.equal(mixed.summary, '15 × 5-gal + 2 × BlueTap Bottled Water — 24 Pack');
  assert.equal(mixed.standard5GallonCount, 15);
  assert.equal(mixed.otherCargoCount, 2);
  assert.equal(mixed.isMixed, true);

  // Unknown cargo
  const unknown = describeOrderCargo({
    items: [{ productNameSnapshot: 'Unknown Mystery Container', quantity: 1 }],
  });
  assert.ok(unknown.summary.includes('Needs Review'));
  assert.equal(unknown.hasUnknownCargo, true);
});

test('getDistributorWorkloadSummary computes accurate workload, trips, cargo totals, and flags', () => {
  // 1. Empty active orders
  const empty = getDistributorWorkloadSummary({ activeOrders: [], distributorUid: 'dist-1' });
  assert.equal(empty.totalActiveOrders, 0);
  assert.equal(empty.activeTripsCount, 0);
  assert.equal(empty.isAtMaxTrips, false);
  assert.equal(empty.total5GallonContainers, 0);
  assert.equal(empty.totalOtherCargoCount, 0);
  assert.equal(empty.hasUnscheduledOrders, false);

  // 2. Active orders with multiple trips and mixed cargo
  const baseTime = Date.now() + 3600000;
  const orders = [
    // Trip 1
    {
      id: 'ord-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: new Date(baseTime).toISOString(),
      items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 10 }],
    },
    {
      id: 'ord-2',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: new Date(baseTime).toISOString(),
      items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 }],
    },
    // Trip 2 (scheduled 1 hour later)
    {
      id: 'ord-3',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: new Date(baseTime + 3600000).toISOString(),
      items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 25 }],
    },
    // Unscheduled order
    {
      id: 'ord-4',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-1',
      scheduledAt: null,
      items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 5 }],
    },
  ];

  const summary = getDistributorWorkloadSummary({ activeOrders: orders, distributorUid: 'dist-1' });
  assert.equal(summary.totalActiveOrders, 4);
  assert.equal(summary.activeTripsCount, 3); // 2 scheduled trips + 1 unscheduled group
  assert.equal(summary.total5GallonContainers, 40); // 10 + 25 + 5
  assert.equal(summary.totalOtherCargoCount, 2); // 2
  assert.equal(summary.hasUnscheduledOrders, true);
  assert.equal(summary.unscheduledOrdersCount, 1);
  assert.equal(summary.isAtMaxTrips, false);

  // 3. Distributor workload summary accurately tracks 5 or more trips without arbitrary caps
  const manyOrders = Array.from({ length: 7 }, (_, i) => ({
    id: `ord-trip-${i}`,
    status: 'scheduled',
    assignedDistributorUid: 'dist-1',
    scheduledAt: new Date(baseTime + (i + 1) * 2 * 3600000).toISOString(),
    items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 5 }],
  }));
  const manySummary = getDistributorWorkloadSummary({ activeOrders: manyOrders, distributorUid: 'dist-1' });
  assert.equal(manySummary.activeTripsCount, 7);
  assert.equal(manySummary.isAtMaxTrips, false);
});

test('getSlotCapacityInfo accurately evaluates co-loading, turnaround conflicts, and capacity limits', () => {
  const baseTime = Date.now() + 7200000; // 2 hours in future
  const existingOrders = [
    {
      id: 'ord-existing-1',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: new Date(baseTime).toISOString(),
      items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 20 }],
    },
    {
      id: 'ord-existing-2',
      status: 'scheduled',
      assignedDistributorUid: 'dist-1',
      scheduledAt: new Date(baseTime + 3600000).toISOString(), // 1 hour after baseTime
      items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 55 }],
    },
  ];
  const trips = groupOrdersIntoTrips(existingOrders, 'dist-1');

  // Case 1: Co-loading available in Trip #1 (20 used + 15 new = 35 <= 60)
  const orderCoLoad = {
    id: 'ord-new',
    items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 15 }],
  };
  const slot1 = getSlotCapacityInfo({ trips, slotTime: baseTime, currentOrder: orderCoLoad });
  assert.equal(slot1.isExistingTrip, true);
  assert.equal(slot1.tripNumber, 1);
  assert.equal(slot1.usedContainers, 20);
  assert.equal(slot1.projectedContainers, 35);
  assert.equal(slot1.remainingAfter, 25);
  assert.equal(slot1.isOverCapacity, false);
  assert.equal(slot1.isEligible, true);
  assert.equal(slot1.statusLabel, 'Co-Load Available');
  assert.equal(slot1.statusTone, 'purple');
  assert.equal(slot1.assignedOrders.length, 1);

  // Case 2: Co-loading exceeds capacity in Trip #2 (55 used + 10 new = 65 > 60)
  const orderTooBig = {
    id: 'ord-big',
    items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 10 }],
  };
  const slot2 = getSlotCapacityInfo({ trips, slotTime: baseTime + 3600000, currentOrder: orderTooBig });
  assert.equal(slot2.isExistingTrip, true);
  assert.equal(slot2.usedContainers, 55);
  assert.equal(slot2.projectedContainers, 65);
  assert.equal(slot2.isOverCapacity, true);
  assert.equal(slot2.isEligible, false);
  assert.equal(slot2.statusLabel, 'Trip Full');
  assert.equal(slot2.statusTone, 'danger');

  // Case 3: Turnaround conflict (slot 15 minutes after Trip #1)
  const slotConflict = getSlotCapacityInfo({ trips, slotTime: baseTime + 15 * 60 * 1000, currentOrder: orderCoLoad });
  assert.equal(slotConflict.isExistingTrip, false);
  assert.equal(slotConflict.hasTurnaroundConflict, true);
  assert.equal(slotConflict.isEligible, false);
  assert.equal(slotConflict.statusLabel, 'Conflict');
  assert.equal(slotConflict.statusTone, 'orange');

  // Case 4: Past time slot (2 hours ago)
  const pastTime = Date.now() - 7200000;
  const slotPast = getSlotCapacityInfo({ trips, slotTime: pastTime, currentOrder: orderCoLoad });
  assert.equal(slotPast.isPastTime, true);
  assert.equal(slotPast.isEligible, false);
  assert.equal(slotPast.statusLabel, 'Passed');
  assert.equal(slotPast.statusTone, 'muted');

  // Case 5: Available new trip (slot 2.5 hours after baseTime)
  const slotNew = getSlotCapacityInfo({ trips, slotTime: baseTime + 2.5 * 3600000, currentOrder: orderCoLoad });
  assert.equal(slotNew.isExistingTrip, false);
  assert.equal(slotNew.hasTurnaroundConflict, false);
  assert.equal(slotNew.isPastTime, false);
  assert.equal(slotNew.isEligible, true);
  assert.equal(slotNew.statusLabel, 'New Trip');
  assert.equal(slotNew.statusTone, 'blue');
});

test('isTripOverlapping and schedule conflict detection catch overlapping delivery windows even when start times differ by 30-35 minutes', () => {
  const baseTime = Date.now() + 86400000; // Tomorrow
  const baseDate = new Date(baseTime);
  baseDate.setHours(10, 0, 0, 0);
  const time1000 = baseDate.getTime();
  const time1035 = time1000 + 35 * 60 * 1000; // 35 minutes later (start times differ by 35 min > 30 min)
  const time1100 = time1000 + 60 * 60 * 1000; // 60 minutes later (Trip 1 is complete + turnaround buffer)

  const existingTrip = {
    tripId: 'trip-1',
    tripNumber: 1,
    time: time1000,
    scheduledAt: new Date(time1000).toISOString(),
    totalContainers: 20,
    orders: [
      {
        id: 'ord-1',
        scheduledAt: new Date(time1000).toISOString(),
        orderContainers: 20,
      },
    ],
  };

  const newOrder = {
    id: 'ord-new',
    items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 10 }],
  };

  // 1. Verify that 10:35 AM is detected as overlapping with 10:00 AM trip (which runs 10:00 - 11:00 AM)
  assert.equal(
    isTripOverlapping(existingTrip, time1035, newOrder),
    true,
    'A 35-minute start time difference must not be treated as non-overlapping when the trip is still ongoing'
  );

  // 2. validateTripAssignment must block 10:35 AM assignment with DISTRIBUTOR_SCHEDULE_CONFLICT
  assert.throws(
    () => {
      validateTripAssignment({
        activeOrders: [
          {
            id: 'ord-1',
            status: 'scheduled',
            assignedDistributorUid: 'dist-overlap-test',
            scheduledAt: new Date(time1000).toISOString(),
            items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 20 }],
          },
        ],
        currentOrderId: 'ord-new',
        targetDistributorUid: 'dist-overlap-test',
        targetScheduledAt: new Date(time1035).toISOString(),
        orderToAssign: newOrder,
        OtpErrorClass: TestOtpError,
      });
    },
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.reason, 'DISTRIBUTOR_SCHEDULE_CONFLICT');
      return true;
    }
  );

  // 3. Verify that 11:00 AM does NOT overlap and is accepted
  assert.equal(
    isTripOverlapping(existingTrip, time1100, newOrder),
    false,
    'A non-overlapping schedule after completion and turnaround buffer must be allowed'
  );

  const validResult = validateTripAssignment({
    activeOrders: [
      {
        id: 'ord-1',
        status: 'scheduled',
        assignedDistributorUid: 'dist-overlap-test',
        scheduledAt: new Date(time1000).toISOString(),
        items: [{ productNameSnapshot: '5-Gallon Refill', quantity: 20 }],
      },
    ],
    currentOrderId: 'ord-new',
    targetDistributorUid: 'dist-overlap-test',
    targetScheduledAt: new Date(time1100).toISOString(),
    orderToAssign: newOrder,
    OtpErrorClass: TestOtpError,
  });

  assert.equal(validResult.isNewTrip, true);
  assert.equal(validResult.tripNumber, 2);
});

test('Exact user reported scenario: Distributor demo distributor test with 4 orders, 2 trips, 0 5-gal, 6 other cargo items', () => {
  // Day 1: Nov 14 at 09:00 AM Manila time (future date)
  const day1 = new Date('2027-11-14T09:00:00+08:00');
  // Day 2: Nov 15 at 09:00 AM Manila time (future date)
  const day2 = new Date('2027-11-15T09:00:00+08:00');

  const orders = [
    // Trip #1 on Day 1 (2 orders, 3 other-cargo items total)
    {
      id: 'ord-trip1-a',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo',
      scheduledAt: day1.toISOString(),
      items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 }],
    },
    {
      id: 'ord-trip1-b',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo',
      scheduledAt: day1.toISOString(),
      items: [{ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 1 }],
    },
    // Trip #2 on Day 2 (2 orders, 3 other-cargo items total)
    {
      id: 'ord-trip2-a',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo',
      scheduledAt: day2.toISOString(),
      items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 1 }],
    },
    {
      id: 'ord-trip2-b',
      status: 'scheduled',
      assignedDistributorUid: 'dist-demo',
      scheduledAt: day2.toISOString(),
      items: [{ productNameSnapshot: 'BlueTap Bottled Water — 24 Pack', quantity: 2 }],
    },
  ];

  // 1. Workload Summary
  const workload = getDistributorWorkloadSummary({
    activeOrders: orders,
    distributorUid: 'dist-demo',
  });

  assert.equal(workload.totalActiveOrders, 4, 'Must have 4 active orders');
  assert.equal(workload.activeTripsCount, 2, 'Must have 2 active trips');
  assert.equal(workload.total5GallonContainers, 0, 'Must have 0 standard 5-gallon containers');
  assert.equal(workload.totalOtherCargoCount, 6, 'Must have 6 total other cargo items');

  const trip1 = workload.activeTrips[0];
  const trip2 = workload.activeTrips[1];

  // Trip #1 checks
  assert.equal(trip1.tripNumber, 1);
  assert.equal(trip1.orders.length, 2);
  assert.equal(trip1.totalContainers, 0);
  assert.equal(trip1.otherCargoCount, 3);
  assert.ok(trip1.fullScheduleLabel.includes('09:00'), 'Trip #1 must include time 09:00');
  assert.equal(trip1.hasUnverifiedPhysicalLoad, false, 'Ordinary other cargo must not flag unverified physical load');

  // Trip #2 checks
  assert.equal(trip2.tripNumber, 2);
  assert.equal(trip2.orders.length, 2);
  assert.equal(trip2.totalContainers, 0);
  assert.equal(trip2.otherCargoCount, 3);
  assert.ok(trip2.fullScheduleLabel.includes('09:00'), 'Trip #2 must include time 09:00');
  assert.notEqual(trip1.fullScheduleLabel, trip2.fullScheduleLabel, 'Trip #1 and Trip #2 occurring on different dates must have distinct fullScheduleLabels');
  assert.equal(trip2.hasUnverifiedPhysicalLoad, false, 'Ordinary other cargo must not flag unverified physical load');

  // 2. Slot Capacity Info for Trip #2 slot
  const candidateOrder = {
    id: 'ord-candidate',
    items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 1 }],
  };

  const slotInfo = getSlotCapacityInfo({
    trips: workload.activeTrips,
    slotTime: day2.getTime(),
    currentOrder: candidateOrder,
  });

  assert.equal(slotInfo.isExistingTrip, true);
  assert.equal(slotInfo.tripNumber, 2);
  assert.equal(slotInfo.usedContainers, 0);
  assert.equal(slotInfo.hasOtherCargo, true);
  assert.equal(slotInfo.hasUnverifiedPhysicalLoad, false);
  assert.equal(slotInfo.isEligible, true, 'Non-5-gallon items within schedule and 60 5-gal max are eligible for co-loading');
  assert.equal(slotInfo.statusLabel, 'Co-Load Available');
  assert.equal(slotInfo.statusTone, 'purple');
  assert.match(slotInfo.explanation, /Eligible for Co-Loading/i);
});

test('Capacity and load verification distinguishing pure 5-gallon, other cargo, and unknown products', () => {
  // 1. Pure 5-gallon order
  const pureOrder = {
    id: 'ord-pure',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 25 }],
  };
  const pureCargo = analyzeOrderCargo(pureOrder);
  assert.equal(pureCargo.isPure5Gallon, true);
  assert.equal(pureCargo.hasOtherCargo, false);
  assert.equal(pureCargo.isPhysicalLoadVerified, true, 'Pure 5-gallon load is verified by standard 60-container rule');
  assert.equal(pureCargo.hasUnverifiedPhysicalLoad, false);
  assert.equal(pureCargo.hasUnknownCargo, false);

  // 2. Known other cargo order (e.g. 1-Gallon water) - does NOT block dispatch
  const otherOrder = {
    id: 'ord-other',
    items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 4 }],
  };
  const otherCargo = analyzeOrderCargo(otherOrder);
  assert.equal(otherCargo.isOnlyOther, true);
  assert.equal(otherCargo.hasOtherCargo, true);
  assert.equal(otherCargo.hasUnknownCargo, false);
  assert.equal(otherCargo.isPhysicalLoadVerified, true, 'Known non-5-gallon items are recognized and assignable');
  assert.equal(otherCargo.hasUnverifiedPhysicalLoad, false);

  // 3. Unknown product without catalog specifications - requires review
  const unknownOrder = {
    id: 'ord-unknown',
    items: [{ productNameSnapshot: 'Unknown Mystery Product', quantity: 2 }],
  };
  const unknownCargo = analyzeOrderCargo(unknownOrder);
  assert.equal(unknownCargo.hasUnknownCargo, true);
  assert.equal(unknownCargo.isPhysicalLoadVerified, false, 'Unknown items require catalog review');
  assert.equal(unknownCargo.badgeLabel, '⚠️ Catalog Review Required');
});

test('aggregateCargoItems combines duplicate line items and formats counts accurately', () => {
  const items = [
    '1 × BlueTap 1-Gallon Purified Water',
    '1 × BlueTap 1-Gallon Purified Water',
    '3 × 500ml Bottled Water',
  ];
  const aggregated = aggregateCargoItems(items);
  assert.equal(aggregated, '2 × BlueTap 1-Gallon Purified Water, 3 × 500ml Bottled Water');

  // Single item
  assert.equal(aggregateCargoItems(['1 × Water Dispenser']), '1 × Water Dispenser');

  // Empty or invalid input
  assert.equal(aggregateCargoItems([]), '');
  assert.equal(aggregateCargoItems(null), '');
});

test('Empty time slots reflect slot schedule availability and do NOT inherit unverified load from candidate cargo', () => {
  const futureSlotTime = Date.now() + 7200000; // 2 hours from now
  const existingTrips = []; // No existing trips in this slot

  // Candidate order has unverified non-5-gallon cargo
  const candidateOrder = {
    id: 'ord-unverified-candidate',
    items: [{ productNameSnapshot: 'BlueTap 1-Gallon Purified Water', quantity: 2 }],
  };

  const slotInfo = getSlotCapacityInfo({
    trips: existingTrips,
    slotTime: futureSlotTime,
    currentOrder: candidateOrder,
  });

  // Slot itself is an empty slot available for a new trip
  assert.equal(slotInfo.isExistingTrip, false);
  assert.equal(slotInfo.hasUnverifiedPhysicalLoad, false, 'Empty slot must not flag unverified physical load of an existing trip');
  assert.equal(slotInfo.statusLabel, 'New Trip', 'Slot status label must be "New Trip", not "Load Unverified"');
  assert.equal(slotInfo.statusTone, 'blue');
  assert.equal(slotInfo.isEligible, true);
  assert.equal(slotInfo.hasTurnaroundConflict, false);
  assert.equal(slotInfo.isPastTime, false);
});

test('Overdue active trips are detected and flagged with overdue status without dropping reservations', () => {
  // Trip from past (e.g. 2 days ago)
  const pastTime = new Date(Date.now() - 172800000).toISOString();
  const pastOrders = [
    {
      id: 'ord-past-active',
      status: 'distributor_assigned',
      assignedDistributorUid: 'dist-overdue',
      scheduledAt: pastTime,
      items: [{ productNameSnapshot: 'Purified Water Refill', quantity: 15 }],
    },
  ];

  const trips = groupOrdersIntoTrips(pastOrders, 'dist-overdue');
  assert.equal(trips.length, 1);
  const overdueTrip = trips[0];

  assert.equal(overdueTrip.isOverdue, true, 'Trip scheduled in the past with active order must be flagged isOverdue');
  assert.equal(overdueTrip.statusLabel, 'Overdue Scheduled');
  assert.ok(overdueTrip.fullScheduleLabel.includes('(Overdue)'));

  // Workload summary must reflect overdue trip
  const workload = getDistributorWorkloadSummary({
    activeOrders: pastOrders,
    distributorUid: 'dist-overdue',
  });
  assert.equal(workload.hasOverdueTrips, true);
  assert.equal(workload.overdueTripsCount, 1);
  assert.equal(workload.activeTripsCount, 1, 'Overdue trip must remain counted in active trips');
});

test('Pure 5-gallon candidate order is assignable into empty slots without unverified load blocks', () => {
  const futureSlotTime = Date.now() + 7200000;
  const candidatePure5Gal = {
    id: 'ord-pure-5gal',
    items: [{ productNameSnapshot: '5-Gallon Water Refill', quantity: 10 }],
  };

  const pureCargo = analyzeOrderCargo(candidatePure5Gal);
  assert.equal(pureCargo.isPure5Gallon, true);
  assert.equal(pureCargo.isPhysicalLoadVerified, true);
  assert.equal(pureCargo.hasUnverifiedPhysicalLoad, false);

  const slotInfo = getSlotCapacityInfo({
    trips: [],
    slotTime: futureSlotTime,
    currentOrder: candidatePure5Gal,
  });

  assert.equal(slotInfo.isExistingTrip, false);
  assert.equal(slotInfo.hasUnverifiedPhysicalLoad, false);
  assert.equal(slotInfo.isEligible, true);
  assert.equal(slotInfo.isOverCapacity, false);
});
