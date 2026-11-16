import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { applyModerationAction, loadExpandedChatReview, loadModerationCases, loadModerationDetail } from '../services/moderationApi';
import { useAdminTheme } from './AdminTheme';
import { useModerationActivitySignal } from './useModerationActivityBadge';
import { formatModerationTimestamp, moderationActionLabel } from '../services/moderationPresentation';
import BlueTapEmptyState from './BlueTapEmptyState';
import SidebarIcon from './SidebarIcon';
import ReportsSafetyWebStyles from './ReportsSafetyWebStyles';

const STATUS_TABS = ['active', 'open', 'escalated', 'resolved'];
const STATUS_LABELS = { active: 'Active', open: 'Open', escalated: 'Escalated', resolved: 'Resolved' };
const EMPTY_STATES = {
  active: ['No active reports', 'New and escalated reports requiring review will appear here.'],
  open: ['No open reports', 'New reports requiring review will appear here.'],
  escalated: ['No escalated reports', 'Cases escalated for higher-level review will appear here.'],
  resolved: ['No resolved reports yet', 'Completed safety reviews will appear here.'],
};
const ACTIONS = {
  manager: [
    ['dismiss', 'Dismiss'], ['warn', 'Warn'], ['suspend_branch_chat', 'Restrict branch chat'],
    ['suspend_branch_ordering', 'Restrict branch ordering'], ['escalate', 'Escalate to Admin'],
  ],
  admin: [
    ['dismiss', 'Dismiss'], ['warn', 'Warn'], ['suspend_platform_chat', 'Restrict platform chat'],
    ['suspend_platform_ordering', 'Restrict platform ordering'], ['suspend_account', 'Suspend account'],
    ['terminate_account', 'Terminate account'],
  ],
};
const RESTRICTIONS = new Set(['suspend_branch_chat', 'suspend_branch_ordering', 'suspend_platform_chat', 'suspend_platform_ordering']);
const ABUSE_ACTIONS = new Set(['warn', 'suspend_branch_ordering', 'suspend_platform_ordering', 'escalate']);
const ABUSE_PUNITIVE_ACTIONS = new Set(['warn', 'suspend_branch_ordering', 'suspend_platform_ordering']);
const newMutationId = () => globalThis.crypto?.randomUUID?.() || `mod-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateLabel = formatModerationTimestamp;

export default function ModerationWorkspace({ role, initialKind = 'reports', hideWorkflowTabs = false }) {
  const { colors, resolvedTheme } = useAdminTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 1000;
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [status, setStatus] = React.useState('active');
  const [kind, setKind] = React.useState(initialKind);
  React.useEffect(() => { if (hideWorkflowTabs) setKind(initialKind); }, [hideWorkflowTabs, initialKind]);
  const [items, setItems] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [moreError, setMoreError] = React.useState('');
  const [selected, setSelected] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [listError, setListError] = React.useState('');
  const [error, setError] = React.useState('');
  const [action, setAction] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [privateNote, setPrivateNote] = React.useState('');
  const [durationDays, setDurationDays] = React.useState(role === 'manager' ? '1' : '7');
  const [saving, setSaving] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);
  const [confirming, setConfirming] = React.useState(false);
  const [selectedGrounds, setSelectedGrounds] = React.useState([]);
  const pendingAccountSubmission = React.useRef(null);
  const submitting = React.useRef(false);
  const detailEpoch = React.useRef(0);
  const listEpoch = React.useRef(0);
  const loadingMoreRef = React.useRef(false);
  const activityRevision = useModerationActivitySignal(role);

  const refresh = React.useCallback(async () => {
    const epoch = ++listEpoch.current;
    loadingMoreRef.current = false; setMoreError('');
    detailEpoch.current += 1;
    setLoading(true); setLoadingMore(false); setCursor(null); setDetailLoading(false); setError(''); setListError(''); setSelected(null); setDetail(null); setExpanded(null); setSelectedGrounds([]);
    try {
      const result = await loadModerationCases(role, { kind, status: kind === 'reports' ? status : '', limit: 25 });
      if (epoch === listEpoch.current) { setItems(kind === 'reports' ? result.reports || [] : result.abuseReviews || []); setCursor(kind === 'reports' ? result.nextCursor || null : null); }
    } catch (loadError) { if (epoch === listEpoch.current) { setListError(loadError.message || 'The queue could not be loaded.'); setItems([]); } }
    finally { if (epoch === listEpoch.current) setLoading(false); }
  }, [kind, role, status]);
  React.useEffect(() => { refresh(); return () => { listEpoch.current += 1; detailEpoch.current += 1; }; }, [activityRevision, refresh]);

  const loadMore = async () => {
    if (kind !== 'reports' || !cursor || loading || loadingMoreRef.current) return;
    const epoch = listEpoch.current;
    loadingMoreRef.current = true; setLoadingMore(true); setMoreError('');
    try {
      const result = await loadModerationCases(role, { kind, status: kind === 'reports' ? status : '', limit: 25, cursor });
      if (epoch !== listEpoch.current) return;
      const nextItems = result.reports || [];
      setItems((current) => [...current, ...nextItems.filter((item) => !current.some((known) => known.id === item.id))]);
      setCursor(result.nextCursor || null);
    } catch (loadError) { if (epoch === listEpoch.current) setMoreError(loadError.message || 'More cases could not be loaded.'); }
    finally { if (epoch === listEpoch.current) { loadingMoreRef.current = false; setLoadingMore(false); } }
  };

  const select = async (item) => {
    const epoch = ++detailEpoch.current;
    setSelected(item); setDetail(null); setExpanded(null); setAction(''); setReason(''); setPrivateNote(''); setError(''); setSelectedGrounds([]);
    if (kind !== 'reports') { setDetailLoading(false); return; }
    setDetailLoading(true);
    try { const result = await loadModerationDetail(role, item.id); if (epoch === detailEpoch.current) setDetail(result); }
    catch (loadError) { if (epoch === detailEpoch.current) setError(loadError.message || 'Case details could not be loaded.'); }
    finally { if (epoch === detailEpoch.current) setDetailLoading(false); }
  };
  const submitAction = () => {
    if (!action) return setError('Choose a moderation action.');
    if (action !== 'dismiss' && !reason.trim()) return setError('A user-safe reason is required.');
    if (['suspend_account', 'terminate_account'].includes(action) && reason.trim().length < 20) {
      return setError('Describe the factual reason in at least 20 characters.');
    }
    if (kind === 'abuse' && ABUSE_PUNITIVE_ACTIONS.has(action) && !selectedGrounds.length) {
      return setError('Select at least one incident. The server will verify its eligibility.');
    }
    setConfirming(true);
  };
  const confirmAction = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setConfirming(false);
    setSaving(true); setError('');
    try {
      const accountAction = role === 'admin' && kind === 'reports'
        && ['suspend_account', 'terminate_account'].includes(action);
      const proposed = {
        ...(kind === 'reports' ? { reportId: selected.id } : { abuseReviewId: selected.id }),
        action, reason: reason.trim(), privateNote: privateNote.trim(),
        ...(kind === 'abuse' && ABUSE_PUNITIVE_ACTIONS.has(action) ? { incidentIds: selectedGrounds } : {}),
        ...(RESTRICTIONS.has(action) ? { durationDays: Number(durationDays) } : {}),
      };
      const pending = pendingAccountSubmission.current;
      if (accountAction && pending?.reportId === selected.id
        && (pending.action !== action || pending.reason !== proposed.reason
          || pending.privateNote !== proposed.privateNote)) {
        setError('Finish the pending account action before changing its reason or decision.');
        return;
      }
      const submission = accountAction && pending?.reportId === selected.id
        ? pending : { ...proposed, clientMutationId: newMutationId() };
      if (accountAction) pendingAccountSubmission.current = submission;
      const result = await applyModerationAction(role, submission);
      if (result.accountAction?.pending) {
        setSelected((current) => current?.id === selected.id
          ? { ...current, accountActionPending: true } : current);
        setError('Account access is held while Firebase Auth is reconciled. Retry this exact decision shortly.');
        return;
      }
      if (accountAction) pendingAccountSubmission.current = null;
      await refresh();
    } catch (saveError) {
      if (saveError.status >= 400 && saveError.status < 500) pendingAccountSubmission.current = null;
      setError(saveError.message);
    }
    finally { submitting.current = false; setSaving(false); }
  };
  const retryAccountAction = async () => {
    if (!selected?.id || submitting.current) return;
    submitting.current = true;
    setSaving(true); setError('');
    try {
      const result = await applyModerationAction('admin', { action: 'retryChatAccountAction', reportId: selected.id });
      if (result.accountAction?.pending) {
        setError('The account action is still pending reconciliation. Account access remains held.');
      } else {
        pendingAccountSubmission.current = null;
        await refresh();
      }
    } catch (retryError) { setError(retryError.message); }
    finally { submitting.current = false; setSaving(false); }
  };
  const expandReview = async () => {
    if (!reason.trim()) return setError('Enter a reason before expanding chat context.');
    const epoch = detailEpoch.current;
    setSaving(true); setError('');
    try { const result = await loadExpandedChatReview({ reportId: selected.id, reason: reason.trim() }); if (epoch === detailEpoch.current) setExpanded(result); }
    catch (reviewError) { if (epoch === detailEpoch.current) setError(reviewError.message); }
    finally { setSaving(false); }
  };

  const durations = role === 'manager' ? [1, 3, 7] : [1, 3, 7, 30];
  const mobileAbuseQueue = role === 'manager' && kind === 'abuse' && narrow;
  const QueueContainer = narrow && !mobileAbuseQueue ? View : ScrollView;
  return <View style={styles.root}>
    <ReportsSafetyWebStyles colors={colors} />
    {!hideWorkflowTabs && <View style={styles.tabs}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: kind === 'reports' }} dataSet={{ safetyButton: kind === 'reports' ? 'primary' : undefined }} onPress={() => setKind('reports')} style={[styles.tab, kind === 'reports' && styles.tabActive]}><Text style={[styles.tabText, kind === 'reports' && styles.tabTextActive]}>Chat Reports</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: kind === 'abuse' }} dataSet={{ safetyButton: kind === 'abuse' ? 'primary' : undefined }} onPress={() => setKind('abuse')} style={[styles.tab, kind === 'abuse' && styles.tabActive]}><Text style={[styles.tabText, kind === 'abuse' && styles.tabTextActive]}>Ordering Abuse Review</Text></Pressable>
    </View>}
    <Text style={styles.scope}>{role === 'manager' ? 'Branch-scoped review' : 'Platform-wide review'}</Text>
    {kind === 'reports' && <Text style={styles.caseMeta}>Active includes open and escalated reports. Open awaits review; escalated needs Admin review; resolved cases have a recorded outcome.</Text>}
    {kind === 'reports' && <View style={styles.filters}>{STATUS_TABS.map((value) => <Pressable accessibilityRole="button" accessibilityState={{ selected: status === value }} dataSet={{ safetyChoice: status === value ? 'selected' : undefined }} key={value} onPress={() => setStatus(value)} style={[styles.filter, status === value && styles.filterActive]}><Text style={[styles.filterText, status === value && styles.filterTextActive]}>{STATUS_LABELS[value]}</Text></Pressable>)}</View>}
    {!!error && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
    {!!listError && <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{listError}</Text></View>}
    <View style={styles.columns}>
      {(!narrow || !selected) && <View style={[styles.listPanel, narrow && styles.narrowPanel, mobileAbuseQueue && width < 900 && styles.mobileUtilityClearance]}>
        <View style={styles.panelHeader}><View style={styles.panelHeading}><SidebarIcon name="FileSearch" size={18} color={colors.iconPrimary} /><Text style={styles.panelTitle}>{kind === 'reports' ? 'Report queue' : 'Review queue'}</Text></View><Pressable accessibilityRole="button" onPress={refresh} style={styles.refresh}><Text style={styles.link}>Refresh</Text></Pressable></View>
        <QueueContainer style={mobileAbuseQueue ? styles.mobileQueueScroll : !narrow && styles.queueScroll} {...(mobileAbuseQueue ? { nestedScrollEnabled: true } : {})}>
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primaryAction} /><Text style={styles.caseMeta}>Loading cases...</Text></View> : listError ? <Text style={styles.empty}>The queue is unavailable. Select Refresh to retry.</Text> : items.length === 0 ? <BlueTapEmptyState compact variant={kind === 'reports' ? 'exceptions' : 'management'} title={kind === 'reports' ? EMPTY_STATES[status][0] : 'No ordering reviews'} description={kind === 'reports' ? EMPTY_STATES[status][1] : 'New order-abuse review signals will appear here.'} themeColors={colors} dark={resolvedTheme === 'dark'} style={styles.emptyState} /> : items.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selected?.id === item.id }} dataSet={{ safetyChoice: selected?.id === item.id ? 'selected' : undefined }} accessibilityLabel={kind === 'reports' ? `Open report ${item.publicReference}` : 'Open ordering abuse review'} key={item.id} onPress={() => select(item)} style={({ hovered, pressed }) => [styles.case, selected?.id === item.id && styles.caseSelected, (hovered || pressed) && styles.interacting]}>
          {kind === 'reports' ? <><View style={styles.caseTop}><View style={[styles.statusBadge, item.status === 'resolved' ? styles.resolvedBadge : item.status === 'escalated' ? styles.escalatedBadge : styles.openBadge]}><Text style={styles.statusBadgeText}>{STATUS_LABELS[item.status] || 'Review'}</Text></View><Text style={styles.reference}>{item.publicReference}</Text></View><Text style={styles.caseTitle}>{item.categoryLabel || item.category}</Text><Text style={styles.caseMeta}>Reported: {item.reportedUser?.name || item.reportedUser?.publicUid || 'Account unavailable'}</Text><Text style={styles.caseMeta}>Reporter: {item.reporter?.role || 'User'}{item.reporter?.publicUid ? ` · ${item.reporter.publicUid}` : ''}</Text><Text style={styles.caseMeta}>{item.orderReference ? `Order ${item.orderReference} · ` : ''}Branch {item.branchId || 'unavailable'}</Text></> : <><Text style={styles.caseTitle}>{item.requester?.name || 'Requester'} · {item.severity}</Text><Text style={styles.caseMeta}>{item.incidentCount} incidents in {item.windowDays} days</Text></>}
          <Text style={styles.caseMeta}>Submitted {dateLabel(item.createdAt || item.lastIncidentAt)}</Text>
        </Pressable>)}
        {kind === 'abuse' && !loading && !listError && items.length === 25 && <Text style={styles.caseMeta}>Showing up to 25 ordering reviews. Additional reviews are not available in this queue.</Text>}
        {!!moreError && <Text accessibilityRole="alert" style={styles.errorText}>{moreError}</Text>}
        {!!cursor && <Pressable accessibilityRole="button" disabled={loadingMore} onPress={loadMore} style={[styles.outlineButton, loadingMore && styles.disabledButton]}><Text style={[styles.outlineButtonText, loadingMore && styles.disabledButtonText]}>{loadingMore ? 'Loading…' : moreError ? 'Retry loading more' : 'Load more cases'}</Text></Pressable>}
        </QueueContainer>
      </View>}
      {(!narrow || selected) && <View style={[styles.detailPanel, narrow && styles.narrowPanel, mobileAbuseQueue && width < 900 && styles.mobileUtilityClearance]}>
        {!selected ? <Text style={styles.empty}>Select a case to review its evidence and history.</Text> : <>
          {narrow && <Pressable accessibilityRole="button" accessibilityLabel="Back to report queue" onPress={() => { detailEpoch.current += 1; setDetailLoading(false); setSelected(null); setDetail(null); setExpanded(null); }} style={styles.backButton}><Text style={styles.link}>‹ Back to queue</Text></Pressable>}
          <Text style={styles.panelTitle}>{kind === 'reports' ? selected.publicReference : 'Ordering abuse review'}</Text>
          {kind === 'reports' && <Text style={styles.caseMeta}>Status: {STATUS_LABELS[selected.status] || 'Review'}</Text>}
          <Text style={styles.scope}>{role === 'manager' ? 'Branch-scoped review' : 'Platform-wide review'}</Text>
          {kind === 'reports' ? <>
            <View style={styles.section}><Text style={styles.sectionLabel}>CASE SUMMARY</Text><Text style={styles.caseTitle}>{selected.categoryLabel || selected.category}</Text><Text style={styles.body}>{selected.details || 'No additional details provided.'}</Text><Text style={styles.metaStrong}>Submitted {dateLabel(selected.createdAt)}</Text></View>
            <View style={styles.section}><Text style={styles.sectionLabel}>PEOPLE INVOLVED</Text><Text style={styles.metaStrong}>Reported by: {selected.reporter?.name || selected.reporter?.publicUid || 'Unavailable'} · {selected.reporter?.role || 'User'}</Text><Text style={styles.metaStrong}>Reported account: {selected.reportedUser?.name || selected.reportedUser?.publicUid || 'Unavailable'} · {selected.reportedUser?.role || 'User'}</Text></View>
            <View style={styles.section}><Text style={styles.sectionLabel}>ORDER CONTEXT</Text><Text style={styles.metaStrong}>Order: {selected.orderReference || 'No related order'}</Text><Text style={styles.metaStrong}>Branch: {selected.branchId || 'Unavailable'}</Text></View>
            <View style={styles.section}><Text style={styles.sectionLabel}>EVIDENCE</Text><Text style={styles.metaStrong}>Bounded immutable evidence captured when the report was submitted.</Text>{detailLoading ? <Text style={styles.metaStrong}>Loading evidence...</Text> : !detail ? <Pressable accessibilityRole="button" onPress={() => select(selected)} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Retry loading evidence</Text></Pressable> : (detail?.report?.evidence || []).length === 0 ? <Text style={styles.metaStrong}>No evidence was returned for this report.</Text> : (detail?.report?.evidence || []).map((message) => <View key={`${message.messageId}-${message.seq}`} style={[styles.evidence, message.reported && styles.reportedEvidence]}><View style={styles.evidenceHeader}>{message.reported && <Text style={styles.reportedLabel}>Reported message</Text>}<Text style={styles.evidenceMeta}>{message.senderRole} · sequence {message.seq} · {dateLabel(message.createdAt)}</Text></View><Text style={styles.body}>{message.body}</Text></View>)}</View>
            <View style={styles.section}><Text style={styles.sectionLabel}>MODERATION HISTORY</Text>{(detail?.restrictions || []).map((entry, index) => <Text key={`${entry.kind}-${entry.scope}-${index}`} style={styles.history}>Active {entry.kind} restriction · {entry.scope} · until {dateLabel(entry.endsAt)}</Text>)}{detailLoading ? <Text style={styles.metaStrong}>Loading history...</Text> : !detail ? <Text style={styles.metaStrong}>History unavailable until case details load.</Text> : (detail?.actions || []).length === 0 ? <Text style={styles.metaStrong}>No moderation actions recorded yet.</Text> : [...(detail?.actions || [])].reverse().map((entry) => <Text key={entry.id} style={styles.history}>{moderationActionLabel(entry.action)} by {entry.actorRole} · {dateLabel(entry.createdAt)}</Text>)}</View>
            {role === 'admin' && <Pressable disabled={saving} onPress={expandReview} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Audit and load up to 20 messages</Text></Pressable>}
            {(expanded?.context || []).map((message) => <View key={`expanded-${message.messageId}`} style={styles.expanded}><Text style={styles.evidenceMeta}>Expanded · sequence {message.seq}</Text><Text style={styles.body}>{message.body}</Text></View>)}
          </> : <View style={styles.section}>
            <Text style={styles.sectionLabel}>INCIDENT GROUNDS</Text>
            <Text style={styles.metaStrong}>These are allegations. Select up to five; the server verifies each ground before a warning or restriction.</Text>
            {(selected.incidents || []).map((incident, index) => {
              const selectable = Boolean(incident.incidentId && (incident.type === 'cancellation' || incident.linkedAttempt));
              const selectedGround = selectedGrounds.includes(incident.incidentId);
              return <Pressable key={`${incident.incidentId || incident.orderReference}-${index}`} accessibilityRole="checkbox"
                accessibilityLabel={`Select ${incident.type} incident for order ${incident.orderReference}`}
                accessibilityState={{ checked: selectedGround, disabled: !selectable }} dataSet={{ safetyChoice: selectedGround ? 'selected' : undefined }} disabled={!selectable}
                onPress={() => setSelectedGrounds((current) => current.includes(incident.incidentId)
                  ? current.filter((id) => id !== incident.incidentId)
                  : current.length < 5 ? [...current, incident.incidentId] : current)}
                style={[styles.evidence, { minHeight: 44 }, selectedGround && styles.caseSelected, !selectable && { opacity: .7 }]}>
                <Text style={styles.evidenceMeta}>{incident.type} · {incident.concern} concern</Text>
                <Text style={styles.body}>Order {incident.orderReference} · {incident.category} · {incident.stage}</Text>
                <Text style={styles.metaStrong}>{!selectable ? 'Historical unlinked allegation — unavailable as a ground'
                  : selectedGround ? 'Selected for server verification' : 'Tap to select for server verification'}</Text>
              </Pressable>;
            })}
            {role === 'admin' && <Text style={styles.metaStrong}>Account suspension and termination from ordering-abuse cases are temporarily unavailable pending security hardening.</Text>}
          </View>}
          {role === 'admin' && kind === 'reports' && selected.accountActionPending && <View style={styles.section}><Text style={styles.sectionLabel}>ACCOUNT ACTION PENDING</Text><Text style={styles.metaStrong}>Account access remains held until Firebase Auth and the case are reconciled.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry pending account action" disabled={saving} onPress={retryAccountAction} style={styles.outlineButton}><Text style={styles.outlineButtonText}>{saving ? 'Checking…' : 'Retry reconciliation'}</Text></Pressable></View>}
          {!selected.accountActionPending && <View style={styles.section}><Text style={styles.sectionLabel}>DECISION</Text><Text style={styles.metaStrong}>Choose an action, then review it before confirming.</Text>{[['Case actions', ['dismiss', 'warn', 'escalate']], ['Restrictions', [...RESTRICTIONS]], ['Account actions', ['suspend_account', 'terminate_account']]].map(([group, values]) => {
            const options = ACTIONS[role].filter(([value]) => values.includes(value) && (kind === 'reports' || ABUSE_ACTIONS.has(value)));
            return options.length ? <View key={group}><Text style={styles.groupLabel}>{group}</Text><View style={styles.actionGrid}>{options.map(([value, label]) => <Pressable accessibilityRole="button" accessibilityState={{ selected: action === value }} dataSet={{ safetyChoice: action === value ? 'selected' : undefined }} key={value} onPress={() => setAction(value)} style={({ hovered, pressed }) => [styles.action, action === value && styles.actionSelected, ['terminate_account', 'suspend_account'].includes(value) && styles.dangerAction, (hovered || pressed) && styles.interacting]}><Text style={[styles.actionText, action === value && styles.actionTextSelected]}>{label}</Text></Pressable>)}</View></View> : null;
          })}{RESTRICTIONS.has(action) && <View style={styles.durations}>{durations.map((days) => <Pressable accessibilityRole="button" accessibilityState={{ selected: durationDays === String(days) }} dataSet={{ safetyChoice: durationDays === String(days) ? 'selected' : undefined }} key={days} onPress={() => setDurationDays(String(days))} style={[styles.duration, durationDays === String(days) && styles.actionSelected]}><Text style={styles.actionText}>{days} day{days === 1 ? '' : 's'}</Text></Pressable>)}</View>}<Text style={styles.metaStrong}>{action === 'dismiss' ? 'Reason (optional)' : 'Reason required'} - shown in the audit record</Text><TextInput accessibilityLabel="User-safe moderation reason" placeholder="Reason shown in the audit record" placeholderTextColor={colors.placeholder} value={reason} onChangeText={(value) => setReason(value.slice(0, 1000))} multiline style={styles.input} /><Text style={styles.metaStrong}>Private moderator note (optional)</Text><TextInput accessibilityLabel="Private moderator note" placeholder="Private moderator note (never shown to the user)" placeholderTextColor={colors.placeholder} value={privateNote} onChangeText={(value) => setPrivateNote(value.slice(0, 1000))} multiline style={styles.input} /><Pressable accessibilityRole="button" dataSet={{ safetyButton: saving ? 'disabled' : 'primary' }} disabled={saving} onPress={submitAction} style={[styles.primaryButton, saving && styles.disabledButton]}><Text style={[styles.primaryButtonText, saving && styles.disabledButtonText]}>{saving ? 'Saving…' : 'Apply decision'}</Text></Pressable></View>}
        </>}
      </View>}
    </View>
    <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.confirmModal}><Text style={styles.panelTitle}>Confirm moderation decision</Text><ScrollView style={styles.confirmBody}><Text style={styles.confirmCopy}>Action: {moderationActionLabel(action)}</Text><Text style={styles.confirmCopy}>Scope: {role === 'manager' ? 'Assigned branch' : 'Platform'}</Text>{RESTRICTIONS.has(action) && <Text style={styles.confirmCopy}>Duration: {durationDays} days</Text>}<Text style={styles.confirmCopy}>Reason: {reason.trim() || 'Not provided'}</Text><Text style={styles.confirmCopy}>This decision will be recorded in the protected moderation audit history.</Text></ScrollView><View style={styles.confirmActions}><Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={styles.cancelButton}><Text style={styles.actionText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" dataSet={{ safetyButton: 'primary' }} onPress={confirmAction} style={styles.confirmButton}><Text style={styles.primaryButtonText}>Confirm decision</Text></Pressable></View></View></View></Modal>
  </View>;
}

const createStyles = (colors) => StyleSheet.create({
  root: { paddingTop: 18 }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, tab: { paddingHorizontal: 15, minHeight: 42, justifyContent: 'center', borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, tabActive: { backgroundColor: colors.primaryAction }, tabText: { color: colors.textPrimary, fontWeight: '800' }, tabTextActive: { color: colors.onPrimary }, filters: { flexDirection: 'row', gap: 7, marginTop: 12, flexWrap: 'wrap' }, filter: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border }, filterActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, filterText: { color: colors.textSecondary, textTransform: 'capitalize', fontWeight: '700' }, filterTextActive: { color: colors.textPrimary },
  errorBox: { marginTop: 12, padding: 11, borderRadius: 10, backgroundColor: colors.dangerSoft }, errorText: { color: colors.textPrimary, fontWeight: '700' }, columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 16, alignItems: 'flex-start' }, listPanel: { flex: 1, minWidth: 280, maxWidth: 430, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14 }, detailPanel: { flex: 2, minWidth: 300, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 18 }, narrowPanel: { width: '100%', maxWidth: '100%', minWidth: 0, flexBasis: '100%' }, panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, panelTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' }, link: { color: colors.iconPrimary, fontWeight: '900' }, backButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: 8 }, emptyState: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 12 }, emptyTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', textAlign: 'center' }, empty: { color: colors.textSecondary, paddingVertical: 8, textAlign: 'center', lineHeight: 18 }, case: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 12, marginTop: 10, backgroundColor: colors.surfaceAlt }, caseSelected: { borderColor: colors.iconPrimary, borderWidth: 2, backgroundColor: colors.primarySoft }, caseTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }, statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }, openBadge: { backgroundColor: colors.warningSoft }, escalatedBadge: { backgroundColor: colors.dangerSoft }, resolvedBadge: { backgroundColor: colors.successSoft || colors.primarySoft }, statusBadgeText: { color: colors.textPrimary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, reference: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' }, caseTitle: { color: colors.textPrimary, fontWeight: '900', fontSize: 13 }, caseMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 4 }, scope: { color: colors.iconPrimary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginTop: 4 }, section: { marginTop: 12, padding: 12, borderRadius: 11, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, sectionLabel: { color: colors.iconPrimary, fontSize: 10, fontWeight: '900', letterSpacing: .8, marginBottom: 7 }, heading: { color: colors.textPrimary, fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 5 }, body: { color: colors.textPrimary, fontSize: 13, lineHeight: 19, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) }, metaStrong: { color: colors.textSecondary, fontSize: 12, marginTop: 7 }, evidence: { marginTop: 9, padding: 11, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, reportedEvidence: { borderColor: colors.warning, borderWidth: 2 }, evidenceHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 4 }, reportedLabel: { color: colors.warning, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, expanded: { marginTop: 7, padding: 10, borderRadius: 9, backgroundColor: colors.warningSoft }, evidenceMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', marginBottom: 4 }, history: { color: colors.textSecondary, fontSize: 11, marginTop: 6 }, actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, action: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 }, dangerAction: { borderColor: colors.danger }, actionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, actionText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' }, actionTextSelected: { color: colors.textPrimary }, durations: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, duration: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7 }, input: { minHeight: 72, marginTop: 11, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: 10, backgroundColor: colors.input, color: colors.textPrimary, padding: 11, textAlignVertical: 'top' }, primaryButton: { marginTop: 12, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryAction, paddingHorizontal: 16 }, primaryButtonText: { color: colors.onPrimary, fontWeight: '900' }, outlineButton: { marginTop: 12, minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, outlineButtonText: { color: colors.iconPrimary, fontWeight: '900', fontSize: 12 }, modalBackdrop: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay }, confirmModal: { width: '100%', maxWidth: 430, maxHeight: '90%', padding: 20, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, confirmCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: 9 }, confirmActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 18 }, cancelButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: colors.border }, confirmButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primaryAction },
  groupLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', marginTop: 12 },
  panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  refresh: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  interacting: { borderColor: colors.iconPrimary },
  disabledButton: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  disabledButtonText: { color: colors.disabledText },
  queueScroll: { maxHeight: 640 },
  mobileQueueScroll: { maxHeight: 360 },
  mobileUtilityClearance: { paddingRight: 64 },
  confirmBody: { flexShrink: 1 },
});
