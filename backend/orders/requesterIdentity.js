const clean = (value) => String(value || '').trim().slice(0, 160);

// Order snapshots are historical facts; only use a profile belonging to the
// order's requester when the order has no name of its own.
function resolveRequesterName(order = {}, profile = {}) {
  const historical = [order.requesterNameSnapshot, order.requester_name, order.requesterName, order.customerName]
    .map(clean).find(Boolean);
  if (historical) return historical;
  const uid = clean(order.requesterUid || order.requester_id);
  const profileUid = clean(profile.uid || profile.id);
  if (!uid || profileUid !== uid) return '';
  return [profile.fullName, profile.full_name,
    `${profile.firstName || profile.first_name || ''} ${profile.lastName || profile.last_name || ''}`,
    profile.name, profile.displayName].map(clean).find(Boolean) || '';
}

module.exports = { resolveRequesterName };
