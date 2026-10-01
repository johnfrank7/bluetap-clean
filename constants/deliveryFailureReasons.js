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

const DELIVERY_FAILURE_REASON_BY_CODE = Object.freeze(Object.fromEntries(
  DELIVERY_FAILURE_REASONS.map((reason) => [reason.code, reason])
));

const clean = (value) => String(value || '').trim();

function deliveryFailureReasonForCode(code) {
  return DELIVERY_FAILURE_REASON_BY_CODE[clean(code).toUpperCase()] || null;
}

function formatDeliveryFailureReason(order = {}, fallback = '') {
  const reason = deliveryFailureReasonForCode(order.failureReasonCode);
  const label = reason?.label || clean(order.failureReasonLabel) || clean(order.failureReason);
  const note = clean(order.failureReasonNote);
  if (!label) return fallback;
  return note && note.toLowerCase() !== label.toLowerCase() ? `${label}: ${note}` : label;
}

module.exports = {
  DELIVERY_FAILURE_REASONS,
  DELIVERY_FAILURE_REASON_BY_CODE,
  deliveryFailureReasonForCode,
  formatDeliveryFailureReason,
};
