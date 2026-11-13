function profileDraftsDiffer(draft, baseline, normalizePhone) {
  return Object.keys(changedProfileFields(draft, baseline, normalizePhone)).length > 0;
}

function changedProfileFields(draft, baseline, normalizePhone) {
  const trim = (value) => String(value || '').trim();
  const phone = (value) => normalizePhone(trim(value)) || trim(value);
  const changes = {};
  if (trim(draft.fullName) !== trim(baseline.fullName)) changes.fullName = trim(draft.fullName);
  if (phone(draft.phone) !== phone(baseline.phone)) changes.phone = phone(draft.phone);
  if (trim(draft.address) !== trim(baseline.address)) changes.address = trim(draft.address);
  return changes;
}

module.exports = { profileDraftsDiffer, changedProfileFields };
