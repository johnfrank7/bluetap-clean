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
  canSubmitResponse,
  explanationError,
  normalizeExplanation,
  reportDisplayState,
  reportViewModel,
} = require('../services/requesterDeliveryReportFlow');

const displayTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
};

export default function RequesterDeliveryReportDialog({ visible, orderId, onClose, responseRegistry }) {
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
  const [, setFlowRevision] = React.useState(0);
  const activeRef = React.useRef(false);
  const requestEpochRef = React.useRef(0);
  const listBusyRef = React.useRef(false);
  const selectionRef = React.useRef(0);
  const selectedIdRef = React.useRef('');

  const loadFirstPage = React.useCallback(async () => {
    if (!orderId || listBusyRef.current) return;
    const epoch = requestEpochRef.current;
    listBusyRef.current = true;
    setLoading(true);
    setLoadError('');
    try {
      const result = await fetchRequesterDeliveryReports(orderId);
      if (!activeRef.current || requestEpochRef.current !== epoch) return;
      const next = (result.reports || []).map(reportViewModel).filter(Boolean);
      const pendingId = responseRegistry.pendingAttemptId(auth.currentUser?.uid, orderId);
      if (pendingId && !next.some((item) => item.attemptId === pendingId)) {
        const pendingResult = await fetchRequesterDeliveryReport(pendingId, orderId);
        if (!activeRef.current || requestEpochRef.current !== epoch) return;
        const pendingReport = reportViewModel(pendingResult.report);
        if (pendingReport) next.unshift(pendingReport);
      }
      setReports(next);
      const nextSelectedId = next.some((item) => item.attemptId === pendingId) ? pendingId : next[0]?.attemptId || '';
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      setNextCursor(result.nextCursor || null);
    } catch (error) {
      if (activeRef.current && requestEpochRef.current === epoch) setLoadError(error.message || 'Delivery reports could not be loaded.');
    } finally {
      if (requestEpochRef.current === epoch) {
        listBusyRef.current = false;
        if (activeRef.current) setLoading(false);
      }
    }
  }, [orderId, responseRegistry]);

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
    setFlowRevision((current) => current + 1);
    loadFirstPage();
    return () => { activeRef.current = false; requestEpochRef.current += 1; selectionRef.current += 1; };
  }, [visible, orderId, loadFirstPage]);

  const selected = reports.find((report) => report.attemptId === selectedId) || null;
  const displayState = reportDisplayState({ loading, error: loadError, reports });
  const flow = responseRegistry.get(auth.currentUser?.uid, orderId, selectedId);
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
    const sequence = selectionRef.current;
    setDetailLoading(true);
    try {
      const result = await fetchRequesterDeliveryReport(attemptId, orderId);
      if (activeRef.current && selectionRef.current === sequence) {
        setReports((current) => current.map((item) => item.attemptId === attemptId ? reportViewModel(result.report) : item));
      }
    } catch (error) {
      if (activeRef.current && selectionRef.current === sequence) setSubmitError(error.message || 'This report could not be refreshed.');
    } finally {
      if (activeRef.current && selectionRef.current === sequence) setDetailLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore || listBusyRef.current) return;
    const epoch = requestEpochRef.current;
    listBusyRef.current = true;
    setLoadingMore(true);
    setLoadError('');
    try {
      const result = await fetchRequesterDeliveryReports(orderId, { cursor: nextCursor });
      if (!activeRef.current || requestEpochRef.current !== epoch) return;
      setReports((current) => {
        const seen = new Set(current.map((item) => item.attemptId));
        return [...current, ...(result.reports || []).map(reportViewModel).filter((item) => item && !seen.has(item.attemptId))];
      });
      setNextCursor(result.nextCursor || null);
    } catch (error) {
      if (activeRef.current && requestEpochRef.current === epoch) setLoadError(error.message || 'More reports could not be loaded.');
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

  const onConfirm = () => {
    if (loadError && !reports.length) { loadFirstPage(); return; }
    if (selected && eligible) { submit(); return; }
    onClose?.();
  };

  return (
    <ResponsiveActionDialog
      visible={visible}
      title="Delivery reports"
      body="Review reported delivery attempts and add one factual response while review is pending."
      cancelLabel="Close"
      confirmLabel={loadError && !reports.length ? 'Retry' : eligible ? inFlight ? 'Submitting response' : pending ? 'Retry original response' : 'Submit response' : 'Done'}
      busy={false}
      confirmDisabled={loading || detailLoading || loadingMore || submitting || inFlight}
      onCancel={onClose}
      onConfirm={onConfirm}
    >
      {displayState === 'loading' ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={[styles.muted, { color: colors.textSecondary }]}>Loading delivery reports…</Text></View> : null}
      {displayState === 'empty' ? <Text style={[styles.muted, { color: colors.textSecondary }]}>No delivery reports are available for this order.</Text> : null}
      {!!loadError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.danger }]}>{loadError}</Text>}
      {reports.length > 0 && (
        <>
          {reports.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attemptTabs} contentContainerStyle={styles.attemptTabsContent}>
              {reports.map((report) => (
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
            <Text style={[styles.eyebrow, { color: accent }]}>REPORTED BY DISTRIBUTOR · ATTEMPT {selected.attemptNumber}</Text>
            <Text style={[styles.reason, { color: colors.textPrimary }]}>{selected.reportedReasonLabel}</Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>Report received: {displayTime(selected.reportReceivedAt)}</Text>
            <Text style={[styles.status, { color: selected.reviewState === 'awaiting_review' ? colors.warning : colors.textSecondary }]}>
              {selected.reviewState === 'awaiting_review' ? 'Awaiting review' : 'Review status unavailable'}
            </Text>
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
  contactRow: { paddingTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800' },
  bodyText: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  moreButton: { marginTop: 12, minHeight: 44, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  moreText: { fontSize: 12, fontWeight: '800' },
  detailLoader: { marginTop: 12 },
  responseCard: { marginTop: 16, borderWidth: 1, borderRadius: 14, padding: 14 },
  form: { marginTop: 16 },
  input: { marginTop: 12, minHeight: 110, maxHeight: 180, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 20 },
});
