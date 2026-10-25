// UI-only validation and retry coordination. The server remains the authority.
function normalizeExplanation(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
}

function explanationError(value) {
  const text = normalizeExplanation(value);
  const length = Array.from(text).length;
  return length >= 10 && length <= 500 && /[\p{L}\p{N}]/u.test(text)
    ? '' : 'Enter a factual explanation of 10 to 500 characters.';
}

function appealReasonError(value) {
  const text = normalizeExplanation(value);
  const length = Array.from(text).length;
  return length >= 10 && length <= 1000 && /[\p{L}\p{N}]/u.test(text)
    ? '' : 'Enter a factual appeal reason of 10 to 1000 characters.';
}

const RESPONSIBILITY_LABELS = Object.freeze({
  requester_responsible: 'Requester responsibility',
  provider_responsible: 'Provider responsibility',
  shared: 'Shared responsibility',
  undetermined: 'Responsibility undetermined',
});
const responsibilityLabel = (value) => RESPONSIBILITY_LABELS[value] || 'Outcome unavailable';

function reportViewModel(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    attemptId: report.attemptId,
    orderId: report.orderId,
    attemptNumber: report.attemptNumber,
    reportedReasonLabel: report.reportedReasonLabel,
    reportReceivedAt: report.reportReceivedAt,
    reviewState: report.reviewState,
    responseDeadlineAt: report.responseDeadlineAt || null,
    responseWindowOpen: report.responseWindowOpen !== false,
    responsibility: report.reviewState === 'resolved' ? report.responsibility : null,
    decisionReason: report.reviewState === 'resolved' ? report.decisionReason || null : null,
    decidedAt: report.reviewState === 'resolved' ? report.decidedAt || null : null,
    effectiveResponsibility: report.effectiveResponsibility || (report.reviewState === 'resolved' ? report.responsibility : null),
    appeal: report.appeal ? {
      state: report.appeal.state,
      appealReason: report.appeal.appealReason,
      submittedAt: report.appeal.submittedAt,
      resolution: report.appeal.resolution || null,
      resolutionReason: report.appeal.resolutionReason || null,
      overturnedResponsibility: report.appeal.overturnedResponsibility || null,
      resolvedAt: report.appeal.resolvedAt || null,
    } : null,
    requesterResponseStatus: report.requesterResponseStatus,
    requesterResponse: report.requesterResponse ? {
      explanation: report.requesterResponse.explanation,
      submittedAt: report.requesterResponse.submittedAt,
    } : null,
    contactAttempts: Array.isArray(report.contactAttempts) ? report.contactAttempts.slice(0, 3).map((entry) => ({
      method: entry.method,
      outcome: entry.outcome,
      claimedAt: entry.claimedAt,
      claimedAtUnverified: entry.claimedAtUnverified === true,
    })) : [],
  };
}

const ATTEMPT_ID = /^[a-f0-9]{64}$/;
const validReportOrderId = (value) => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= 128 && value !== '.' && value !== '..' && !value.includes('/');
const validReportAttemptId = (value) => typeof value === 'string' && ATTEMPT_ID.test(value);

function reportNotificationTarget(event) {
  const original = event?.kind === 'delivery_report' && event.status === 'delivery_report'
    && event.id === `delivery-report:${event.attemptId}`;
  const completion = event?.kind === 'delivery_review_completed' && event.status === 'delivery_review_completed'
    && event.id === `delivery-review:${event.attemptId}_manager_decision_v1`;
  const appealSubmitted = event?.kind === 'delivery_appeal_submitted' && event.status === 'delivery_appeal_submitted'
    && event.id === `moderation:appeal_sub_${event.attemptId}`;
  const appealResolved = event?.kind === 'delivery_appeal_resolved' && event.status === 'delivery_appeal_resolved'
    && event.id === `moderation:appeal_res_${event.attemptId}`;
  if ((!original && !completion && !appealSubmitted && !appealResolved) || !validReportOrderId(event.orderId)
    || !validReportAttemptId(event.attemptId)) return null;
  return { orderId: event.orderId, attemptId: event.attemptId };
}

function reportRouteTarget(params) {
  const orderId = params?.reportOrderId;
  const attemptId = params?.reportAttemptId;
  if (orderId === undefined && attemptId === undefined) return null;
  if (!validReportOrderId(orderId) || !validReportAttemptId(attemptId)) return { invalid: true };
  return { orderId, attemptId };
}

