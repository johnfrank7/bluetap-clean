import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../firebase';
import { useBlueTapTheme } from './BlueTapTheme';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { validatePasswordStrength } from '../services/passwordValidator';
import { passwordChangeOtp } from '../services/passwordChangeOtp';
import PasswordVisibilityButton from './PasswordVisibilityButton';
import { signOutAndClearSessions } from '../services/authSession';

export { validatePasswordStrength };

export default function ChangePasswordModal({ visible, onClose, onSuccess, theme }) {
  const portalTheme = useBlueTapTheme();
  const { colors, isDark } = theme || portalTheme;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [step, setStep] = useState('credentials');
  const [otp, setOtp] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const inFlight = useRef(false);
  const accountUid = useRef('');
  useEffect(() => {
    if (!visible || !retryAt) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, retryAt]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - clock) / 1000));

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setErrorMessage('');
    setSuccessMessage('');
    setStep('credentials');
    setOtp('');
    setRetryAt(0);
    accountUid.current = '';
  };

  const handleClose = () => {
    if (loading) return;
    resetForm();
    onClose?.();
  };

  const handleSubmit = async () => {
    if (inFlight.current) return;
    setErrorMessage('');
    setSuccessMessage('');

    if (step === 'otp') {
      if (!/^\d{6}$/.test(otp)) { setErrorMessage('Enter the six-digit code.'); return; }
      if (!auth.currentUser || auth.currentUser.uid !== accountUid.current) { setErrorMessage('Your session changed. Please sign in again.'); return; }
      inFlight.current = true;
      setLoading(true);
      try {
        const result = await passwordChangeOtp(auth.currentUser, 'confirm', { code: otp, newPassword });
        if (result.changed !== true) throw new Error('Password change could not be confirmed.');
        setSuccessMessage('Password successfully updated.');
        setTimeout(async () => { resetForm(); onSuccess?.(); onClose?.(); if (result.signOutRequired === true) await signOutAndClearSessions(); }, 1200);
      } catch (error) {
        setErrorMessage(error?.message || 'Password change could not be confirmed. Sign in with your new password or contact support.');
      } finally { inFlight.current = false; setLoading(false); }
      return;
    }

    if (!currentPassword) {
      setErrorMessage('Please enter your current password.');
      return;
    }

    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      setErrorMessage(validation.message);
      return;
    }
    if (newPassword.length < 12 || newPassword.length > 128) { setErrorMessage('Use 12–128 characters.'); return; }

    if (newPassword !== confirmPassword) {
      setErrorMessage('New passwords do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setErrorMessage('New password must be different from your current password.');
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      setErrorMessage('Unable to find active user session. Please sign in again.');
      return;
    }

    inFlight.current = true;
    try {
      setLoading(true);
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      if (auth.currentUser?.uid !== currentUser.uid) throw new Error('Your session changed. Please sign in again.');
      await passwordChangeOtp(currentUser, 'request');
      accountUid.current = currentUser.uid;
      setCurrentPassword('');
      setStep('otp');
      setClock(Date.now());
      setRetryAt(Date.now() + 60000);
    } catch (err) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setErrorMessage('Current password is incorrect.');
      } else if (code === 'auth/weak-password') {
        setErrorMessage('The chosen password is too weak according to Firebase security rules.');
      } else if (code === 'auth/requires-recent-login') {
        setErrorMessage('For security, please log out and sign in again before changing your password.');
      } else {
        setErrorMessage(err?.message || 'Failed to request a code. Please try again.');
      }
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  const resend = async () => {
    if (inFlight.current || retrySeconds || auth.currentUser?.uid !== accountUid.current) return;
    inFlight.current = true;
    setLoading(true);
    setErrorMessage('');
    try {
      await passwordChangeOtp(auth.currentUser, 'request');
      setOtp('');
      setClock(Date.now());
      setRetryAt(Date.now() + 60000);
    } catch (error) { setErrorMessage(error?.message || 'Could not send another code.'); }
    finally { inFlight.current = false; setLoading(false); }
  };

  const themeColors = colors || BLUETAP_COLORS;
  const styles = getStyles(themeColors, isDark);
  const Form = Platform.OS === 'web' ? 'form' : View;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View dataSet={{ bluetapPasswordTheme: isDark ? 'dark' : 'light' }} style={styles.overlay}>
        <View style={styles.modalCard} accessibilityViewIsModal accessibilityRole="dialog">
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTextGroup}>
              <Text style={styles.title}>Change Password</Text>
              <Text style={styles.subtitle}>Update your account security password</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Close change password modal"
              style={styles.closeButton}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          <Form {...(Platform.OS === 'web' ? { onSubmit: (event) => { event.preventDefault(); if (!loading && !successMessage) handleSubmit(); } } : {})} style={Platform.OS === 'web' ? { display: 'flex', flexDirection: 'column', minHeight: 0 } : { flexShrink: 1 }}>
          {/* Body */}
          <ScrollView
            style={styles.modalBody}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {!!errorMessage && (
              <View style={styles.alertError} accessibilityRole="alert">
                <Text style={styles.alertErrorText}>{errorMessage}</Text>
              </View>
            )}

            {!!successMessage && (
              <View style={styles.alertSuccess} accessibilityRole="alert">
                <Text style={styles.alertSuccessText}>{successMessage}</Text>
              </View>
            )}

            {step === 'credentials' ? <>
            {/* Current Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Current Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  secureTextEntry={!showCurrent}
                  autoComplete="current-password"
                  accessibilityLabel="Current Password"
                  value={currentPassword}
                  onChangeText={(val) => {
                    setCurrentPassword(val);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="Enter your current password"
                  placeholderTextColor={themeColors.textSecondary || '#8E8E93'}
                  autoCapitalize="none"
                  editable={!loading && !successMessage}
                />
                <PasswordVisibilityButton visible={showCurrent} onPress={() => setShowCurrent((prev) => !prev)} color={themeColors.iconPrimary || themeColors.primary} label="current password" />
              </View>
            </View>

            {/* New Password Field */}
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>New Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  secureTextEntry={!showNew}
                  autoComplete="new-password"
                  accessibilityLabel="New Password"
                  value={newPassword}
                  onChangeText={(val) => {
                    setNewPassword(val);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="Enter at least 12 characters"
                  placeholderTextColor={themeColors.textSecondary || '#8E8E93'}
                  autoCapitalize="none"
                  editable={!loading && !successMessage}
                />
                <PasswordVisibilityButton visible={showNew} onPress={() => setShowNew((prev) => !prev)} color={themeColors.iconPrimary || themeColors.primary} label="new password" />
              </View>
              <Text style={styles.helperText}>
                12–128 characters with at least 1 uppercase, 1 lowercase, and 1 number.
              </Text>
            </View>
            </> : <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Email verification code</Text>
              <Text style={styles.helperText}>Enter the code sent to your verified account email.</Text>
              <TextInput style={styles.textInput} accessibilityLabel="Email verification code" keyboardType="number-pad" autoComplete="one-time-code" value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} editable={!loading && !successMessage} maxLength={6} />
              <TouchableOpacity accessibilityRole="button" disabled={loading || retrySeconds > 0} onPress={resend} style={styles.resendButton}><Text style={[styles.toggleVisibilityText, { color: themeColors.textPrimary }]}>{retrySeconds ? `Resend code in ${retrySeconds}s` : 'Resend code'}</Text></TouchableOpacity>
            </View>}

            {/* Confirm New Password Field */}
            {step === 'credentials' && <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Confirm New Password</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  secureTextEntry={!showConfirm}
                  autoComplete="new-password"
                  accessibilityLabel="Confirm New Password"
                  value={confirmPassword}
                  onChangeText={(val) => {
                    setConfirmPassword(val);
                    if (errorMessage) setErrorMessage('');
                  }}
                  placeholder="Re-enter your new password"
                  placeholderTextColor={themeColors.textSecondary || '#8E8E93'}
                  autoCapitalize="none"
                  editable={!loading && !successMessage}
                />
                <PasswordVisibilityButton visible={showConfirm} onPress={() => setShowConfirm((prev) => !prev)} color={themeColors.iconPrimary || themeColors.primary} label="confirm password" />
              </View>
            </View>}
          </ScrollView>

          {/* Footer */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              onPress={handleClose}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Cancel password change"
              dataSet={{ bluetapPasswordCancel: 'true' }}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading || !!successMessage}
              accessibilityRole="button"
              accessibilityLabel="Update password"
              dataSet={{ bluetapCta: 'true' }}
              style={[
                styles.submitBtn,
                (loading || !!successMessage) && styles.submitBtnDisabled,
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitBtnText}>{step === 'credentials' ? 'Send Code' : 'Update Password'}</Text>
              )}
            </TouchableOpacity>
          </View>
          </Form>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors, isDark) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay || 'rgba(0, 0, 0, 0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '90%',
      backgroundColor: colors.surface || '#FFFFFF',
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border || '#E2E8F0',
      ...Platform.select({
        web: {
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        },
        default: {
          elevation: 6,
        },
      }),
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border || '#E2E8F0',
    },
    headerTextGroup: {
      flex: 1,
      marginRight: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary || '#1E293B',
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary || '#64748B',
      marginTop: 2,
    },
    closeButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt || '#F1F5F9',
    },
    closeIcon: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textSecondary || '#64748B',
    },
    modalBody: {
      maxHeight: 400,
      flexShrink: 1,
    },
    bodyContent: {
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    alertError: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEE2E2',
      borderWidth: 1,
      borderColor: colors.danger || '#EF4444',
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    alertErrorText: {
      color: colors.danger || '#EF4444',
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
    alertSuccess: {
      backgroundColor: isDark ? 'rgba(34, 197, 94, 0.15)' : '#DCFCE7',
      borderWidth: 1,
      borderColor: colors.success || '#22C55E',
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
    },
    alertSuccessText: {
      color: colors.success || '#16A34A',
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
    },
    inputGroup: {
      marginBottom: 16,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary || '#1E293B',
      marginBottom: 6,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.inputBorder || colors.border || '#CBD5E1',
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt || (isDark ? '#1E293B' : '#F8FAFC'),
      paddingHorizontal: 12,
    },
    textInput: {
      flex: 1,
      minHeight: 44,
      fontSize: 14,
      color: colors.textPrimary || '#1E293B',
    },
    resendButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 4 },
    toggleVisibilityText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary || '#0284C7',
    },
    helperText: {
      fontSize: 11,
      color: colors.textSecondary || '#64748B',
      marginTop: 5,
      lineHeight: 15,
    },
    modalFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border || '#E2E8F0',
      gap: 12,
    },
    cancelBtn: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border || '#CBD5E1',
      backgroundColor: colors.surfaceAlt || '#F1F5F9',
    },
    cancelBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary || '#1E293B',
    },
    submitBtn: {
      minHeight: 44,
      paddingHorizontal: 20,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.primaryAction || colors.primary || '#0284C7',
    },
    submitBtnDisabled: {
      opacity: 0.6,
    },
    submitBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.onPrimary || '#FFFFFF',
    },
  });
