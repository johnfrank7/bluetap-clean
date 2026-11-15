const DELIVERY_FAILURE_REASONS = Object.freeze([
  Object.freeze({ code: 'CUSTOMER_UNAVAILABLE', label: 'Customer unavailable' }),
  Object.freeze({ code: 'NO_RESPONSE', label: 'Customer did not respond' }),
  Object.freeze({ code: 'RECIPIENT_REFUSED', label: 'Recipient refused delivery' }),
  Object.freeze({ code: 'ADDRESS_ISSUE', label: 'Incorrect or incomplete address' }),
  Object.freeze({ code: 'LOCATION_INACCESSIBLE', label: 'Delivery location inaccessible' }),
  Object.freeze({ code: 'WEATHER_OR_ROAD', label: 'Weather or road conditions' }),
  Object.freeze({ code: 'VEHICLE_ISSUE', label: 'Vehicle / transportation issue' }),
  Object.freeze({ code: 'PRODUCT_ISSUE', label: 'Product or quantity issue' }),
  Object.freeze({ code: 'PAYMENT_ISSUE', label: 'Payment issue' }),
  Object.freeze({ code: 'OTHER', label: 'Other' }),
]);

const DELIVERY_CONTACT_OPTIONS = Object.freeze({
  NO_RESPONSE: Object.freeze({
    PHONE_CALL: Object.freeze(['NO_ANSWER']),
    SMS: Object.freeze(['SENT_NO_REPLY']),
    CHAT: Object.freeze(['SENT_NO_REPLY']),
  }),
  CUSTOMER_UNAVAILABLE: Object.freeze({
    IN_PERSON: Object.freeze(['NOT_AT_ADDRESS']),
    PHONE_CALL: Object.freeze(['NO_ANSWER']),
  }),
});

const DELIVERY_CONTACT_METHOD_LABELS = Object.freeze({
  PHONE_CALL: 'Phone call', SMS: 'SMS', CHAT: 'Chat', IN_PERSON: 'At the address',
});
const DELIVERY_CONTACT_OUTCOME_LABELS = Object.freeze({
  NO_ANSWER: 'No answer', SENT_NO_REPLY: 'Sent, no reply', NOT_AT_ADDRESS: 'Not at address',
});

const DELIVERY_FAILURE_REASON_BY_CODE = Object.freeze(Object.fromEntries(
  DELIVERY_FAILURE_REASONS.map((reason) => [reason.code, reason])
));

const clean = (value) => String(value || '').trim();

function deliveryFailureReasonForCode(code) {
  return DELIVERY_FAILURE_REASON_BY_CODE[clean(code).toUpperCase()] || null;
}

function formatDeliveryFailureReason(order = {}, fallback = '') {
  const source = order && typeof order === 'object' ? order : {};
  const reason = deliveryFailureReasonForCode(source.failureReasonCode);
  const label = reason?.label || clean(source.failureReasonLabel) || clean(source.failureReason);
  const note = clean(source.failureReasonNote);
  if (!label) return fallback;
  return note && note.toLowerCase() !== label.toLowerCase() ? `${label}: ${note}` : label;
}

module.exports = {
  DELIVERY_FAILURE_REASONS,
  DELIVERY_FAILURE_REASON_BY_CODE,
  DELIVERY_CONTACT_OPTIONS,
  DELIVERY_CONTACT_METHOD_LABELS,
  DELIVERY_CONTACT_OUTCOME_LABELS,
  deliveryFailureReasonForCode,
  formatDeliveryFailureReason,
};