function exactReportViewModel(report, target) {
  if (!target || report?.orderId !== target.orderId || report?.attemptId !== target.attemptId
    || report?.reportedStatus !== 'reported_by_distributor') return null;
  return reportViewModel(report);
}

async function loadExactReport(target, fetchDetail, isCurrent) {
  if (!validReportOrderId(target?.orderId) || !validReportAttemptId(target?.attemptId)) return null;
  const result = await fetchDetail(target.attemptId, target.orderId);
  if (!isCurrent()) return null;
  return exactReportViewModel(result?.report, target);
}

function canSubmitResponse(report) {
  return report?.reviewState === 'awaiting_review' && report?.requesterResponseStatus === 'not_submitted'
    && report?.responseWindowOpen !== false;
}

function reportDisplayState({ loading, error, reports }) {
  if (loading) return 'loading';
  if (error && !reports.length) return 'error';
  return reports.length ? 'ready' : 'empty';
}

function createMutationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createReportModalHandoff(platform) {
  let pending = null;
  return {
    begin(orderId, route) {
      if (!orderId || pending) return false;
      pending = { orderId, route };
      return true;
    },
    pendingOrderId: () => pending?.orderId || '',
    pendingRoute: () => pending?.route || '',
    cancel() { pending = null; },
    dismissed(route) {
      if (platform === 'android' || !pending || pending.route !== route) return '';
      const { orderId } = pending;
      pending = null;
      return orderId;
    },
    visibilityCommitted(route) {
      if (platform !== 'android' || !pending || pending.route !== route) return '';
      const { orderId } = pending;
      pending = null;
      return orderId;
    },
  };
}

function createRequesterResponseFlow({ send, readReport, makeId = createMutationId }) {
  let pending = null;
  let inFlight = false;
  let confirmedReport = null;
  let terminalConflict = false;
  const listeners = new Set();
  const state = () => ({
    pending: pending ? { explanation: pending.payload.explanation, uncertain: pending.uncertain } : null,
    inFlight,
    confirmedReport,
    terminalConflict,
  });
  const notify = () => { for (const listener of listeners) listener(state()); };
  return {
    hasPending: () => Boolean(pending),
    getState: state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async submit(attemptId, draft) {
      if (inFlight) return { ignored: true };
      if (pending && pending.attemptId !== attemptId) {
        const error = new Error('Finish retrying this response before selecting another report.');
        error.code = 'RESPONSE_PENDING_DIFFERENT_ATTEMPT';
        throw error;
      }
      if (!pending) {
        const validation = explanationError(draft);
        if (validation) {
          const error = new Error(validation);
          error.code = 'RESPONSE_INVALID';
          throw error;
        }
        pending = { payload: Object.freeze({ attemptId, explanation: normalizeExplanation(draft), clientMutationId: makeId() }), uncertain: false, attemptId };
      }
      terminalConflict = false;
      inFlight = true;
      notify();
      try {
        if (pending.uncertain) {
          const current = await readReport(attemptId);
          if (current?.requesterResponseStatus === 'submitted'
            && current.requesterResponse?.explanation !== pending.payload.explanation) {
            const error = new Error('Another response has already been recorded. Refresh this report.');
            error.status = 409;
            throw error;
          }
          // Even an identical visible explanation needs an exact server replay to prove mutation identity.
        }
        const result = await send(pending.payload);
        const report = result?.report;
        if (report?.attemptId !== attemptId || report.requesterResponseStatus !== 'submitted'
          || report.requesterResponse?.explanation !== pending.payload.explanation
          || !Number.isFinite(Date.parse(report.requesterResponse?.submittedAt))) {
          const error = new Error('The response result could not be confirmed. Retry to check its status.');
          error.uncertain = true;
          throw error;
        }
        pending = null;
        confirmedReport = reportViewModel(report);
        return { report: confirmedReport };
      } catch (error) {
        if (pending) {
          if (error.uncertain || error.status >= 500 || error.status === undefined && error.code !== 'RESPONSE_INVALID') pending.uncertain = true;
          else { pending = null; terminalConflict = error.status === 409; }
        }
        throw error;
      } finally {
        inFlight = false;
        notify();
      }
    },
  };
}

