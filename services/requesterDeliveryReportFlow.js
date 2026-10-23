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

function reportViewModel(report) {
  if (!report || typeof report !== 'object') return null;
  return {
    attemptId: report.attemptId,
    orderId: report.orderId,
    attemptNumber: report.attemptNumber,
    reportedReasonLabel: report.reportedReasonLabel,
    reportReceivedAt: report.reportReceivedAt,
    reviewState: report.reviewState,
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
  if (event?.kind !== 'delivery_report' || event.status !== 'delivery_report'
    || !validReportOrderId(event.orderId) || !validReportAttemptId(event.attemptId)
    || event.id !== `delivery-report:${event.attemptId}`) return null;
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
  return report?.reviewState === 'awaiting_review' && report?.requesterResponseStatus === 'not_submitted';
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

module.exports = { canSubmitResponse, createMutationId, createReportModalHandoff, createRequesterResponseFlow, createRequesterResponseRegistry, exactReportViewModel, explanationError, loadExactReport, normalizeExplanation, reportDisplayState, reportNotificationTarget, reportRouteTarget, reportViewModel };
