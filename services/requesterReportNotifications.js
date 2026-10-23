// Pure projection of the protected Requester report DTO. No client Firestore reads.
const ATTEMPT_ID = /^[a-f0-9]{64}$/;
const SERVER_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MESSAGE = 'A delivery issue was reported for your order. You can review the details and share your response.';
const validCursor = (value) => typeof value === 'string' && value.length > 0 && value.length <= 1500
  && value !== '.' && value !== '..' && !value.includes('/');

function projectReportNotification(report) {
  if (!report || typeof report !== 'object' || !ATTEMPT_ID.test(report.attemptId)
    || typeof report.orderId !== 'string' || !report.orderId.trim()
    || report.orderId.length > 128 || report.orderId.includes('/')
    || !Number.isSafeInteger(report.attemptNumber) || report.attemptNumber < 1
    || report.reportedStatus !== 'reported_by_distributor'
    || typeof report.reportReceivedAt !== 'string' || !SERVER_TIME.test(report.reportReceivedAt)) return null;
  const at = new Date(report.reportReceivedAt);
  if (!Number.isFinite(at.getTime()) || at.toISOString() !== report.reportReceivedAt) return null;
  return {
    id: `delivery-report:${report.attemptId}`,
    kind: 'delivery_report',
    status: 'delivery_report',
    title: 'Delivery report',
    message: MESSAGE,
    orderId: report.orderId,
    attemptId: report.attemptId,
    at,
    ...(report.reviewState === 'awaiting_review' ? { reviewLabel: 'Awaiting review' } : {}),
  };
}

function uniqueEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    if (seen.has(event.attemptId)) return false;
    seen.add(event.attemptId);
    return true;
  });
}

function projectReportPage(page) {
  if (!page || !Array.isArray(page.reports) || page.reports.length > 25
    || !(page.nextCursor === null || validCursor(page.nextCursor))) return null;
  return {
    events: uniqueEvents(page.reports.map(projectReportNotification).filter(Boolean)),
    nextCursor: page.nextCursor,
    hasMore: page.nextCursor !== null,
    historyComplete: page.nextCursor === null,
    scope: 'loaded-report-pages',
  };
}

function mergeReportPages(current, next) {
  if (!current || !next) return null;
  return {
    events: uniqueEvents([...current.events, ...next.events]),
    nextCursor: next.nextCursor,
    hasMore: next.hasMore,
    historyComplete: next.historyComplete,
    scope: 'loaded-report-pages',
  };
}

module.exports = { projectReportNotification, projectReportPage, mergeReportPages };
