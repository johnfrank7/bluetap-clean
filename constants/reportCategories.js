const REPORT_CATEGORIES = Object.freeze([
  Object.freeze({ code: 'HARASSMENT_INAPPROPRIATE', label: 'Harassment / inappropriate content' }),
  Object.freeze({ code: 'SPAM', label: 'Spam' }),
  Object.freeze({ code: 'FRAUD_SCAM', label: 'Fraud / scam' }),
  Object.freeze({ code: 'DELIVERY_MISCONDUCT', label: 'Delivery misconduct' }),
  Object.freeze({ code: 'ORDER_ABUSE', label: 'Abusive / malicious ordering' }),
  Object.freeze({ code: 'THREAT_SAFETY', label: 'Threat / safety concern' }),
  Object.freeze({ code: 'OTHER', label: 'Other' }),
]);

const REPORT_CATEGORY_BY_CODE = Object.freeze(Object.fromEntries(
  REPORT_CATEGORIES.map((category) => [category.code, category])
));

module.exports = { REPORT_CATEGORIES, REPORT_CATEGORY_BY_CODE };
