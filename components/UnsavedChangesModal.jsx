import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOptionalAdminTheme } from './AdminTheme';
import { useBlueTapTheme } from './BlueTapTheme';

export default function UnsavedChangesModal({
  visible,
  onContinueEditing,
  onDiscardAndLeave,
  onSaveAndLeave,
  saving = false,
  error = '',
  title = 'You have unfinished changes.',
  message,
  discardLabel = 'Discard Changes and Leave',
  continueLabel = onSaveAndLeave ? 'Continue Editing' : 'Keep Editing',
}) {
  const adminTheme = useOptionalAdminTheme();
  const portalTheme = useBlueTapTheme();
  const colors = adminTheme?.colors || portalTheme.colors;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={saving ? undefined : onContinueEditing}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.warningSoft }]}>
            <Text style={[styles.iconText, { color: colors.warning }]}>⚠</Text>
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{message || (onSaveAndLeave ? 'Save your changes, discard them, or continue editing.' : 'Discard your changes or continue editing.')}</Text>
          {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>}
          <View style={styles.actions}>
            {onSaveAndLeave && <Pressable accessibilityRole="button" accessibilityLabel="Keep Changes" disabled={saving} onPress={onSaveAndLeave} style={[styles.continueButton, { backgroundColor: colors.primaryAction }, saving && styles.disabled]}><Text style={[styles.continueText, { color: colors.onPrimary }]}>{saving ? 'Saving…' : 'Keep Changes'}</Text></Pressable>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={discardLabel}
              onPress={onDiscardAndLeave}
              disabled={saving}
              style={({ pressed }) => [
                styles.discardButton,
                { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
                pressed && { opacity: 0.8 },
                saving && styles.disabled,
              ]}
            >
              <Text style={[styles.discardText, { color: colors.danger }]}>
                {discardLabel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={continueLabel}
              onPress={onContinueEditing}
              disabled={saving}
              style={({ pressed }) => [
                styles.continueButton,
                { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
                pressed && { opacity: 0.88 },
                saving && styles.disabled,
              ]}
            >
              <Text style={[styles.continueText, { color: colors.textPrimary }]}>
                {continueLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 18,
    borderWidth: 1,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconText: {
    fontSize: 22,
    fontWeight: '900',
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'column',
    gap: 10,
  },
  discardButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  discardText: {
    fontSize: 12,
    fontWeight: '800',
  },
  continueButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueText: {
    fontSize: 12,
    fontWeight: '900',
  },
  error: { fontSize: 13, marginBottom: 12 },
  disabled: { opacity: 0.65 },
});
