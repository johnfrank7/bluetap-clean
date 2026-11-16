import React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';
import SidebarIcon from './SidebarIcon';
import ReportsSafetyWebStyles from './ReportsSafetyWebStyles';
import { useModerationActivitySignal } from './useModerationActivityBadge';
import { fetchAdminAppeals, fetchAdminAppealDetail, fetchAdminDeliveryPenalty,
  fetchAdminDeliveryPenaltyReviews, resolveAdminAppeal } from '../services/adminDeliveryAppeals';

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
  const narrow = width < 1000;
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
  const [listError, setListError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [exactAttempt, setExactAttempt] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [restrictionsOpen, setRestrictionsOpen] = React.useState(false);
  const [penaltyUid, setPenaltyUid] = React.useState('');
  const [penaltyDetail, setPenaltyDetail] = React.useState(null);
  const [penaltyLoading, setPenaltyLoading] = React.useState(false);
  const [reviewFlags, setReviewFlags] = React.useState([]);
  const [reviewCursor, setReviewCursor] = React.useState(null);
  const [reviewLoading, setReviewLoading] = React.useState(false);
  const [resolution, setResolution] = React.useState('');
  const [replacement, setReplacement] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState('');
  const listEpoch = React.useRef(0);
  const detailEpoch = React.useRef(0);
  const penaltyEpoch = React.useRef(0);
  const reviewEpoch = React.useRef(0);
  const busy = React.useRef(false);
  const pending = React.useRef(null);

  const load = React.useCallback(async (nextCursor = '') => {
    const epoch = nextCursor ? listEpoch.current : ++listEpoch.current;
    if (nextCursor) setLoadingMore(true); else { setLoading(true); setItems([]); setCursor(null); }
    setListError('');
    try {
      const result = await fetchAdminAppeals({ status, limit: 20, cursor: nextCursor });
      if (epoch !== listEpoch.current) return;
      setItems((current) => nextCursor ? [...current, ...(result.appeals || []).filter((item) =>
        !current.some((known) => known.attemptId === item.attemptId))] : result.appeals || []);
      setCursor(result.nextCursor || null);
    } catch (cause) { if (epoch === listEpoch.current) setListError(cause.message || 'Appeals could not be loaded.'); }
    finally { if (epoch === listEpoch.current) { setLoading(false); setLoadingMore(false); } }
  }, [status]);
  React.useEffect(() => { load(); return () => { listEpoch.current += 1; }; }, [load, revision]);

  const openDetail = React.useCallback(async (attemptId) => {
    const epoch = ++detailEpoch.current;
    setSelected(attemptId); setDetail(null); setDetailLoading(true); setError(''); setConfirmation('');
    if (pending.current?.attemptId === attemptId) {
      setResolution(pending.current.resolution); setReplacement(pending.current.overturnedResponsibility || '');
      setReason(pending.current.resolutionReason); setUncertain(true);
    } else {
      setResolution(''); setReplacement(''); setReason(''); setUncertain(false);
    }
    try {
      const result = await fetchAdminAppealDetail(attemptId);
      if (epoch === detailEpoch.current && result?.appeal?.attemptId === attemptId) {
        setDetail(result);
        if (result.appeal.requesterUid) setPenaltyUid(result.appeal.requesterUid);
      }
      else if (epoch === detailEpoch.current) setError('The appeal detail did not match the selected case.');
    } catch (cause) { if (epoch === detailEpoch.current) setError(cause.message || 'Appeal details are unavailable.'); }
    finally { if (epoch === detailEpoch.current) setDetailLoading(false); }
  }, []);
  React.useEffect(() => {
    if (/^[a-f0-9]{64}$/.test(targetAttemptId)) openDetail(targetAttemptId);
  }, [targetAttemptId, openDetail]);

  const searchCase = () => {
    const term = exactAttempt.trim();
    if (/^[a-f0-9]{64}$/.test(term)) { openDetail(term); return; }
    setError('Enter the full delivery attempt ID to open an exact case, or use the bounded queue below.');
  };
  const searchPenalty = async (uid = penaltyUid) => {
    const target = String(uid || '').trim();
    if (!target || target.length > 128 || target.includes('/')) {
      setError('Enter a valid Requester account ID to inspect delivery ordering status.');
      return;
    }
    const epoch = ++penaltyEpoch.current;
    setPenaltyUid(target); setPenaltyDetail(null); setPenaltyLoading(true); setError('');
    try {
      const result = await fetchAdminDeliveryPenalty(target);
      if (epoch === penaltyEpoch.current && result?.deliveryPenalty?.requesterUid === target)
        setPenaltyDetail(result.deliveryPenalty);
      else if (epoch === penaltyEpoch.current) setError('The penalty status did not match the selected Requester.');
    } catch (cause) { if (epoch === penaltyEpoch.current) setError(cause.message || 'Delivery status is unavailable.'); }
    finally { if (epoch === penaltyEpoch.current) setPenaltyLoading(false); }
  };
  const loadReviewFlags = async (nextCursor = '') => {
    const epoch = nextCursor ? reviewEpoch.current : ++reviewEpoch.current;
    setReviewLoading(true); setError('');
    try {
      const result = await fetchAdminDeliveryPenaltyReviews(nextCursor);
      if (epoch !== reviewEpoch.current) return;
      setReviewFlags((current) => nextCursor ? [...current, ...(result.reviews || []).filter((item) =>
        !current.some((known) => known.requesterUid === item.requesterUid))] : result.reviews || []);
      setReviewCursor(result.nextCursor || null);
    } catch (cause) { if (epoch === reviewEpoch.current) setError(cause.message || 'Admin review flags are unavailable.'); }
    finally { if (epoch === reviewEpoch.current) setReviewLoading(false); }
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
      pending.current = null; setUncertain(false); setConfirmation('The appeal resolution was confirmed.'); setDetail((current) => current?.appeal?.attemptId === selected
        ? { ...current, appeal: result.appeal } : current);
      await load();
    } catch (cause) {
      if (cause.status === 409 || cause.status >= 400 && cause.status < 500) {
        pending.current = null; setUncertain(false);
        openDetail(payload.attemptId);
        setError(cause.message || 'This appeal can no longer be resolved. Refresh its detail.');
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
  const QueueContainer = narrow ? View : ScrollView;
  return <View style={styles.root}>
    <ReportsSafetyWebStyles colors={colors} />
    <Text style={styles.title}>Delivery Appeals</Text>
    <Text style={styles.muted}>Review submitted appeals and their verified delivery evidence across all branches.</Text>
    <View style={styles.filters}>{[['pending', 'Pending'], ['resolved', 'Resolved'], ['all', 'All']].map(([value, label]) =>
      <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: status === value }} dataSet={{ safetyChoice: status === value ? 'selected' : undefined }}
        onPress={() => setStatus(value)} style={[styles.choice, status === value && styles.selectedChoice]}>
        <Text style={styles.choiceText}>{label}</Text>
      </Pressable>)}</View>
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Filter loaded appeals" placeholder="Filter loaded appeals by order or attempt ID"
        placeholderTextColor={colors.placeholder} value={search} onChangeText={setSearch} style={styles.searchInput} />
    </View>
    <Text style={styles.hint}>Filters only appeals already loaded. Load more to include additional cases.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)} style={styles.disclosure}>
      <Text style={styles.link}>{advanced ? '-' : '+'} Advanced lookup</Text>
    </Pressable>
    {advanced && <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Exact delivery attempt ID" placeholder="Full delivery attempt ID" value={exactAttempt}
        onChangeText={setExactAttempt} onSubmitEditing={searchCase} placeholderTextColor={colors.placeholder} style={styles.searchInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Open by exact attempt ID" dataSet={{ safetyButton: 'primary' }} onPress={searchCase} style={styles.action}><Text style={styles.actionText}>Open exact attempt</Text></Pressable>
    </View>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!!listError && <Text accessibilityRole="alert" style={styles.error}>{listError}</Text>}
    {!!confirmation && <Text accessibilityRole="alert" style={styles.confirmation}>{confirmation}</Text>}
    <View style={[styles.columns, narrow && styles.narrow]}>
      {(!narrow || !selected) && <View style={[styles.panel, styles.listPanel, narrow && styles.full]}>
        <View style={styles.panelHead}><View style={styles.panelHeading}><SidebarIcon name="FileSearch" size={18} color={colors.iconPrimary} /><Text style={styles.title}>Appeal queue</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh delivery appeals" onPress={() => load()}><Text style={styles.link}>Refresh</Text></Pressable></View>
        <QueueContainer style={!narrow && styles.queueScroll}>
        {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primaryAction} /><Text style={styles.muted}>Loading appeals...</Text></View> : visible.length ? visible.map((item) =>
          <Pressable key={item.attemptId} accessibilityRole="button" accessibilityLabel={`Open appeal for order ${item.orderId}`} accessibilityState={{ selected: selected === item.attemptId }} dataSet={{ safetyChoice: selected === item.attemptId ? 'selected' : undefined }}
            onPress={() => openDetail(item.attemptId)} style={({ hovered, pressed }) => [styles.case, selected === item.attemptId && styles.selectedCase, (hovered || pressed) && styles.interacting]}>
            <Text style={styles.title}>Order {item.orderId}</Text>
            <Text style={styles.muted}>Attempt {item.attemptNumber} · {item.appeal?.state || 'Unavailable'}</Text>
            <Text style={styles.muted}>Submitted {dateLabel(item.appeal?.submittedAt)}</Text>
          </Pressable>) : <Text style={styles.muted}>{listError ? 'Appeals could not be loaded. Try Refresh.' : search.trim() ? 'No loaded appeals match this filter.' : 'No appeals in this queue.'}</Text>}
        {!!cursor && <Pressable accessibilityRole="button" accessibilityLabel="Load more appeals" dataSet={{ safetyButton: loadingMore ? 'disabled' : 'primary' }} disabled={loadingMore}
          onPress={() => load(cursor)} style={[styles.action, loadingMore && styles.disabled]}><Text style={[styles.actionText, loadingMore && styles.disabledText]}>{loadingMore ? 'Loading…' : 'Load more'}</Text></Pressable>}
        </QueueContainer>
      </View>}
      {(!narrow || selected) && <View style={[styles.panel, styles.detailPanel, narrow && styles.full]}>
        {narrow && selected && <Pressable accessibilityRole="button" accessibilityLabel="Back to appeal queue"
          onPress={() => { detailEpoch.current += 1; setSelected(null); setDetail(null); }}><Text style={styles.link}>Back to queue</Text></Pressable>}
        {detailLoading ? <View style={styles.loading}><ActivityIndicator color={colors.primaryAction} /><Text style={styles.muted}>Loading appeal details...</Text></View> : !appeal ? selected && error ? <Pressable accessibilityRole="button" onPress={() => openDetail(selected)} style={styles.choice}><Text style={styles.choiceText}>Retry loading appeal details</Text></Pressable> : <Text style={styles.muted}>Select an appeal to review its canonical evidence.</Text> : <>
          <Text style={styles.title}>Order {detail.order?.orderReference || appeal.orderId}</Text>
          <Text style={styles.muted}>Original branch: {appeal.branchId} · Attempt {appeal.attemptNumber}</Text>
          <Text style={styles.muted}>Submitted {dateLabel(appeal.appeal?.submittedAt)} · Status: {appeal.appeal?.state}</Text>
          <View style={styles.section}><Text style={styles.heading}>Delivery report and original evidence</Text>
            <Text style={styles.body}>Reported reason: {appeal.reportedReasonCode}</Text>
            {!!appeal.reportedReasonNote && <Text style={styles.body}>Distributor statement (unverified): {appeal.reportedReasonNote}</Text>}
            {(appeal.contactAttempts || []).map((entry, index) => <Text key={index} style={styles.body}>
              Distributor-reported contact: {entry.method} · {entry.outcome}{entry.claimedAt ? ` · Claimed time ${dateLabel(entry.claimedAt)} (unverified)` : ''}</Text>)}
          </View>
          <View style={styles.section}><Text style={styles.heading}>Manager responsibility decision</Text>
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
            <Text style={styles.muted}>Uphold keeps the current finding; overturn replaces its effective responsibility.</Text>
            {pending.current && !pendingHere && <Text style={styles.error}>An earlier decision is unconfirmed. Return to that appeal to retry the original decision.</Text>}
            <View style={styles.filters}>{[['upheld', 'Uphold Manager Decision'], ['overturned', 'Overturn Decision']].map(([value, label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: resolution === value }} dataSet={{ safetyChoice: resolution === value ? 'selected' : undefined }}
                disabled={pendingHere || saving} onPress={() => setResolution(value)} style={[styles.choice, resolution === value && styles.selectedChoice]}>
                <Text style={styles.choiceText}>{label}</Text></Pressable>)}</View>
            {resolution === 'overturned' && <Text style={styles.muted}>Select the replacement responsibility:</Text>}
            {resolution === 'overturned' && <View style={styles.filters}>{REPLACEMENTS.map(([value, label]) =>
              <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: replacement === value }} dataSet={{ safetyChoice: replacement === value ? 'selected' : undefined }}
                disabled={pendingHere || saving} onPress={() => setReplacement(value)} style={[styles.choice, replacement === value && styles.selectedChoice]}>
                <Text style={styles.choiceText}>{label}</Text></Pressable>)}</View>}
            <Text style={styles.muted}>Required factual reason (10 to 1000 characters)</Text>
            <TextInput accessibilityLabel="Factual Admin appeal decision reason" multiline maxLength={2000}
              editable={!pendingHere && !saving} value={reason} onChangeText={setReason} placeholder="Explain the factual resolution"
              placeholderTextColor={colors.placeholder} style={styles.reasonInput} />
            <Text style={styles.muted}>{Array.from(normalize(reason)).length}/1000 characters</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={uncertain ? 'Retry original appeal resolution' : 'Review appeal resolution'}
              dataSet={{ safetyButton: saving ? 'disabled' : 'primary' }} disabled={saving} onPress={propose} style={[styles.action, saving && styles.disabled]}>
              <Text style={[styles.actionText, saving && styles.disabledText]}>{saving ? 'Saving...' : uncertain ? 'Retry original decision' : 'Review decision'}</Text></Pressable>
          </View>}
          <View style={styles.section}><Text style={styles.heading}>Audit trail</Text>
            <Text style={styles.body}>Appeal submitted {dateLabel(appeal.appeal?.submittedAt)}</Text>
            {appeal.appeal?.resolvedAt && <Text style={styles.body}>Admin resolution recorded {dateLabel(appeal.appeal.resolvedAt)}</Text>}
            <Text style={styles.muted}>The original Manager decision and Admin resolution are retained in the protected audit history.</Text>
          </View>
        </>}
      </View>}
    </View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: restrictionsOpen }} onPress={() => setRestrictionsOpen(!restrictionsOpen)} style={styles.disclosure}>
      <Text style={styles.link}>{restrictionsOpen ? '-' : '+'} Ordering Restrictions & Review Flags</Text>
    </Pressable>
    {restrictionsOpen && <View style={styles.section}>
      <Text style={styles.heading}>Requester delivery ordering status</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Load second-streak Admin review flags"
        dataSet={{ safetyButton: reviewLoading ? 'disabled' : 'primary' }} disabled={reviewLoading} onPress={() => loadReviewFlags()} style={[styles.action, reviewLoading && styles.disabled]}>
        <Text style={[styles.actionText, reviewLoading && styles.disabledText]}>{reviewLoading ? 'Loading…' : 'Load Admin review flags'}</Text>
      </Pressable>
      {reviewFlags.map((item) => <Pressable key={item.requesterUid} accessibilityRole="button"
        accessibilityLabel={`Inspect delivery status for Requester ${item.requesterUid}`}
        onPress={() => searchPenalty(item.requesterUid)} style={styles.case}>
        <Text style={styles.body}>Requester {item.requesterUid} · flagged {dateLabel(item.createdAt)}</Text>
      </Pressable>)}
      {!!reviewCursor && <Pressable accessibilityRole="button" accessibilityLabel="Load more delivery review flags"
        dataSet={{ safetyButton: reviewLoading ? 'disabled' : 'primary' }} disabled={reviewLoading} onPress={() => loadReviewFlags(reviewCursor)} style={[styles.action, reviewLoading && styles.disabled]}>
        <Text style={[styles.actionText, reviewLoading && styles.disabledText]}>{reviewLoading ? 'Loading…' : 'Load more flags'}</Text>
      </Pressable>}
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="Requester account ID for verified delivery status" value={penaltyUid}
          onChangeText={setPenaltyUid} onSubmitEditing={() => searchPenalty()}
          placeholder="Requester account ID" placeholderTextColor={colors.placeholder} style={styles.searchInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="Inspect Requester delivery status"
          dataSet={{ safetyButton: penaltyLoading ? 'disabled' : 'primary' }} disabled={penaltyLoading} onPress={() => searchPenalty()} style={[styles.action, penaltyLoading && styles.disabled]}>
          <Text style={[styles.actionText, penaltyLoading && styles.disabledText]}>{penaltyLoading ? 'Loading…' : 'Inspect'}</Text>
        </Pressable>
      </View>
      {!!penaltyDetail && <View>
        <Text style={styles.body}>Verified streak: {penaltyDetail.verifiedStreak == null ? 'Unavailable' : penaltyDetail.verifiedStreak} of 3</Text>
        <Text style={styles.body}>Ordering restriction: {penaltyDetail.restriction?.state || 'None'}</Text>
        {!!penaltyDetail.restriction && <Text style={styles.body}>Started {dateLabel(penaltyDetail.restriction.startsAt)} · Original expiry {dateLabel(penaltyDetail.restriction.endsAt)}</Text>}
        {penaltyDetail.adminReviewFlag && <Text style={styles.body}>A second distinct verified streak is flagged for Admin review. No second automatic restriction was applied.</Text>}
        {(penaltyDetail.supportingIncidents || []).map((item) => <Text key={item.attemptId} style={styles.muted}>
          Attempt {item.attemptId} · {item.reportedReasonCode} · effective {item.effectiveResponsibility || 'undetermined'} · appeal {item.appealState || 'none'}
        </Text>)}
        {(penaltyDetail.secondReviewAttemptIds || []).map((id) => <Text key={id} style={styles.muted}>Second-streak review attempt: {id}</Text>)}
        {(penaltyDetail.audit || []).map((item, index) => <Text key={`${item.kind}-${index}`} style={styles.muted}>
          {item.kind} · {item.state || 'recorded'} · {dateLabel(item.createdAt)}
        </Text>)}
      </View>}
    </View>}
    <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
      <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.confirmCard}>
        <Text style={styles.title}>Confirm appeal resolution</Text>
        <ScrollView style={styles.confirmBody}><Text style={styles.body}>{resolution === 'overturned' ? `Overturn the Manager decision and set effective responsibility to ${REPLACEMENTS.find(([value]) => value === replacement)?.[1] || replacement}.` : 'Uphold the Manager decision; effective responsibility remains unchanged.'} The original decision remains unchanged and an immutable Admin event is recorded. The server will also update any applicable ordering restriction based on its existing rules and notify the Requester.</Text>
          <Text style={styles.body}>Reason: {normalize(reason)}</Text></ScrollView>
        <View style={styles.filters}><Pressable accessibilityRole="button" accessibilityLabel="Cancel appeal resolution" onPress={() => setConfirming(false)} style={styles.choice}><Text style={styles.choiceText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm appeal resolution" dataSet={{ safetyButton: 'primary' }} onPress={confirm} style={styles.action}><Text style={styles.actionText}>Confirm decision</Text></Pressable></View>
      </View></View>
    </Modal>
  </View>;
}

