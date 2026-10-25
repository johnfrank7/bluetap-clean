import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';
import RoleBadge from './RoleBadge';
import { BLUETAP_LAYOUT } from '../constants/bluetapTheme';

const titleCase = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const actionLabel = (value) => titleCase(String(value || '').toLowerCase());
const dateText = (value) => {
  if (!value) return '—';
  const raw = value?._seconds ? value._seconds * 1000 : value?.seconds ? value.seconds * 1000 : value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
const detailText = (event) => [
  event.previousStatus && `${event.previousStatus} → ${event.newStatus}`,
  event.branchId && `Branch: ${event.branchId}`,
].filter(Boolean).join(' · ') || '—';

function actionTone(action) {
  const value = String(action || '').toLowerCase();
  if (/suspend|deactivat|terminat|reject|revoke|fail/.test(value)) return 'danger';
  if (/reactivat|approv|creat|complet|restor/.test(value)) return 'success';
  if (/reset|chang|updat|assign/.test(value)) return 'primary';
  return 'neutral';
}

function ActionBadge({ action, colors, styles }) {
  const tone = actionTone(action);
  const palette = {
    danger: [colors.dangerSoft, colors.iconDanger],
    success: [colors.successSoft, colors.iconSuccess],
    primary: [colors.primarySoft, colors.iconPrimary],
    neutral: [colors.surfaceAlt, colors.textSecondary],
  }[tone];
  return <View style={[styles.actionBadge, { backgroundColor: palette[0] }]}><Text style={[styles.actionBadgeText, { color: palette[1] }]}>{actionLabel(action) || 'Unknown action'}</Text></View>;
}

function RoleValue({ role, colors, styles }) {
  const normalized = String(role || '').toLowerCase();
  return ['requester', 'distributor', 'manager'].includes(normalized)
    ? <RoleBadge colors={colors} label={titleCase(normalized)} role={normalized} />
    : <Text style={styles.mutedValue}>{titleCase(role) || '—'}</Text>;
}

const COLUMNS = [
  ['Time', 'time'], ['Admin / actor', 'actor'], ['Action', 'action'],
  ['Target account', 'target'], ['Role', 'role'], ['Details', 'details'],
];

export default function AdminActivityLog({ events, totalCount, loading, hasData, compact, query, onQueryChange, resolveActorLabel, resolveTargetLabel }) {
  const { colors } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors, compact), [colors, compact]);
  const countLabel = `${totalCount.toLocaleString('en-PH')} ${totalCount === 1 ? 'event' : 'events'}`;

  return <View style={styles.card}>
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>ACCOUNT AUDIT</Text>
      <View style={styles.heroTitleRow}>
        <Text style={styles.title}>Activity log</Text>
        <Text style={styles.heroCount}>{countLabel}</Text>
      </View>
      <Text style={styles.heroDescription}>Server-recorded account and access changes. Sensitive credentials are never stored here.</Text>
    </View>

    <View style={styles.toolbar}>
      <View style={styles.toolbarCopy}>
        <Text style={styles.sectionTitle}>Recent changes</Text>
        <Text style={styles.sectionHint}>{query.trim() ? `Showing ${events.length} matching ${events.length === 1 ? 'event' : 'events'}` : 'Account and access events'}</Text>
      </View>
      <View style={styles.searchField}>
        <Text style={styles.searchLabel}>Search activity</Text>
        <TextInput accessibilityLabel="Search activity log" value={query} onChangeText={onQueryChange} placeholder="Action, actor, target, or role" placeholderTextColor={colors.placeholder} autoCapitalize="none" style={styles.searchInput} />
      </View>
    </View>

    {loading && !hasData ? <View style={styles.emptyState}><Text style={styles.emptyTitle}>Loading activity…</Text></View>
      : events.length === 0 ? <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{query.trim() ? 'No matching activity' : 'No activity recorded yet'}</Text>
        <Text style={styles.emptyHint}>{query.trim() ? 'Try a different action, actor, target, or role.' : 'Recorded account and access changes will appear here.'}</Text>
      </View>
        : compact ? <View style={styles.mobileList}>{events.map((event) => <View key={event.id} style={styles.mobileCard}>
          <View style={styles.mobileTop}>
            <ActionBadge action={event.action} colors={colors} styles={styles} />
            <Text style={styles.mobileTime}>{dateText(event.createdAt)}</Text>
          </View>
          <View style={styles.mobileMeta}><Text style={styles.mobileLabel}>Actor</Text><Text style={styles.mobileValue}>{resolveActorLabel(event)}</Text></View>
          <View style={styles.mobileMeta}><Text style={styles.mobileLabel}>Target account</Text><Text style={styles.mobileValue}>{resolveTargetLabel(event)}</Text></View>
          <View style={styles.mobileMeta}><Text style={styles.mobileLabel}>Role</Text><RoleValue role={event.role} colors={colors} styles={styles} /></View>
          <View style={styles.mobileMeta}><Text style={styles.mobileLabel}>Details</Text><Text style={styles.mobileValue}>{detailText(event)}</Text></View>
        </View>)}</View>
          : <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroll}>
            <View style={styles.table}>
              <View style={styles.tableHeader}>{COLUMNS.map(([label, key]) => <Text key={key} style={[styles.headerCell, styles[`col${key}`]]}>{label}</Text>)}</View>
              {events.map((event, index) => <View key={event.id} style={[styles.tableRow, index % 2 === 1 && styles.alternateRow]}>
                <Text style={[styles.cell, styles.coltime, styles.timeCell]}>{dateText(event.createdAt)}</Text>
                <Text style={[styles.cell, styles.colactor, styles.mainCell]}>{resolveActorLabel(event)}</Text>
                <View style={[styles.cellWrap, styles.colaction]}><ActionBadge action={event.action} colors={colors} styles={styles} /></View>
                <Text style={[styles.cell, styles.coltarget, styles.mainCell]}>{resolveTargetLabel(event)}</Text>
                <View style={[styles.cellWrap, styles.colrole]}><RoleValue role={event.role} colors={colors} styles={styles} /></View>
                <Text style={[styles.cell, styles.coldetails]}>{detailText(event)}</Text>
              </View>)}
            </View>
          </ScrollView>}
  </View>;
}

