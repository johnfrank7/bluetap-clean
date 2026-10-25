import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import ResponsiveActionDialog from './ResponsiveActionDialog';
import { useBlueTapTheme } from './BlueTapTheme';
import {
  fetchRequesterDeliveryReport,
  fetchRequesterDeliveryReports,
} from '../services/requesterDeliveryReports';
import { auth } from '../firebase';

const {
  appealReasonError,
  canSubmitResponse,
  explanationError,
  normalizeExplanation,
  reportDisplayState,
  reportViewModel,
  loadExactReport,
  responsibilityLabel,
} = require('../services/requesterDeliveryReportFlow');

const displayTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
};

export default function RequesterDeliveryReportDialog({ visible, orderId, targetAttemptId = '', ownerUid = '', onClose, responseRegistry, appealRegistry }) {
  const { colors, isDark } = useBlueTapTheme();
  const accent = isDark ? colors.primaryLight : colors.primaryAction;
  const [reports, setReports] = React.useState([]);
  const [nextCursor, setNextCursor] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [fieldError, setFieldError] = React.useState('');
  const [submitError, setSubmitError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [showAppealForm, setShowAppealForm] = React.useState(false);
  const [appealDraft, setAppealDraft] = React.useState('');
  const [appealFieldError, setAppealFieldError] = React.useState('');
  const [appealError, setAppealError] = React.useState('');
  const [submittingAppeal, setSubmittingAppeal] = React.useState(false);
  const [, setFlowRevision] = React.useState(0);
  const activeRef = React.useRef(false);
  const requestEpochRef = React.useRef(0);
  const listBusyRef = React.useRef(false);
  const selectionRef = React.useRef(0);
  const selectedIdRef = React.useRef('');

  const loadFirstPage = React.useCallback(async () => {
    if (!orderId || listBusyRef.current) return;
    const epoch = requestEpochRef.current;
    const requestOwnerUid = auth.currentUser?.uid;
    listBusyRef.current = true;
    setLoading(true);
    setLoadError('');
    try {
      if (!requestOwnerUid || ownerUid && requestOwnerUid !== ownerUid) throw new Error('Session unavailable');
      if (targetAttemptId) {
        const exact = await loadExactReport({ orderId, attemptId: targetAttemptId },
          fetchRequesterDeliveryReport,
          () => activeRef.current && requestEpochRef.current === epoch && auth.currentUser?.uid === requestOwnerUid);
        if (!activeRef.current || requestEpochRef.current !== epoch || auth.currentUser?.uid !== requestOwnerUid) return;
        if (!exact) throw new Error('Report mismatch');
        setReports([exact]);
        selectedIdRef.current = exact.attemptId;
        setSelectedId(exact.attemptId);
        setNextCursor(null);
        return;
      }
      const result = await fetchRequesterDeliveryReports(orderId);
      if (!activeRef.current || requestEpochRef.current !== epoch || auth.currentUser?.uid !== requestOwnerUid) return;
      const next = (result.reports || []).map(reportViewModel).filter(Boolean);
      const pendingIds = [responseRegistry.pendingAttemptId(requestOwnerUid, orderId),
        appealRegistry.pendingAttemptId(requestOwnerUid, orderId)].filter(Boolean);
      for (const pendingId of pendingIds) {
        if (!next.some((item) => item.attemptId === pendingId)) {
          const pendingResult = await fetchRequesterDeliveryReport(pendingId, orderId);
          if (!activeRef.current || requestEpochRef.current !== epoch || auth.currentUser?.uid !== requestOwnerUid) return;
          const pendingReport = reportViewModel(pendingResult.report);
          if (pendingReport) next.unshift(pendingReport);
        }
      }
      const pendingId = pendingIds[0] || '';
      const nextSelectedId = next.some((item) => item.attemptId === pendingId) ? pendingId : next[0]?.attemptId || '';
      const selectedSummary = next.find((item) => item.attemptId === nextSelectedId);
      if (selectedSummary?.reviewState === 'resolved' && !selectedSummary.decisionReason) {
        const detail = await fetchRequesterDeliveryReport(nextSelectedId, orderId);
        if (!activeRef.current || requestEpochRef.current !== epoch || auth.currentUser?.uid !== requestOwnerUid) return;
        const full = reportViewModel(detail.report);
        if (!full || full.attemptId !== nextSelectedId || full.orderId !== orderId || !full.decisionReason) throw new Error('Review details unavailable');
        next.splice(next.indexOf(selectedSummary), 1, full);
      }
      setReports(next);
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      setNextCursor(result.nextCursor || null);
    } catch (error) {
      if (activeRef.current && requestEpochRef.current === epoch && auth.currentUser?.uid === requestOwnerUid) {
        setLoadError(targetAttemptId
          ? 'This delivery report is unavailable or could not be loaded. Please retry or close to return to Orders.'
          : error.message || 'Delivery reports could not be loaded.');
      }
    } finally {
      if (requestEpochRef.current === epoch) {
        listBusyRef.current = false;
        if (activeRef.current) setLoading(false);
      }
    }
  }, [orderId, ownerUid, responseRegistry, appealRegistry, targetAttemptId]);

  React.useEffect(() => {
    if (!visible || !orderId) return undefined;
    activeRef.current = true;
    requestEpochRef.current += 1;
    listBusyRef.current = false;
    setReports([]);
    selectedIdRef.current = '';
    setSelectedId('');
    setNextCursor(null);
    setDraft('');
    setFieldError('');
    setSubmitError('');
    setSuccess('');
    setSubmitting(false);
    setShowAppealForm(false);
    setAppealDraft('');
    setAppealFieldError('');
    setAppealError('');
    setSubmittingAppeal(false);
    setFlowRevision((current) => current + 1);
    loadFirstPage();
    return () => { activeRef.current = false; requestEpochRef.current += 1; selectionRef.current += 1; };
  }, [visible, orderId, ownerUid, targetAttemptId, loadFirstPage]);

  const sessionCurrent = Boolean(ownerUid && auth.currentUser?.uid === ownerUid);
  const visibleReports = sessionCurrent ? reports : [];
  const selected = visibleReports.find((report) => report.attemptId === selectedId) || null;
  const displayState = reportDisplayState({ loading, error: loadError, reports: visibleReports });
  const flow = visible && sessionCurrent
    ? responseRegistry.get(ownerUid, orderId, selectedId) : null;
  const appealFlow = visible && sessionCurrent
    ? appealRegistry.get(ownerUid, orderId, selectedId) : null;
  const appealFlowState = appealFlow?.getState();
  const appealPending = Boolean(appealFlowState?.pending);
  const appealInFlight = Boolean(appealFlowState?.inFlight);
  const currentFlowState = flow?.getState();
  const pending = Boolean(currentFlowState?.pending);
  const inFlight = Boolean(currentFlowState?.inFlight);
  // A matching GET response cannot prove that an uncertain POST used our mutation ID.
  const eligible = canSubmitResponse(selected) || pending;

  React.useEffect(() => {
    if (!visible || !flow) return undefined;
    const applyState = (state) => {
      if (!activeRef.current || selectedIdRef.current !== selectedId) return;
      setFlowRevision((current) => current + 1);
      if (state.confirmedReport) {
        setReports((current) => current.map((item) => item.attemptId === state.confirmedReport.attemptId ? state.confirmedReport : item));
        setSuccess('Your response was received and is awaiting review.');
        setSubmitError('');
      } else if (state.terminalConflict) {
        setSubmitError('This report already has a response or is no longer awaiting review. Refresh this report.');
      }
    };
    applyState(flow.getState());
    return flow.subscribe(applyState);
  }, [visible, flow]);

  React.useEffect(() => {
    if (visible && currentFlowState?.pending) setDraft(currentFlowState.pending.explanation);
  }, [visible, selectedId, currentFlowState?.pending?.explanation]);

  React.useEffect(() => {
    if (!visible || !appealFlow) return undefined;
    const applyState = (state) => {
      if (!activeRef.current || selectedIdRef.current !== selectedId) return;
      setFlowRevision((current) => current + 1);
      if (state.pending) {
        setAppealDraft(state.pending.appealReason);
        setShowAppealForm(true);
      }
      if (state.confirmedAppeal) {
        setReports((current) => current.map((item) => item.attemptId === selectedId
          ? { ...item, appeal: state.confirmedAppeal } : item));
      }
    };
    applyState(appealFlow.getState());
    return appealFlow.subscribe(applyState);
  }, [visible, appealFlow, selectedId]);

  const selectReport = async (attemptId) => {
    if (attemptId === selectedId) return;
    selectionRef.current += 1;
    selectedIdRef.current = attemptId;
    setSelectedId(attemptId);
    setSubmitting(false);
    setDraft('');
    setFieldError('');
    setSubmitError('');
    setSuccess('');
    setShowAppealForm(false);
    setAppealDraft('');
    setAppealFieldError('');
    setAppealError('');
    setSubmittingAppeal(false);
    const sequence = selectionRef.current;
    const epoch = requestEpochRef.current;
    const requestOwnerUid = auth.currentUser?.uid;
    setDetailLoading(true);
    try {
      const result = await fetchRequesterDeliveryReport(attemptId, orderId);
      if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === sequence
        && auth.currentUser?.uid === requestOwnerUid && requestOwnerUid === ownerUid) {
        setReports((current) => current.map((item) => item.attemptId === attemptId ? reportViewModel(result.report) : item));
      }
    } catch (error) {
      if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === sequence
        && auth.currentUser?.uid === requestOwnerUid) setSubmitError(error.message || 'This report could not be refreshed.');
    } finally {
      if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === sequence) setDetailLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore || listBusyRef.current) return;
    const epoch = requestEpochRef.current;
    const requestOwnerUid = auth.currentUser?.uid;
    listBusyRef.current = true;
    setLoadingMore(true);
    setLoadError('');
    try {
      const result = await fetchRequesterDeliveryReports(orderId, { cursor: nextCursor });
      if (!activeRef.current || requestEpochRef.current !== epoch || auth.currentUser?.uid !== requestOwnerUid
        || requestOwnerUid !== ownerUid) return;
      setReports((current) => {
        const seen = new Set(current.map((item) => item.attemptId));
        return [...current, ...(result.reports || []).map(reportViewModel).filter((item) => item && !seen.has(item.attemptId))];
      });
      setNextCursor(result.nextCursor || null);
    } catch (error) {
      if (activeRef.current && requestEpochRef.current === epoch && auth.currentUser?.uid === requestOwnerUid)
        setLoadError(error.message || 'More reports could not be loaded.');
    } finally {
      if (requestEpochRef.current === epoch) {
        listBusyRef.current = false;
        if (activeRef.current) setLoadingMore(false);
      }
    }
  };

  const submit = async () => {
    if (!selected || !eligible || submitting || inFlight) return;
    if (!flow) { setSubmitError('Sign in again to submit this response.'); return; }
    if (!pending) {
      const validation = explanationError(draft);
      if (validation) { setFieldError(validation); return; }
    }
    setFieldError('');
    setSubmitError('');
    setSuccess('');
    setSubmitting(true);
    const epoch = requestEpochRef.current;
    const selection = selectionRef.current;
    try {
      const result = await flow.submit(selected.attemptId, draft);
      if (result.ignored || !activeRef.current || requestEpochRef.current !== epoch || selectionRef.current !== selection) return;
      setReports((current) => current.map((item) => item.attemptId === selected.attemptId ? result.report : item));
      setSuccess('Your response was received and is awaiting review.');
      try {
        const fresh = await fetchRequesterDeliveryReport(selected.attemptId, orderId);
        if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection) setReports((current) => current.map((item) => item.attemptId === selected.attemptId ? reportViewModel(fresh.report) : item));
      } catch {
        if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection) setSubmitError('Your response was saved, but the latest report could not be refreshed.');
      }
    } catch (error) {
      if (!activeRef.current || requestEpochRef.current !== epoch || selectionRef.current !== selection) return;
      if (error.status === 409) {
        setSubmitError('This report already has a response or is no longer awaiting review. Refreshing its status.');
        try {
          const fresh = await fetchRequesterDeliveryReport(selected.attemptId, orderId);
          if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection) setReports((current) => current.map((item) => item.attemptId === selected.attemptId ? reportViewModel(fresh.report) : item));
        } catch { /* Keep the confirmed conflict visible. */ }
      } else if (error.uncertain || flow.hasPending()) {
        setSubmitError('The result is not confirmed. Retry sends the same response and checks for an exact replay.');
      } else {
        setSubmitError(error.message || 'Your response could not be submitted.');
      }
    } finally {
      if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection) setSubmitting(false);
    }
  };

  const submitAppeal = async () => {
    if (!selected || !appealFlow || appealInFlight) return;
    if (!appealPending) {
      const validation = appealReasonError(appealDraft);
      if (validation) { setAppealFieldError(validation); return; }
    }
    setAppealFieldError('');
    setAppealError('');
    setSubmittingAppeal(true);
    const epoch = requestEpochRef.current;
    const selection = selectionRef.current;
    try {
      const res = await appealFlow.submit(selected.orderId, selected.attemptId, appealDraft);
      if (res.ignored) return;
      if (!activeRef.current || requestEpochRef.current !== epoch || selectionRef.current !== selection) return;
      setReports((current) => current.map((item) => item.attemptId === selected.attemptId ? {
        ...item,
        appeal: res.appeal,
      } : item));
      setShowAppealForm(false);
      setSuccess('Your appeal has been submitted to Administration.');
    } catch (err) {
      if (!activeRef.current || requestEpochRef.current !== epoch || selectionRef.current !== selection) return;
      if (err.status === 409) {
        setAppealError('This appeal conflicts with an existing submission or decision. Refresh the report.');
        setShowAppealForm(false);
        setSubmitError('This delivery review already has an appeal or decision. The latest report is being loaded.');
        try {
          const fresh = await fetchRequesterDeliveryReport(selected.attemptId, orderId);
          if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection)
            setReports((current) => current.map((item) => item.attemptId === selected.attemptId ? reportViewModel(fresh.report) : item));
        } catch { /* Keep the confirmed conflict visible. */ }
      } else if (err.uncertain || appealFlow.hasPending()) {
        setAppealError('The result is not confirmed. Retry sends the same appeal with its original submission ID.');
      } else setAppealError(err.message || 'Failed to submit appeal. Please retry.');
    } finally {
      if (activeRef.current && requestEpochRef.current === epoch && selectionRef.current === selection) {
        setSubmittingAppeal(false);
      }
    }
  };

  const onConfirm = () => {
    if (!sessionCurrent) { onClose?.(); return; }
    if (loadError && !reports.length) { loadFirstPage(); return; }
    if (selected && eligible) { submit(); return; }
    onClose?.();
  };

  return (
    <ResponsiveActionDialog
      visible={visible}
      title="Delivery reports"
      body="Review reported delivery attempts, your response, and any completed Manager decision."
      cancelLabel="Close"
      confirmLabel={loadError && !reports.length ? 'Retry' : eligible ? inFlight ? 'Submitting response' : pending ? 'Retry original response' : 'Submit response' : 'Done'}
      busy={false}
      confirmDisabled={loading || detailLoading || loadingMore || submitting || inFlight}
      onCancel={onClose}
      onConfirm={onConfirm}
    >
      {!sessionCurrent && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>Sign in again to view delivery reports.</Text>}
      {sessionCurrent && displayState === 'loading' ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={[styles.muted, { color: colors.textSecondary }]}>Loading delivery reports…</Text></View> : null}
      {sessionCurrent && displayState === 'empty' ? <Text style={[styles.muted, { color: colors.textSecondary }]}>No delivery reports are available for this order.</Text> : null}
      {!!loadError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.danger }]}>{loadError}</Text>}
      {visibleReports.length > 0 && (
        <>
          {visibleReports.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attemptTabs} contentContainerStyle={styles.attemptTabsContent}>
              {visibleReports.map((report) => (
                <Pressable key={report.attemptId} accessibilityRole="tab" accessibilityState={{ selected: selectedId === report.attemptId }}
                  accessibilityLabel={`Delivery attempt ${report.attemptNumber}`}
                  disabled={detailLoading}
                  onPress={() => selectReport(report.attemptId)}
                  style={[styles.attemptTab, { borderColor: selectedId === report.attemptId ? colors.primary : colors.border,
                    backgroundColor: selectedId === report.attemptId ? colors.primarySoft : colors.surfaceAlt }]}
                ><Text style={[styles.attemptTabText, { color: colors.textPrimary }]}>Attempt {report.attemptNumber}</Text></Pressable>
              ))}
            </ScrollView>
          )}
          {selected && <View style={[styles.reportCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>Order reference: {selected.orderId}</Text>
            <Text style={[styles.eyebrow, { color: accent }]}>REPORTED BY DISTRIBUTOR · ATTEMPT {selected.attemptNumber}</Text>
            <Text style={[styles.reason, { color: colors.textPrimary }]}>{selected.reportedReasonLabel}</Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>Report received: {displayTime(selected.reportReceivedAt)}</Text>
            <Text style={[styles.status, { color: selected.reviewState === 'resolved' ? colors.success : colors.primary }]}>
              {selected.reviewState === 'resolved' ? 'Review Completed'
                : selected.reviewState === 'awaiting_review' ? 'Awaiting review' : 'Review status unavailable'}
            </Text>
            {selected.reviewState === 'awaiting_review' && !!selected.responseDeadlineAt &&
              <Text style={[styles.muted, { color: colors.textSecondary }]}>Initial response deadline: {displayTime(selected.responseDeadlineAt)}</Text>}
            {selected.reviewState === 'awaiting_review' && selected.responseWindowOpen === false
              && selected.requesterResponseStatus === 'not_submitted' &&
              <Text style={[styles.muted, { color: colors.textSecondary }]}>The initial response window is closed.</Text>}
            {selected.reviewState === 'resolved' && !!selected.decisionReason && <View style={styles.decision}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Manager review outcome</Text>
              <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{responsibilityLabel(selected.responsibility)}</Text>
              <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{selected.decisionReason}</Text>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>Decided: {displayTime(selected.decidedAt)}</Text>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>This review records a finding; it does not by itself create an account warning or restriction.</Text>
            </View>}
            {selected.reviewState === 'resolved' && selected.appeal && <View style={[styles.appealCard, { backgroundColor: selected.appeal.state === 'overturned' ? colors.successSoft : colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Delivery Review Appeal</Text>
              <Text style={[styles.status, { color: selected.appeal.state === 'overturned' ? colors.success : selected.appeal.state === 'upheld' ? colors.danger : colors.primary }]}>
                {selected.appeal.state === 'submitted' ? 'Appeal pending Admin review'
                  : selected.appeal.state === 'overturned' ? 'Appeal overturned by Admin'
                  : 'Appeal upheld by Admin'}
              </Text>
              <Text style={[styles.bodyText, { color: colors.textPrimary }]}>Your appeal reason: {selected.appeal.appealReason}</Text>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>Submitted: {displayTime(selected.appeal.submittedAt)}</Text>
              {selected.appeal.state !== 'submitted' && !!selected.appeal.resolutionReason && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.bodyText, { fontWeight: '700', color: colors.textPrimary }]}>Admin resolution reason:</Text>
                  <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{selected.appeal.resolutionReason}</Text>
                  {selected.appeal.state === 'overturned' && !!selected.appeal.overturnedResponsibility && (
                    <Text style={[styles.muted, { color: colors.textSecondary }]}>
                      Updated outcome: {responsibilityLabel(selected.appeal.overturnedResponsibility)}
                    </Text>
                  )}
                  <Text style={[styles.muted, { color: colors.textSecondary }]}>Resolved: {displayTime(selected.appeal.resolvedAt)}</Text>
                </View>
              )}
            </View>}
            {selected.reviewState === 'resolved' && !selected.appeal && !showAppealForm && !appealPending && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Appeal this review decision"
                style={[styles.appealButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.primary }]}
                onPress={() => { setShowAppealForm(true); setAppealDraft(''); setAppealFieldError(''); setAppealError(''); }}
              >
                <Text style={[styles.appealButtonText, { color: colors.primary }]}>Appeal this review</Text>
              </Pressable>
            )}
            {selected.reviewState === 'resolved' && (!selected.appeal || appealPending) && (showAppealForm || appealPending) && (
              <View style={[styles.appealFormCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Appeal delivery review decision</Text>
                <Text style={[styles.muted, { color: colors.textSecondary }]}>
                  If you dispute the Manager's delivery review outcome, submit a factual explanation to BlueTap Administration (10 to 1,000 characters). You can only submit one appeal per attempt.
                </Text>
                <TextInput
                  accessibilityLabel="Factual appeal reason"
                  accessibilityHint="Enter 10 to 1000 characters"
                  multiline
                  maxLength={2000}
                  editable={!submittingAppeal && !appealPending}
                  value={appealDraft}
                  onChangeText={(val) => { setAppealDraft(val); setAppealFieldError(''); }}
                  placeholder="Explain why this decision should be reviewed..."
                  placeholderTextColor={colors.textSecondary}
                  textAlignVertical="top"
                  style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.input || colors.surface, borderColor: appealFieldError ? colors.danger : colors.border }]}
                />
                <Text style={[styles.muted, { color: colors.textSecondary }]}>
                  {Array.from(normalizeExplanation(appealDraft)).length}/1000 characters
                </Text>
                {!!appealFieldError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{appealFieldError}</Text>}
                {!!appealError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{appealError}</Text>}
                <View style={styles.appealActionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel appeal submission"
                    disabled={submittingAppeal || appealInFlight}
                    style={[styles.appealCancelButton, { borderColor: colors.border }]}
                    onPress={() => setShowAppealForm(false)}
                  >
                    <Text style={[styles.appealActionText, { color: colors.textSecondary }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Submit appeal to Admin"
                    disabled={submittingAppeal || appealInFlight}
                    style={[styles.appealSubmitButton, { backgroundColor: colors.primary }]}
                    onPress={submitAppeal}
                  >
                    {submittingAppeal ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={[styles.appealSubmitText, { color: colors.buttonText || '#fff' }]}>{appealPending ? 'Retry original appeal' : 'Submit appeal'}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
            {selected.contactAttempts.length > 0 && <View style={styles.contacts}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Reported contact attempts</Text>
              {selected.contactAttempts.map((entry, index) => <View key={`${selected.attemptId}-contact-${index}`} style={styles.contactRow}>
                <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{entry.method}: {entry.outcome}</Text>
                {!!entry.claimedAt && <Text style={[styles.muted, { color: colors.textSecondary }]}>
                  Distributor-claimed time (unverified): {displayTime(entry.claimedAt)}
                </Text>}
              </View>)}
            </View>}
          </View>}
          {!!nextCursor && <Pressable accessibilityRole="button" accessibilityLabel="Load more delivery attempts" disabled={loadingMore}
            onPress={loadMore} style={[styles.moreButton, { borderColor: colors.border }]}>
            <Text style={[styles.moreText, { color: accent }]}>{loadingMore ? 'Loading…' : 'Load more attempts'}</Text>
          </Pressable>}
          {detailLoading && <ActivityIndicator accessibilityLabel="Refreshing report" color={colors.primary} style={styles.detailLoader} />}
          {!pending && selected?.requesterResponseStatus === 'submitted' && selected.requesterResponse && <View style={[styles.responseCard, { backgroundColor: colors.successSoft, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your submitted response</Text>
            <Text style={[styles.bodyText, { color: colors.textPrimary }]}>{selected.requesterResponse.explanation}</Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>Submitted: {displayTime(selected.requesterResponse.submittedAt)}</Text>
          </View>}
          {selected && eligible && <View style={styles.form}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your initial response</Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>Describe only what happened. You can submit one response; it cannot be edited here.</Text>
            <TextInput accessibilityLabel="Factual delivery response" accessibilityHint="Enter 10 to 500 characters" multiline
              maxLength={2000} editable={!submitting && !pending && !inFlight}
              value={draft} onChangeText={(value) => { setDraft(value); setFieldError(''); }}
              placeholder="What happened during this delivery attempt?" placeholderTextColor={colors.textSecondary}
              textAlignVertical="top" style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.input || colors.surface,
                borderColor: fieldError ? colors.danger : colors.border }]}
            />
            <Text style={[styles.muted, { color: colors.textSecondary }]}>{Array.from(normalizeExplanation(draft)).length}/500 characters</Text>
            {pending && <Text style={[styles.muted, { color: colors.textSecondary }]}>
              {inFlight ? 'Submission is in progress. You can close this dialog and check again later.' :
                'The result is not confirmed. Your original response is locked; retry will use that exact submission.'}
            </Text>}
            {!!fieldError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.danger }]}>{fieldError}</Text>}
          </View>}
        </>
      )}
      {!!submitError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.danger }]}>{submitError}</Text>}
      {!!success && <Text accessibilityLiveRegion="polite" style={[styles.success, { color: colors.success }]}>{success}</Text>}
    </ResponsiveActionDialog>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 100, gap: 10 },
  muted: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  success: { fontSize: 12, lineHeight: 18, marginTop: 10, fontWeight: '700' },
  attemptTabs: { marginTop: 16, maxHeight: 52 },
  attemptTabsContent: { gap: 8, paddingBottom: 2 },
  attemptTab: { minHeight: 44, minWidth: 94, paddingHorizontal: 12, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  attemptTabText: { fontSize: 12, fontWeight: '700' },
  reportCard: { marginTop: 16, borderWidth: 1, borderRadius: 14, padding: 14 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  reason: { fontSize: 16, fontWeight: '800', marginTop: 5 },
  status: { fontSize: 12, fontWeight: '800', marginTop: 10 },
  contacts: { marginTop: 14, gap: 8 },
  decision: { marginTop: 14, gap: 4 },
  contactRow: { paddingTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800' },
  bodyText: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  moreButton: { marginTop: 12, minHeight: 44, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  moreText: { fontSize: 12, fontWeight: '800' },
  detailLoader: { marginTop: 12 },
  responseCard: { marginTop: 16, borderWidth: 1, borderRadius: 14, padding: 14 },
  form: { marginTop: 16 },
  input: { marginTop: 12, minHeight: 110, maxHeight: 180, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20 },
  appealCard: { marginTop: 14, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  appealButton: { marginTop: 12, minHeight: 40, borderWidth: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  appealButtonText: { fontSize: 13, fontWeight: '700' },
  appealFormCard: { marginTop: 14, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  appealActionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  appealCancelButton: { minHeight: 38, paddingHorizontal: 14, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  appealSubmitButton: { minHeight: 38, paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  appealActionText: { fontSize: 13, fontWeight: '600' },
  appealSubmitText: { fontSize: 13, fontWeight: '700' },
});
