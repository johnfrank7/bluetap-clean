const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerFailedDeliveryResolutionFlow, getEligibleResolutionTrips, buildScheduleDateForSlot, TIME_SLOT_OPTIONS } = require('../../../services/managerFailedDeliveryResolution');

const order = { id: 'failed', status: 'delivery_failed', branchId: 'branch', assignedDistributorUid: 'driver' };
const distributors = [{ uid: 'other', role: 'distributor', distributorStatus: 'active', branchId: 'branch' }];
function options() {
  const stop = buildScheduleDateForSlot(1, TIME_SLOT_OPTIONS[0]).getTime();
  return { eligibleDistributorUids: ['driver', 'other'], trips: ['driver', 'other'].map((uid) => ({ tripId: `trip-${uid}`, distributorUid: uid, state: 'planning', verified: true, standardContainers: 45, plannedResourceId: 'resource', plannedDeparture: new Date(stop - 3600000).toISOString(), estimatedReturn: new Date(stop + 3600000).toISOString() })) };
}
function setup(dispatchOrder = async () => ({})) {
  const flow = createManagerFailedDeliveryResolutionFlow({ dispatchOrder, getTripPreparation: async () => options() }, () => 'stable-request-id');
  flow.setScope('manager:branch', 'branch');
  return flow;
}
async function open(flow, mode) {
  flow.open(order, mode, distributors, 'trip');
  await new Promise((resolve) => setImmediate(resolve));
  flow.setDayOffset(1); flow.setSlotIndex(0); flow.setReason('Customer requested a new time');
}

for (const mode of ['reschedule', 'reassign']) test(`trip ${mode} requires explicit eligible selection and sends it`, async () => {
  let sent;
  const flow = setup(async (id, action, payload) => { sent = { id, action, payload }; return {}; });
  await open(flow, mode);
  assert.equal(flow.requestConfirmation(), false);
  const target = `trip-${mode === 'reschedule' ? 'driver' : 'other'}`;
  assert.deepEqual(getEligibleResolutionTrips(flow.getState()).map((trip) => trip.tripId), [target]);
  flow.setTripId('invalid'); assert.equal(flow.getState().selectedTripId, '');
  flow.setTripId(target); assert.equal(flow.requestConfirmation(), true);
  assert.equal((await flow.submit()).ok, true);
  assert.equal(sent.payload.tripId, target);
  assert.equal(sent.action, mode === 'reschedule' ? 'reschedule-delivery' : 'reassign-distributor');
});

test('changing schedule invalidates selection and a backend conflict retains the draft', async () => {
  const flow = setup(async () => { const error = new Error('Trip is full or stale'); error.code = 'TRIP_CAPACITY_EXCEEDED'; throw error; });
  await open(flow, 'reschedule'); flow.setTripId('trip-driver'); flow.setSlotIndex(1);
  assert.equal(flow.getState().selectedTripId, ''); assert.equal(flow.requestConfirmation(), false);
  flow.setSlotIndex(0); flow.setTripId('trip-driver'); flow.requestConfirmation();
  assert.equal((await flow.submit()).ok, false);
  assert.equal(flow.getState().error, 'Trip is full or stale');
  assert.equal(flow.getState().selectedTripId, 'trip-driver');
  assert.equal(flow.getState().reason, 'Customer requested a new time');
});

test('unverified, unscheduled and ineligible trip choices fail closed', async () => {
  const data = options(); data.trips[0].verified = false; data.eligibleDistributorUids = ['driver'];
  const flow = createManagerFailedDeliveryResolutionFlow({ getTripPreparation: async () => data });
  flow.setScope('manager:branch', 'branch'); await open(flow, 'reschedule');
  assert.deepEqual(getEligibleResolutionTrips(flow.getState()), []);
  flow.setTripId('trip-driver'); assert.equal(flow.requestConfirmation(), false);
});

test('a delayed trip read cannot reopen or authorize a closed dialog', async () => {
  let finish;
  const flow = createManagerFailedDeliveryResolutionFlow({ getTripPreparation: () => new Promise((resolve) => { finish = resolve; }) });
  flow.setScope('manager:branch', 'branch'); flow.open(order, 'reschedule', distributors, 'trip');
  assert.equal(flow.getState().tripOptionsStatus, 'loading');
  flow.close(); finish(options()); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(flow.getState().visible, false);
  assert.deepEqual(flow.getState().tripOptions, []);
});

test('default mode does not require or submit a trip', async () => {
  let sent;
  const flow = setup(async (id, action, payload) => { sent = payload; return {}; });
  flow.open(order, 'reschedule', distributors); flow.setDayOffset(1); flow.setSlotIndex(0); flow.setReason('Coordinate with customer');
  assert.equal(flow.requestConfirmation(), true); assert.equal((await flow.submit()).ok, true);
  assert.equal(Object.hasOwn(sent, 'tripId'), false);
});
