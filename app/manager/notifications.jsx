import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import ManagerNotificationDetailsModal from '../../components/ManagerNotificationDetailsModal';
import ManagerShell from '../../components/ManagerShell';
import SoftStatusBadge from '../../components/SoftStatusBadge';
import { useManagerNotifications } from '../../components/ManagerNotifications';
import { formatNotificationTime } from '../../services/notificationTimestamp';

export default function ManagerNotificationsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { events, markRead, loading, error } = useManagerNotifications();
  const [selectedEventId, setSelectedEventId] = React.useState(null);
  const selectedEvent = React.useMemo(
    () => events.find((event) => String(event.id) === String(selectedEventId)) || null,
    [events, selectedEventId]
  );
  React.useEffect(() => {
    if (events.length) markRead(events.map((event) => event.id));
  }, [events, markRead]);

  return <ManagerShell active="notifications" title="Notifications" subtitle="Updates from your branch orders and transfer decisions">
    {loading && events.length === 0 ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.secondary}>Loading branch updates…</Text></View> : null}
    {!!error && events.length === 0 ? (
      <BlueTapEmptyState
        compact
        title="Notifications could not be loaded."
        description="Your branch updates are temporarily unavailable. Please try again shortly."
        themeColors={colors}
        dark={resolvedTheme === 'dark'}
      />
    ) : null}
    {!loading && !error && events.length === 0 ? (
      <BlueTapEmptyState
        compact
        title="No Branch Updates Yet"
        description="Order lifecycle and transfer updates for your branch will appear here."
        themeColors={colors}
        dark={resolvedTheme === 'dark'}
      />
    ) : null}
    <View style={styles.list}>
      {events.map((event) => <TouchableOpacity key={event.id} accessibilityRole="button" accessibilityLabel={`${event.message} Order ${event.requestId}`} onPress={() => { markRead([event.id]); setSelectedEventId(event.id); }} style={styles.card}>
        <View style={styles.meta}><SoftStatusBadge status={event.status} dark={resolvedTheme === 'dark'} /><Text style={styles.time}>{formatNotificationTime(event.at)}</Text></View>
        <Text style={styles.message}>{event.message}</Text>
        <Text style={styles.context}>Order #{event.requestId}{event.requesterName ? ` · ${event.requesterName}` : ''}</Text>
      </TouchableOpacity>)}
    </View>
    <ManagerNotificationDetailsModal
      event={selectedEvent}
      visible={selectedEvent !== null}
      onClose={() => setSelectedEventId(null)}
    />
  </ManagerShell>;
}

const createStyles = (colors) => StyleSheet.create({
  state: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { color: colors.textSecondary, fontSize: 13 },
  list: { gap: 10 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 7 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  time: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  message: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', lineHeight: 21 },
  context: { color: colors.textSecondary, fontSize: 12 },
});
