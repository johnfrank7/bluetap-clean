import React from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import ManagerNotificationDetailsModal from '../../components/ManagerNotificationDetailsModal';
import ManagerShell from '../../components/ManagerShell';
import NotificationCard from '../../components/NotificationCard';
import { useManagerNotifications } from '../../components/ManagerNotifications';
import { formatNotificationTime } from '../../services/notificationTimestamp';

export default function ManagerNotificationsPage() {
  const router = useRouter();
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
      {events.map((event) => <NotificationCard
        key={event.id}
        accessibilityLabel={`${event.message} Order ${event.requestId}`}
        colors={colors}
        dark={resolvedTheme === 'dark'}
        status={event.status}
        time={formatNotificationTime(event.at)}
        message={event.message}
        metadata={`Order #${event.requestId}${event.requesterName ? ` · ${event.requesterName}` : ''}`}
        onPress={() => {
          markRead([event.id]);
          if (event.navigable !== false && event.orderId) router.push({ pathname: '/manager/request', params: { orderId: event.orderId } });
          else setSelectedEventId(event.id);
        }}
      />)}
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
  list: { alignSelf: 'center', gap: 10, maxWidth: 760, minWidth: 0, width: '100%' },
});
