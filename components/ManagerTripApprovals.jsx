import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { getManagerAdminProposals, getManagerTripOptions, decideManagerProposal } from '../services/tripApprovals';
import { parseTimestamp } from '../services/notificationTimestamp';

const eligible = new Set(['awaiting_distributor_assignment', 'distributor_assigned', 'accepted', 'scheduled', 'delivery_failed']);
const time = (value) => { const date = parseTimestamp(value); return date ? date.toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled'; };

export default function ManagerTripApprovals({ mode, orders, colors, onRefresh }) {
  const [admin, setAdmin] = React.useState([]); const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState(''); const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(''); const [selected, setSelected] = React.useState(null); const [options, setOptions] = React.useState([]); const [tripId, setTripId] = React.useState('');
  const lock = React.useRef(false); const generation = React.useRef(0);
  const activeOrders = React.useMemo(() => (orders || []).filter((order) => eligible.has(String(order.status || '').trim().toLowerCase())), [orders]);
  const pending = React.useMemo(() => activeOrders.flatMap((order) => (Array.isArray(order.distributorRescheduleProposals) ? order.distributorRescheduleProposals : [])
    .filter((proposal) => proposal?.status === 'pending' && proposal.orderId === order.id && proposal.distributorUid === (order.assignedDistributorUid || order.distributor_id))
    .map((proposal) => ({ ...proposal, order, kind: 'distributor' }))), [activeOrders]);
  const load = React.useCallback(async () => {
    if (mode !== 'trip') return;
    const version = ++generation.current;
    setAdmin([]); setLoading(true); setError('');
    try {
      const lists = await Promise.all(activeOrders.map(async (order) => ({ order, data: await getManagerAdminProposals(order.id) })));
      if (version === generation.current) setAdmin(lists.flatMap(({ order, data }) => (Array.isArray(data?.proposals) ? data.proposals : []).filter((item) => item.status === 'pending').map((item) => ({ ...item, order, kind: 'admin' }))));
    } finally { if (version === generation.current) setLoading(false); }
  }, [activeOrders, mode]);
  React.useEffect(() => { let active = true; if (mode === 'trip') load().catch((failure) => { if (active) setError(failure.message || 'Trip approvals are unavailable.'); }); else { setAdmin([]); setSelected(null); } return () => { active = false; generation.current += 1; }; }, [load, mode]);
  if (mode !== 'trip') return null;
  const rows = [...pending, ...admin];
  const action = async (item, approve) => {
    if (lock.current) return;
    if (approve && item.kind === 'distributor' && (!selected || selected.id !== item.id || selected.order?.id !== item.order.id || !tripId)) { setError('Select an eligible trip before approval.'); return; }
    lock.current = true; setBusy(item.id); setError(''); setNotice('');
    try {
      const name = `${approve ? 'approve' : 'reject'}-${item.kind === 'admin' ? 'admin-trip-override' : 'distributor-reschedule'}`;
      const result = await decideManagerProposal(item.order.id, item.id, name, item.kind === 'distributor' && approve ? tripId : undefined);
      if (approve ? !result.order : item.kind === 'admin' ? result.proposal?.status !== 'rejected' : result.proposalStatus !== 'rejected') throw new Error('The decision could not be confirmed.');
      setNotice(approve ? 'Proposal approved.' : 'Proposal rejected.');
      setSelected(null); setOptions([]); setTripId(''); await load(); await onRefresh?.();
    } catch (failure) { setError(failure.message || 'The decision could not be confirmed.'); }
    finally { lock.current = false; setBusy(''); }
  };
  const review = async (item) => {
    if (lock.current) return; lock.current = true; setBusy(item.id); setError('');
    try { const result = await getManagerTripOptions(item.order.id, item.id); if (!Array.isArray(result.trips)) throw new Error('Trip options could not be verified.'); setSelected(item); setOptions(result.trips); setTripId(''); }
    catch (failure) { setSelected(null); setError(failure.message || 'Trip options are unavailable.'); }
    finally { lock.current = false; setBusy(''); }
  };
  const button = (label, onPress, disabled) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ hovered, focused }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: focused ? colors.primary : colors.border, backgroundColor: hovered || focused ? colors.primarySoft : colors.surfaceAlt, borderRadius: 7, opacity: disabled ? 0.5 : 1 })}><Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 12 }}>{label}</Text></Pressable>;
  return <View style={{ marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceAlt, padding: 10 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Trip approvals</Text>
      {button('Refresh approvals', () => load().catch((failure) => setError(failure.message || 'Trip approvals are unavailable.')), loading || !!busy)}
    </View>
    {!!notice && <Text accessibilityRole="status" style={{ color: colors.textPrimary, marginTop: 4 }}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.textPrimary, marginTop: 4 }}>{error}</Text>}
    {loading && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Loading trip proposals…</Text>}
    {!loading && !error && !rows.length && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>No pending trip proposals.</Text>}
    <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }}>
      {rows.map((item) => <View key={`${item.kind}-${item.order.id}-${item.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{item.kind === 'admin' ? 'Admin exception' : 'Distributor reschedule'} · Order #{item.order.requestId || item.order.id}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Current: {time(item.order.scheduledAt || item.order.scheduled_at)} · Proposed: {time(item.scheduledAt)}</Text>
        {item.kind === 'admin' && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Requested {item.action}: {item.source?.distributorUid || item.order.assignedDistributorUid || item.order.distributor_id || 'Unassigned'} → {item.distributorUid} · Trip {item.source?.tripId || 'none'} → {item.tripId} · {item.reason}</Text>}
        {item.kind === 'distributor' && !!item.reason && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{item.reason}</Text>}
        {selected?.id === item.id && selected?.order.id === item.order.id && <View style={{ gap: 5, marginTop: 6 }}>
          {!options.length && <Text style={{ color: colors.textSecondary }}>No eligible trip is available.</Text>}
          {options.map((option) => <View key={option.tripId}>{button(`${tripId === option.tripId ? '✓ ' : ''}${time(option.plannedDeparture)} – ${time(option.estimatedReturn)} · ${option.tripId}${option.hasOtherCargo ? ' · Mixed cargo needs loading review' : ''}`, () => setTripId(option.tripId), !!busy)}</View>)}
        </View>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 }}>
          {item.kind === 'distributor' && button('Select trip', () => review(item), !!busy)}
          {button('Approve', () => action(item, true), !!busy || (item.kind === 'distributor' && (selected?.id !== item.id || selected?.order?.id !== item.order.id || !tripId)))}
          {button('Reject', () => action(item, false), !!busy)}
          {busy === item.id && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>)}
    </ScrollView>
  </View>;
}
