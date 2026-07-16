import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
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
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { findLocalUserForAuthRole, saveLocalUser } from '../../localUsers';
import { normalizeRole, signOutAndClearSessions } from '../../services/authSession';

const BLUE = '#187BCD';
const BLUE_LIGHT = '#E3F2FD';
const CARD_BORDER = '#D7ECFF';
const TEXT_MUTED = '#6F8EA8';
const TEXT_DARK = '#20384D';

const PROFILE_CACHE_TTL_MS = 60000;

let cachedRequesterProfile = null;
let cachedRequesterProfileUid = '';
let cachedRequesterProfileFetchedAt = 0;

const getLocalRequesterProfile = (user) => {
  return findLocalUserForAuthRole(user, 'requester');
};

const buildProfileData = (profile = {}, user = null) => ({
  ...profile,
  uid: user?.uid || profile.uid || profile.id || '',
  email: profile.email || user?.email || '',
});

const cacheProfile = (profile) => {
  cachedRequesterProfile = profile;
  cachedRequesterProfileUid = profile?.uid || '';
  cachedRequesterProfileFetchedAt = Date.now();
};

const getFullName = (profile) =>
  `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();

const buildProfileDraft = (profile = {}) => ({
  fullName: getFullName(profile),
  phone: profile.phone || '',
  address: profile.address || '',
});

const splitFullName = (fullName) => {
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts.shift() || '';

  return {
    firstName,
    lastName: nameParts.join(' '),
  };
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

export default function ProfilePage() {
  const router = useRouter();
  const editFadeAnim = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(!cachedRequesterProfile);
  const [userData, setUserData] = useState(cachedRequesterProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState(() =>
    buildProfileDraft(cachedRequesterProfile || {})
  );

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      const user = auth.currentUser;
      const localProfile = getLocalRequesterProfile(user);

      if (!user && !localProfile) {
        router.replace('/login');
        return;
      }

      const profileUid = user?.uid || localProfile?.uid || '';
      const hasFreshCache =
        cachedRequesterProfile &&
        cachedRequesterProfileUid === profileUid &&
        Date.now() - cachedRequesterProfileFetchedAt < PROFILE_CACHE_TTL_MS;

      if (hasFreshCache) {
        if (isMounted) {
          setUserData(cachedRequesterProfile);
          setLoading(false);
        }
        return;
      }

      if (localProfile) {
        const nextProfile = buildProfileData(localProfile, user);
        cacheProfile(nextProfile);

        if (isMounted) {
          setUserData(nextProfile);
          setLoading(false);
        }
      }

      if (!user) {
        if (isMounted) {
          setLoading(false);
        }
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', user.uid));

        if (snap.exists()) {
          const firestoreProfile = snap.data();

          if (normalizeRole(firestoreProfile.role) !== 'requester') {
            router.replace('/login');
            return;
          }

          const nextProfile = buildProfileData(
            {
              ...localProfile,
              ...firestoreProfile,
            },
            user
          );

          cacheProfile(nextProfile);

          if (isMounted) {
            setUserData(nextProfile);
          }
        }
      } catch (error) {
        console.log('Requester profile read error:', error.message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
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
      phone: userData?.phone || '',
      email: userData?.email || auth.currentUser?.email || '',
      address: userData?.address || '',
    }),
    [userData]
  );

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
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

  const updateProfileDraft = (field, value) => {
    setProfileDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };

  const saveProfileChanges = async () => {
    if (savingProfile) return;

    const uid = userData?.uid || auth.currentUser?.uid || '';
    const fullName = profileDraft.fullName.trim();
    const phone = profileDraft.phone.trim();
    const address = profileDraft.address.trim();

    if (!uid) {
      Alert.alert('Profile not saved', 'Please log in again before editing your profile.');
      return;
    }

    if (!fullName) {
      Alert.alert('Missing name', 'Full name cannot be empty.');
      return;
    }

    const nameParts = splitFullName(fullName);
    const profileUpdate = {
      ...nameParts,
      phone,
      address,
    };
    const nextProfile = {
      ...(userData || {}),
      ...profileUpdate,
      uid,
      email: userData?.email || auth.currentUser?.email || '',
    };

    try {
      setSavingProfile(true);
      saveLocalUser(nextProfile);
      cacheProfile(nextProfile);
      setUserData(nextProfile);

      if (auth.currentUser?.uid) {
        try {
          await setDoc(
            doc(db, 'users', auth.currentUser.uid),
            {
              ...profileUpdate,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (error) {
          console.log('Requester profile save error:', error.message);
          Alert.alert(
            'Saved locally',
            'Your profile was updated on this device, but Firebase did not accept the update.'
          );
        }
      }

      setEditingProfile(false);
    } catch (error) {
      console.log('Requester profile edit error:', error.message);
      Alert.alert('Profile not saved', error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
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
                  value={editingProfile ? profileDraft.phone : profileDisplay.phone}
                  editable={editingProfile}
                  saving={savingProfile}
                  keyboardType="phone-pad"
                  onChangeText={(value) => updateProfileDraft('phone', value)}
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
                onPress={() => router.replace('/requester/bluetap_AI')}
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

      </View>
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
});
