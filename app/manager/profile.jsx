import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { saveLocalUser } from '../../localUsers';

import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell from '../../components/ManagerShell';
import ManagerProfileHeader from '../../components/ManagerProfileHeader';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import TopToastFeedback from '../../components/TopToastFeedback';
import useUnsavedChangesGuard from '../../components/useUnsavedChangesGuard';
import { getModuleSession } from '../../services/authSession';
import { formatPhilippinePhone, normalizePhilippinePhone } from '../../services/phoneUtils';
import { updateManagerProfile } from '../../services/managerProfile';
import { getProfileUniqueId } from '../../services/uniqueIds';
const { profileDraftsDiffer, changedProfileFields } = require('../../services/profileDraftComparison');

const clean = (value, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const fullNameFor = (profile = {}) => clean(
  profile?.fullName || `${profile?.firstName || ''} ${profile?.lastName || ''}`,
  ''
);

const draftFor = (profile = {}) => {
  const safeProfile = profile || {};
  return {
    fullName: fullNameFor(safeProfile),
    phone: clean(safeProfile.phone || safeProfile.contactNumber, ''),
    address: clean(safeProfile.address || safeProfile.location || safeProfile.completeAddress, ''),
  };
};

function ProfileField({ editable, disabled, label, multiline, onChangeText, value, themedStyles }) {
  return (
    <View style={themedStyles.fieldWrap}>
      <Text style={themedStyles.detailLabel}>{label}</Text>
      {editable ? (
        <TextInput
          accessibilityLabel={label}
          editable={!disabled}
          multiline={multiline}
          onChangeText={onChangeText}
          style={[themedStyles.input, multiline && themedStyles.multilineInput]}
          value={value}
        />
      ) : (
        <Text style={themedStyles.detailValue}>{value}</Text>
      )}
    </View>
  );
}

export default function ManagerProfilePage() {
  const { colors } = useAdminTheme();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const styles = useMemo(() => createStyles(colors, compact), [colors, compact]);
  const session = getModuleSession('manager');
  const realtime = useManagerRealtimeData();
  const manager = realtime.profile;
  const navigation = useNavigation();
  const expectedProfile = useRef(null);
  const saveInFlight = useRef(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(manager));
  const [selectedImage, setSelectedImage] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [profileSaveError, setProfileSaveError] = useState('');

  useEffect(() => {
    if (!editing) setDraft(draftFor(manager || {}));
  }, [editing, manager]);

  const isProfileDirty = useMemo(() => {
    if (!editing) return false;
    const initial = expectedProfile.current || draftFor(manager || {});
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
  const managerUid = resolvedManagerUid || (realtime.profileLoading || (!!manager && !realtime.errors?.profileEnsure) ? 'Loading…' : 'Not assigned');
  const rawContact = clean(manager?.phone || manager?.contactNumber, '');
  const managerContact = rawContact ? formatPhilippinePhone(rawContact) : (realtime.profileLoading ? 'Loading…' : 'Not set');
  const managerEmail = clean(manager?.email || session?.email, realtime.profileLoading ? 'Loading…' : 'Not set');
  const managerAddress = clean(manager?.address || manager?.location || manager?.completeAddress, realtime.profileLoading ? 'Loading…' : 'Not set');
  const branchName = clean(realtime.branch?.name || session?.branchName, realtime.branchLoading ? 'Loading…' : 'Not assigned');
  const storedPhotoUri = manager?.profilePhotoRemoved ? '' : (manager?.profilePhotoUrl || manager?.photoURL || manager?.avatarUrl || '');
  const photoUri = selectedImage?.uri || (removeImage ? '' : storedPhotoUri);
  const loadError = realtime.errors?.branch || realtime.errors?.profile || realtime.errors?.profileEnsure || '';
  const missingRequiredData = !realtime.branch && !manager && !realtime.branchLoading && !realtime.profileLoading;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });
  const changeDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const beginEditing = () => {
    const initial = draftFor(manager || {});
    expectedProfile.current = { ...initial, profilePhotoPath: String(manager?.profilePhotoPath || '').trim() };
    setProfileSaveError('');
    setDraft(initial);
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
    if ('phone' in changes && !normalizePhilippinePhone(changes.phone)) { showToast('Enter a valid Philippine mobile number.', 'warning'); return false; }
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

  return (
    <ManagerShell active="profile" title="Profile" subtitle="Your Manager workspace and branch assignment" onNavigate={confirmLeave}>
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((current) => ({ ...current, visible: false }))}
      />
      <View style={styles.container}>
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
                  <ProfileField editable={editing} disabled={saving} label="Contact Number" onChangeText={(value) => changeDraft('phone', value)} themedStyles={styles} value={editing ? draft.phone : managerContact} />
                  <ProfileField label="Email Address" themedStyles={styles} value={managerEmail} />
                  <ProfileField editable={editing} disabled={saving} label="Complete Address / Location" multiline onChangeText={(value) => changeDraft('address', value)} themedStyles={styles} value={editing ? draft.address : managerAddress} />
                </View>
              </View>
              <View style={styles.detailSection}>
                <Text style={styles.sectionTitle}>Branch &amp; access</Text>
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
                disabled={saving}
                onPress={saveProfile}
                style={[styles.primaryButton, saving && styles.disabledButton]}
              >
                {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.securityNote}>Email, branch assignment, public UID, account status, and access level are managed securely by BlueTap.</Text>
        </View>
      </View>
      <UnsavedModal {...(profileSaveError ? { error: profileSaveError } : {})} />
    </ManagerShell>
  );
}

const createStyles = (colors, compact) => StyleSheet.create({
  container: { maxWidth: 640, alignSelf: 'center', width: '100%' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: compact ? 16 : 22 },
  disabledButton: { opacity: 0.78 },
  errorBanner: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, borderRadius: 12, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 16, padding: 12 },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '600', marginTop: 3 },
  retryButton: { borderWidth: 1, borderColor: colors.danger, borderRadius: 9, minHeight: 38, justifyContent: 'center', paddingHorizontal: 14 },
  retryText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  unavailableState: { alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 12, marginTop: 18, padding: 24 },
  emptyCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16, marginTop: 5, textAlign: 'center' },
  detailSections: { marginTop: 18, gap: 20 },
  detailSection: { width: '100%' },
  sectionTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', paddingBottom: 9, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 },
  fieldWrap: { flexBasis: compact ? '100%' : '48%', flexGrow: 1, minWidth: compact ? 0 : 220, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.35, textTransform: 'uppercase' },
  detailValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 6 },
  input: { backgroundColor: colors.input || colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.textPrimary, fontSize: 15, marginTop: 7, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  multilineInput: { minHeight: 82, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 18 },
  cancelButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, minHeight: 42, justifyContent: 'center', paddingHorizontal: 18 },
  cancelButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryAction || '#0B67AD',
    borderColor: colors.primaryDark || colors.primaryAction || '#0B5FA8',
    borderRadius: 10,
    borderWidth: 1,
    elevation: 2,
    justifyContent: 'center',
    minHeight: 46,
    minWidth: 136,
    paddingHorizontal: 20,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 3,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  securityNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' },
});
