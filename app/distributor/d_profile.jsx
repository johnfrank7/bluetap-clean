import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { auth, db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { findLocalUserForAuthRole, saveLocalUser } from '../../localUsers';
import { normalizeRole, signOutAndClearSessions } from '../../services/authSession';
import BlueTapHeader from '../../components/BlueTapHeader';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const getProfileObject = (profile) => profile || {};

const getFullName = (profile) => {
  const safeProfile = getProfileObject(profile);

  return (
    safeProfile.full_name ||
    safeProfile.fullName ||
    `${safeProfile.firstName || ''} ${safeProfile.lastName || ''}`
  )
    .toString()
    .trim();
};

const getContactNumber = (profile) => {
  const safeProfile = getProfileObject(profile);

  return (
    safeProfile.contact_number ||
    safeProfile.contactNumber ||
    safeProfile.phone ||
    ''
  )
    .toString()
    .trim();
};

const getAddress = (profile) => {
  const safeProfile = getProfileObject(profile);

  return (
    safeProfile.address ||
    safeProfile.complete_address ||
    safeProfile.completeAddress ||
    ''
  )
    .toString()
    .trim();
};

const getWaterStation = (profile) => {
  const safeProfile = getProfileObject(profile);

  return (
    safeProfile.waterStation ||
    safeProfile.water_station ||
    safeProfile.stationName ||
    safeProfile.station_name ||
    ''
  )
    .toString()
    .trim();
};

const getDistributorId = (profile) => {
  const safeProfile = getProfileObject(profile);

  return (
    safeProfile.distributor_id ||
    safeProfile.distributorId ||
    safeProfile.uid ||
    safeProfile.id ||
    ''
  )
    .toString()
    .trim();
};

const getRoleLabel = (role) => {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return 'Not set';
  return normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1);
};

const splitFullName = (fullName) => {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.shift() || '';

  return {
    firstName,
    lastName: nameParts.join(' '),
  };
};

const buildProfileDraft = (profile) => ({
  fullName: getFullName(profile),
  contactNumber: getContactNumber(profile),
  address: getAddress(profile),
});

const buildProfileData = (profile = {}, user = null) => {
  const safeProfile = getProfileObject(profile);

  return {
    ...safeProfile,
    uid: user?.uid || safeProfile.uid || safeProfile.id || '',
    email: safeProfile.email || user?.email || '',
  };
};

const buildChangedProfileUpdate = (currentProfile = {}, draft = {}) => {
  const safeCurrentProfile = getProfileObject(currentProfile);
  const updates = {};
  const localUpdates = {};
  const fullName = (draft.fullName || '').trim();
  const contactNumber = (draft.contactNumber || '').trim();
  const address = (draft.address || '').trim();

  if (fullName !== getFullName(safeCurrentProfile)) {
    if (
      Object.prototype.hasOwnProperty.call(safeCurrentProfile, 'full_name') ||
      Object.prototype.hasOwnProperty.call(safeCurrentProfile, 'fullName')
    ) {
      updates.full_name = fullName;
      localUpdates.full_name = fullName;
    } else {
      const nameParts = splitFullName(fullName);
      updates.firstName = nameParts.firstName;
      updates.lastName = nameParts.lastName;
      localUpdates.firstName = nameParts.firstName;
      localUpdates.lastName = nameParts.lastName;
    }
  }

  if (contactNumber !== getContactNumber(safeCurrentProfile)) {
    if (
      Object.prototype.hasOwnProperty.call(safeCurrentProfile, 'contact_number') ||
      Object.prototype.hasOwnProperty.call(safeCurrentProfile, 'contactNumber')
    ) {
      updates.contact_number = contactNumber;
      localUpdates.contact_number = contactNumber;
    } else {
      updates.phone = contactNumber;
      localUpdates.phone = contactNumber;
    }
  }

  if (address !== getAddress(safeCurrentProfile)) {
    updates.address = address;
    localUpdates.address = address;
  }

  return { updates, localUpdates };
};

const ProfileField = memo(function ProfileField({
  editable = false,
  keyboardType = 'default',
  label,
  multiline = false,
  onChangeText,
  placeholder,
  saving = false,
  value,
}) {
  return (
    <View style={styles.profileField}>
      <Text style={styles.label}>{label}</Text>
      {editable ? (
        <TextInput
          style={[styles.input, multiline && styles.multilineInput]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder || label}
          placeholderTextColor="#90A4AE"
          keyboardType={keyboardType}
          editable={!saving}
          multiline={multiline}
        />
      ) : (
        <Text style={styles.value}>{value || 'Not set'}</Text>
      )}
    </View>
  );
});

