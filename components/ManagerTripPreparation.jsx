import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { getTripPreparation, prepareManagerTrip, parseManilaTripTime, tripMutationId } from '../services/tripApprovals';

const formatTime = (value) => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};

export default function ManagerTripPreparation({ mode, colors, distributors, onRefresh, onSelectedTripChange }) {
  const [data, setData] = React.useState(null); const [selected, setSelected] = React.useState(''); const [driver, setDriver] = React.useState('');
  const [resource, setResource] = React.useState(''); const [departure, setDeparture] = React.useState(''); const [returnTime, setReturnTime] = React.useState('');
  const [stopTime, setStopTime] = React.useState(''); const [mixedRevision, setMixedRevision] = React.useState(null); const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState(''); const [notice, setNotice] = React.useState('');
  const lock = React.useRef(false); const generation = React.useRef(0); const createRequest = React.useRef(null); const assignmentRequests = React.useRef({});
  const load = React.useCallback(async () => {
    const version = ++generation.current;
    try {
      const next = await getTripPreparation();
      if (version === generation.current) {
        setData(next); setError('');
        if (createRequest.current && next.trips.some((trip) => trip.tripId === createRequest.current.id && trip.distributorUid === createRequest.current.uid)) {
          setSelected(createRequest.current.id); onSelectedTripChange?.(createRequest.current.id); setResource(''); setDeparture(''); setReturnTime(''); setMixedRevision(null); createRequest.current = null;
        }
      }
    } catch (failure) { if (version === generation.current) { setData(null); setError(failure.message || 'Trip preparation is unavailable.'); } throw failure; }
  }, [onSelectedTripChange]);
  React.useEffect(() => { if (mode === 'trip') load().catch(() => {}); else { generation.current += 1; setData(null); } return () => { generation.current += 1; }; }, [mode, load]);
  if (mode !== 'trip') return null;
  const trip = data?.trips.find((item) => item.tripId === selected);
  const eligibleDrivers = distributors.filter((item) => data?.eligibleDistributorUids.includes(item.uid));
  const eligibleTripDriver = eligibleDrivers.some((item) => item.uid === trip?.distributorUid);
  const mixed = !!trip && mixedRevision === trip.revision;
  const unsavedSchedule = !!trip && (resource !== (trip.plannedResourceId || '') || departure !== formatTime(trip.plannedDeparture) || returnTime !== formatTime(trip.estimatedReturn));
  const selectedResource = data?.resources.find((item) => item.id === trip?.plannedResourceId);
  const driverName = (uid) => eligibleDrivers.find((item) => item.uid === uid)?.name || 'Distributor unavailable';
  const resourceName = (id) => { const index = data?.resources.findIndex((item) => item.id === id); return index >= 0 ? `Delivery resource ${String.fromCharCode(65 + index)}` : 'Not selected'; };
  const selectTrip = (item) => { setSelected(item.tripId); onSelectedTripChange?.(item.tripId); setResource(item.plannedResourceId || ''); setDeparture(formatTime(item.plannedDeparture)); setReturnTime(formatTime(item.estimatedReturn)); setMixedRevision(null); setStopTime(''); setError(''); setNotice(''); };
  const run = async (key, body) => {
    if (lock.current) return; lock.current = true; setBusy(key); setError(''); setNotice('');
    try {
      await prepareManagerTrip(body);
      if (body.action === 'assign-distributor') delete assignmentRequests.current[body.orderId];
      try { await load(); setNotice('Trip updated. Review the latest details.'); await onRefresh?.(); }
      catch { setNotice('The action was saved, but trip details could not be refreshed.'); }
    } catch (failure) {
      if (!failure.uncertain && body.action === 'assign-distributor') delete assignmentRequests.current[body.orderId];
      if (!failure.uncertain && body.action === 'create-trip' && failure.code !== 'TRIP_EXISTS') createRequest.current = null;
      setError(failure.message || 'The trip action could not be confirmed. Refresh before retrying.');
    }
    finally { lock.current = false; setBusy(''); }
  };
  const button = (label, onPress, disabled = false, selectedState = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: selectedState }} disabled={disabled} onPress={onPress} style={({ hovered, focused, pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: focused || selectedState ? colors.primary : colors.border, backgroundColor: hovered || focused || pressed || selectedState ? colors.primarySoft : (colors.surfaceAlt || colors.surface), borderRadius: 7, opacity: disabled ? 0.55 : 1, maxWidth: '100%' })}><Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 12, flexShrink: 1 }}>{label}</Text></Pressable>;
  const inputStyle = { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 7, color: colors.textPrimary, backgroundColor: colors.surface || colors.surfaceAlt, paddingHorizontal: 10, minWidth: 0, flexGrow: 1 };
  const resources = data?.resources || []; const orders = data?.orders || [];
  const makeTrip = () => {
    if (!driver) { setError('Choose an eligible Distributor.'); return; }
    if (createRequest.current && createRequest.current.uid !== driver) { setError('Refresh to resolve the previous trip request before choosing another Distributor.'); return; }
    try { if (!createRequest.current) createRequest.current = { id: tripMutationId(), uid: driver }; run('create', { action: 'create-trip', tripId: createRequest.current.id, distributorUid: driver }); }
    catch (failure) { setError(failure.message); }
  };
  const saveSchedule = () => {
    const start = parseManilaTripTime(departure); const end = parseManilaTripTime(returnTime);
    if (!start || !end || end <= start || !resources.some((item) => item.id === resource && item.available)) { setError('Choose an available resource and valid departure and return times.'); return; }
    run('schedule', { action: 'schedule-trip', tripId: trip.tripId, resourceId: resource, plannedDeparture: start.toISOString(), estimatedReturn: end.toISOString() });
  };
  const addOrder = (order) => {
    const when = parseManilaTripTime(stopTime);
    if (!when || !trip?.plannedDeparture || !trip?.estimatedReturn) { setError('Schedule the trip and enter a delivery time for this order.'); return; }
    const old = assignmentRequests.current[order.orderId];
    if (old && (old.tripId !== trip.tripId || old.scheduledAt !== when.toISOString())) { setError('Refresh to resolve the earlier assignment before changing its details.'); return; }
    try {
      const request = old || { tripId: trip.tripId, scheduledAt: when.toISOString(), clientMutationId: tripMutationId() }; assignmentRequests.current[order.orderId] = request;
      run(order.orderId, { action: 'assign-distributor', orderId: order.orderId, tripId: request.tripId, distributorUid: trip.distributorUid, scheduledAt: request.scheduledAt, clientMutationId: request.clientMutationId });
    } catch (failure) { setError(failure.message); }
  };
  return <View style={{ marginBottom: 10, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceAlt || colors.surface, minWidth: 0 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}><Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Prepare delivery trip</Text>{button('Refresh trips', () => load().catch(() => {}), !!busy)}</View>
    {!!error && <Text accessibilityRole="alert" style={{ color: colors.textPrimary, marginTop: 5 }}>{error}</Text>}
    {!!notice && <Text accessibilityRole="status" style={{ color: colors.textPrimary, marginTop: 5 }}>{notice}</Text>}
    {busy ? <ActivityIndicator color={colors.primary} /> : null}
    {!data ? <Text style={{ color: colors.textSecondary }}>Trip preparation is not available until its data is verified.</Text> : <>
      <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Choose a Distributor to create a draft. Drafts do not reserve a resource.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>{eligibleDrivers.map((item) => <View key={item.uid}>{button(item.name, () => setDriver(item.uid), !!busy, driver === item.uid)}</View>)}{button('Create draft', makeTrip, !!busy || !eligibleDrivers.some((item) => item.uid === driver))}</View>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 520 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{data.trips.map((item) => <View key={item.tripId}>{button(`${driverName(item.distributorUid)} · ${item.state === 'approved' ? 'Approved' : 'Draft'}${item.plannedDeparture ? ` · ${formatTime(item.plannedDeparture)}` : ' · Unscheduled'}`, () => selectTrip(item), !!busy, selected === item.tripId)}</View>)}</View>
        {trip && <View style={{ gap: 6, marginTop: 8 }}>
          <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{driverName(trip.distributorUid)} · {trip.state === 'approved' ? 'Approved' : 'Draft'}</Text>
          <Text style={{ color: colors.textSecondary }}>Select a verified resource and set Philippine local times. Estimated return does not release the resource.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{resources.map((item) => <View key={item.id}>{button(`${resourceName(item.id)} · ${item.available ? 'Available now' : 'Occupied'}`, () => setResource(item.id), !!busy || !item.available, resource === item.id)}</View>)}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><TextInput accessibilityLabel="Planned departure, Philippine time" value={departure} onChangeText={setDeparture} placeholder="Departure YYYY-MM-DD HH:mm" placeholderTextColor={colors.textSecondary} style={inputStyle} /><TextInput accessibilityLabel="Estimated return, Philippine time" value={returnTime} onChangeText={setReturnTime} placeholder="Return YYYY-MM-DD HH:mm" placeholderTextColor={colors.textSecondary} style={inputStyle} /></View>
          {button('Save trip schedule', saveSchedule, !!busy || !resource || !eligibleTripDriver)}
          {!trip.verified ? <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>Trip cargo requires reconciliation before approval.</Text> : <>
            <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Review: {trip.standardContainers} / 60 standard containers · {60 - trip.standardContainers} remaining</Text>
            <Text style={{ color: colors.textSecondary }}>{resourceName(trip.plannedResourceId)} · {formatTime(trip.plannedDeparture) || 'Unscheduled'} – {formatTime(trip.estimatedReturn) || 'Unscheduled'} (Philippine time)</Text>
            {trip.members.map((member) => <View key={member.orderId} style={{ borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 4 }}><Text style={{ color: colors.textPrimary }}>{member.requestId || 'Customer order'} · {member.requesterName || 'Customer'} · {formatTime(member.scheduledAt)}</Text>{member.cargo.map((cargo, index) => <Text key={`${cargo.productId}-${index}`} style={{ color: colors.textSecondary, fontSize: 12 }}>{cargo.quantity} × {cargo.description || 'Product'}{cargo.classification === 'other' ? ' · Additional cargo: loading review required' : ' · Standard 5-gallon'}</Text>)}</View>)}
            {trip.hasOtherCargo && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: mixed, disabled: !!busy }} disabled={!!busy} onPress={() => setMixedRevision(mixed ? null : trip.revision)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.textPrimary }}>{mixed ? '☑' : '☐'} I reviewed the physical loading arrangement for all additional cargo.</Text></Pressable>}
            {unsavedSchedule && <Text style={{ color: colors.textSecondary }}>Save the schedule changes before approval.</Text>}
            {button('Approve reviewed trip', () => run('approve', { action: 'approve-trip', tripId: trip.tripId, expectedRevision: trip.revision, mixedLoadConfirmed: mixed }), !!busy || !eligibleTripDriver || trip.state !== 'planning' || !trip.members.length || !trip.plannedDeparture || unsavedSchedule || (trip.hasOtherCargo && !mixed))}
            {button('Reserve resource for loading', () => run('reserve', { action: 'reserve-trip-resource', tripId: trip.tripId, resourceId: trip.plannedResourceId }), !!busy || !eligibleTripDriver || trip.state !== 'approved' || !selectedResource?.available)}
          </>}
          <Text style={{ color: colors.textSecondary }}>Assign an eligible order to this trip. This immediately assigns its Distributor and customer delivery time.</Text>
          <TextInput accessibilityLabel="Customer delivery time, Philippine time" value={stopTime} onChangeText={setStopTime} placeholder="Delivery YYYY-MM-DD HH:mm" placeholderTextColor={colors.textSecondary} style={inputStyle} />
          {orders.map((order) => <View key={order.orderId} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingVertical: 4 }}><Text style={{ color: colors.textPrimary, flexShrink: 1 }}>{order.requestId || 'Customer order'} · {order.requesterName || 'Customer'} · {order.verified ? `${order.containers} standard containers` : 'Load review required'}</Text>{button('Assign to trip', () => addOrder(order), !!busy || !eligibleTripDriver || !trip.verified || !order.verified || !trip.plannedDeparture || !stopTime)}</View>)}
        </View>}
      </ScrollView>
    </>}
  </View>;
}
