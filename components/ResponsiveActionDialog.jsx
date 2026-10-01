import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function ResponsiveActionDialog({
  visible,
  title,
  body,
  children,
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  confirmTone = 'primary',
  busy = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
}) {
  const { colors } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 520;
  const confirmColor = confirmTone === 'danger' ? colors.danger : confirmTone === 'success' ? colors.success : colors.primaryAction;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !busy && onCancel?.()}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
        style={[styles.backdrop, { backgroundColor: colors.overlay, justifyContent: narrow ? 'flex-end' : 'center' }]}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            narrow && styles.mobileDialog,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            {!!body && <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>}
            {children}
          </ScrollView>
          <View style={[styles.actions, narrow && styles.mobileActions, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCancel}
              style={({ pressed }) => [styles.button, styles.cancel, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }, pressed && styles.pressed]}
            >
              <Text style={[styles.cancelText, { color: colors.textPrimary }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy || confirmDisabled}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.button,
                styles.confirm,
                { backgroundColor: confirmColor },
                (busy || confirmDisabled) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.confirmText, { color: colors.onPrimary }]}>{busy ? 'Saving…' : confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', padding: 18 },
  dialog: {
    width: '100%', maxWidth: 500, maxHeight: '88%', minWidth: 0,
    borderWidth: 1, borderRadius: 20, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  mobileDialog: { maxWidth: '100%', maxHeight: '92%', borderRadius: 20, marginBottom: 0 },
  content: { padding: 20 },
  title: { fontSize: 20, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, padding: 16, borderTopWidth: 1 },
  mobileActions: { flexWrap: 'wrap' },
  button: { minHeight: 46, minWidth: 120, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1 },
  confirm: { flexGrow: 0 },
  cancelText: { fontSize: 13, fontWeight: '800' },
  confirmText: { fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.82 },
});
