import React from 'react';
import { Text, View } from 'react-native';

// Advisory only: a selected trip or one unambiguous active trip, never a total.
export default function ManagerTripCapacity({ snapshot, distributorUid, colors, selectionIsExplicit = false }) {
  const textStyle = { color: colors.textSecondary, fontSize: 11, lineHeight: 15, flexShrink: 1 };
  if (!snapshot || snapshot.status === 'loading') return <Text style={textStyle}>Checking trip capacity…</Text>;
  if (snapshot.status !== 'ready') return <Text accessibilityRole="alert" style={textStyle}>Capacity unavailable · reopen to retry</Text>;
  const activity = snapshot.data.distributors.find((item) => item.distributorUid === distributorUid);
  const count = activity?.tripCount || 0;
  const selected = snapshot.data.selectedTrip;
  const sole = !selectionIsExplicit && !selected && activity?.tripCount === 1 && activity?.inProgressCount === 1 && activity?.soleActiveTrip?.distributorUid === distributorUid && ['resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(activity.soleActiveTrip.state) ? activity.soleActiveTrip : null;
  const trip = selected?.distributorUid === distributorUid ? selected : sole;
  if (!trip || trip.distributorUid !== distributorUid) return <Text style={textStyle}>{!count ? 'No active trip' : count > 1 ? `Multiple trips · Select a relevant trip in preparation${activity.inProgressCount ? ' · Active trip capacity unavailable' : ''}` : activity.inProgressCount === count ? 'Trip in progress · capacity unavailable' : 'Select a relevant trip in preparation'}</Text>;
  if (!trip.verified) return <View style={{ marginTop: 4 }}><Text accessibilityRole="alert" style={textStyle}>{sole ? 'Active' : 'Selected'} trip capacity unknown · review required</Text><Text style={textStyle}>Additional cargo · review status unknown</Text></View>;
  const locked = !['planning', 'approved'].includes(trip.state);
  const departure = trip.plannedDeparture ? new Date(trip.plannedDeparture).toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Unscheduled';
  return <View style={{ marginTop: 4, gap: 2, minWidth: 0 }}>
    <Text style={textStyle}>{sole ? 'Only active trip · Read-only' : 'Selected trip'} · {departure}</Text>
    <Text style={textStyle}>{trip.standardContainers} / 60 standard 5-gallon · {60 - trip.standardContainers} remaining{trip.standardContainers === 60 ? ' · Full' : ''}</Text>
    <View accessibilityRole="progressbar" accessibilityLabel="Standard 5-gallon containers allocated" accessibilityValue={{ min: 0, max: 60, now: trip.standardContainers }} style={{ height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', width: '100%', maxWidth: 180 }}>
      <View style={{ height: '100%', width: `${(trip.standardContainers / 60) * 100}%`, backgroundColor: colors.primary }} />
    </View>
    {locked && <Text style={textStyle}>Trip in progress · additional loading unavailable</Text>}
    {trip.resourceStatus === 'unscheduled' && <Text style={textStyle}>Unscheduled · resource availability not confirmed</Text>}
    {trip.resourceStatus === 'occupied' && <Text style={textStyle}>Delivery resource occupied · loading unavailable</Text>}
    {!trip.eligible && <Text style={textStyle}>Distributor unavailable for assignment</Text>}
    <Text style={textStyle}>{!trip.hasOtherCargo ? 'No additional cargo' : trip.mixedReviewStatus === 'confirmed' ? 'Additional cargo · Manager review confirmed' : 'Additional cargo · Manager review required'}</Text>
    {trip.hasOtherCargo && <Text style={textStyle}>Remaining container positions do not confirm space for other cargo.</Text>}
  </View>;
}
