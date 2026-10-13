import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAdminTheme } from './AdminTheme';
import AdminIcon from './AdminIcon';
import RoleBadge from './RoleBadge';

export default function AccountActionModal({
  visible,
  action = 'suspend', // 'suspend' | 'reactivate' | 'deactivate'
  account = null,
  scope = 'global', // 'global' | 'branch'
  branchName = '',
  busy = false,
  onClose,
  onConfirm,
}) {
  const { colors, resolvedTheme } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const { width } = useWindowDimensions();
  const compact = width < 480;

  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) {
      setReason('');
    }
  }, [visible, action, account]);

  // Web Escape key listener
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || typeof window === 'undefined') return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, busy, onClose]);

  if (!visible || !account) return null;

  const isSuspend = action === 'suspend';
  const isReactivate = action === 'reactivate';

  const title = isSuspend
    ? 'Suspend Account?'
    : isReactivate
      ? 'Reactivate Account?'
      : 'Deactivate Account?';

  const description = isSuspend
    ? 'Are you sure you want to suspend this account? Access to protected BlueTap services will be restricted according to the account policy.'
    : isReactivate
      ? "Are you sure you want to reactivate this account? Access will be restored according to the user's approved role and existing restrictions."
      : 'Are you sure you want to deactivate this account? Inactive accounts cannot access BlueTap services.';

  const cancelLabel = isSuspend ? 'Keep Active' : 'Cancel';
  const confirmLabel = isSuspend
    ? 'Suspend Account'
    : isReactivate
      ? 'Reactivate Account'
      : 'Deactivate Account';

  const publicId = account.publicUid || account.displayUid || account.uniqueId || account.uid || '—';
  const displayName = account.fullName || account.name || 'Unnamed Account';
  const roleName = String(account.role || '').toUpperCase();

  const handleConfirm = () => {
    if (busy) return;
    onConfirm?.({ reason: reason.trim() });
  };

  const styles = createStyles(colors, isDark, compact);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !busy && onClose?.()}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close confirmation dialog"
          onPress={() => !busy && onClose?.()}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.avoidingWrap}
        >
          <View
            accessibilityViewIsModal
            style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View
                style={[
                  styles.iconWrap,
                  {
                    backgroundColor: isSuspend
                      ? colors.dangerSoft || 'rgba(239, 68, 68, 0.12)'
                      : colors.primarySoft || 'rgba(33, 134, 217, 0.12)',
                  },
                ]}
              >
                <AdminIcon
                  name={isSuspend ? 'security' : 'check'}
                  size={22}
                  color={isSuspend ? colors.danger || '#EF4444' : colors.primary || '#2186D9'}
                />
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                {scope === 'branch' && !!branchName ? (
                  <Text style={[styles.scopeText, { color: colors.textSecondary }]}>
                    Branch: {branchName}
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close"
                disabled={busy}
                onPress={() => onClose?.()}
                style={styles.closeBtn}
              >
                <Text style={[styles.closeText, { color: colors.textSecondary }]}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Content */}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {description}
              </Text>

              {/* Target Account Summary */}
              <View
                style={[
                  styles.targetCard,
                  {
                    backgroundColor: colors.surfaceAlt || (isDark ? '#0A1B2A' : '#F3F8FC'),
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.targetRow}>
                  <Text style={[styles.targetName, { color: colors.textPrimary }]} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {account.role ? (
                    <RoleBadge colors={colors} label={roleName} role={account.role} />
                  ) : null}
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaCol}>
                    <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Public UID</Text>
                    <Text style={[styles.metaValueMono, { color: colors.textPrimary }]}>{publicId}</Text>
                  </View>
                  {account.email ? (
                    <View style={styles.metaCol}>
                      <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>Email</Text>
                      <Text
                        style={[styles.metaValue, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {account.email}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Reason Field */}
              <View style={styles.fieldSection}>
                <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
                  {isSuspend ? 'Reason for suspension (optional)' : 'Reason (optional)'}
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder={
                    isSuspend
                      ? 'Add administrative context for audit log…'
                      : 'Add administrative context…'
                  }
                  placeholderTextColor={colors.placeholder || '#8FA5B8'}
                  editable={!busy}
                  maxLength={240}
                  multiline
                  numberOfLines={2}
                  style={[
                    styles.reasonInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.inputBorder || colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                />
              </View>
            </ScrollView>

            {/* Footer Actions */}
            <View style={[styles.footer, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={cancelLabel}
                disabled={busy}
                onPress={() => onClose?.()}
                style={[
                  styles.cancelBtn,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceAlt || (isDark ? '#0A1B2A' : '#F3F8FC'),
                  },
                ]}
              >
                <Text style={[styles.cancelBtnText, { color: colors.textPrimary }]}>
                  {cancelLabel}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
                disabled={busy}
                onPress={handleConfirm}
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor: isSuspend
                      ? colors.danger || '#EF4444'
                      : colors.primaryAction || colors.primary || '#2186D9',
                  },
                  busy && styles.btnDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
                ) : null}
                <Text style={styles.confirmBtnText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function createStyles(colors, isDark, compact) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(3, 10, 18, 0.72)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
      zIndex: 1000,
    },
    avoidingWrap: {
      width: '100%',
      maxWidth: 480,
      alignItems: 'center',
    },
    modalCard: {
      width: '100%',
      borderRadius: 16,
      borderWidth: 1,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 24,
      elevation: 20,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      gap: 12,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: -0.2,
    },
    scopeText: {
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    closeBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    closeText: {
      fontSize: 22,
      fontWeight: '600',
      lineHeight: 24,
    },
    bodyScroll: {
      maxHeight: 400,
    },
    bodyContent: {
      padding: 20,
      gap: 16,
    },
    description: {
      fontSize: 14,
      lineHeight: 21,
    },
    targetCard: {
      borderRadius: 12,
      borderWidth: 1,
      padding: 14,
      gap: 10,
    },
    targetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    targetName: {
      fontSize: 15,
      fontWeight: '800',
      flex: 1,
    },
    metaRow: {
      flexDirection: compact ? 'column' : 'row',
      gap: compact ? 8 : 16,
    },
    metaCol: {
      flex: 1,
    },
    metaLabel: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    metaValueMono: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      fontWeight: '700',
    },
    metaValue: {
      fontSize: 13,
      fontWeight: '600',
    },
    fieldSection: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '700',
    },
    reasonInput: {
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 13,
      minHeight: 58,
      textAlignVertical: 'top',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderTopWidth: 1,
      gap: 12,
    },
    cancelBtn: {
      minHeight: 44,
      paddingHorizontal: 18,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      fontSize: 14,
      fontWeight: '700',
    },
    confirmBtn: {
      minHeight: 44,
      paddingHorizontal: 20,
      borderRadius: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    confirmBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '800',
    },
    btnDisabled: {
      opacity: 0.65,
    },
  });
}
