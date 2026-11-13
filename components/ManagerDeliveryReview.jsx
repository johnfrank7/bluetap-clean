import React, { useMemo } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import SidebarIcon from './SidebarIcon';
import { validDecisionReason } from '../services/managerDeliveryReviewFlow';

const OUTCOMES = [
  ['requester_responsible', 'Requester responsible'],
  ['provider_responsible', 'Provider responsible'],
  ['shared', 'Shared responsibility'],
  ['undetermined', 'Undetermined'],
];
const dateLabel = (value) => {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
};

function ReviewButton({ label, onPress, disabled, primary, styles, icon }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    style={({ focused, pressed }) => [styles.button, primary ? styles.primaryButton : styles.secondaryButton,
      disabled && styles.disabledButton, pressed && !disabled && { opacity: 0.82 },
      focused && styles.focusedButton]}>
    {icon ? <SidebarIcon name={icon} size={16} color={disabled ? styles.disabledText.color : primary ? styles.primaryText.color : styles.secondaryText.color} /> : null}
    <Text style={disabled ? styles.disabledText : primary ? styles.primaryText : styles.secondaryText}>{label}</Text>
  </Pressable>;
}

export function ManagerDeliveryReviewList({ state, flow, colors, onReview, failedOrdersById = null, onResolveOrder = null }) {
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);
  return <View style={styles.listArea}>
    <Text style={styles.helper}>Failed attempts reported to this branch. Each case is verified before a decision.</Text>
    {!state.scope ? <Text style={styles.muted}>Manager access is loading…</Text> : null}
    {state.listError ? <View accessibilityRole="alert" style={styles.errorBox}>
      <Text style={styles.errorText}>{state.listError}</Text>
      <ReviewButton label="Retry loading reviews" onPress={() => flow.load()} styles={styles} />
    </View> : null}
    {state.listBusy && !state.listLoaded ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading failed deliveries…</Text></View> : null}
    {state.listLoaded && !state.listBusy && !state.listError && state.reviews.length === 0 && !state.nextCursor
      ? <View style={styles.center}><Text style={styles.muted}>No failed deliveries awaiting review.</Text></View> : null}
    {state.reviews.length ? <ScrollView nestedScrollEnabled style={styles.listScroll} contentContainerStyle={styles.listContent}>
      {state.reviews.map((review) => {
        const failedOrder = failedOrdersById?.get?.(String(review.orderId)) || null;
        const canResolveOrder = Boolean(
          onResolveOrder &&
          failedOrder &&
          String(failedOrder.status || '').toLowerCase() === 'delivery_failed' &&
          (failedOrder.assignedDistributorUid || failedOrder.distributor_id)
        );
        return (
          <View key={review.attemptId} style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle} numberOfLines={2}>Order #{review.orderReference || review.orderId}</Text>
              <Text style={styles.rowReason} numberOfLines={2}>{review.reportedReasonLabel || 'Failed delivery'}</Text>
              <Text style={styles.muted}>Reported {dateLabel(review.reportReceivedAt)} · {review.reviewState === 'reported' ? 'Awaiting review' : 'Resolved'}</Text>
            </View>
            <View style={styles.itemActions}>
              {canResolveOrder ? (
                <>
                  <ReviewButton
                    label="Reschedule"
                    onPress={() => onResolveOrder(failedOrder, 'reschedule')}
                    styles={styles}
                    icon="Calendar"
                  />
                  <ReviewButton
                    label="Reassign"
                    onPress={() => onResolveOrder(failedOrder, 'reassign')}
                    styles={styles}
                    icon="UserCheck"
                  />
                </>
              ) : null}
              <ReviewButton label={`Review order ${review.orderReference || review.orderId}`}
                onPress={() => onReview(review)} styles={styles} icon="FileSearch" />
            </View>
          </View>
        );
      })}
    </ScrollView> : null}
    {state.nextCursor ? <View style={styles.pager}>
      <Text style={styles.muted}>Showing {state.reviews.length} loaded cases</Text>
      <ReviewButton label={state.listBusy ? 'Loading more' : 'Load more'} disabled={state.listBusy}
        onPress={() => flow.load({ more: true })} styles={styles} />
    </View> : null}
    {state.listBusy && state.listLoaded ? <ActivityIndicator accessibilityLabel="Loading reviews" color={colors.primary} /> : null}
  </View>;
}

