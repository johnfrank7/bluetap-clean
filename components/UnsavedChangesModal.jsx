import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';

export default function UnsavedChangesModal({
  visible,
  onContinueEditing,
  onDiscardAndLeave,
  title = 'You have unfinished changes.',
  message = 'If you leave now, any changes you made will be lost. Do you want to continue editing or discard your changes?',
  discardLabel = 'Discard Changes and Leave',
  continueLabel = 'Keep Editing',
}) {
  const { colors } = useAdminTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onContinueEditing}
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
          <Text style={[styles.body, { color: colors.textSecondary }]}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={discardLabel}
              onPress={onDiscardAndLeave}
              style={({ pressed }) => [
                styles.discardButton,
                { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
                pressed && { opacity: 0.8 },
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
              style={({ pressed }) => [
                styles.continueButton,
                { backgroundColor: colors.primaryAction },
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text style={[styles.continueText, { color: colors.onPrimary }]}>
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
  },
  discardButton: {
    minHeight: 42,
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
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueText: {
    fontSize: 12,
    fontWeight: '900',
  },
});
