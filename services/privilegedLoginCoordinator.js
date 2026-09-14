const states = new Map();

const getState = (role) => {
  const key = String(role || '').toLowerCase();
  if (!states.has(key)) states.set(key, { completedUid: '', existingSessionUid: '', inFlight: null, inFlightUid: '' });
  return states.get(key);
};

function resetPrivilegedLoginValidation(role) {
  states.delete(String(role || '').toLowerCase());
}

function completePrivilegedLoginValidation(role, uid) {
  const state = getState(role);
  state.completedUid = String(uid || '');
  state.existingSessionUid = state.completedUid;
}

function shouldValidateExistingSession(role, user, submitting = false) {
  const uid = String(user?.uid || '');
  if (!uid || submitting) return false;
  const state = getState(role);
  if (state.completedUid === uid || state.existingSessionUid === uid || state.inFlightUid === uid) return false;
  state.existingSessionUid = uid;
  return true;
}

function runPrivilegedLoginValidation(role, user, validate) {
  const uid = String(user?.uid || '');
  const state = getState(role);
  if (uid && state.completedUid === uid) return Promise.resolve({ skipped: 'completed' });
  if (state.inFlight && state.inFlightUid === uid) return state.inFlight;

  const pending = Promise.resolve().then(validate);
  state.inFlightUid = uid;
  state.inFlight = pending.finally(() => {
    if (state.inFlight === pending || state.inFlight === wrapped) {
      state.inFlight = null;
      state.inFlightUid = '';
    }
  });
  const wrapped = state.inFlight;
  return wrapped;
}

module.exports = {
  completePrivilegedLoginValidation,
  resetPrivilegedLoginValidation,
  runPrivilegedLoginValidation,
  shouldValidateExistingSession,
};
