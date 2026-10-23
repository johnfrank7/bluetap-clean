import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DELIVERY_FAILURE_REASONS,
  DELIVERY_CONTACT_OPTIONS,
  DELIVERY_CONTACT_METHOD_LABELS,
  DELIVERY_CONTACT_OUTCOME_LABELS,
} from '../constants/deliveryFailureReasons';
import DropdownChevron from './DropdownChevron';
import { useBlueTapTheme } from './BlueTapTheme';
import ResponsiveActionDialog from './ResponsiveActionDialog';

const emptyContact = () => ({ method: '', outcome: '', claimedAt: '' });
const validUtcTime = (value) => !value || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)));

export default function DeliveryActionDialog({ action, orderReference, visible, busy, locked, submissionError, onCancel, onConfirm }) {
  const { colors } = useBlueTapTheme();
  const [reasonCode, setReasonCode] = React.useState('');
  const [reasonNote, setReasonNote] = React.useState('');
  const [selectorOpen, setSelectorOpen] = React.useState(false);
  const [contactAttempts, setContactAttempts] = React.useState([emptyContact()]);
  const [interactionNote, setInteractionNote] = React.useState('');
  const [contactPicker, setContactPicker] = React.useState('');
  const [timeEditor, setTimeEditor] = React.useState(-1);
  const failed = action === 'failed';
  const selected = DELIVERY_FAILURE_REASONS.find((reason) => reason.code === reasonCode) || null;
  const contactOptions = DELIVERY_CONTACT_OPTIONS[reasonCode];
  const noteRequired = reasonCode === 'OTHER';
  const contactInvalid = Boolean(contactOptions) && contactAttempts.some((entry) =>
    !contactOptions[entry.method]?.includes(entry.outcome) || !validUtcTime(entry.claimedAt));
  const invalid = failed && (!selected || (noteRequired && !reasonNote.trim()) || contactInvalid
    || (reasonCode === 'RECIPIENT_REFUSED' && interactionNote.trim().length < 10));

  const changeContact = (index, field, value) => setContactAttempts((items) => items.map((item, position) => position === index
    ? { ...item, [field]: value, ...(field === 'method' ? { outcome: '' } : {}) } : item));
  const chooseReason = (code) => {
    setReasonCode(code);
    setReasonNote('');
    setContactAttempts([emptyContact()]);
    setInteractionNote('');
    setSelectorOpen(false);
    setContactPicker('');
    setTimeEditor(-1);
  };

  React.useEffect(() => {
    if (!visible) return;
    setReasonCode('');
    setReasonNote('');
    setSelectorOpen(false);
    setContactAttempts([emptyContact()]);
    setInteractionNote('');
    setContactPicker('');
    setTimeEditor(-1);
  }, [visible, action]);

  const confirm = () => {
    if (!failed) return onConfirm?.({});
    const reportEvidence = contactOptions
      ? { contactAttempts: contactAttempts.map((entry) => ({
        method: entry.method, outcome: entry.outcome,
        ...(entry.claimedAt ? { claimedAt: entry.claimedAt.trim() } : {}),
      })) }
      : reasonCode === 'RECIPIENT_REFUSED' ? { interactionNote: interactionNote.trim() } : {};
    return onConfirm?.({ failureReasonCode: reasonCode, failureReasonNote: reasonNote.trim(), reportFormat: 'structured-v1', reportEvidence });
  };

  return (
    <ResponsiveActionDialog
      visible={visible}
      title={failed ? 'Report delivery failure' : 'Confirm delivery'}
      body={failed
        ? `Choose why Order ${orderReference || ''} could not be delivered.`
        : `Mark Order ${orderReference || ''} as delivered?`}
      cancelLabel="Cancel"
      confirmLabel={failed ? locked ? 'Retry Report' : 'Confirm Failure' : 'Confirm Delivered'}
      confirmTone={failed ? 'danger' : 'success'}
      busy={busy}
      confirmDisabled={invalid}
      onCancel={onCancel}
      onConfirm={confirm}
    >
      {failed && (
        <View style={styles.form}>
          {!!submissionError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.error, { color: colors.danger, backgroundColor: colors.dangerSoft }]}>{submissionError}</Text>}
          {locked && <Text style={[styles.hint, { color: colors.textSecondary }]}>The previous result is uncertain. Retry sends the same report after checking the latest order status.</Text>}
          <Text style={[styles.label, { color: colors.textPrimary }]}>Failure reason</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose delivery failure reason"
            accessibilityState={{ expanded: selectorOpen }}
            disabled={busy || locked}
            onPress={() => setSelectorOpen((open) => !open)}
            style={({ pressed }) => [styles.select, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.selectText, { color: selected ? colors.textPrimary : colors.textSecondary }]}>{selected?.label || 'Select a reason'}</Text>
            <DropdownChevron expanded={selectorOpen} size={16} color={colors.iconSecondary || colors.primary} />
          </Pressable>
          {selectorOpen && (
            <View style={[styles.options, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              {DELIVERY_FAILURE_REASONS.map((reason) => (
                <Pressable
                  key={reason.code}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reason.code === reasonCode }}
                  disabled={busy || locked}
                  onPress={() => chooseReason(reason.code)}
                  style={({ pressed }) => [styles.option, { borderBottomColor: colors.border }, reason.code === reasonCode && { backgroundColor: colors.primarySoft }, pressed && styles.pressed]}
                >
                  <Text style={[styles.optionText, { color: colors.textPrimary }]}>{reason.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {!!contactOptions && (
            <View style={[styles.evidence, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Contact attempts (self-reported)</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>Record how you tried to reach the recipient. Do not enter phone numbers or message contents.</Text>
              {contactAttempts.map((entry, index) => {
                const choices = contactOptions[entry.method] || [];
                return <View key={index} style={[styles.contactRow, { borderTopColor: colors.border }]}>
                  <View style={styles.rowHeading}>
                    <Text style={[styles.label, { color: colors.textPrimary }]}>Attempt {index + 1}</Text>
                    {contactAttempts.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove contact attempt ${index + 1}`} disabled={busy || locked} onPress={() => { setContactAttempts((items) => items.filter((_, position) => position !== index)); setContactPicker(''); setTimeEditor(-1); }} style={styles.textButton}><Text style={{ color: colors.danger }}>Remove</Text></Pressable>}
                  </View>
                  <View style={styles.contactColumns}>
                    {[
                      { field: 'method', label: 'Method', value: entry.method, options: Object.keys(contactOptions), labels: DELIVERY_CONTACT_METHOD_LABELS },
                      { field: 'outcome', label: 'Outcome', value: entry.outcome, options: choices, labels: DELIVERY_CONTACT_OUTCOME_LABELS },
                    ].map((picker) => {
                      const key = `${index}:${picker.field}`;
                      return <View key={picker.field} style={styles.contactField}>
                        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{picker.label}</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${picker.label} for attempt ${index + 1}`} accessibilityState={{ expanded: contactPicker === key }} disabled={busy || locked || (picker.field === 'outcome' && !entry.method)} onPress={() => setContactPicker((current) => current === key ? '' : key)} style={[styles.compactSelect, { borderColor: colors.border, backgroundColor: colors.input || colors.surface }]}>
                          <Text style={[styles.compactText, { color: picker.value ? colors.textPrimary : colors.textSecondary }]} numberOfLines={1}>{picker.labels[picker.value] || 'Select'}</Text>
                          <DropdownChevron expanded={contactPicker === key} size={14} color={colors.iconSecondary || colors.primary} />
                        </Pressable>
                        {contactPicker === key && <View style={[styles.compactOptions, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                          {picker.options.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: picker.value === value }} disabled={busy || locked} onPress={() => { changeContact(index, picker.field, value); setContactPicker(''); }} style={[styles.compactOption, { borderBottomColor: colors.border }]}><Text style={{ color: colors.textPrimary }}>{picker.labels[value]}</Text></Pressable>)}
                        </View>}
                      </View>;
                    })}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={timeEditor === index ? `Remove claimed time for attempt ${index + 1}` : `Add claimed time for attempt ${index + 1}`} disabled={busy || locked} onPress={() => { if (timeEditor === index) { changeContact(index, 'claimedAt', ''); setTimeEditor(-1); } else { changeContact(index, 'claimedAt', new Date().toISOString()); setTimeEditor(index); } }} style={styles.textButton}><Text style={{ color: colors.primary }}>{timeEditor === index ? 'Remove claimed time' : 'Add claimed time (optional)'}</Text></Pressable>
                  {timeEditor === index && <TextInput accessibilityLabel={`Claimed contact time for attempt ${index + 1}, UTC`} value={entry.claimedAt} onChangeText={(value) => changeContact(index, 'claimedAt', value)} editable={!busy && !locked} maxLength={32} autoCapitalize="none" style={[styles.compactInput, { backgroundColor: colors.input || colors.surface, borderColor: colors.border, color: colors.textPrimary }]} />}
                  {entry.claimedAt && !validUtcTime(entry.claimedAt) && <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.danger }]}>Use UTC format YYYY-MM-DDTHH:mm:ssZ.</Text>}
                </View>;
              })}
              {contactAttempts.length < 3 && <Pressable accessibilityRole="button" disabled={busy || locked} onPress={() => { setContactAttempts((items) => [...items, emptyContact()]); setContactPicker(''); }} style={styles.textButton}><Text style={{ color: colors.primary }}>+ Add contact attempt</Text></Pressable>}
              {contactInvalid && <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.danger }]}>Choose a valid method and outcome for each attempt.</Text>}
            </View>
          )}
          {reasonCode === 'RECIPIENT_REFUSED' && <View style={styles.refusalField}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Factual interaction note</Text>
            <TextInput accessibilityLabel="Factual recipient refusal note" value={interactionNote} onChangeText={setInteractionNote} editable={!busy && !locked} maxLength={240} multiline placeholder="Briefly describe what the recipient said or did" placeholderTextColor={colors.textSecondary} style={[styles.input, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border, color: colors.textPrimary }]} />
            {interactionNote.trim().length < 10 && <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.danger }]}>Enter at least 10 characters. This note is kept in the protected report.</Text>}
          </View>}
          {!!selected && (
            <>
              {(noteRequired || (!contactOptions && reasonCode !== 'RECIPIENT_REFUSED')) && <Text style={[styles.label, { color: colors.textPrimary }]}>{noteRequired ? 'Short explanation' : 'Additional note (optional)'}</Text>}
              {(noteRequired || (!contactOptions && reasonCode !== 'RECIPIENT_REFUSED')) &&
              <TextInput
                accessibilityLabel={noteRequired ? 'Delivery failure explanation' : 'Optional delivery failure note'}
                value={reasonNote}
                onChangeText={setReasonNote}
                editable={!busy && !locked}
                maxLength={240}
                multiline
                placeholder={noteRequired ? 'Briefly explain what happened' : 'Add useful context for the requester and Manager'}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border, color: colors.textPrimary }]}
              />}
              {noteRequired && !reasonNote.trim() && <Text style={[styles.hint, { color: colors.danger }]}>An explanation is required for Other.</Text>}
            </>
          )}
        </View>
      )}
    </ResponsiveActionDialog>
  );
}

const styles = StyleSheet.create({
  form: { marginTop: 18, gap: 8 },
  evidence: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 7, marginTop: 6 },
  contactRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, gap: 6 },
  rowHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contactColumns: { flexDirection: 'row', gap: 8 },
  contactField: { flex: 1, minWidth: 0 },
  fieldLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  compactSelect: { minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: '700' },
  compactOptions: { borderWidth: 1, borderRadius: 9, marginTop: 4, overflow: 'hidden' },
  compactOption: { minHeight: 44, paddingHorizontal: 9, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  compactInput: { minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, fontSize: 12 },
  textButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 3 },
  refusalField: { gap: 6 },
  error: { borderRadius: 9, padding: 10, fontSize: 12, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '800', marginTop: 5 },
  select: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700' },
  options: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  option: { minHeight: 44, paddingHorizontal: 13, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { fontSize: 13, fontWeight: '700' },
  input: { minHeight: 76, maxHeight: 120, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 13 },
  hint: { fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
