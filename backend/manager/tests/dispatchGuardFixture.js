// Regression fixtures model guards after a successful legacy backfill. Guard
// concurrency and reconciliation are exercised separately with the emulator.
function seedDispatchGuards(records) {
  const active = new Set(['distributor_assigned', 'accepted', 'scheduled', 'out_for_delivery', 'delivery_failed']);
  for (const [path, profile] of records) {
    if (!path.startsWith('users/') || profile.role !== 'distributor') continue;
    const uid = path.slice('users/'.length);
    const reservations = [];
    for (const [orderPath, order] of records) {
      if (!orderPath.startsWith('requests/') || !active.has(String(order.status || '').toLowerCase()) || (order.assignedDistributorUid || order.distributor_id) !== uid) continue;
      reservations.push({ orderId: orderPath.slice('requests/'.length), scheduledAt: order.scheduledAt ?? order.scheduled_at ?? null });
    }
    records.set(`distributorDispatchGuards/${uid}`, { schemaVersion: 1, initialized: true, distributorUid: uid, revision: 0, reservations });
  }
}
module.exports = { seedDispatchGuards };