export default function DistributorProfilePage() {
  const router = useRouter();
  const editFadeAnim = useRef(new Animated.Value(0)).current;
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState(() => buildProfileDraft());
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      const user = auth.currentUser;
      const localProfile = findLocalUserForAuthRole(user, 'distributor');

      if (!user && !localProfile) {
        router.replace('/login');
        return;
      }

      if (localProfile && isMounted) {
        const nextProfile = buildProfileData(localProfile, user);
        setUserData(nextProfile);
        setProfileDraft(buildProfileDraft(nextProfile));
        setLoading(false);
      }

      if (!user) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', user.uid));

        if (snap.exists()) {
          const profile = buildProfileData(snap.data(), user);

          if (normalizeRole(profile.role) !== 'distributor') {
            router.replace('/login');
            return;
          }

          if (isMounted) {
            setUserData(profile);
            setProfileDraft(buildProfileDraft(profile));
          }
        }
      } catch (error) {
        console.log('Distributor profile read error:', error.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [router]);

  useEffect(() => {
    Animated.timing(editFadeAnim, {
      toValue: editingProfile ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [editFadeAnim, editingProfile]);

  const profileDisplay = useMemo(
    () => ({
      fullName: getFullName(userData),
      contactNumber: getContactNumber(userData),
      email: userData?.email || auth.currentUser?.email || '',
      address: getAddress(userData),
      waterStation: getWaterStation(userData) || 'Not Assigned',
      distributorId: getDistributorId(userData) || auth.currentUser?.uid || 'Not set',
      role: getRoleLabel(userData?.role || 'distributor'),
    }),
    [userData]
  );

  const updateProfileDraft = (field, value) => {
    setProfileDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };

  const showSuccessToast = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

    setToastVisible(true);
    Animated.timing(toastAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setToastVisible(false);
      });
    }, 2200);
  };

  const openProfileEditor = () => {
    if (loading || savingProfile) return;

    setProfileDraft(buildProfileDraft(userData || {}));
    setEditingProfile(true);
  };

  const cancelProfileEdit = () => {
    if (savingProfile) return;

    setProfileDraft(buildProfileDraft(userData || {}));
    setEditingProfile(false);
  };

  const saveProfileChanges = async () => {
    if (savingProfile) return;

    const uid = userData?.uid || auth.currentUser?.uid || '';
    const fullName = (profileDraft.fullName || '').trim();
    const contactNumber = (profileDraft.contactNumber || '').trim();
    const address = (profileDraft.address || '').trim();

    if (!uid) {
      Alert.alert('Profile not saved', 'Please log in again before editing your profile.');
      return;
    }

    if (!fullName) {
      Alert.alert('Missing full name', 'Full name cannot be empty.');
      return;
    }

    if (!contactNumber) {
      Alert.alert('Missing contact number', 'Contact number cannot be empty.');
      return;
    }

    if (!address) {
      Alert.alert('Missing address', 'Complete address cannot be empty.');
      return;
    }

    const { updates, localUpdates } = buildChangedProfileUpdate(userData || {}, {
      fullName,
      contactNumber,
      address,
    });
    const hasChanges = Object.keys(updates).length > 0;

    try {
      setSavingProfile(true);

      if (hasChanges && auth.currentUser?.uid) {
        await setDoc(doc(db, 'users', auth.currentUser.uid), updates, {
          merge: true,
        });
      }

      const nextProfile = {
        ...(userData || {}),
        ...localUpdates,
        uid,
        email: profileDisplay.email,
      };

      saveLocalUser(nextProfile);
      setUserData(nextProfile);
      setProfileDraft(buildProfileDraft(nextProfile));
      setEditingProfile(false);
      showSuccessToast();
    } catch (error) {
      console.log('Distributor profile save error:', error.message);
      Alert.alert('Profile not saved', error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    if (savingProfile) return;

    await signOutAndClearSessions();
    router.replace('/login');
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader notificationPath="/distributor/d_notification" />

      <View style={styles.phoneWrapper}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.profileTitle}>PROFILE</Text>

          <View style={styles.infoSection}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>User Information</Text>
              {!editingProfile && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={openProfileEditor}
                  disabled={loading || savingProfile}
                >
                  <Image
                    source={require('../../assets/icons/pencil.png')}
                    style={styles.editIcon}
                  />
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.infoDivider} />

            {loading && !userData ? (
              <View style={styles.infoLoading}>
                <ActivityIndicator size="small" color={BLUE} />
                <Text style={styles.loadingText}>Loading profile...</Text>
              </View>
            ) : (
              <>
                <ProfileField
                  label="Full Name"
                  value={editingProfile ? profileDraft.fullName : profileDisplay.fullName}
                  editable={editingProfile}
                  saving={savingProfile}
                  onChangeText={(value) => updateProfileDraft('fullName', value)}
                />

                <ProfileField
                  label="Contact Number"
                  value={
                    editingProfile
                      ? profileDraft.contactNumber
                      : profileDisplay.contactNumber
                  }
                  editable={editingProfile}
                  saving={savingProfile}
                  keyboardType="phone-pad"
                  onChangeText={(value) => updateProfileDraft('contactNumber', value)}
                />

                <ProfileField
                  label="Email Address"
                  value={profileDisplay.email}
                />

                <ProfileField
                  label="Complete Address"
                  value={editingProfile ? profileDraft.address : profileDisplay.address}
                  editable={editingProfile}
                  saving={savingProfile}
                  multiline
                  onChangeText={(value) => updateProfileDraft('address', value)}
                />

                <ProfileField
                  label="Water Station"
                  value={profileDisplay.waterStation}
                />

                <ProfileField
                  label="Distributor ID"
                  value={profileDisplay.distributorId}
                />

                <ProfileField
                  label="Account Role"
                  value={profileDisplay.role}
                />

                {editingProfile && (
                  <Animated.View
                    style={[
                      styles.editActions,
                      {
                        opacity: editFadeAnim,
                        transform: [
                          {
                            translateY: editFadeAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [8, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={[
                        styles.cancelEditButton,
                        savingProfile && styles.buttonDisabled,
                      ]}
                      onPress={cancelProfileEdit}
                      disabled={savingProfile}
                    >
                      <Text style={styles.cancelEditText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[
                        styles.saveEditButton,
                        savingProfile && styles.buttonDisabled,
                      ]}
                      onPress={saveProfileChanges}
                      disabled={savingProfile}
                    >
                      {savingProfile ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.saveEditText}>Save Changes</Text>
                      )}
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </>
            )}
          </View>

          <View style={styles.helpCard}>
            <View style={styles.helpRow}>
              <View style={styles.helpTextBlock}>
                <Text style={styles.helpTitle}>Need Help?</Text>
                <Text style={styles.helpSubtitle}>Tap BlueTap AI for quick guidance inside the app.</Text>
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => alert('BlueTap AI for distributor coming soon')}
              >
                <View style={styles.helpIconWrapper}>
                  <Image
                    source={require('../../assets/icons/bluetapwhitelogo.png')}
                    style={styles.helpIcon}
                  />
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.logoutButton}
              onPress={handleLogout}
              disabled={savingProfile}
            >
              <Text style={styles.logoutIcon}>{'\u21AA'}</Text>
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 130 }} />
        </ScrollView>

        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
            <Image source={require('../../assets/icons/calendar-clock.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIconActive} />
          </TouchableOpacity>
        </View>
      </View>

      {toastVisible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.successToast,
            {
              opacity: toastAnim,
              transform: [
                {
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.successToastText}>
            {'\u2713'} Profile updated successfully
          </Text>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4FAFF',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  profileTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: BLUE,
    letterSpacing: 0,
  },
  infoSection: {
    marginTop: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    elevation: 6,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: BLUE,
  },
  editIcon: {
    width: 20,
    height: 20,
    tintColor: BLUE,
  },
  infoDivider: {
    height: 1,
    backgroundColor: BLUE_LIGHT,
    marginBottom: 2,
  },
  infoLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  profileField: {
    marginTop: 14,
  },
  label: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  value: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: 'bold',
    color: TEXT_DARK,
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#BBDEFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: TEXT_DARK,
    fontSize: 15,
    fontWeight: 'bold',
    backgroundColor: '#F7FBFF',
  },
  multilineInput: {
    minHeight: 78,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  cancelEditButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  cancelEditText: {
    color: BLUE,
    fontSize: 13,
    fontWeight: 'bold',
  },
  saveEditButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: BLUE,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: BLUE,
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
  },
  saveEditText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  helpCard: {
    marginTop: 22,
    backgroundColor: BLUE,
    borderRadius: 20,
    padding: 18,
    elevation: 5,
    shadowColor: '#0D47A1',
    shadowOpacity: 0.12,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
  },
  helpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  helpTextBlock: {
    flex: 1,
  },
  helpTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: 'bold',
  },
  helpSubtitle: {
    color: '#EAF4FF',
    fontSize: 13,
    lineHeight: 17,
    marginTop: 6,
  },
  helpIconWrapper: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 999,
    padding: 6,
  },
  helpIcon: {
    width: 38,
    height: 38,
    tintColor: '#FFFFFF',
  },
  logoutButton: {
    marginTop: 18,
    minHeight: 44,
    borderWidth: 1.5,
    borderColor: BLUE,
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  logoutIcon: {
    color: BLUE,
    fontSize: 15,
    fontWeight: 'bold',
    marginRight: 8,
  },
  logoutText: {
    color: BLUE,
    fontWeight: 'bold',
    fontSize: 14,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 22,
    zIndex: 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  navIcon: {
    width: 26,
    height: 26,
    tintColor: BLUE,
  },
  navIconActive: {
    width: 26,
    height: 26,
    tintColor: BLUE,
  },
  successToast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 92,
    alignSelf: 'center',
    maxWidth: 335,
    backgroundColor: '#1B8F4C',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    zIndex: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  successToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
