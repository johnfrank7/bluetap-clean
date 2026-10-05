const stableId = (value) => String(value ?? '').trim();

function reconcilePresenceList(current, authoritativeItems, getId, seenIds) {
  const authoritativeIds = new Set();
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  const next = [];

  authoritativeItems.forEach((item, index) => {
    const id = stableId(getId(item, index));
    if (!id) return;
    authoritativeIds.add(id);
    const existing = currentById.get(id);
    const firstAppearance = !seenIds.has(id);
    seenIds.add(id);
    next.push({
      id,
      item,
      phase: firstAppearance ? 'entering' : existing?.phase === 'entering' ? 'entering' : 'present',
      actionsDisabled: false,
    });
  });

  current.forEach((entry) => {
    if (!authoritativeIds.has(entry.id) && entry.phase !== 'exiting') {
      next.push({ ...entry, phase: 'exiting', actionsDisabled: true });
    } else if (!authoritativeIds.has(entry.id) && entry.phase === 'exiting') {
      next.push(entry);
    }
  });

  return next;
}

module.exports = { reconcilePresenceList };
