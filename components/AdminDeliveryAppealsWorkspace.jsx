import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';
import { useModerationActivitySignal } from './useModerationActivityBadge';
import { fetchAdminAppeals, fetchAdminAppealDetail, resolveAdminAppeal } from '../services/adminDeliveryAppeals';

const REPLACEMENTS = [
  ['provider_responsible', 'Provider responsible'], ['shared', 'Shared responsibility'],
  ['undetermined', 'Undetermined'],
];
const newId = () => globalThis.crypto?.randomUUID?.() || `appeal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const normalize = (value) => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const dateLabel = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unavailable';

export default function AdminDeliveryAppealsWorkspace({ targetAttemptId = '' }) {
  const { colors } = useAdminTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 760;
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const revision = useModerationActivitySignal('admin');
  const [status, setStatus] = React.useState('pending');
  const [items, setItems] = React.useState([]);
  const [cursor, setCursor] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [resolution, setResolution] = React.useState('');
  const [replacement, setReplacement] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const listEpoch = React.useRef(0);
  const detailEpoch = React.useRef(0);
  const busy = React.useRef(false);
  const pending = React.useRef(null);

  const load = React.useCallback(async (nextCursor = '') => {
    const epoch = nextCursor ? listEpoch.current : ++listEpoch.current;
    if (nextCursor) setLoadingMore(true); else { setLoading(true); setItems([]); setCursor(null); }
    setError('');
    try {
      const result = await fetchAdminAppeals({ status, limit: 20, cursor: nextCursor });
      if (epoch !== listEpoch.current) return;
      setItems((current) => nextCursor ? [...current, ...(result.appeals || []).filter((item) =>
        !current.some((known) => known.attemptId === item.attemptId))] : result.appeals || []);
      setCursor(result.nextCursor || null);
    } catch (cause) { if (epoch === listEpoch.current) setError(cause.message || 'Appeals could not be loaded.'); }
    finally { if (epoch === listEpoch.current) { setLoading(false); setLoadingMore(false); } }
  }, [status]);
  React.useEffect(() => { load(); return () => { listEpoch.current += 1; }; }, [load, revision]);

  const openDetail = React.useCallback(async (attemptId) => {
    const epoch = ++detailEpoch.current;
    setSelected(attemptId); setDetail(null); setDetailLoading(true); setError('');
    if (pending.current?.attemptId !== attemptId) {
      setResolution(''); setReplacement(''); setReason(''); setUncertain(false);
    }
    try {
      const result = await fetchAdminAppealDetail(attemptId);
      if (epoch === detailEpoch.current && result?.appeal?.attemptId === attemptId) setDetail(result);
      else if (epoch === detailEpoch.current) setError('The appeal detail did not match the selected case.');
    } catch (cause) { if (epoch === detailEpoch.current) setError(cause.message || 'Appeal details are unavailable.'); }
    finally { if (epoch === detailEpoch.current) setDetailLoading(false); }
  }, []);
  React.useEffect(() => {
    if (/^[a-f0-9]{64}$/.test(targetAttemptId)) openDetail(targetAttemptId);
  }, [targetAttemptId, openDetail]);

  const searchCase = () => {
    const term = search.trim();
    if (/^[a-f0-9]{64}$/.test(term)) { openDetail(term); return; }
    setError('Enter the full delivery attempt ID to open an exact case, or use the bounded queue below.');
  };
  const propose = () => {
    if (!detail || detail.appeal.appeal.state !== 'submitted') return;
    if (!['upheld', 'overturned'].includes(resolution)) return setError('Choose uphold or overturn.');
    if (resolution === 'overturned' && !REPLACEMENTS.some(([value]) => value === replacement))
      return setError('Choose the replacement responsibility.');
    const normalized = normalize(reason);
    if (Array.from(normalized).length < 10 || Array.from(normalized).length > 1000 || !/[\p{L}\p{N}]/u.test(normalized))
      return setError('Enter a factual decision reason of 10 to 1000 characters.');
    if (pending.current && (pending.current.attemptId !== selected || pending.current.resolution !== resolution
      || pending.current.resolutionReason !== normalized || pending.current.overturnedResponsibility !== (resolution === 'overturned' ? replacement : null)))
      return setError('Retry the unchanged pending decision before editing it.');
    setError(''); setConfirming(true);
  };
  const confirm = async () => {
    if (busy.current || !selected) return;
    busy.current = true; setConfirming(false); setSaving(true); setError('');
    if (!pending.current) pending.current = Object.freeze({ attemptId: selected, resolution,
      resolutionReason: normalize(reason), overturnedResponsibility: resolution === 'overturned' ? replacement : null,
      clientMutationId: newId() });
    const payload = pending.current;
    try {
      const result = await resolveAdminAppeal(payload);
      if (result?.appeal?.attemptId !== payload.attemptId || result.appeal.appeal?.state !== payload.resolution
        || result.appeal.appeal?.resolutionReason !== payload.resolutionReason) {
        const mismatch = new Error('The decision result could not be confirmed. Retry the original decision.');
        mismatch.uncertain = true;
        throw mismatch;
      }
      pending.current = null; setUncertain(false); setDetail((current) => current?.appeal?.attemptId === selected
        ? { ...current, appeal: result.appeal } : current);
      await load();
    } catch (cause) {
      if (cause.status === 409 || cause.status >= 400 && cause.status < 500) {
        pending.current = null; setUncertain(false);
        setError(cause.message || 'This appeal can no longer be resolved. Refresh its detail.');
        openDetail(payload.attemptId);
      } else {
        setUncertain(true);
        setError('The result is unconfirmed. Retry the unchanged decision; an exact replay is read-only.');
      }
    } finally { busy.current = false; setSaving(false); }
  };
  const visible = items.filter((item) => !search.trim() || item.attemptId.includes(search.trim())
    || item.orderId?.toLowerCase().includes(search.trim().toLowerCase()));
  const appeal = detail?.appeal;
  const pendingHere = pending.current?.attemptId === selected;
  return <View style={styles.root}>
    <View style={styles.filters}>{[['pending', 'Pending'], ['resolved', 'Resolved'], ['all', 'All']].map(([value, label]) =>
      <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: status === value }}
        onPress={() => setStatus(value)} style={[styles.choice, status === value && styles.selectedChoice]}>
        <Text style={[styles.choiceText, { color: status === value ? colors.primary : colors.textPrimary }]}>{label}</Text>
      </Pressable>)}</View>
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Search delivery appeal by order or exact attempt ID" placeholder="Order or exact attempt ID"
        placeholderTextColor={colors.placeholder} value={search} onChangeText={setSearch}
        onSubmitEditing={searchCase} style={styles.searchInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Open exact appeal" onPress={searchCase} style={styles.action}><Text style={styles.actionText}>Open exact</Text></Pressable>
    </View>
    <Text style={styles.hint}>Order search filters loaded cases. Exact attempt ID lookup opens a protected case directly.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={[styles.columns, narrow && styles.narrow]}>
      {(!narrow || !selected) && <View style={[styles.panel, styles.listPanel, narrow && styles.full]}>
        <View style={styles.panelHead}><Text style={styles.title}>Delivery appeals</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh delivery appeals" onPress={() => load()}><Text style={styles.link}>Refresh</Text></Pressable></View>
        {loading ? <ActivityIndicator color={colors.primary} /> : visible.length ? visible.map((item) =>
          <Pressable key={item.attemptId} accessibilityRole="button" accessibilityLabel={`Open appeal for order ${item.orderId}`}
            onPress={() => openDetail(item.attemptId)} style={[styles.case, selected === item.attemptId && styles.selectedChoice]}>
            <Text style={styles.title}>Order {item.orderId}</Text>
            <Text style={styles.muted}>Attempt {item.attemptNumber} · {item.appeal?.state || 'Unavailable'}</Text>
            <Text style={styles.muted}>Submitted {dateLabel(item.appeal?.submittedAt)}</Text>
          </Pressable>) : <Text style={styles.muted}>No matching appeals on this page.</Text>}
        {!!cursor && <Pressable accessibilityRole="button" accessibilityLabel="Load more appeals" disabled={loadingMore}
          onPress={() => load(cursor)} style={styles.action}><Text style={styles.actionText}>{loadingMore ? 'Loading…' : 'Load more'}</Text></Pressable>}
      </View>}
      {(!narrow || selected) && <ScrollView style={[styles.panel, styles.detailPanel, narrow && styles.full]} contentContainerStyle={styles.detailContent}>
        {narrow && selected && <Pressable accessibilityRole="button" accessibilityLabel="Back to appeal queue"
          onPress={() => { detailEpoch.current += 1; setSelected(null); setDetail(null); }}><Text style={styles.link}>Back to queue</Text></Pressable>}
        {detailLoading ? <ActivityIndicator color={colors.primary} /> : !appeal ? <Text style={styles.muted}>Select an appeal to review its canonical evidence.</Text> : <>
          <Text style={styles.title}>Order {detail.order?.orderReference || appeal.orderId}</Text>
          <Text style={styles.muted}>Original branch: {appeal.branchId} · Attempt {appeal.attemptNumber}</Text>
          <Text style={styles.muted}>Submitted {dateLabel(appeal.appeal?.submittedAt)} · Status: {appeal.appeal?.state}</Text>
          <View style={styles.section}><Text style={styles.heading}>Delivery report and Manager finding</Text>
            <Text style={styles.body}>Reported reason: {appeal.reportedReasonCode}</Text>
            {!!appeal.reportedReasonNote && <Text style={styles.body}>Distributor statement (unverified): {appeal.reportedReasonNote}</Text>}
            {(appeal.contactAttempts || []).map((entry, index) => <Text key={index} style={styles.body}>
              Distributor-reported contact: {entry.method} · {entry.outcome}{entry.claimedAt ? ` · Claimed time ${dateLabel(entry.claimedAt)} (unverified)` : ''}</Text>)}
            <Text style={styles.body}>Original responsibility: {appeal.originalResponsibility}</Text>
            <Text style={styles.body}>Manager reason: {appeal.managerDecision?.decisionReason || 'Unavailable'}</Text>
            {!!appeal.requesterResponse?.explanation && <Text style={styles.body}>Requester response: {appeal.requesterResponse.explanation}</Text>}
          </View>
          <View style={styles.section}><Text style={styles.heading}>Requester appeal</Text><Text style={styles.body}>{appeal.appeal?.appealReason}</Text></View>
          {appeal.appeal?.state !== 'submitted' ? <View style={styles.section}>
            <Text style={styles.heading}>Admin resolution: {appeal.appeal?.state}</Text>
            <Text style={styles.body}>{appeal.appeal?.resolutionReason}</Text>
            <Text style={styles.body}>Effective responsibility: {appeal.effectiveResponsibility}</Text>
          </View> : <View style={styles.section}>
            <Text style={styles.heading}>Resolve appeal</Text>
            <Text style={styles.muted}>The original Manager decision remains immutable. An overturn changes only effective responsibility.</Text>
            <View style={styles.filters}>{[['upheld', 'Uphold'], ['overturned', 'Overturn']].map(([value, label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: resolution === value }}
                disabled={pendingHere || saving} onPress={() => setResolution(value)} style={[styles.choice, resolution === value && styles.selectedChoice]}>
                <Text style={styles.choiceText}>{label}</Text></Pressable>)}</View>
            {resolution === 'overturned' && <View style={styles.filters}>{REPLACEMENTS.map(([value, label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: replacement === value }}
                disabled={pendingHere || saving} onPress={() => setReplacement(value)} style={[styles.choice, replacement === value && styles.selectedChoice]}>
                <Text style={styles.choiceText}>{label}</Text></Pressable>)}</View>}
            <TextInput accessibilityLabel="Factual Admin appeal decision reason" multiline maxLength={2000}
              editable={!pendingHere && !saving} value={reason} onChangeText={setReason} placeholder="Explain the factual resolution"
              placeholderTextColor={colors.placeholder} style={styles.reasonInput} />
            <Text style={styles.muted}>{Array.from(normalize(reason)).length}/1000 characters</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={uncertain ? 'Retry original appeal resolution' : 'Review appeal resolution'}
              disabled={saving} onPress={propose} style={[styles.action, saving && styles.disabled]}>
              <Text style={styles.actionText}>{uncertain ? 'Retry original decision' : 'Review decision'}</Text></Pressable>
          </View>}
        </>}
      </ScrollView>}
    </View>
    <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
      <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.confirmCard}>
        <Text style={styles.title}>Confirm appeal resolution</Text>
        <Text style={styles.body}>{resolution === 'overturned' ? `Overturn to ${replacement}` : 'Uphold the Manager finding'} for this attempt? This creates an immutable Admin event.</Text>
        <View style={styles.filters}><Pressable accessibilityRole="button" accessibilityLabel="Cancel appeal resolution" onPress={() => setConfirming(false)} style={styles.choice}><Text style={styles.choiceText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm appeal resolution" onPress={confirm} style={styles.action}><Text style={styles.actionText}>Confirm decision</Text></Pressable></View>
      </View></View>
    </Modal>
  </View>;
}

const makeStyles = (colors) => StyleSheet.create({
  root: { paddingTop: 16 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderRadius: 9, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  selectedChoice: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, choiceText: { color: colors.textPrimary, fontWeight: '700' },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  searchInput: { flex: 1, minWidth: 190, minHeight: 44, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: colors.inputBorder, color: colors.textPrimary, backgroundColor: colors.input },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 7 }, error: { color: colors.danger, backgroundColor: colors.dangerSoft, padding: 11, borderRadius: 9, marginTop: 10 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: 14 }, narrow: { flexWrap: 'wrap' },
  panel: { backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 15 },
  listPanel: { flex: 1, minWidth: 260 }, detailPanel: { flex: 2, minWidth: 320, maxHeight: 750 }, full: { width: '100%', minWidth: 0, flexBasis: '100%' },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, title: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  link: { color: colors.primary, minHeight: 44, textAlignVertical: 'center', fontWeight: '700' }, case: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, marginTop: 9 },
  muted: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, marginTop: 4 }, detailContent: { paddingBottom: 22 },
  section: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceAlt, marginTop: 12 },
  heading: { color: colors.textPrimary, fontWeight: '800', marginBottom: 8 }, body: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, marginTop: 4 },
  reasonInput: { color: colors.textPrimary, minHeight: 88, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.input, borderRadius: 9, marginTop: 10, padding: 11, textAlignVertical: 'top' },
  action: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRadius: 9, backgroundColor: colors.primaryAction, marginTop: 10 },
  actionText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { opacity: 0.55 },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.overlay },
  confirmCard: { width: '100%', maxWidth: 460, padding: 20, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});
