import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import {
  ActivityIndicator,
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
import * as ImagePicker from 'expo-image-picker';

import { saveLocalUser } from '../../localUsers';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapIcon from '../../components/BlueTapIcon';
import ManagerShell from '../../components/ManagerShell';
import ManagerProfileHeader from '../../components/ManagerProfileHeader';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import TopToastFeedback from '../../components/TopToastFeedback';
import ChangePasswordModal from '../../components/ChangePasswordModal';
import useUnsavedChangesGuard from '../../components/useUnsavedChangesGuard';
import { getModuleSession } from '../../services/authSession';
import { formatPhilippinePhone, normalizePhilippinePhone } from '../../services/phoneUtils';
import { updateManagerProfile } from '../../services/managerProfile';
import { getProfileUniqueId } from '../../services/uniqueIds';
const { isValidManagerPhone } = require('../../services/managerPhone');
const { profileDraftsDiffer, changedProfileFields } = require('../../services/profileDraftComparison');

const clean = (value, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const fullNameFor = (profile = {}) =>
  clean(profile?.fullName || `${profile?.firstName || ''} ${profile?.lastName || ''}`, '');

const draftFor = (profile = {}) => {
  const safeProfile = profile || {};
  return {
    fullName: fullNameFor(safeProfile),
    phone: clean(safeProfile.phone || safeProfile.contactNumber, ''),
    address: clean(safeProfile.address || safeProfile.location || safeProfile.completeAddress, ''),
  };
};

function ProfileField({ editable, disabled, label, multiline, onChangeText, value, themedStyles, error, keyboardType }) {
  return (
    <View style={themedStyles.fieldWrap}>
      <Text style={themedStyles.detailLabel}>{label}</Text>
      {editable ? (
        <TextInput
          accessibilityLabel={label}
          aria-invalid={!!error}
          keyboardType={keyboardType}
          editable={!disabled}
          multiline={multiline}
          onChangeText={onChangeText}
          style={[themedStyles.input, multiline && themedStyles.multilineInput]}
          value={value}
        />
      ) : (
        <Text style={themedStyles.detailValue}>{value}</Text>
      )}
      {!!error && <Text accessibilityRole="alert" style={themedStyles.fieldError}>{error}</Text>}
    </View>
  );
}

export default function ManagerSettingsPage() {
  const { colors, preference, resolvedTheme, setPreference } = useAdminTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
  const session = getModuleSession('manager');
  const realtime = useManagerRealtimeData();
  const manager = realtime.profile;
  const navigation = useNavigation();
  const editBaseline = useRef(null);
  const expectedProfile = useRef(null);
  const saveInFlight = useRef(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(manager));
  const [selectedImage, setSelectedImage] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState('');
  const phoneValid = isValidManagerPhone(draft.phone);
  const phoneError = editing && !phoneValid ? 'Enter 09XXXXXXXXX or +639XXXXXXXXX (Philippine mobile number).' : '';

  useEffect(() => {
    if (!editing) setDraft(draftFor(manager || {}));
  }, [editing, manager]);

  const isProfileDirty = useMemo(() => {
    if (!editing) return false;
    const initial = editBaseline.current || draftFor(manager);
    return (
      profileDraftsDiffer(draft, initial, normalizePhilippinePhone) ||
      Boolean(selectedImage) || removeImage
    );
  }, [editing, manager, draft, selectedImage, removeImage]);

  const { confirmLeave, UnsavedModal } = useUnsavedChangesGuard({
    isDirty: isProfileDirty,
    isSubmitting: saving,
    onSave: saveProfile,
    navigationManaged: true,
    onDiscard: () => {
      setDraft(draftFor(manager || {}));
      setSelectedImage(null);
      setRemoveImage(false);
      setEditing(false);
    },
  });
  usePreventRemove(isProfileDirty || saving, ({ data }) => {
    confirmLeave(() => navigation.dispatch(data.action));
  });

  const managerFullName = fullNameFor(manager || {});
  const resolvedManagerUid = getProfileUniqueId(manager || {});
  const managerUid =
    resolvedManagerUid ||
    (realtime.profileLoading || (!!manager && !realtime.errors?.profileEnsure)
      ? 'Loading…'
      : 'Not assigned');
  const rawContact = clean(manager?.phone || manager?.contactNumber, '');
  const managerContact = rawContact
    ? formatPhilippinePhone(rawContact)
    : realtime.profileLoading
    ? 'Loading…'
    : 'Not set';
  const managerEmail = clean(manager?.email || session?.email, realtime.profileLoading ? 'Loading…' : 'Not set');
  const managerAddress = clean(
    manager?.address || manager?.location || manager?.completeAddress,
    realtime.profileLoading ? 'Loading…' : 'Not set'
  );
  const branchName = clean(
    realtime.branch?.name || session?.branchName,
    realtime.branchLoading ? 'Loading…' : 'Not assigned'
  );
  const storedPhotoUri = manager?.profilePhotoRemoved ? '' : (manager?.profilePhotoUrl || manager?.photoURL || manager?.avatarUrl || '');
  const photoUri = selectedImage?.uri || (removeImage ? '' : storedPhotoUri);
  const loadError =
    realtime.errors?.branch || realtime.errors?.profile || realtime.errors?.profileEnsure || '';
  const missingRequiredData =
    !realtime.branch && !manager && !realtime.branchLoading && !realtime.profileLoading;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });
  const changeDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const beginEditing = () => {
    editBaseline.current = draftFor(manager || {});
    expectedProfile.current = { ...editBaseline.current, profilePhotoPath: String(manager?.profilePhotoPath || '').trim() };
    setProfileSaveError('');
    setDraft(editBaseline.current);
    setSelectedImage(null);
    setRemoveImage(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    confirmLeave(() => {
      setDraft(draftFor(manager || {}));
      setSelectedImage(null);
      setRemoveImage(false);
      setEditing(false);
    });
  };

  const choosePhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showToast('Photo access is needed to choose a profile picture.', 'warning');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = { ...result.assets[0] };
        if (asset.fileSize && asset.fileSize > 3 * 1024 * 1024) {
          showToast('Profile pictures must be 3 MB or smaller.', 'warning');
          return;
        }
        if (!asset.base64 && asset.uri && Platform.OS === 'web') {
          try {
            const res = await fetch(asset.uri);
            const blob = await res.blob();
            if (blob.size > 3 * 1024 * 1024) {
              showToast('Profile pictures must be 3 MB or smaller.', 'warning');
              return;
            }
            asset.base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const str = reader.result;
                resolve(str ? String(str).split(',')[1] : null);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch {
            // Keep asset as-is if conversion fails
          }
        }
        setSelectedImage(asset);
        setRemoveImage(false);
      }
    } catch {
      showToast('The profile picture could not be opened. Please try again.', 'error');
    }
  };

  async function saveProfile() {
    if (saveInFlight.current) return false;
    const changes = changedProfileFields(draft, expectedProfile.current || draftFor(manager || {}), normalizePhilippinePhone);
    if ('fullName' in changes && !changes.fullName) { showToast('Full name is required.', 'warning'); return false; }
    if ('phone' in changes && (!isValidManagerPhone(changes.phone) || !normalizePhilippinePhone(changes.phone))) { showToast('Enter a valid Philippine mobile number.', 'warning'); return false; }
    if ('address' in changes && !changes.address) { showToast('Complete address is required.', 'warning'); return false; }
    if (!Object.keys(changes).length && !selectedImage && !removeImage) { setEditing(false); showToast('No changes to save.', 'info'); return true; }
    try {
      saveInFlight.current = true;
      setSaving(true);
      setProfileSaveError('');
      const saved = await updateManagerProfile(changes, selectedImage, expectedProfile.current, removeImage);
      if (!saved) throw new Error('The server did not confirm the profile update.');
      realtime.primeProfile(saved);
      saveLocalUser(saved);
      setEditing(false);
      setSelectedImage(null);
      setRemoveImage(false);
      const cleanupWarning = saved.photoCleanupIncomplete ? 'Profile saved, but the previous photo could not be removed from storage. Contact support.' : '';
      setProfileSaveError(cleanupWarning);
      showToast(cleanupWarning || 'Profile updated successfully.', cleanupWarning ? 'warning' : 'success');
      return !cleanupWarning;
    } catch (error) {
      setProfileSaveError(error?.message || 'Manager profile could not be saved.');
      showToast(error?.message || 'Manager profile could not be saved.', 'error');
      return false;
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  const themeOptions = [
    { key: 'light', label: 'Light', hint: 'Default crisp theme', icon: 'sun' },
    { key: 'dark', label: 'Dark', hint: 'Low-light high contrast', icon: 'moon' },
    { key: 'system', label: 'System', hint: 'Match device setting', icon: 'monitor' },
  ];

  return (
    <ManagerShell active="settings" title="Settings" subtitle="Manage your profile, application theme, and account security" onNavigate={confirmLeave}>
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((current) => ({ ...current, visible: false }))}
      />
      <View style={styles.container}>
        {/* Profile Card */}
        <View style={styles.card}>
          <ManagerProfileHeader colors={colors} name={managerFullName} email={managerEmail} photoUri={photoUri}
            loading={realtime.profileLoading} editing={editing} saving={saving} canRemovePhoto={Boolean(storedPhotoUri || selectedImage)}
            onChoosePhoto={choosePhoto} onRemovePhoto={() => { setSelectedImage(null); setRemoveImage(Boolean(storedPhotoUri)); }}
            onEdit={beginEditing} editDisabled={!manager || realtime.profileLoading} />

          {!!loadError && (
            <View accessibilityRole="alert" style={styles.errorBanner}>
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Profile details need another try</Text>
                <Text style={styles.errorText}>{loadError}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" onPress={realtime.retry} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {missingRequiredData ? (
            <View style={styles.unavailableState}>
              <Text style={styles.errorTitle}>Profile details are unavailable</Text>
              <Text style={styles.emptyCopy}>Your cached profile could not be loaded. Try reconnecting to BlueTap.</Text>
              <TouchableOpacity accessibilityRole="button" onPress={realtime.retry} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.detailSections}>
              <View style={styles.detailSection}>
                <Text style={styles.sectionTitle}>Personal information</Text>
                <View style={styles.sectionGrid}>
                  <ProfileField editable={editing} disabled={saving} label="Full Name" onChangeText={(value) => changeDraft('fullName', value)} themedStyles={styles} value={editing ? draft.fullName : managerFullName || 'Not set'} />
                  <ProfileField editable={editing} disabled={saving} label="Contact Number" keyboardType="phone-pad" error={phoneError} onChangeText={(value) => changeDraft('phone', value)} themedStyles={styles} value={editing ? draft.phone : managerContact} />
                  <ProfileField label="Email Address" themedStyles={styles} value={managerEmail} />
                  <ProfileField editable={editing} disabled={saving} label="Complete Address / Location" multiline onChangeText={(value) => changeDraft('address', value)} themedStyles={styles} value={editing ? draft.address : managerAddress} />
                </View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.sectionTitle}>Branch & access</Text>
                <View style={styles.sectionGrid}>
                  <ProfileField label="UID" themedStyles={styles} value={managerUid} />
                  <ProfileField label="Branch" themedStyles={styles} value={branchName} />
                  <ProfileField label="Access Level" themedStyles={styles} value="Manager panel" />
                </View>
              </View>
            </View>
          )}

          {editing && (
            <View style={styles.formActions}>
              <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={cancelEditing} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={saving ? 'Saving profile changes' : 'Save profile changes'}
                dataSet={{ bluetapCta: 'true' }}
                disabled={saving || !phoneValid}
                onPress={saveProfile}
                style={[styles.primaryButton, (saving || !phoneValid) && styles.disabledButton]}
              >
                {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.securityNote}>Email, branch assignment, public UID, account status, and access level are managed securely by BlueTap.</Text>
        </View>

        {/* Appearance & Theme Section */}
        <View style={[styles.card, { marginTop: 20 }]}>
          <Text style={styles.sectionHeaderTitle}>Appearance</Text>
          <Text style={styles.sectionHeaderSubtitle}>Customize your Manager workspace display mode</Text>

          <View style={styles.themeGrid}>
            {themeOptions.map((opt) => {
              const active = preference === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setPreference(opt.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch theme to ${opt.label}`}
                  style={[
                    styles.themeOptionCard,
                    active && styles.themeOptionCardActive,
                  ]}
                >
                  <View style={[styles.themeIconWrapper, active && styles.themeIconWrapperActive]}>
                    <BlueTapIcon
                      name={opt.icon}
                      size={20}
                      color={active ? colors.onPrimary || '#FFFFFF' : colors.primary}
                    />
                  </View>
                  <Text style={[styles.themeOptionLabel, active && styles.themeOptionLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.themeOptionHint}>{opt.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Security Section */}
        <View style={[styles.card, { marginTop: 20 }]}>
          <Text style={styles.sectionHeaderTitle}>Account Security</Text>
          <Text style={styles.sectionHeaderSubtitle}>Manage authentication password and credentials</Text>

          <View style={styles.securityRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.securityRowTitle}>Account Password</Text>
              <Text style={styles.securityRowSubtitle}>
                Ensure your password is at least 8 characters with numbers and letters
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setPasswordModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Change Password"
              dataSet={{ bluetapCta: 'true' }}
              style={styles.changePasswordBtn}
            >
              <Text style={styles.changePasswordBtnText}>Change Password</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ChangePasswordModal
        theme={{ colors, isDark: resolvedTheme === 'dark' }}
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
        onSuccess={() => showToast('Password updated successfully.', 'success')}
      />
      <UnsavedModal {...(profileSaveError ? { error: profileSaveError } : {})} />
    </ManagerShell>
  );
}

const createStyles = (colors, compact) =>
  StyleSheet.create({
    container: { maxWidth: 680, alignSelf: 'center', width: '100%', paddingBottom: 40 },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: compact ? 16 : 22,
    },
    errorBanner: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
      padding: 14,
    },
    errorCopy: { flex: 1 },
    errorTitle: { color: colors.danger, fontSize: 14, fontWeight: '800' },
    errorText: { color: colors.danger, fontSize: 12, marginTop: 4 },
    retryButton: {
      alignSelf: 'center',
      backgroundColor: colors.danger,
      borderRadius: 8,
      minHeight: 34,
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
    unavailableState: {
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      marginTop: 20,
      padding: 24,
    },
    emptyCopy: { color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center' },
    detailSections: { gap: 18, marginTop: 18 },
    detailSection: { gap: 10 },
    sectionTitle: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    sectionGrid: { gap: 10 },
    fieldWrap: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    detailLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    fieldError: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 6 },
    detailValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 3 },
    input: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 3,
      paddingVertical: 2,
    },
    multilineInput: { minHeight: 48, textAlignVertical: 'top' },
    formActions: {
      flexDirection: 'row',
      gap: 10,
      justifyContent: 'flex-end',
      marginTop: 20,
    },
    cancelButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: 10,
      borderWidth: 1,
      minHeight: 42,
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    cancelButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primaryAction,
      borderRadius: 10,
      minHeight: 42,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    primaryButtonText: { color: colors.onPrimary || '#FFFFFF', fontSize: 13, fontWeight: '800' },
    disabledButton: { opacity: 0.75 },
    securityNote: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 18,
    },
    sectionHeaderTitle: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '800',
    },
    sectionHeaderSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 16,
    },
    themeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    themeOptionCard: {
      flex: 1,
      minWidth: compact ? '100%' : 140,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 14,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    themeOptionCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    themeIconWrapper: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    themeIconWrapperActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    themeOptionLabel: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    themeOptionLabelActive: {
      color: colors.primary,
    },
    themeOptionHint: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 3,
      textAlign: 'center',
    },
    securityRow: {
      flexDirection: compact ? 'column' : 'row',
      alignItems: compact ? 'flex-start' : 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 8,
    },
    securityRowTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    securityRowSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    changePasswordBtn: {
      minHeight: 44,
      paddingHorizontal: 16,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primaryAction,
      backgroundColor: colors.primaryAction,
      justifyContent: 'center',
      alignItems: 'center',
    },
    changePasswordBtnText: {
      color: colors.onPrimary || '#FFFFFF',
      fontSize: 12,
      fontWeight: '800',
    },
  });
