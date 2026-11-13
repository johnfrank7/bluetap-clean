const {
  effectiveDeliveryDays,
  isAllowedDeliveryDate,
  manilaScheduleDate,
} = require('./productOrderPolicy');

const TIME_SLOT_OPTIONS = [
  { label: 'Morning (8:00 AM)', hour: 8, minute: 0 },
  { label: 'Midday (11:00 AM)', hour: 11, minute: 0 },
  { label: 'Afternoon (2:00 PM)', hour: 14, minute: 0 },
  { label: 'Late Afternoon (5:00 PM)', hour: 17, minute: 0 },
];

const clean = (value, max = 240) => String(value || '').trim().slice(0, max);
const statusOf = (value) => clean(value, 80).toLowerCase().replace(/[\s-]+/g, '_');

function normalizeRescheduleReason(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, 240)
    : '';
}

function isValidRescheduleReason(value) {
  const normalized = normalizeRescheduleReason(value);
  const length = Array.from(normalized).length;
  return length >= 3 && length <= 240 && /[\p{L}\p{N}]/u.test(normalized);
}

function buildScheduleDateForSlot(dayOffset, slot) {
  const safeSlot = slot || TIME_SLOT_OPTIONS[0];
  return manilaScheduleDate(dayOffset, safeSlot.hour, safeSlot.minute || 0);
}

function formatManilaDate(date) {
  return date.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' });
}

function formatManilaTime(date) {
  return date.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
}

function allowedDayOffsetsForOrder(order = {}, horizonDays = 21) {
  const allowedDays = Array.isArray(order?.effectiveDeliveryDaysSnapshot)
    ? order.effectiveDeliveryDaysSnapshot
    : effectiveDeliveryDays(order?.items || []);
  return Array.from({ length: horizonDays }, (_, index) => index).filter((index) =>
    isAllowedDeliveryDate(buildScheduleDateForSlot(index, TIME_SLOT_OPTIONS[0]), allowedDays)
  );
}

function defaultFutureScheduleSelection(order = {}, now = new Date()) {
  const offsets = allowedDayOffsetsForOrder(order);
  const cutoff = (now instanceof Date ? now.getTime() : Date.now()) - 5 * 60 * 1000;
  for (const offset of offsets) {
    for (let slotIndex = 0; slotIndex < TIME_SLOT_OPTIONS.length; slotIndex += 1) {
      const candidate = buildScheduleDateForSlot(offset, TIME_SLOT_OPTIONS[slotIndex]);
      if (candidate.getTime() >= cutoff) {
        return { dayOffset: offset, slotIndex };
      }
    }
  }
  return { dayOffset: offsets[0] ?? 0, slotIndex: 0 };
}

function canManagerResolveFailedOrder(order = {}, branchId = '') {
  if (!order || typeof order !== 'object') return false;
  const orderBranchId = clean(order.currentBranchId || order.branchId, 128);
  const assignedUid = clean(order.assignedDistributorUid || order.distributor_id, 128);
  if (branchId && orderBranchId !== clean(branchId, 128)) return false;
  return statusOf(order.status) === 'delivery_failed' && Boolean(assignedUid);
}

