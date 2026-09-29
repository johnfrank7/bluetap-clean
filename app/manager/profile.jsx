import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell, { ManagerPill, ManagerWaterDrop } from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import TopToastFeedback from '../../components/TopToastFeedback';
import { getModuleSession } from '../../services/authSession';
import { formatPhilippinePhone, normalizePhilippinePhone } from '../../services/phoneUtils';
import { updateManagerProfile } from '../../services/managerProfile';
import { getProfileUniqueId } from '../../services/uniqueIds';

const clean = (value, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const fullNameFor = (profile = {}) => clean(
  profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`,
  ''
);

const draftFor = (profile = {}) => ({
  fullName: fullNameFor(profile),
  phone: clean(profile.phone || profile.contactNumber, ''),
  address: clean(profile.address || profile.location || profile.completeAddress, ''),
});

function ProfileField({ editable, label, multiline, onChangeText, value, themedStyles }) {
  return (
    <View style={themedStyles.fieldWrap}>
      <Text style={themedStyles.detailLabel}>{label}</Text>
      {editable ? (
        <TextInput
          accessibilityLabel={label}
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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const session = getModuleSession('manager');
  const realtime = useManagerRealtimeData();
  const manager = realtime.profile;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(manager));
  const [selectedImage, setSelectedImage] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  useEffect(() => {
    if (!editing) setDraft(draftFor(manager || {}));
  }, [editing, manager]);

  const managerFullName = fullNameFor(manager || {});
  const resolvedManagerUid = getProfileUniqueId(manager || {});
  const managerUid = resolvedManagerUid || (realtime.profileLoading || (!!manager && !realtime.errors?.profileEnsure) ? 'Loading…' : 'Not assigned');
  const rawContact = clean(manager?.phone || manager?.contactNumber, '');
  const managerContact = rawContact ? formatPhilippinePhone(rawContact) : (realtime.profileLoading ? 'Loading…' : 'Not set');
  const managerEmail = clean(manager?.email || session?.email, realtime.profileLoading ? 'Loading…' : 'Not set');
  const managerAddress = clean(manager?.address || manager?.location || manager?.completeAddress, realtime.profileLoading ? 'Loading…' : 'Not set');
  const branchName = clean(realtime.branch?.name || session?.branchName, realtime.branchLoading ? 'Loading…' : 'Not assigned');
  const photoUri = selectedImage?.uri || manager?.profilePhotoUrl || '';
  const loadError = realtime.errors?.branch || realtime.errors?.profile || realtime.errors?.profileEnsure || '';
  const missingRequiredData = !realtime.branch && !manager && !realtime.branchLoading && !realtime.profileLoading;

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });
  const changeDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const beginEditing = () => {
    setDraft(draftFor(manager || {}));
    setSelectedImage(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraft(draftFor(manager || {}));
    setSelectedImage(null);
    setEditing(false);
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
      if (!result.canceled && result.assets?.[0]) setSelectedImage(result.assets[0]);
    } catch {
      showToast('The profile picture could not be opened. Please try again.', 'error');
    }
  };

  const saveProfile = async () => {
    if (saving) return;
    const fullName = draft.fullName.trim();
    const phone = normalizePhilippinePhone(draft.phone);
    const address = draft.address.trim();
    if (!fullName) return showToast('Full name is required.', 'warning');
    if (!phone) return showToast('Enter a valid Philippine mobile number.', 'warning');
    if (!address) return showToast('Complete address is required.', 'warning');
    try {
      setSaving(true);
      const saved = await updateManagerProfile({ fullName, phone, address }, selectedImage);
      realtime.primeProfile(saved);
      setEditing(false);
      setSelectedImage(null);
      showToast('Profile updated successfully.', 'success');
    } catch (error) {
      showToast(error?.message || 'Manager profile could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ManagerShell active="profile" title="Profile" subtitle="Your Manager workspace and branch assignment">
      <TopToastFeedback
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((current) => ({ ...current, visible: false }))}
      />
      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <View style={styles.avatarArea}>
            <View style={styles.avatar}>
              {photoUri ? (
                <Image accessibilityLabel="Manager profile picture" source={{ uri: photoUri }} style={styles.avatarImage} />
              ) : (
                <ManagerWaterDrop color={colors.primary} size={34} />
              )}
            </View>
            {editing && (
              <TouchableOpacity accessibilityRole="button" onPress={choosePhoto} style={styles.changePhotoButton}>
                <Text style={styles.changePhotoText}>{selectedImage ? 'Change photo' : 'Choose photo'}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.profileText}>
            {realtime.profileLoading && !managerFullName ? (
              <ActivityIndicator color={colors.primary} size="small" style={styles.nameLoader} />
            ) : (
              <Text style={styles.profileName}>{managerFullName || managerEmail || 'Manager'}</Text>
            )}
            <Text style={styles.profileMeta}>Branch Manager · {branchName}</Text>
          </View>
          <View style={styles.headerActions}>
            <ManagerPill tone="blue">Manager</ManagerPill>
            {!editing && (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!manager || realtime.profileLoading}
                onPress={beginEditing}
                style={[styles.editButton, (!manager || realtime.profileLoading) && styles.disabledButton]}
              >
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

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
          <View style={styles.detailGrid}>
            <ProfileField label="UID" themedStyles={styles} value={managerUid} />
            <ProfileField editable={editing} label="Full Name" onChangeText={(value) => changeDraft('fullName', value)} themedStyles={styles} value={editing ? draft.fullName : managerFullName || 'Not set'} />
            <ProfileField editable={editing} label="Contact Number" onChangeText={(value) => changeDraft('phone', value)} themedStyles={styles} value={editing ? draft.phone : managerContact} />
            <ProfileField label="Email Address" themedStyles={styles} value={managerEmail} />
            <ProfileField editable={editing} label="Complete Address / Location" multiline onChangeText={(value) => changeDraft('address', value)} themedStyles={styles} value={editing ? draft.address : managerAddress} />
            <ProfileField label="Branch" themedStyles={styles} value={branchName} />
            <ProfileField label="Access Level" themedStyles={styles} value="Manager panel" />
          </View>
        )}

        {editing && (
          <View style={styles.formActions}>
            <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={cancelEditing} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={saveProfile} style={[styles.primaryButton, saving && styles.disabledButton]}>
              {saving ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={styles.primaryButtonText}>Save Changes</Text>}
            </TouchableOpacity>
          </View>
        )}
        <Text style={styles.securityNote}>Email, branch assignment, public UID, account status, and access level are managed securely by BlueTap.</Text>
      </View>
    </ManagerShell>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 22 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 20 },
  avatarArea: { alignItems: 'center', gap: 7 },
  avatar: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft, borderWidth: 2, borderColor: colors.border, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  changePhotoButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  changePhotoText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  profileText: { flex: 1, minWidth: 180 },
  nameLoader: { alignSelf: 'flex-start', marginBottom: 4 },
  profileName: { color: colors.textPrimary, fontSize: 21, fontWeight: '800' },
  profileMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 5 },
  headerActions: { alignItems: 'flex-end', gap: 10 },
  editButton: { backgroundColor: colors.primaryAction, borderRadius: 10, minHeight: 40, justifyContent: 'center', paddingHorizontal: 16 },
  editButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  disabledButton: { opacity: 0.55 },
  errorBanner: { alignItems: 'center', backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger, borderRadius: 12, flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 16, padding: 12 },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  errorText: { color: colors.danger, fontSize: 12, fontWeight: '600', marginTop: 3 },
  retryButton: { borderWidth: 1, borderColor: colors.danger, borderRadius: 9, minHeight: 38, justifyContent: 'center', paddingHorizontal: 14 },
  retryText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  unavailableState: { alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 12, marginTop: 18, padding: 24 },
  emptyCopy: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16, marginTop: 5, textAlign: 'center' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  fieldWrap: { flex: 1, flexBasis: 220, minWidth: 0, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 15 },
  detailLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.35, textTransform: 'uppercase' },
  detailValue: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', lineHeight: 21, marginTop: 8 },
  input: { backgroundColor: colors.input || colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.textPrimary, fontSize: 15, marginTop: 7, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  multilineInput: { minHeight: 82, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', marginTop: 18 },
  cancelButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, minHeight: 42, justifyContent: 'center', paddingHorizontal: 18 },
  cancelButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primaryAction, borderRadius: 10, minHeight: 42, justifyContent: 'center', minWidth: 112, paddingHorizontal: 18 },
  primaryButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  securityNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' },
});
