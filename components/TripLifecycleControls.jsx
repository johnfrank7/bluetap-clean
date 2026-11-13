import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { getTripLifecycle, updateTripLifecycle } from '../services/tripApprovals';

const status = {
  resource_reserved: 'Ready for Distributor loading report',
  loading_reported: 'Loading reported · awaiting Manager confirmation',
  in_transit: 'Loading confirmed · trip in progress',
  return_reported: 'Return and unloading reported · awaiting Manager confirmation',
  closed: 'Unloading confirmed · resource released',
};
const actions = {
  distributor: { resource_reserved: ['Report loading', 'report-trip-loading'], in_transit: ['Report return and unloading', 'report-trip-unloading'] },
  manager: { loading_reported: ['Confirm loading and departure', 'confirm-trip-loading'], return_reported: ['Confirm unloading and release', 'confirm-trip-unloading'] },
};

export default function TripLifecycleControls({ mode, role, colors, distributors = [] }) {
  const [trips, setTrips] = React.useState([]); const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState(''); const [busy, setBusy] = React.useState('');
  const generation = React.useRef(0); const lock = React.useRef(false);
  const load = React.useCallback(async () => {
    const current = ++generation.current; setLoading(true);
    try { const rows = await getTripLifecycle(role); if (current === generation.current) { setTrips(rows); setError(''); } }
    catch (failure) { if (current === generation.current) { setTrips([]); setError(failure.message || 'Trip status is unavailable.'); } throw failure; }
    finally { if (current === generation.current) setLoading(false); }
  }, [role]);
  React.useEffect(() => {
    if (mode === 'trip') load().catch(() => {}); else { generation.current += 1; setTrips([]); }
    return () => { generation.current += 1; };
  }, [load, mode]);
  if (mode !== 'trip') return null;
  const perform = async (trip, action) => {
    if (lock.current) return;
    lock.current = true; setBusy(trip.tripId); setError(''); setNotice('');
    try {
      await updateTripLifecycle(role, trip.tripId, action);
      try { await load(); setNotice('Trip report updated.'); }
      catch { setNotice('The action was saved, but the current trip status could not be refreshed.'); }
    } catch (failure) { setTrips([]); setError(failure.message || 'The trip action could not be confirmed. Refresh before retrying.'); }
    finally { lock.current = false; setBusy(''); }
  };
  const button = (label, onPress, disabled) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ hovered, focused }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: focused ? colors.primary : colors.border, backgroundColor: hovered || focused ? colors.primarySoft : (colors.surfaceAlt || colors.surface), borderRadius: 7, opacity: disabled ? 0.5 : 1 })}><Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 12 }}>{label}</Text></Pressable>;
  return <View style={{ marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceAlt || colors.surface, padding: 10, minWidth: 0 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Trip loading and return</Text>
      {button('Refresh trips', () => { setNotice(''); load().catch(() => {}); }, loading || !!busy)}
    </View>
    {!!notice && <Text accessibilityRole="status" style={{ color: colors.textPrimary, marginTop: 4 }}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.textPrimary, marginTop: 4 }}>{error}</Text>}
    {loading && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>Checking trip status…</Text>}
    {!loading && !error && !trips.length && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>No trip reports available.</Text>}
    <ScrollView nestedScrollEnabled style={{ maxHeight: 280 }}>
      {trips.map((trip) => {
        const action = actions[role]?.[trip.state];
        const driver = distributors.find((item) => item.uid === trip.distributorUid);
        return <View key={trip.tripId} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Trip {trip.tripId}{role === 'manager' ? ` · ${driver?.name || trip.distributorUid}` : ''}</Text>
          <Text style={{ color: colors.textSecondary, marginTop: 3 }}>{status[trip.state]}</Text>
          {!!trip.updatedAt && <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Updated: {new Date(trip.updatedAt).toLocaleString('en-US', { timeZone: 'Asia/Manila' })}</Text>}
          {action && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 }}>{button(action[0], () => perform(trip, action[1]), !!busy || loading)}{busy === trip.tripId && <ActivityIndicator size="small" color={colors.primary} />}</View>}
        </View>;
      })}
    </ScrollView>
  </View>;
}