function createRequesterResponseRegistry({ send, readReport, makeId = createMutationId }) {
  const flows = new Map();
  const key = (uid, orderId, attemptId) => JSON.stringify([uid, orderId, attemptId]);
  return {
    get(uid, orderId, attemptId) {
      if (!uid || !orderId || !attemptId) return null;
      const id = key(uid, orderId, attemptId);
      if (!flows.has(id)) flows.set(id, createRequesterResponseFlow({
        send,
        readReport: () => readReport(orderId, attemptId),
        makeId,
      }));
      return flows.get(id);
    },
    pendingAttemptId(uid, orderId) {
      if (!uid || !orderId) return '';
      for (const [id, flow] of flows) {
        const [owner, order, attemptId] = JSON.parse(id);
        if (owner === uid && order === orderId && flow.hasPending()) return attemptId;
      }
      return '';
    },
  };
}

function createRequesterAppealFlow({ send, makeId = createMutationId }) {
  let pending = null;
  let inFlight = false;
  let confirmedAppeal = null;
  let terminalConflict = false;
  const listeners = new Set();
  const state = () => ({ pending: pending ? { appealReason: pending.appealReason,
    uncertain: pending.uncertain } : null, inFlight, confirmedAppeal, terminalConflict });
  const notify = () => { for (const listener of listeners) listener(state()); };
  return {
    getState: state,
    hasPending: () => Boolean(pending),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async submit(orderId, attemptId, draft) {
      if (inFlight) return { ignored: true };
      if (!pending) {
        const validation = appealReasonError(draft);
        if (validation) {
          const error = new Error(validation);
          error.code = 'APPEAL_INVALID';
          throw error;
        }
        const payload = Object.freeze({ orderId, attemptId, appealReason: normalizeExplanation(draft),
          clientMutationId: makeId() });
        pending = { payload, appealReason: payload.appealReason, uncertain: false };
      } else if (pending.payload.orderId !== orderId || pending.payload.attemptId !== attemptId
        || normalizeExplanation(draft) !== pending.appealReason) {
        const error = new Error('Finish retrying the unchanged pending appeal before editing it.');
        error.status = 409;
        throw error;
      }
      terminalConflict = false;
      inFlight = true;
      notify();
      try {
        const result = await send(pending.payload);
        const appeal = result?.appeal;
        if (appeal?.attemptId !== attemptId || appeal.orderId !== orderId
          || appeal.appealReason !== pending.appealReason
          || !['submitted', 'upheld', 'overturned'].includes(appeal.state)
          || !Number.isFinite(Date.parse(appeal.submittedAt))) {
          const error = new Error('The appeal result could not be confirmed. Retry the same submission.');
          error.uncertain = true;
          throw error;
        }
        confirmedAppeal = appeal;
        pending = null;
        return { appeal };
      } catch (error) {
        if (pending) {
          if (error.uncertain || error.status >= 500 || error.status === undefined && error.code !== 'APPEAL_INVALID') {
            pending.uncertain = true;
          } else {
            pending = null;
            terminalConflict = error.status === 409;
          }
        }
        throw error;
      } finally {
        inFlight = false;
        notify();
      }
    },
  };
}

function createRequesterAppealRegistry({ send, makeId = createMutationId }) {
  const flows = new Map();
  const key = (uid, orderId, attemptId) => JSON.stringify([uid, orderId, attemptId]);
  return {
    get(uid, orderId, attemptId) {
      if (!uid || !orderId || !attemptId) return null;
      const id = key(uid, orderId, attemptId);
      if (!flows.has(id)) flows.set(id, createRequesterAppealFlow({ send, makeId }));
      return flows.get(id);
    },
    pendingAttemptId(uid, orderId) {
      for (const [id, flow] of flows) {
        const [owner, order, attemptId] = JSON.parse(id);
        if (owner === uid && order === orderId && flow.hasPending()) return attemptId;
      }
      return '';
    },
  };
}

module.exports = { appealReasonError, canSubmitResponse, createMutationId, createReportModalHandoff, createRequesterResponseFlow,
  createRequesterResponseRegistry, createRequesterAppealFlow, createRequesterAppealRegistry,
  exactReportViewModel, explanationError, loadExactReport,
  normalizeExplanation, reportDisplayState, reportNotificationTarget, reportRouteTarget,
  reportViewModel, responsibilityLabel };
