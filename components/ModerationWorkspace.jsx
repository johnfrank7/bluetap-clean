import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { applyModerationAction, loadExpandedChatReview, loadModerationCases, loadModerationDetail } from '../services/moderationApi';
import { useAdminTheme } from './AdminTheme';

const STATUS_TABS = ['', 'open', 'escalated', 'resolved'];
const ACTIONS = {
  manager: [
    ['dismiss', 'Dismiss'], ['warn', 'Warn'], ['suspend_branch_chat', 'Restrict branch chat'],
    ['suspend_branch_ordering', 'Restrict branch ordering'], ['escalate', 'Escalate to Admin'],
  ],
  admin: [
    ['dismiss', 'Dismiss'], ['warn', 'Warn'], ['suspend_platform_chat', 'Restrict platform chat'],
    ['suspend_platform_ordering', 'Restrict platform ordering'], ['suspend_account', 'Suspend account'],
    ['terminate_account', 'Terminate account'], ['reactivate', 'Reactivate account'],
  ],
};
const RESTRICTIONS = new Set(['suspend_branch_chat', 'suspend_branch_ordering', 'suspend_platform_chat', 'suspend_platform_ordering']);
const ABUSE_ACTIONS = new Set(['warn', 'suspend_branch_ordering', 'suspend_platform_ordering', 'suspend_account', 'terminate_account', 'escalate']);
const newMutationId = () => globalThis.crypto?.randomUUID?.() || `mod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateLabel = (value) => {
  const date = value?.toDate?.() || new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
};

export default function ModerationWorkspace({ role }) {
  const { colors } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [status, setStatus] = React.useState('open');
  const [kind, setKind] = React.useState('reports');
  const [items, setItems] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [action, setAction] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [privateNote, setPrivateNote] = React.useState('');
  const [durationDays, setDurationDays] = React.useState(role === 'manager' ? '1' : '7');
  const [saving, setSaving] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setLoading(true); setError(''); setSelected(null); setDetail(null); setExpanded(null);
    try {
      const result = await loadModerationCases(role, { kind, status: kind === 'reports' ? status : '', limit: 25 });
      setItems(kind === 'reports' ? result.reports || [] : result.abuseReviews || []);
    } catch (loadError) { setError(loadError.message); setItems([]); }
    finally { setLoading(false); }
  }, [kind, role, status]);
  React.useEffect(() => { refresh(); }, [refresh]);

  const select = async (item) => {
    setSelected(item); setDetail(null); setExpanded(null); setAction(''); setReason(''); setPrivateNote(''); setError('');
    if (kind !== 'reports') return;
    try { setDetail(await loadModerationDetail(role, item.id)); } catch (loadError) { setError(loadError.message); }
  };
  const submitAction = async () => {
    if (!action) return setError('Choose a moderation action.');
    if (action !== 'dismiss' && !reason.trim()) return setError('A user-safe reason is required.');
    setSaving(true); setError('');
    try {
      await applyModerationAction(role, {
        ...(kind === 'reports' ? { reportId: selected.id } : { abuseReviewId: selected.id }),
        action, reason: reason.trim(), privateNote: privateNote.trim(), clientMutationId: newMutationId(),
        ...(RESTRICTIONS.has(action) ? { durationDays: Number(durationDays) } : {}),
      });
      await refresh();
    } catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  };
  const expandReview = async () => {
    if (!reason.trim()) return setError('Enter a reason before expanding chat context.');
    setSaving(true); setError('');
    try { setExpanded(await loadExpandedChatReview({ reportId: selected.id, reason: reason.trim() })); }
    catch (reviewError) { setError(reviewError.message); }
    finally { setSaving(false); }
  };

  const durations = role === 'manager' ? [1, 3, 7] : [1, 3, 7, 30];
  return <View style={styles.root}>
    <View style={styles.tabs}>
      <Pressable onPress={() => setKind('reports')} style={[styles.tab, kind === 'reports' && styles.tabActive]}><Text style={[styles.tabText, kind === 'reports' && styles.tabTextActive]}>Chat reports</Text></Pressable>
      <Pressable onPress={() => setKind('abuse')} style={[styles.tab, kind === 'abuse' && styles.tabActive]}><Text style={[styles.tabText, kind === 'abuse' && styles.tabTextActive]}>Ordering abuse review</Text></Pressable>
    </View>
    {kind === 'reports' && <View style={styles.filters}>{STATUS_TABS.map((value) => <Pressable key={value || 'all'} onPress={() => setStatus(value)} style={[styles.filter, status === value && styles.filterActive]}><Text style={[styles.filterText, status === value && styles.filterTextActive]}>{value || 'All'}</Text></Pressable>)}</View>}
    {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
    <View style={styles.columns}>
      <View style={styles.listPanel}>
        <View style={styles.panelHeader}><Text style={styles.panelTitle}>{kind === 'reports' ? 'Report queue' : 'Review queue'}</Text><Pressable onPress={refresh}><Text style={styles.link}>Refresh</Text></Pressable></View>
        {loading ? <ActivityIndicator color={colors.primary} style={{ margin: 30 }} /> : items.length === 0 ? <Text style={styles.empty}>No cases in this view.</Text> : items.map((item) => <Pressable key={item.id} onPress={() => select(item)} style={[styles.case, selected?.id === item.id && styles.caseSelected]}>
          <Text style={styles.caseTitle}>{kind === 'reports' ? item.categoryLabel || item.category : `${item.requester?.name || 'Requester'} · ${item.severity}`}</Text>
          <Text style={styles.caseMeta}>{kind === 'reports' ? `${item.publicReference} · ${item.status}` : `${item.incidentCount} incidents in ${item.windowDays} days`}</Text>
          <Text style={styles.caseMeta}>{dateLabel(item.createdAt || item.lastIncidentAt)}</Text>
        </Pressable>)}
      </View>
      <View style={styles.detailPanel}>
        {!selected ? <Text style={styles.empty}>Select a case to review its evidence and history.</Text> : <>
          <Text style={styles.panelTitle}>{kind === 'reports' ? selected.publicReference : 'Ordering abuse review'}</Text>
          <Text style={styles.scope}>{role === 'manager' ? 'Branch-scoped authority' : 'Platform Admin authority'}</Text>
          {kind === 'reports' ? <>
            <Text style={styles.heading}>{selected.categoryLabel}</Text><Text style={styles.body}>{selected.details || 'No optional details were supplied.'}</Text>
            <Text style={styles.metaStrong}>Reporter: {selected.reporter?.name || selected.reporter?.publicUid} ({selected.reporter?.role})</Text>
            <Text style={styles.metaStrong}>Reported: {selected.reportedUser?.name || selected.reportedUser?.publicUid} ({selected.reportedUser?.role})</Text>
            <Text style={styles.metaStrong}>Branch: {selected.branchId || 'Unavailable'} · Order: {selected.orderReference || 'No order reference'}</Text>
            <Text style={styles.metaStrong}>Submitted: {dateLabel(selected.createdAt)}</Text>
            {(detail?.report?.evidence || []).map((message) => <View key={`${message.messageId}-${message.seq}`} style={styles.evidence}><Text style={styles.evidenceMeta}>{message.senderRole} · sequence {message.seq} · {dateLabel(message.createdAt)}</Text><Text style={styles.body}>{message.body}</Text></View>)}
            {(detail?.restrictions || []).map((entry, index) => <Text key={`${entry.kind}-${entry.scope}-${index}`} style={styles.history}>Active {entry.kind} restriction · {entry.scope} · until {dateLabel(entry.endsAt)}</Text>)}
            {[...(detail?.actions || [])].reverse().map((entry) => <Text key={entry.id} style={styles.history}>{entry.action} by {entry.actorRole} · {dateLabel(entry.createdAt)}</Text>)}
            {role === 'admin' && <Pressable disabled={saving} onPress={expandReview} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Audit and load up to 20 messages</Text></Pressable>}
            {(expanded?.context || []).map((message) => <View key={`expanded-${message.messageId}`} style={styles.expanded}><Text style={styles.evidenceMeta}>Expanded · sequence {message.seq}</Text><Text style={styles.body}>{message.body}</Text></View>)}
          </> : <>{(selected.incidents || []).map((incident, index) => <View key={`${incident.orderReference}-${index}`} style={styles.evidence}><Text style={styles.evidenceMeta}>{incident.type} · {incident.concern} concern</Text><Text style={styles.body}>Order {incident.orderReference} · {incident.category} · {incident.stage}</Text></View>)}</>}
          <Text style={styles.heading}>Moderation decision</Text>
          <View style={styles.actionGrid}>{ACTIONS[role].filter(([value]) => kind === 'reports' || ABUSE_ACTIONS.has(value)).map(([value, label]) => <Pressable key={value} onPress={() => setAction(value)} style={[styles.action, action === value && styles.actionSelected]}><Text style={[styles.actionText, action === value && styles.actionTextSelected]}>{label}</Text></Pressable>)}</View>
          {RESTRICTIONS.has(action) && <View style={styles.durations}>{durations.map((days) => <Pressable key={days} onPress={() => setDurationDays(String(days))} style={[styles.duration, durationDays === String(days) && styles.actionSelected]}><Text style={styles.actionText}>{days} day{days === 1 ? '' : 's'}</Text></Pressable>)}</View>}
          <TextInput accessibilityLabel="User-safe moderation reason" placeholder="Reason shown in the audit record" placeholderTextColor={colors.placeholder} value={reason} onChangeText={(value) => setReason(value.slice(0, 1000))} multiline style={styles.input} />
          <TextInput accessibilityLabel="Private moderator note" placeholder="Private moderator note (never shown to the user)" placeholderTextColor={colors.placeholder} value={privateNote} onChangeText={(value) => setPrivateNote(value.slice(0, 1000))} multiline style={styles.input} />
          <Pressable disabled={saving} onPress={submitAction} style={[styles.primaryButton, saving && { opacity: .6 }]}><Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Apply decision'}</Text></Pressable>
        </>}
      </View>
    </View>
  </View>;
}

const createStyles = (colors) => StyleSheet.create({
  root: { paddingTop: 18 }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tab: { paddingHorizontal: 15, minHeight: 42, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, tabActive: { backgroundColor: colors.primary }, tabText: { color: colors.textPrimary, fontWeight: '800' }, tabTextActive: { color: colors.onPrimary }, filters: { flexDirection: 'row', gap: 7, marginTop: 12, flexWrap: 'wrap' }, filter: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border }, filterActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, filterText: { color: colors.textSecondary, textTransform: 'capitalize', fontWeight: '700' }, filterTextActive: { color: colors.primary },
  errorBox: { marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: colors.dangerSoft }, errorText: { color: colors.danger, fontWeight: '700' }, columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 16, alignItems: 'flex-start' }, listPanel: { flex: 1, minWidth: 280, maxWidth: 430, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14 }, detailPanel: { flex: 2, minWidth: 320, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 18 }, panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, panelTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' }, link: { color: colors.primary, fontWeight: '900' }, empty: { color: colors.textSecondary, paddingVertical: 24, textAlign: 'center' }, case: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 12, marginTop: 10, backgroundColor: colors.surfaceAlt }, caseSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, caseTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 13 }, caseMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 4 }, scope: { color: colors.primary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginTop: 4 }, heading: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 5 }, body: { color: colors.textPrimary, fontSize: 13, lineHeight: 19 }, metaStrong: { color: colors.textSecondary, fontSize: 12, marginTop: 7 }, evidence: { marginTop: 9, padding: 11, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, expanded: { marginTop: 7, padding: 10, borderRadius: 9, backgroundColor: colors.warningSoft }, evidenceMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', marginBottom: 4 }, history: { color: colors.textSecondary, fontSize: 11, marginTop: 6 }, actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, action: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 }, actionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, actionText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' }, actionTextSelected: { color: colors.primary }, durations: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, duration: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 }, input: { minHeight: 72, marginTop: 11, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, backgroundColor: colors.input, color: colors.textPrimary, padding: 11, textAlignVertical: 'top' }, primaryButton: { marginTop: 12, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryAction }, primaryButtonText: { color: colors.onPrimary, fontWeight: '900' }, outlineButton: { marginTop: 12, minHeight: 40, borderRadius: 9, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, outlineButtonText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
});
