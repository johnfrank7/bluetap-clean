const RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;
const DECISION_EVENT_KIND = 'MANAGER_DELIVERY_DECISION';
const DECISION_RESPONSIBILITIES = new Set(['requester_responsible', 'provider_responsible', 'shared', 'undetermined']);
const decisionEventIdFor = (attemptId) => `${attemptId}_manager_decision_v1`;

module.exports = { RESPONSE_WINDOW_MS, DECISION_EVENT_KIND, DECISION_RESPONSIBILITIES, decisionEventIdFor };