function Fact({ label, value, styles }) {
  if (value == null || value === '') return null;
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}

export function ManagerDeliveryReviewModal({ state, flow, colors, visible }) {
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, width), [colors, width]);
  const review = state.detail;
  const canSubmit = Boolean(review?.canFinalizeNow && review?.reviewState === 'reported'
    && state.responsibility && validDecisionReason(state.reason) && !state.submitBusy && !state.detailError);
  return <Modal visible={Boolean(visible && state.modalOpen)} transparent animationType="fade"
    onRequestClose={() => flow.close()}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <View accessibilityViewIsModal style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View style={styles.rowCopy}>
            <Text style={styles.eyebrow}>DELIVERY REVIEW</Text>
            <Text style={styles.modalTitle} numberOfLines={2}>Order #{review?.orderReference || 'Failed delivery'}</Text>
          </View>
          <ReviewButton label="Close delivery review" onPress={() => flow.close()} styles={styles} icon="X" />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalBody} contentContainerStyle={styles.modalContent}>
          {state.detailBusy ? <View style={styles.center}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading exact report…</Text></View> : null}
          {state.detailError ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{state.detailError}</Text></View> : null}
          {review ? <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Distributor report</Text>
              <Text style={styles.muted}>The reason and contact details below are Distributor claims, not verified facts.</Text>
              <Fact label="Failure reason" value={review.reportedReasonLabel} styles={styles} />
              <Fact label="Additional report note" value={review.reportedReasonNote} styles={styles} />
              <Fact label="Reported to server" value={dateLabel(review.reportReceivedAt)} styles={styles} />
              <Fact label="Delivery attempt ended" value={dateLabel(review.endedAt)} styles={styles} />
              {review.contactAttempts?.map((contact, index) => <View key={index} style={styles.evidence}>
                <Text style={styles.factValue}>Claimed contact #{index + 1}: {contact.method} · {contact.outcome}</Text>
                {contact.claimedAt ? <Text style={styles.muted}>Claimed time (unverified): {dateLabel(contact.claimedAt)}</Text> : null}
              </View>)}
              <Fact label="Claimed interaction" value={review.interactionNote} styles={styles} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Requester response</Text>
              {review.requesterResponse ? <>
                <Fact label="Submitted" value={dateLabel(review.requesterResponse.submittedAt)} styles={styles} />
                <Fact label="Explanation" value={review.requesterResponse.explanation} styles={styles} />
              </> : <Text style={styles.muted}>No response submitted.</Text>}
              <Fact label="Response deadline (server-derived)" value={dateLabel(review.responseDeadlineAt)} styles={styles} />
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Review status</Text>
              <Text style={styles.factValue}>{review.reviewState === 'resolved' ? 'Resolved' : 'Reported'}</Text>
              {review.reviewState === 'reported' && !review.canFinalizeNow
                ? <Text style={styles.notice}>The Requester response window remains open. You can review the evidence now; finalization is disabled until the server permits it.</Text> : null}
            </View>
            {review.reviewState === 'reported' ? <View style={styles.section}>
              <Text style={styles.sectionTitle}>Responsibility decision</Text>
              <View style={styles.options}>{OUTCOMES.map(([value, label]) => <Pressable key={value}
                accessibilityRole="radio" accessibilityLabel={label}
                accessibilityState={{ selected: state.responsibility === value, disabled: state.submitBusy }}
                disabled={state.submitBusy} onPress={() => flow.setDraft('responsibility', value)}
                style={({ focused }) => [styles.option, state.responsibility === value && styles.optionSelected,
                  focused && styles.focusedButton]}>
                <Text style={state.responsibility === value ? styles.optionSelectedText : styles.optionText}>{label}</Text>
              </Pressable>)}</View>
              <Text style={styles.factLabel}>Factual explanation (10–500 characters)</Text>
              <TextInput accessibilityLabel="Factual decision explanation" value={state.reason}
                onChangeText={(value) => flow.setDraft('reason', value)} editable={!state.submitBusy}
                multiline maxLength={1000} placeholder="Describe the evidence supporting your decision"
                placeholderTextColor={colors.placeholder || colors.textSecondary} style={styles.input} />
              <Text style={styles.muted}>This decision records responsibility only. It does not create a warning or restriction.</Text>
            </View> : null}
          </> : null}
          {state.submitError ? <Text accessibilityRole="alert" style={styles.errorText}>{state.submitError}</Text> : null}
          {state.success ? <Text accessibilityRole="alert" style={styles.successText}>{state.success}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <ReviewButton label="Close" onPress={() => flow.close()} styles={styles} />
          {review?.reviewState === 'reported' ? <ReviewButton
            label={state.submitBusy ? 'Saving decision' : state.pending ? 'Retry same decision' : 'Save decision'}
            primary disabled={!canSubmit} onPress={() => flow.submit()} styles={styles} icon="ShieldCheck" /> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function makeStyles(colors, width = 1200) {
  return StyleSheet.create({
    listArea: { flexShrink: 1, minWidth: 0 },
    helper: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 10 },
    listScroll: { maxHeight: 360, minWidth: 0 },
    listContent: { gap: 8, paddingBottom: 4 },
    row: { flexDirection: width < 430 ? 'column' : 'row', alignItems: width < 430 ? 'stretch' : 'center',
      gap: 10, padding: 11, backgroundColor: colors.surfaceAlt, borderColor: colors.border,
      borderWidth: 1, borderRadius: 10, minWidth: 0 },
    itemActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', flexShrink: 1 },
    rowReason: { color: colors.textSecondary, fontSize: 12, marginTop: 3, flexShrink: 1 },
    muted: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1, marginTop: 3 },
    center: { minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8 },
    pager: { flexDirection: width < 430 ? 'column' : 'row', alignItems: width < 430 ? 'stretch' : 'center',
      justifyContent: 'space-between', gap: 8, marginTop: 10 },
    button: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 9,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start' },
    primaryButton: { backgroundColor: colors.primaryAction, borderColor: colors.primaryAction },
    secondaryButton: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    primaryText: { color: colors.onPrimary, fontSize: 12, fontWeight: '800' },
    secondaryText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
    disabledButton: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    disabledText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
    focusedButton: { borderColor: colors.primary, borderWidth: 2 },
    errorBox: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1,
      borderRadius: 9, padding: 10, gap: 8, marginBottom: 8 },
    errorText: { color: colors.danger, fontSize: 12, fontWeight: '700', flexShrink: 1 },
    successText: { color: colors.success, fontSize: 12, fontWeight: '800' },
    backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: width < 430 ? 8 : 16,
      backgroundColor: colors.overlay || 'rgba(0,0,0,0.5)' },
    modalCard: { width: '100%', maxWidth: 660, maxHeight: '90%', minHeight: 200, borderRadius: 16,
      backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, minWidth: 0 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8,
      borderBottomWidth: 1, borderBottomColor: colors.border },
    modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', flexShrink: 1 },
    eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
    modalBody: { flex: 1, flexGrow: 1, flexShrink: 1 },
    modalContent: { padding: 14, gap: 12 },
    section: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1,
      borderRadius: 10, padding: 12, gap: 7 },
    sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
    fact: { gap: 2, minWidth: 0 },
    factLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    factValue: { color: colors.textPrimary, fontSize: 12, lineHeight: 18, flexShrink: 1 },
    evidence: { padding: 8, borderLeftWidth: 2, borderLeftColor: colors.primary, minWidth: 0 },
    notice: { color: colors.textPrimary, backgroundColor: colors.warningSoft || colors.surface,
      borderLeftWidth: 3, borderLeftColor: colors.warning, padding: 9, fontSize: 12, lineHeight: 18 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 8,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    optionText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
    optionSelectedText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    input: { minHeight: 86, borderWidth: 1, borderColor: colors.border, borderRadius: 9,
      backgroundColor: colors.surface, color: colors.textPrimary, padding: 10,
      textAlignVertical: 'top', fontSize: 13 },
    footer: { flexDirection: width < 440 ? 'column-reverse' : 'row', justifyContent: 'flex-end',
      padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
  });
}