const createStyles = (colors, compact) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: BLUETAP_LAYOUT.radius.lg, marginBottom: 18, overflow: 'hidden', ...BLUETAP_LAYOUT.shadow },
  hero: { backgroundColor: colors.primaryAction, paddingHorizontal: 22, paddingVertical: 22 },
  eyebrow: { color: colors.onPrimary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 5 },
  title: { color: colors.onPrimary, fontSize: 23, fontWeight: '900' },
  heroCount: { color: colors.onPrimary, borderWidth: 1, borderColor: colors.onPrimary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: '800' },
  heroDescription: { color: colors.onPrimary, fontSize: 13, lineHeight: 19, marginTop: 7, maxWidth: 700 },
  toolbar: { flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'flex-end', justifyContent: 'space-between', gap: 14, padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  toolbarCopy: { flex: compact ? undefined : 1, minWidth: 0 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  sectionHint: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  searchField: { width: compact ? '100%' : 320, maxWidth: '100%' },
  searchLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', marginBottom: 5 },
  searchInput: { minHeight: 44, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, backgroundColor: colors.input, color: colors.textPrimary, paddingHorizontal: 12, fontSize: 13, outlineStyle: 'none' },
  emptyState: { margin: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surfaceAlt, padding: 28, alignItems: 'center' },
  emptyTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  emptyHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  tableScroll: { minWidth: '100%' },
  table: { minWidth: 1110, width: '100%' },
  tableHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44, backgroundColor: colors.surfaceAlt, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.border },
  alternateRow: { backgroundColor: colors.surfaceAlt },
  headerCell: { color: colors.textSecondary, fontSize: 11, fontWeight: '900', paddingHorizontal: 12 },
  cell: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 10, flexShrink: 1 },
  cellWrap: { paddingHorizontal: 12, paddingVertical: 10, flexShrink: 1 },
  mainCell: { color: colors.textPrimary, fontWeight: '800' },
  timeCell: { fontVariant: ['tabular-nums'] },
  coltime: { width: 180 }, colactor: { width: 145 }, colaction: { width: 240 },
  coltarget: { width: 155 }, colrole: { width: 125 }, coldetails: { flex: 1, minWidth: 255 },
  actionBadge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '100%' },
  actionBadgeText: { fontSize: 11, fontWeight: '900', flexShrink: 1 },
  mutedValue: { color: colors.textSecondary, fontSize: 12 },
  mobileList: { padding: 14, gap: 10 },
  mobileCard: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: colors.primaryAction, borderRadius: 12, backgroundColor: colors.surfaceAlt, padding: 14 },
  mobileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  mobileTime: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  mobileMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginTop: 10 },
  mobileLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  mobileValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', textAlign: 'right', flex: 1, minWidth: 0 },
});