const makeStyles = (colors) => StyleSheet.create({
  root: { paddingTop: 16 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderRadius: 9, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  selectedChoice: { borderColor: colors.iconPrimary, borderWidth: 2, backgroundColor: colors.primarySoft }, choiceText: { color: colors.textPrimary, fontWeight: '700', flexShrink: 1 },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  searchInput: { flex: 1, minWidth: 190, minHeight: 44, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: colors.inputBorder, color: colors.textPrimary, backgroundColor: colors.input },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 7 }, error: { color: colors.textPrimary, backgroundColor: colors.dangerSoft, padding: 11, borderRadius: 9, marginTop: 10 },
  confirmation: { color: colors.textPrimary, backgroundColor: colors.successSoft || colors.primarySoft, padding: 11, borderRadius: 9, marginTop: 10 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginTop: 14 }, narrow: { flexWrap: 'wrap' },
  panel: { backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 15 },
  listPanel: { flex: 1, minWidth: 260 }, detailPanel: { flex: 2, minWidth: 320 }, full: { width: '100%', minWidth: 0, flexBasis: '100%' },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, panelHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }, title: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', flexShrink: 1, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) },
  disclosure: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8 },
  link: { color: colors.iconPrimary, minHeight: 44, textAlignVertical: 'center', fontWeight: '700' }, case: { borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 12, marginTop: 9 },
  selectedCase: { borderWidth: 2, borderColor: colors.iconPrimary, backgroundColor: colors.primarySoft }, interacting: { borderColor: colors.iconPrimary },
  loading: { minHeight: 80, alignItems: 'center', justifyContent: 'center' },
  queueScroll: { maxHeight: 640 },
  muted: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, marginTop: 4, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) }, detailContent: { paddingBottom: 22 },
  section: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surfaceAlt, marginTop: 12 },
  heading: { color: colors.textPrimary, fontWeight: '800', marginBottom: 8 }, body: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, marginTop: 4, ...Platform.select({ web: { overflowWrap: 'anywhere' } }) },
  reasonInput: { color: colors.textPrimary, minHeight: 88, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.input, borderRadius: 9, marginTop: 10, padding: 11, textAlignVertical: 'top' },
  action: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRadius: 9, backgroundColor: colors.primaryAction, marginTop: 10 },
  actionText: { color: colors.onPrimary, fontWeight: '800' }, disabled: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }, disabledText: { color: colors.disabledText },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: colors.overlay },
  confirmCard: { width: '100%', maxWidth: 460, maxHeight: '90%', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  confirmBody: { flexShrink: 1 },
});
