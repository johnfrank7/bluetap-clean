const { OtpError } = require('../utils/otpError');
const { deliveryFailureReasonForCode, DELIVERY_CONTACT_OPTIONS } = require('../../constants/deliveryFailureReasons');

const hasOnly = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key));
const text = (value) => String(value || '').trim();
const timeOf = (value) => value?.toMillis?.() || value?.getTime?.() || new Date(value || 0).getTime();

function claimedTime(value, order, now, replay) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new OtpError(400, 'REPORT_TIME_INVALID', 'Enter a valid UTC contact time.');
  }
  const milliseconds = Date.parse(value);
  const startedAt = timeOf(order.deliveryStartedAt);
  const earliest = Number.isFinite(startedAt) && startedAt > 0
    ? startedAt - 5 * 60 * 1000 : now.getTime() - 24 * 60 * 60 * 1000;
  if (!Number.isFinite(milliseconds) || (!replay && (milliseconds < earliest || milliseconds > now.getTime() + 5 * 60 * 1000))) {
    throw new OtpError(400, 'REPORT_TIME_IMPLAUSIBLE', 'The claimed contact time is outside this delivery attempt.');
  }
  return new Date(milliseconds).toISOString();
}

function normalizeFailureReport(body, order, now, { replay = false } = {}) {
  const code = text(body.failureReasonCode).toUpperCase();
  const reason = deliveryFailureReasonForCode(code);
  if (!reason) throw new OtpError(400, 'FAILURE_REASON_INVALID', 'Choose a supported delivery failure reason.');
  const format = body.reportFormat;
  const structured = format === 'structured-v1';
  if (format !== undefined && !structured) {
    throw new OtpError(400, 'REPORT_FORMAT_INVALID', 'Choose a supported delivery report format.');
  }
  if (!structured && body.reportEvidence !== undefined) {
    throw new OtpError(400, 'REPORT_EVIDENCE_INVALID', 'Structured evidence requires a report format.');
  }
  if (structured && (!hasOnly(body, ['orderId', 'action', 'failureReasonCode', 'failureReasonNote', 'clientMutationId', 'reportFormat', 'reportEvidence'])
    || typeof body.failureReasonCode !== 'string'
    || (body.failureReasonNote !== undefined && typeof body.failureReasonNote !== 'string')
    || typeof body.clientMutationId !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(body.clientMutationId))) {
    throw new OtpError(400, 'REPORT_PAYLOAD_INVALID', 'The delivery report contains invalid fields.');
  }
  const rawNote = text(body.failureReasonNote);
  if (structured && Array.from(rawNote).length > 240) {
    throw new OtpError(400, 'REPORT_NOTE_TOO_LONG', 'Keep the delivery note within 240 characters.');
  }
  const note = structured ? rawNote : rawNote.slice(0, 240);
  if (code === 'OTHER' && !note) {
    throw new OtpError(400, 'FAILURE_REASON_NOTE_REQUIRED', 'Add a short explanation when choosing Other.');
  }
  if (!structured) return { code, label: reason.label, note, format: null, evidence: null };
  if ((DELIVERY_CONTACT_OPTIONS[code] || code === 'RECIPIENT_REFUSED') && note) {
    throw new OtpError(400, 'REPORT_NOTE_IRRELEVANT', 'Put contact or interaction details only in the protected report fields.');
  }

  const evidence = body.reportEvidence;
  if (!hasOnly(evidence, ['contactAttempts', 'interactionNote']) || JSON.stringify(evidence).length > 1500) {
    throw new OtpError(400, 'REPORT_EVIDENCE_INVALID', 'The delivery evidence is invalid or too large.');
  }
  const contactOptions = DELIVERY_CONTACT_OPTIONS[code];
  if (contactOptions) {
    if (!hasOnly(evidence, ['contactAttempts']) || !Array.isArray(evidence.contactAttempts)
      || evidence.contactAttempts.length < 1 || evidence.contactAttempts.length > 3) {
      throw new OtpError(400, 'REPORT_CONTACT_REQUIRED', 'Add one to three contact attempts.');
    }
    const contactAttempts = evidence.contactAttempts.map((entry) => {
      if (!hasOnly(entry, ['method', 'outcome', 'claimedAt']) || typeof entry.method !== 'string'
        || typeof entry.outcome !== 'string' || !Object.hasOwn(contactOptions, entry.method)
        || !contactOptions[entry.method].includes(entry.outcome)) {
        throw new OtpError(400, 'REPORT_CONTACT_INVALID', 'Choose a supported contact method and outcome.');
      }
      return {
        method: entry.method,
        outcome: entry.outcome,
        ...(entry.claimedAt === undefined ? {} : { claimedAt: claimedTime(entry.claimedAt, order, now, replay) }),
      };
    });
    return { code, label: reason.label, note, format, evidence: { contactAttempts } };
  }
  if (code === 'RECIPIENT_REFUSED') {
    if (!hasOnly(evidence, ['interactionNote']) || typeof evidence.interactionNote !== 'string') {
      throw new OtpError(400, 'REPORT_INTERACTION_REQUIRED', 'Describe the refusal factually.');
    }
    const interactionNote = text(evidence.interactionNote);
    if (Array.from(interactionNote).length < 10 || Array.from(interactionNote).length > 240) {
      throw new OtpError(400, 'REPORT_INTERACTION_INVALID', 'Use 10 to 240 characters for the interaction note.');
    }
    return { code, label: reason.label, note, format, evidence: { interactionNote } };
  }
  if (Object.keys(evidence).length !== 0) {
    throw new OtpError(400, 'REPORT_EVIDENCE_IRRELEVANT', 'This reason does not use structured evidence.');
  }
  return { code, label: reason.label, note, format, evidence: {} };
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;

function matchesCommittedReport(attempt, report, mutationId) {
  return attempt.outcome === 'failed' && attempt.outcomeMutationId === mutationId
    && attempt.reportedReasonCode === report.code && (attempt.reportedReasonNote || '') === report.note
    && (attempt.reportFormat || null) === report.format
    && JSON.stringify(canonical(attempt.reportEvidence ?? null)) === JSON.stringify(canonical(report.evidence));
}

module.exports = { normalizeFailureReport, matchesCommittedReport };