function getEligibleBranchDistributors(distributors = [], branchId = '', currentDistributorUid = '', mode = 'reassign') {
  const targetBranch = clean(branchId, 128);
  const currentUid = clean(currentDistributorUid, 128);
  return (Array.isArray(distributors) ? distributors : [])
    .map((entry) => {
      const uid = clean(entry?.uid || entry?.id, 128);
      const name = clean(entry?.name || entry?.fullName || `${entry?.firstName || ''} ${entry?.lastName || ''}`, 160);
      const entryBranchId = clean(entry?.branchId, 128);
      const uniqueId = clean(entry?.uniqueId || entry?.publicUid || entry?.displayUid, 80);
      const role = clean(entry?.role, 40).toLowerCase();
      const rawStatus = clean(entry?.distributorStatus || entry?.approvalStatus || entry?.status, 40).toLowerCase();
      const accountStatus = clean(entry?.accountStatus, 40).toLowerCase();
      const legacyStatus = clean(entry?.status, 40).toLowerCase();
      const eligibleStatus = role === 'distributor' && ['active', 'approved'].includes(rawStatus)
        && (!accountStatus || accountStatus === 'active')
        && !['inactive', 'disabled', 'suspended', 'terminated'].includes(legacyStatus)
        && entry?.mustChangePassword !== true;
      return {
        uid,
        name: name || 'Distributor',
        branchId: entryBranchId,
        role,
        distributorStatus: rawStatus,
        accountStatus,
        uniqueId: uniqueId && !/^[a-zA-Z0-9]{20,}$/.test(uniqueId) ? uniqueId : '',
        eligibleStatus,
      };
    })
    .filter((entry) => {
      if (!entry.uid || !entry.eligibleStatus) return false;
      if (!targetBranch || entry.branchId !== targetBranch) return false;
      if (mode === 'reassign' && currentUid && entry.uid === currentUid) return false;
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

const emptyState = () => ({
  scope: '',
  branchId: '',
  visible: false,
  mode: 'reschedule',
  order: null,
  distributors: [],
  selectedDistributorUid: '',
  selectedDayOffset: 0,
  selectedSlotIndex: 0,
  reason: '',
  confirming: false,
  submitting: false,
  error: '',
  success: '',
  pendingPayload: null,
  tripMode: 'default',
  tripOptions: [],
  eligibleTripDistributors: [],
  selectedTripId: '',
  tripOptionsStatus: 'idle',
});

// These are advisory choices. The dispatch transaction rechecks all trip,
// cargo, resource and account invariants before committing the resolution.
function getEligibleResolutionTrips(state) {
  if (state.tripMode !== 'trip' || state.tripOptionsStatus !== 'ready') return [];
  const uid = state.selectedDistributorUid;
  if (!state.eligibleTripDistributors.includes(uid)) return [];
  const slot = TIME_SLOT_OPTIONS[state.selectedSlotIndex];
  const stop = slot && buildScheduleDateForSlot(state.selectedDayOffset, slot)?.getTime();
  if (!Number.isFinite(stop)) return [];
  return state.tripOptions.filter((trip) => {
    const start = Date.parse(trip.plannedDeparture);
    const end = Date.parse(trip.estimatedReturn);
    return trip.verified === true && trip.distributorUid === uid && ['planning', 'approved'].includes(trip.state) &&
      typeof trip.tripId === 'string' && trip.tripId.length > 0 && !trip.tripId.includes('/') &&
      Number.isFinite(start) && Number.isFinite(end) && start < end && stop >= start && stop <= end && Boolean(trip.plannedResourceId);
  });
}

function createManagerFailedDeliveryResolutionFlow(api = {}, createMutationId = () => `mgr_res_${Date.now()}`) {
  let state = emptyState();
  let generation = 0;
  let submitLocked = false;
  let tripReadGeneration = 0;
  const listeners = new Set();
  const getNow = typeof api.getNow === 'function' ? api.getNow : () => new Date();

  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };

  function validateCurrentDraft() {
    const order = state.order;
    if (!order || !canManagerResolveFailedOrder(order, state.branchId)) {
      return { ok: false, error: 'Only failed deliveries belonging to your branch can be resolved here.' };
    }
    const allowedOffsets = allowedDayOffsetsForOrder(order);
    if (!allowedOffsets.includes(state.selectedDayOffset)) {
      return {
        ok: false,
        error: allowedOffsets.length
          ? 'Choose a delivery day allowed for every product in this order.'
          : 'These products have no common delivery day. Ask Admin to update the product schedules.',
      };
    }
    const slot = TIME_SLOT_OPTIONS[state.selectedSlotIndex] || TIME_SLOT_OPTIONS[0];
    const scheduledAt = buildScheduleDateForSlot(state.selectedDayOffset, slot);
    const now = getNow();
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime() - 5 * 60 * 1000) {
      return { ok: false, error: 'Choose a current or future delivery time.' };
    }
    if (state.tripMode !== 'default') {
      if (state.tripMode !== 'trip') return { ok: false, error: 'Trip availability could not be verified. Please try again.' };
      if (!getEligibleResolutionTrips(state).some((trip) => trip.tripId === state.selectedTripId)) {
        return { ok: false, error: 'Choose an eligible trip for this Distributor and delivery time.' };
      }
    }
    if (state.mode === 'reschedule') {
      if (!isValidRescheduleReason(state.reason)) {
        return { ok: false, error: 'Add a reason or note (3 to 240 characters) for rescheduling this delivery.' };
      }
      return {
        ok: true,
        action: 'reschedule-delivery',
        scheduledAt,
        rescheduleReason: normalizeRescheduleReason(state.reason),
      };
    }
    const currentAssignedUid = clean(order.assignedDistributorUid || order.distributor_id, 128);
    const eligible = getEligibleBranchDistributors(state.distributors, state.branchId, currentAssignedUid, 'reassign');
    const chosen = eligible.find((item) => item.uid === state.selectedDistributorUid);
    if (!chosen) {
      return {
        ok: false,
        error: 'Choose a different active approved Distributor assigned to your branch.',
      };
    }
    const optionalReason = normalizeRescheduleReason(state.reason);
    return {
      ok: true,
      action: 'reassign-distributor',
      distributorUid: chosen.uid,
      distributorName: chosen.name,
      scheduledAt,
      reassignmentReason: optionalReason,
    };
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope(scope, branchId = '') {
      const normalizedScope = clean(scope, 160);
      const normalizedBranch = clean(branchId, 128);
      if (state.scope === normalizedScope && state.branchId === normalizedBranch) return;
      generation += 1;
      tripReadGeneration += 1;
      submitLocked = false;
      publish({ ...emptyState(), scope: normalizedScope, branchId: normalizedBranch });
    },
    open(order, mode = 'reschedule', distributors = [], tripMode = 'default') {
      if (submitLocked || !order) return false;
      const safeMode = mode === 'reassign' ? 'reassign' : 'reschedule';
      const currentAssignedUid = clean(order.assignedDistributorUid || order.distributor_id, 128);
      const eligible = getEligibleBranchDistributors(distributors, state.branchId || order.currentBranchId || order.branchId, currentAssignedUid, 'reassign');
      const { dayOffset, slotIndex } = defaultFutureScheduleSelection(order, getNow());
      publish({
        visible: true,
        mode: safeMode,
        order,
        distributors: Array.isArray(distributors) ? distributors : state.distributors,
        selectedDistributorUid: safeMode === 'reassign' ? (eligible[0]?.uid || '') : currentAssignedUid,
        selectedDayOffset: dayOffset,
        selectedSlotIndex: slotIndex,
        reason: '',
        confirming: false,
        submitting: false,
        error: '',
        success: '',
        pendingPayload: null,
        tripMode,
        tripOptions: [],
        eligibleTripDistributors: [],
        selectedTripId: '',
        tripOptionsStatus: tripMode === 'trip' ? 'loading' : 'idle',
      });
      if (tripMode === 'trip') this.refreshTripOptions();
      return true;
    },
    setTripMode(tripMode) {
      if (submitLocked || state.tripMode === tripMode) return;
      tripReadGeneration += 1;
      publish({ tripMode, tripOptions: [], eligibleTripDistributors: [], selectedTripId: '', tripOptionsStatus: tripMode === 'trip' ? 'loading' : 'idle', confirming: false, pendingPayload: null });
      if (state.visible && tripMode === 'trip') this.refreshTripOptions();
    },
    async refreshTripOptions() {
      if (!state.visible || state.tripMode !== 'trip' || submitLocked) return;
      const read = ++tripReadGeneration;
      publish({ tripOptionsStatus: 'loading', selectedTripId: '', confirming: false, error: '' });
      try {
        const data = await api.getTripPreparation();
        if (read !== tripReadGeneration || !state.visible || state.tripMode !== 'trip') return;
        publish({ tripOptions: data.trips, eligibleTripDistributors: data.eligibleDistributorUids, tripOptionsStatus: 'ready' });
      } catch (error) {
        if (read !== tripReadGeneration || !state.visible || state.tripMode !== 'trip') return;
        publish({ tripOptions: [], eligibleTripDistributors: [], tripOptionsStatus: 'error', error: error?.message || 'Unable to load eligible trips.' });
      }
    },
    setTripId(tripId) {
      if (submitLocked || !getEligibleResolutionTrips(state).some((trip) => trip.tripId === tripId)) return;
      publish({ selectedTripId: tripId, confirming: false, error: '', success: '', pendingPayload: null });
    },
    updateDistributors(distributors = []) {
      if (!Array.isArray(distributors)) return;
      const currentAssignedUid = clean(state.order?.assignedDistributorUid || state.order?.distributor_id, 128);
      const eligible = getEligibleBranchDistributors(distributors, state.branchId || state.order?.currentBranchId || state.order?.branchId, currentAssignedUid, 'reassign');
      const keepSelected = eligible.some((item) => item.uid === state.selectedDistributorUid);
      publish({
        distributors,
        ...(state.mode === 'reassign' && !keepSelected ? { selectedDistributorUid: eligible[0]?.uid || '' } : {}),
      });
    },
    setMode(mode) {
      if (submitLocked || (mode !== 'reschedule' && mode !== 'reassign') || state.mode === mode) return;
      const currentAssignedUid = clean(state.order?.assignedDistributorUid || state.order?.distributor_id, 128);
      const eligible = getEligibleBranchDistributors(state.distributors, state.branchId || state.order?.currentBranchId || state.order?.branchId, currentAssignedUid, 'reassign');
      publish({
        mode,
        selectedDistributorUid: mode === 'reassign' ? (eligible[0]?.uid || '') : currentAssignedUid,
        confirming: false,
        error: '',
        success: '',
        pendingPayload: null,
        selectedTripId: '',
      });
    },
    setDayOffset(dayOffset) {
      if (submitLocked || !Number.isInteger(dayOffset) || state.selectedDayOffset === dayOffset) return;
      publish({ selectedDayOffset: dayOffset, selectedTripId: '', confirming: false, error: '', success: '', pendingPayload: null });
    },
    setSlotIndex(slotIndex) {
      if (submitLocked || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= TIME_SLOT_OPTIONS.length || state.selectedSlotIndex === slotIndex) return;
      publish({ selectedSlotIndex: slotIndex, selectedTripId: '', confirming: false, error: '', success: '', pendingPayload: null });
    },
    setReason(reason) {
      if (submitLocked || state.reason === reason) return;
      publish({ reason: String(reason ?? ''), confirming: false, error: '', success: '', pendingPayload: null });
    },
    setDistributorUid(uid) {
      if (submitLocked || state.selectedDistributorUid === uid) return;
      publish({ selectedDistributorUid: clean(uid, 128), selectedTripId: '', confirming: false, error: '', success: '', pendingPayload: null });
    },
    requestConfirmation() {
      if (submitLocked) return false;
      const check = validateCurrentDraft();
      if (!check.ok) {
        publish({ confirming: false, error: check.error });
        return false;
      }
      publish({ confirming: true, error: '' });
      return true;
    },
    cancelConfirmation() {
      if (submitLocked) return;
      publish({ confirming: false, error: '' });
    },
    close() {
      if (submitLocked) return;
      tripReadGeneration += 1;
      publish({
        visible: false,
        confirming: false,
        submitting: false,
        error: '',
        success: '',
        pendingPayload: null,
      });
    },
    async submit() {
      if (submitLocked || !state.order) return null;
      const check = validateCurrentDraft();
      if (!check.ok) {
        publish({ confirming: false, error: check.error });
        return null;
      }
      const orderId = clean(state.order.id, 128);
      const payload = state.pendingPayload || Object.freeze(
        check.action === 'reschedule-delivery'
          ? {
              scheduledAt: check.scheduledAt.toISOString(),
              rescheduleReason: check.rescheduleReason,
              expectedStatus: 'delivery_failed',
              clientMutationId: createMutationId(),
              ...(state.tripMode === 'trip' ? { tripId: state.selectedTripId } : {}),
            }
          : {
              distributorUid: check.distributorUid,
              scheduledAt: check.scheduledAt.toISOString(),
              ...(check.reassignmentReason ? { reassignmentReason: check.reassignmentReason } : {}),
              expectedStatus: 'delivery_failed',
              clientMutationId: createMutationId(),
              ...(state.tripMode === 'trip' ? { tripId: state.selectedTripId } : {}),
            }
      );
      submitLocked = true;
      const activeScope = generation;
      publish({ submitting: true, error: '', success: '', pendingPayload: payload });
      try {
        const updatedOrder = await api.dispatchOrder(orderId, check.action, payload);
        if (generation !== activeScope) return null;
        const message = check.action === 'reschedule-delivery'
          ? 'Delivery rescheduled successfully.'
          : 'Distributor reassigned and delivery scheduled.';
        publish({
          visible: false,
          confirming: false,
          submitting: false,
          error: '',
          success: message,
          pendingPayload: null,
        });
        return { ok: true, action: check.action, order: updatedOrder, message };
      } catch (error) {
        if (generation !== activeScope) return null;
        const keepMutationId = Boolean(error?.uncertain || !error?.code || error?.code === 'service-unavailable' || error?.code === 'timeout');
        publish({
          submitting: false,
          error: error?.message || 'Unable to update failed delivery resolution.',
          pendingPayload: keepMutationId ? payload : null,
        });
        return { ok: false, error };
      } finally {
        if (generation === activeScope) {
          submitLocked = false;
        }
      }
    },
  };
}

module.exports = {
  TIME_SLOT_OPTIONS,
  allowedDayOffsetsForOrder,
  buildScheduleDateForSlot,
  canManagerResolveFailedOrder,
  createManagerFailedDeliveryResolutionFlow,
  getEligibleResolutionTrips,
  defaultFutureScheduleSelection,
  formatManilaDate,
  formatManilaTime,
  getEligibleBranchDistributors,
  isValidRescheduleReason,
  normalizeRescheduleReason,
};

