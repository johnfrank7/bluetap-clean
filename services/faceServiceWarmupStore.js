const {
  FACE_SERVICE_POLL_INTERVAL_MS,
  FACE_SERVICE_WARMUP_WINDOW_MS,
} = require('./faceServiceWarmupCore');

function createFaceServiceWarmupStore({ now = Date.now, schedule = setTimeout, cancel = clearTimeout, logger = console } = {}) {
  let state = { status: 'idle', startedAt: 0, registrationSessionId: '' };
  let timer = null;
  let polling = false;
  let poller = null;
  const listeners = new Set();

  const emit = () => listeners.forEach((listener) => listener(state));
  const setState = (next) => {
    if (state.status === next.status && state.startedAt === next.startedAt && state.registrationSessionId === next.registrationSessionId) return;
    state = next;
    emit();
  };
  const stop = (reason) => {
    if (timer) cancel(timer);
    timer = null;
    if (polling) logger.info('[face-warmup]', { stage: 'FACE_STEP3_POLL_STOPPED', reason });
    polling = false;
    poller = null;
  };
  const snapshot = (required = true) => required === false ? { ...state, status: 'not_required' } : state;
  const publishPrewarm = (status) => {
    if (status === 'ready') {
      stop('shared-ready');
      setState({ ...state, status: 'ready' });
    } else if (status === 'not_required') {
      stop('not-required');
      setState({ ...state, status: 'not_required' });
    } else if (state.status !== 'ready') {
      setState({ ...state, status: 'starting' });
    }
  };
  const start = ({ registrationSessionId, required, checkStatus, restart = false }) => {
    if (!required) {
      publishPrewarm('not_required');
      return;
    }
    if (!registrationSessionId || state.status === 'ready') return;
    if (polling && state.registrationSessionId === registrationSessionId) return;
    if (polling) stop('registration-session-changed');
    if (restart || state.status === 'unavailable') state = { status: 'idle', startedAt: 0, registrationSessionId: '' };
    const startedAt = state.startedAt || now();
    setState({ status: 'starting', startedAt, registrationSessionId });
    polling = true;
    logger.info('[face-warmup]', { stage: 'FACE_STEP3_POLL_STARTED' });
    const poll = async () => {
      if (!polling) return;
      if (now() - startedAt >= FACE_SERVICE_WARMUP_WINDOW_MS) {
        setState({ status: 'unavailable', startedAt, registrationSessionId });
        stop('budget-expired');
        return;
      }
      let status = 'starting';
      try {
        const result = await checkStatus(registrationSessionId);
        if (result?.status === 'ready') status = 'ready';
        else if (result?.status === 'not_required') status = 'not_required';
      } catch { /* Keep polling within the shared bounded budget. */ }
      if (!polling) return;
      if (status === 'ready' || status === 'not_required') {
        setState({ status, startedAt, registrationSessionId });
        stop(status);
        return;
      }
      setState({ status: 'starting', startedAt, registrationSessionId });
      timer = schedule(poll, FACE_SERVICE_POLL_INTERVAL_MS);
    };
    poller = poll;
    poll();
  };
  return {
    getSnapshot: snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publishPrewarm,
    start,
    retry(options) { stop('retry'); start({ ...options, restart: true }); },
    getDebugState: () => ({ ...state, polling }),
  };
}

const faceServiceWarmupStore = createFaceServiceWarmupStore();
module.exports = { createFaceServiceWarmupStore, faceServiceWarmupStore };
