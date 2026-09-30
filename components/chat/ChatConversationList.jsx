import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import BlueTapChatIcon from './BlueTapChatIcon';
import { useChat } from './ChatContext';

const formatTimestamp = (value) => {
  const date = value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function ChatConversationList() {
  const { colors, conversations, error, loading, openConversation, resolveAndOpen, retrySummaries, role, threadError } = useChat();
  const [search, setSearch] = React.useState('');
  const needle = search.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => !needle || [
    conversation.displayName,
    conversation.contextLabel,
    conversation.orderReference,
    conversation.lastMessagePreview,
  ].some((value) => String(value || '').toLowerCase().includes(needle)));
  const emptyCopy = {
    requester: 'Use Follow Up on an active request to contact your station.',
    distributor: 'Chats with your branch and assigned requesters will appear here.',
    manager: 'Operational conversations for your branch will appear here.',
  }[role] || 'Your BlueTap conversations will appear here.';

  return (
    <View style={styles.root}>
      <View style={[styles.searchWrap, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border }]}>
        <TextInput
          accessibilityLabel="Search conversations"
          placeholder="Search conversations"
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          style={[styles.search, { color: colors.textPrimary }]}
        />
      </View>
      {!!threadError && <Text accessibilityRole="alert" style={[styles.inlineError, { color: colors.danger, backgroundColor: colors.dangerSoft }]}>{threadError}</Text>}
      {role === 'distributor' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Message my BlueTap station"
          onPress={() => resolveAndOpen({ type: 'distributor_branch' })}
          style={({ pressed }) => [styles.stationAction, { backgroundColor: colors.primarySoft, borderColor: colors.border }, pressed && styles.pressed]}
        >
          <BlueTapChatIcon size={21} color={colors.primary} />
          <View style={{ flex: 1 }}><Text style={[styles.stationTitle, { color: colors.textPrimary }]}>Message your station</Text><Text style={[styles.stationSubtitle, { color: colors.textSecondary }]}>Contact your current BlueTap branch</Text></View>
        </Pressable>
      )}
      {loading && conversations.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={[styles.helper, { color: colors.textSecondary }]}>Loading conversations…</Text></View>
      ) : error && conversations.length === 0 ? (
        <View style={styles.center}><Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Messages unavailable</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>{error}</Text><Pressable accessibilityRole="button" onPress={retrySummaries}><Text style={[styles.retry, { color: colors.primary }]}>Try again</Text></Pressable></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}><BlueTapChatIcon size={34} color={colors.primary} /><Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{needle ? 'No matching conversations' : 'Your BlueTap conversations will appear here.'}</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>{needle ? 'Try another name or order reference.' : emptyCopy}</Text></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {filtered.map((conversation) => (
            <Pressable
              key={conversation.id}
              accessibilityRole="button"
              accessibilityLabel={`${conversation.displayName}${conversation.unreadCount ? `, ${conversation.unreadCount} unread` : ''}`}
              onPress={() => openConversation(conversation)}
              style={({ pressed, hovered }) => [styles.row, { borderBottomColor: colors.border }, (pressed || hovered) && { backgroundColor: colors.surfaceAlt }]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}><BlueTapChatIcon size={23} color={colors.primary} /></View>
              <View style={styles.rowText}>
                <View style={styles.rowTop}><Text style={[styles.name, { color: colors.textPrimary }, conversation.unreadCount > 0 && styles.unreadName]} numberOfLines={1}>{conversation.displayName}</Text><Text style={[styles.timestamp, { color: colors.textSecondary }]}>{formatTimestamp(conversation.lastMessageAt || conversation.updatedAt)}</Text></View>
                <Text style={[styles.context, { color: colors.textSecondary }]} numberOfLines={1}>{conversation.contextLabel}</Text>
                <View style={styles.previewRow}><Text style={[styles.preview, { color: conversation.unreadCount ? colors.textPrimary : colors.textSecondary }]} numberOfLines={1}>{conversation.lastMessagePreview || 'Start the conversation'}</Text>{conversation.unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.danger }]}><Text style={styles.badgeText}>{conversation.unreadLabel}</Text></View>}</View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchWrap: { marginHorizontal: 12, marginTop: 12, marginBottom: 5, minHeight: 42, borderRadius: 13, borderWidth: 1, justifyContent: 'center' },
  search: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  stationAction: { marginHorizontal: 12, marginVertical: 7, minHeight: 58, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stationTitle: { fontSize: 13, fontWeight: '900' },
  stationSubtitle: { fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { fontSize: 15, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  helper: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  retry: { marginTop: 12, fontWeight: '900' },
  inlineError: { marginHorizontal: 12, marginVertical: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, lineHeight: 16 },
  list: { paddingVertical: 5 },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 14, fontWeight: '800' },
  unreadName: { fontWeight: '950' },
  timestamp: { fontSize: 10, fontWeight: '600' },
  context: { fontSize: 11, marginTop: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  preview: { flex: 1, fontSize: 12 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  pressed: { opacity: 0.82 },
});
