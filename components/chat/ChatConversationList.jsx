import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import BlueTapChatIcon from './BlueTapChatIcon';
import RoleBadge from '../RoleBadge';
import SoftStatusBadge from '../SoftStatusBadge';
import { useChat } from './ChatContext';
const { timeOf } = require('./chatModel');
const { avatarForConversation, buildRequesterConversationGroups, counterpartRoleLabel } = require('./chatPresentation');

const formatTimestamp = (value) => {
  const date = timeOf(value) ? new Date(timeOf(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const matchesSearch = (item, needle) => !needle || [
  item.displayName,
  item.contextLabel,
  item.orderReference,
  item.lastMessagePreview,
].some((value) => String(value || '').toLowerCase().includes(needle));

function ConversationRow({ colors, conversation, onPress, role }) {
  const avatar = avatarForConversation(conversation, role);
  const roleLabel = counterpartRoleLabel(conversation, role);
  const generalInquiry = role === 'manager'
    && conversation.type === 'requester_branch'
    && !conversation.orderReference;
  const showContext = Boolean(conversation.orderReference)
    || ['distributor_branch', 'branch_coordination'].includes(conversation.type);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${conversation.displayName}${conversation.unreadCount ? `, ${conversation.unreadCount} unread` : ''}`}
      onPress={onPress}
      style={({ pressed, hovered }) => [styles.row, { borderBottomColor: colors.border }, (pressed || hovered) && { backgroundColor: colors.surfaceAlt }]}
    >
      <View style={[styles.avatar, { backgroundColor: avatar.avatarKind === 'station' ? colors.primarySoft : colors.surfaceAlt, borderColor: colors.border }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>{avatar.avatarLabel}</Text>
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <View style={styles.identityRow}>
            <Text style={[styles.name, { color: colors.textPrimary }, conversation.unreadCount > 0 && styles.unreadName]} numberOfLines={1}>{conversation.displayName}</Text>
            {!!roleLabel && <RoleBadge colors={colors} role={roleLabel} compact numberOfLines={1} style={styles.roleBadge} />}
            {!roleLabel && !!conversation.orderStatus && <SoftStatusBadge status={conversation.orderStatus} compact numberOfLines={1} style={styles.statusBadge} />}
            {!roleLabel && !conversation.orderStatus && generalInquiry && <SoftStatusBadge status="pending" label="General inquiry" compact numberOfLines={1} style={styles.statusBadge} />}
          </View>
          <View style={styles.rowMeta}>
            {conversation.unreadCount > 0 && <View style={[styles.badge, { backgroundColor: colors.danger }]}><Text style={styles.badgeText}>{conversation.unreadLabel}</Text></View>}
            <Text style={[styles.timestamp, { color: colors.textSecondary }]}>{formatTimestamp(conversation.lastMessageAt || conversation.updatedAt)}</Text>
          </View>
        </View>
        {showContext && !!conversation.contextLabel && <Text style={[styles.context, { color: colors.textSecondary }]} numberOfLines={1}>{conversation.contextLabel}</Text>}
        <View style={styles.previewRow}><Text style={[styles.preview, { color: conversation.unreadCount ? colors.textPrimary : colors.textSecondary }]} numberOfLines={1}>{conversation.lastMessagePreview || conversation.emptyPreview || 'Start the conversation'}</Text></View>
      </View>
    </Pressable>
  );
}

function ConversationSection({ colors, label, rows, openConversation, resolveAndOpen, role }) {
  if (!rows.length) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>{label}</Text>
      <View style={[styles.sectionRows, { borderColor: colors.border }]}>
        {rows.map((row) => (
          <ConversationRow
            key={row.key || row.id}
            colors={colors}
            conversation={row}
            role={role}
            onPress={() => row.resolveIntent
              ? resolveAndOpen(row.resolveIntent).catch(() => {})
              : openConversation(row)}
          />
        ))}
      </View>
    </View>
  );
}

export default function ChatConversationList() {
  const { colors, conversations, branchDistributors = [], error, loading, openConversation, requesterBranches = [], resolveAndOpen, resolveError, resolvingConversation, retrySummaries, role, stationName } = useChat();
  const [search, setSearch] = React.useState('');
  const needle = search.trim().toLowerCase();
  const filtered = conversations.filter((conversation) => matchesSearch(conversation, needle));
  const managerDistributorRows = role === 'manager' ? branchDistributors.map((user) => {
    const distributorId = user.uid || user.id;
    const existing = conversations.find((conversation) => conversation.type === 'distributor_branch' && conversation.distributorUid === distributorId);
    return {
      ...(existing || {}),
      key: existing?.id || `pinned-${distributorId}`,
      displayName: user.fullName || existing?.displayName || 'Branch Distributor',
      contextLabel: existing?.contextLabel || 'Distributor · Your branch',
      emptyPreview: 'Message this Distributor',
      ...(existing ? {} : { resolveIntent: { type: 'distributor_branch', distributorId }, unreadCount: 0 }),
    };
  }).filter((row) => matchesSearch(row, needle)) : [];
  const managerRequesterRows = role === 'manager' ? filtered.filter((conversation) => conversation.type === 'requester_branch') : [];
  const managerCoordinationRows = role === 'manager' ? filtered.filter((conversation) => conversation.type === 'branch_coordination') : [];
  const stationConversation = role === 'distributor' ? conversations.find((conversation) => conversation.type === 'distributor_branch') : null;
  const distributorStationRows = role === 'distributor' ? [{
    ...(stationConversation || {}),
    key: stationConversation?.id || 'message-station',
    displayName: stationConversation?.displayName || stationName || 'Your BlueTap Station',
    contextLabel: stationConversation?.contextLabel || 'Your current station',
    emptyPreview: 'Message your station',
    ...(stationConversation ? {} : { resolveIntent: { type: 'distributor_branch' }, unreadCount: 0 }),
  }].filter((row) => matchesSearch(row, needle)) : [];
  const distributorRequesterRows = role === 'distributor' ? filtered.filter((conversation) => conversation.type === 'requester_distributor') : [];
  const requesterGroups = role === 'requester' ? buildRequesterConversationGroups(conversations, requesterBranches) : { branchRows: [], distributorRows: [] };
  const requesterBranchRows = requesterGroups.branchRows.filter((row) => matchesSearch(row, needle));
  const requesterDistributorRows = requesterGroups.distributorRows.filter((row) => matchesSearch(row, needle));
  const groupedCount = role === 'manager'
    ? managerDistributorRows.length + managerRequesterRows.length + managerCoordinationRows.length
    : role === 'distributor'
      ? distributorStationRows.length + distributorRequesterRows.length
      : requesterBranchRows.length + requesterDistributorRows.length;
  const emptyCopy = {
    requester: 'Authorized station and assigned Distributor conversations will appear here.',
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
      {!!resolveError && <Text accessibilityRole="alert" style={[styles.inlineError, { color: colors.danger, backgroundColor: colors.dangerSoft }]}>{resolveError}</Text>}
      {resolvingConversation && <View style={styles.resolving}><ActivityIndicator size="small" color={colors.primary} /><Text style={[styles.helper, { color: colors.textSecondary }]}>Opening conversation...</Text></View>}
      {loading && conversations.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={[styles.helper, { color: colors.textSecondary }]}>Loading conversations...</Text></View>
      ) : error && conversations.length === 0 ? (
        <View style={styles.center}><Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Messages unavailable</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>{error}</Text><Pressable accessibilityRole="button" onPress={retrySummaries}><Text style={[styles.retry, { color: colors.primary }]}>Try again</Text></Pressable></View>
      ) : groupedCount === 0 ? (
        <View style={styles.center}><BlueTapChatIcon size={34} color={colors.primary} bubbleColor={colors.surfaceAlt} detailColor={colors.primaryDark || colors.primary} /><Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>{needle ? 'No matching conversations' : 'Your BlueTap conversations will appear here.'}</Text><Text style={[styles.helper, { color: colors.textSecondary }]}>{needle ? 'Try another name or order reference.' : emptyCopy}</Text></View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {role === 'manager' && <>
            <ConversationSection colors={colors} label="BRANCH DISTRIBUTORS" rows={managerDistributorRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
            <ConversationSection colors={colors} label="REQUESTERS" rows={managerRequesterRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
            <ConversationSection colors={colors} label="BRANCH COORDINATION" rows={managerCoordinationRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
          </>}
          {role === 'distributor' && <>
            <ConversationSection colors={colors} label="YOUR STATION" rows={distributorStationRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
            <ConversationSection colors={colors} label="REQUESTERS" rows={distributorRequesterRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
          </>}
          {role === 'requester' && <>
            <ConversationSection colors={colors} label="BRANCH / STATION" rows={requesterBranchRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
            <ConversationSection colors={colors} label="DISTRIBUTORS" rows={requesterDistributorRows} openConversation={openConversation} resolveAndOpen={resolveAndOpen} role={role} />
          </>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchWrap: { marginHorizontal: 12, marginTop: 12, marginBottom: 5, minHeight: 42, borderRadius: 13, borderWidth: 1, justifyContent: 'center' },
  search: { paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyTitle: { fontSize: 15, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  helper: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  retry: { marginTop: 12, fontWeight: '900' },
  inlineError: { marginHorizontal: 12, marginVertical: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, lineHeight: 16 },
  resolving: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  list: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 12 },
  section: { marginTop: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 6, paddingHorizontal: 2 },
  sectionRows: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 13, fontWeight: '950', letterSpacing: 0.4 },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  identityRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { minWidth: 56, flexShrink: 1, fontSize: 14, fontWeight: '800' },
  unreadName: { fontWeight: '950' },
  rowMeta: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  timestamp: { flexShrink: 0, fontSize: 10, fontWeight: '600' },
  context: { fontSize: 11, marginTop: 2 },
  statusBadge: { maxWidth: '52%', flexShrink: 1 },
  roleBadge: { maxWidth: '42%', flexShrink: 1 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  preview: { flex: 1, fontSize: 12 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
});
