const BRANCH_SUSPENSION_REASONS = Object.freeze([
  { reasonCode: 'suspected_fraud', reasonLabel: 'Suspected fraud or scam' },
  { reasonCode: 'repeated_non_payment', reasonLabel: 'Repeated non-payment' },
  { reasonCode: 'abusive_fake_ordering', reasonLabel: 'Abusive or fake ordering' },
  { reasonCode: 'harassment_abusive_behavior', reasonLabel: 'Harassment or abusive behavior' },
  { reasonCode: 'safety_concern', reasonLabel: 'Safety concern' },
  { reasonCode: 'branch_policy_violation', reasonLabel: 'Branch policy violation' },
]);

const BRANCH_SUSPENSION_REASON_MAP = Object.freeze(
  new Map(BRANCH_SUSPENSION_REASONS.map((r) => [r.reasonCode, r.reasonLabel]))
);

function getBranchSuspensionLabel(reasonCode) {
  if (!reasonCode) return null;
  return BRANCH_SUSPENSION_REASON_MAP.get(String(reasonCode).trim()) || null;
}

module.exports = {
  BRANCH_SUSPENSION_REASONS,
  BRANCH_SUSPENSION_REASON_MAP,
  getBranchSuspensionLabel,
};
