import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DELIVERY_FAILURE_REASONS } from '../constants/deliveryFailureReasons';
import { useBlueTapTheme } from './BlueTapTheme';
import ResponsiveActionDialog from './ResponsiveActionDialog';

export default function DeliveryActionDialog({ action, orderReference, visible, busy, onCancel, onConfirm }) {
  const { colors } = useBlueTapTheme();
  const [reasonCode, setReasonCode] = React.useState('');
  const [reasonNote, setReasonNote] = React.useState('');
  const [selectorOpen, setSelectorOpen] = React.useState(false);
  const failed = action === 'failed';
  const selected = DELIVERY_FAILURE_REASONS.find((reason) => reason.code === reasonCode) || null;
  const noteRequired = reasonCode === 'OTHER';
  const invalid = failed && (!selected || (noteRequired && !reasonNote.trim()));

  React.useEffect(() => {
    if (!visible) return;
    setReasonCode('');
    setReasonNote('');
    setSelectorOpen(false);
  }, [visible, action]);

  return (
    <ResponsiveActionDialog
      visible={visible}
      title={failed ? 'Report delivery failure' : 'Confirm delivery'}
      body={failed
        ? `Choose why Order ${orderReference || ''} could not be delivered.`
        : `Mark Order ${orderReference || ''} as delivered?`}
      cancelLabel="Cancel"
      confirmLabel={failed ? 'Confirm Failure' : 'Confirm Delivered'}
      confirmTone={failed ? 'danger' : 'success'}
      busy={busy}
      confirmDisabled={invalid}
      onCancel={onCancel}
      onConfirm={() => onConfirm?.(failed ? { failureReasonCode: reasonCode, failureReasonNote: reasonNote.trim() } : {})}
    >
      {failed && (
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>Failure reason</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose delivery failure reason"
            accessibilityState={{ expanded: selectorOpen }}
            onPress={() => setSelectorOpen((open) => !open)}
            style={({ pressed }) => [styles.select, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border }, pressed && styles.pressed]}
          >
            <Text style={[styles.selectText, { color: selected ? colors.textPrimary : colors.textSecondary }]}>{selected?.label || 'Select a reason'}</Text>
            <Text style={[styles.chevron, { color: colors.primary }]}>{selectorOpen ? '⌃' : '⌄'}</Text>
          </Pressable>
          {selectorOpen && (
            <View style={[styles.options, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              {DELIVERY_FAILURE_REASONS.map((reason) => (
                <Pressable
                  key={reason.code}
                  accessibilityRole="button"
                  onPress={() => { setReasonCode(reason.code); setSelectorOpen(false); }}
                  style={({ pressed }) => [styles.option, { borderBottomColor: colors.border }, reason.code === reasonCode && { backgroundColor: colors.primarySoft }, pressed && styles.pressed]}
                >
                  <Text style={[styles.optionText, { color: colors.textPrimary }]}>{reason.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {!!selected && (
            <>
              <Text style={[styles.label, { color: colors.textPrimary }]}>{noteRequired ? 'Short explanation' : 'Additional note (optional)'}</Text>
              <TextInput
                accessibilityLabel={noteRequired ? 'Delivery failure explanation' : 'Optional delivery failure note'}
                value={reasonNote}
                onChangeText={setReasonNote}
                maxLength={240}
                multiline
                placeholder={noteRequired ? 'Briefly explain what happened' : 'Add useful context for the requester and Manager'}
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, { backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border, color: colors.textPrimary }]}
              />
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
  label: { fontSize: 12, fontWeight: '800', marginTop: 5 },
  select: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700' },
  chevron: { fontSize: 18, fontWeight: '900' },
  options: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  option: { minHeight: 42, paddingHorizontal: 13, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { fontSize: 13, fontWeight: '700' },
  input: { minHeight: 76, maxHeight: 120, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 13 },
  hint: { fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
