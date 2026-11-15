const OUTCOMES = new Set(['requester_responsible', 'provider_responsible', 'shared', 'undetermined']);

function normalizeDecisionReason(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
}

function validDecisionReason(value) {
  const normalized = normalizeDecisionReason(value);
  const length = Array.from(normalized).length;
  return length >= 10 && length <= 500 && /[\p{L}\p{N}]/u.test(normalized);
}

const empty = () => ({ scope: '', activeTab: 'approvals', reviews: [], nextCursor: null,
  listLoaded: false, listBusy: false, listError: '', detail: null, detailBusy: false,
  detailError: '', modalOpen: false, responsibility: '', reason: '', submitBusy: false,
  submitError: '', success: '', pending: null });

function createManagerDeliveryReviewFlow(api, mutationId) {
  let state = empty();
  let generation = 0;
  let detailSequence = 0;
  let listLocked = false;
  let submitLocked = false;
  const listeners = new Set();
  const publish = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
  };
  const current = (scope, sequence) => generation === scope && (sequence == null || detailSequence === sequence);
  const errorText = (error, fallback) => error?.message || fallback;
  const restricted = (error) => error?.status === 401 || error?.status === 403;
  const clearProtected = (message) => {
    generation += 1;
    detailSequence += 1;
    listLocked = false;
    submitLocked = false;
    publish({ ...empty(), scope: state.scope, activeTab: state.activeTab, listError: message, detailError: message });
  };

  async function load({ more = false } = {}) {
    if (!state.scope || listLocked || more && !state.nextCursor) return;
    listLocked = true;
    const scope = generation;
    const cursor = more ? state.nextCursor : '';
    publish({ listBusy: true, listError: '' });
    try {
      const result = await api.list(cursor);
      if (!current(scope)) return;
      if (!Array.isArray(result?.reviews) || result.nextCursor != null && typeof result.nextCursor !== 'string') {
        throw new Error('The review list could not be read.');
      }
      const seen = new Set();
      const reviews = [...(more ? state.reviews : []), ...result.reviews].filter((review) => {
        if (!review || typeof review.attemptId !== 'string' || seen.has(review.attemptId)) return false;
        seen.add(review.attemptId);
        return true;
      });
      publish({ reviews, nextCursor: result.nextCursor || null, listLoaded: true, listBusy: false });
    } catch (error) {
      if (!current(scope)) return;
      if (restricted(error)) clearProtected('Manager access changed. Sign in again to view reviews.');
      else publish({ listBusy: false, listLoaded: true, listError: errorText(error, 'Unable to load reviews.') });
    } finally { if (current(scope)) listLocked = false; }
  }

  async function open(attemptId, orderId) {
    if (!state.scope || !attemptId || !orderId || state.detailBusy || submitLocked) return;
    const scope = generation;
    const sequence = ++detailSequence;
    const sameCase = state.detail?.attemptId === attemptId && state.detail?.orderId === orderId;
    publish({ modalOpen: true, detailBusy: true, detailError: '', detail: null,
      responsibility: sameCase ? state.responsibility : '', reason: sameCase ? state.reason : '',
      pending: sameCase ? state.pending : null, submitError: '', success: '' });
    try {
      const result = await api.detail(attemptId);
      if (!current(scope, sequence)) return;
      if (result?.review?.attemptId !== attemptId || result.review.orderId !== orderId) {
        throw new Error('The selected delivery report is unavailable.');
      }
      publish({ detail: result.review, detailBusy: false });
    } catch (error) {
      if (!current(scope, sequence)) return;
      if (restricted(error)) clearProtected('Manager access changed. Sign in again to view reviews.');
      else publish({ detailBusy: false, detailError: error?.status === 404
        ? 'This delivery report is no longer available.' : errorText(error, 'Unable to open this review.') });
    }
  }

  function setDraft(field, value) {
    if (submitLocked || !['responsibility', 'reason'].includes(field)) return;
    if (field === 'responsibility' && value && !OUTCOMES.has(value)) return;
    if (state[field] === value) return;
    publish({ [field]: value, pending: null, submitError: '', success: '' });
  }

  async function submit() {
    if (submitLocked || !state.scope || !state.detail || state.detail.reviewState !== 'reported'
      || !state.detail.canFinalizeNow || state.detailError) return;
    if (!OUTCOMES.has(state.responsibility) || !validDecisionReason(state.reason)) {
      publish({ submitError: 'Choose a responsibility and enter a factual reason of 10 to 500 characters.' });
      return;
    }
    const normalized = normalizeDecisionReason(state.reason);
    const payload = state.pending || Object.freeze({ attemptId: state.detail.attemptId,
      orderId: state.detail.orderId, responsibility: state.responsibility,
      decisionReason: normalized, expectedRevision: state.detail.revision,
      clientMutationId: mutationId() });
    submitLocked = true;
    const scope = generation;
    const sequence = detailSequence;
    publish({ submitBusy: true, submitError: '', pending: payload });
    try {
      const result = await api.decide(payload);
      if (!current(scope, sequence)) return;
      if (result?.decision?.attemptId !== payload.attemptId || result.decision.orderId !== payload.orderId
        || result.decision.responsibility !== payload.responsibility || result.decision.reviewState !== 'resolved'
        || result.decision.decisionReason !== payload.decisionReason
        || typeof result.decision.reportingBranchId !== 'string' || !result.decision.reportingBranchId
        || !Number.isFinite(Date.parse(result.decision.decidedAt))) {
        throw Object.assign(new Error('The decision could not be confirmed. Retry the same submission.'), { uncertain: true });
      }
      publish({ submitBusy: false, pending: null, success: 'Decision saved.',
        detail: { ...state.detail, reviewState: 'resolved', responsibility: result.decision.responsibility,
          canFinalizeNow: false }, submitError: '' });
      void load();
    } catch (error) {
      if (!current(scope, sequence)) return;
      if (restricted(error)) clearProtected('Manager access changed. Sign in again to view reviews.');
      else if (error?.status === 409) {
        publish({ submitBusy: false, pending: null, submitError: 'This review changed. The latest case is being loaded; your reason remains here.' });
        try {
          const refreshed = await api.detail(payload.attemptId);
          if (current(scope, sequence)) {
            if (refreshed?.review?.attemptId === payload.attemptId && refreshed.review.orderId === payload.orderId) {
              publish({ detail: refreshed.review });
            } else publish({ detail: null, detailError: 'This delivery report is no longer available.' });
          }
        } catch (refreshError) {
          if (current(scope, sequence)) {
            if (restricted(refreshError)) clearProtected('Manager access changed. Sign in again to view reviews.');
            else publish({ detailError: 'The latest case could not be loaded. Close and reopen this review.' });
          }
        }
      } else publish({ submitBusy: false, submitError: error?.uncertain
        ? 'The outcome is unconfirmed. Retry this exact decision.' : errorText(error, 'Unable to save the decision.'),
      pending: error?.uncertain ? payload : null });
    } finally { if (generation === scope) submitLocked = false; }
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setScope(scope) {
      if (state.scope === scope) return;
      generation += 1;
      detailSequence += 1;
      listLocked = false;
      submitLocked = false;
      publish({ ...empty(), scope });
    },
    setTab(tab) { if (tab === 'approvals' || tab === 'failed') publish({ activeTab: tab }); },
    load, open, setDraft, submit,
    close() {
      if (!submitLocked) detailSequence += 1;
      publish({ modalOpen: false, detailBusy: submitLocked ? state.detailBusy : false });
    },
  };
}

module.exports = { createManagerDeliveryReviewFlow, normalizeDecisionReason, validDecisionReason };
