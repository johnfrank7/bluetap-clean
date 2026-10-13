import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function CancelRequestModal({
  visible,
  request,
  busy = false,
  onKeep,
  onConfirm,
  title = 'Cancel Water Request?',
  description = 'Are you sure you want to cancel this water request? This action cannot be undone.',
  keepLabel = 'Keep Request',
  cancelLabel = 'Cancel Request',
}) {
  const { colors, isDark } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 420;

  const handleDismiss = () => {
    if (busy) return;
    onKeep?.();
  };

  // Web Escape key dismissal
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || typeof window === 'undefined') return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, busy, onKeep]);

  if (!visible) return null;

  const orderId = request?.publicOrderId || request?.id || request?.requestId || '';
  const waterStation =
    request?.waterStation ||
    request?.water_station ||
    request?.currentBranchName ||
    request?.branchNameSnapshot ||
    '';
  const totalAmount =
    request?.formattedGrandTotal ||
    (Number.isFinite(Number(request?.totalAmount || request?.totalAtOrder || request?.total_cost))
      ? `₱${Number(request?.totalAmount || request?.totalAtOrder || request?.total_cost).toFixed(2)}`
      : '');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View
        style={[
          styles.backdrop,
          { backgroundColor: colors.overlay || 'rgba(15, 23, 42, 0.6)' },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => !busy && onKeep?.()}
          accessibilityRole="none"
          importantForAccessibility="no"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centerContainer}
        >
          <View
            accessibilityViewIsModal
            accessibilityRole="alertdialog"
            accessibilityLabel={title}
            style={[
              styles.modalCard,
              narrow && styles.modalCardNarrow,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            {/* Warning Icon Badge */}
            <View
              style={[
                styles.iconBadge,
                { backgroundColor: colors.dangerSoft || (isDark ? '#48262A' : '#FCE9E8') },
              ]}
            >
              <Text
                style={[
                  styles.iconText,
                  { color: colors.danger || '#EF4444' },
                ]}
              >
                ✕
              </Text>
            </View>

            {/* Title & Description */}
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {title}
            </Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {description}
            </Text>

            {/* Contextual Order Snapshot */}
            {Boolean(orderId) && (
              <View
                style={[
                  styles.orderSnapshot,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.snapshotRow}>
                  <Text style={[styles.snapshotLabel, { color: colors.textSecondary }]}>
                    Order ID
                  </Text>
                  <Text
                    style={[styles.snapshotValue, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {orderId}
                  </Text>
                </View>
                {Boolean(waterStation && waterStation !== 'Not set') && (
                  <View style={styles.snapshotRow}>
                    <Text style={[styles.snapshotLabel, { color: colors.textSecondary }]}>
                      Station
                    </Text>
                    <Text
                      style={[styles.snapshotValue, { color: colors.textPrimary }]}
                      numberOfLines={1}
                    >
                      {waterStation}
                    </Text>
                  </View>
                )}
                {Boolean(totalAmount) && (
                  <View style={styles.snapshotRow}>
                    <Text style={[styles.snapshotLabel, { color: colors.textSecondary }]}>
                      Total
                    </Text>
                    <Text
                      style={[styles.snapshotValue, styles.snapshotTotal, { color: colors.primary }]}
                      numberOfLines={1}
                    >
                      {totalAmount}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Action Buttons */}
            <View style={[styles.actions, narrow && styles.actionsNarrow]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={keepLabel}
                disabled={busy}
                onPress={onKeep}
                style={({ pressed }) => [
                  styles.button,
                  styles.keepButton,
                  narrow && styles.buttonNarrow,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                  busy && styles.buttonDisabled,
                  pressed && !busy && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.keepText, { color: colors.textPrimary }]}>
                  {keepLabel}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={busy ? 'Cancelling water request...' : cancelLabel}
                disabled={busy}
                onPress={onConfirm}
                style={({ pressed }) => [
                  styles.button,
                  styles.cancelButton,
                  narrow && styles.buttonNarrow,
                  {
                    backgroundColor: colors.dangerAction || colors.danger || '#B52F2F',
                  },
                  busy && styles.buttonDisabled,
                  pressed && !busy && styles.buttonPressed,
                ]}
              >
                <View style={styles.buttonContentRow}>
                  {busy && (
                    <ActivityIndicator
                      size="small"
                      color={colors.onDanger || '#FFFFFF'}
                      style={styles.buttonSpinner}
                    />
                  )}
                  <Text style={[styles.cancelText, { color: colors.onDanger || '#FFFFFF' }]}>
                    {busy ? 'Cancelling...' : cancelLabel}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 10000,
  },
  centerContainer: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
  },
  modalCard: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 24,
  },
  modalCardNarrow: {
    padding: 18,
    borderRadius: 16,
  },
  iconBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  orderSnapshot: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 20,
    gap: 6,
  },
  snapshotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  snapshotLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  snapshotValue: {
    fontSize: 12,
    fontWeight: '700',
    maxWidth: '70%',
  },
  snapshotTotal: {
    fontSize: 13,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: '100%',
    gap: 12,
  },
  actionsNarrow: {
    flexDirection: 'column-reverse',
    gap: 10,
  },
  button: {
    minHeight: 46,
    minWidth: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    flexGrow: 1,
  },
  buttonNarrow: {
    width: '100%',
    minWidth: '100%',
  },
  keepButton: {
    borderWidth: 1,
  },
  cancelButton: {
    borderWidth: 0,
  },
  keepText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSpinner: {
    marginRight: 8,
  },
});
