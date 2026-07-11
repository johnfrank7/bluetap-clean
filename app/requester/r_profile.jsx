import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { auth, db } from '../../firebase';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { findLocalUserForAuthRole, saveLocalUser } from '../../localUsers';
import { normalizeRole, signOutAndClearSessions } from '../../services/authSession';

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

export default function ProfilePage() {
  const router = useRouter();
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

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

  const openProfileEditor = () => {
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
      <StatusBar style="light" />

      <View style={styles.phoneWrapper}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.profileTitle}>PROFILE</Text>

          {/* Info Section */}
          <View style={styles.infoSection}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>User Information</Text>
              {!editingProfile && (
                <TouchableOpacity onPress={openProfileEditor} disabled={loading}>
                  <Image source={require('../../assets/icons/pencil.png')} style={styles.editIcon} />
                </TouchableOpacity>
              )}
            </View>

            {loading && !userData ? (
              <View style={styles.infoLoading}>
                <ActivityIndicator size="small" color="#187BCD" />
              </View>
            ) : (
              <>
                <Text style={styles.label}>Full Name</Text>
                {editingProfile ? (
                  <TextInput
                    style={styles.input}
                    value={profileDraft.fullName}
                    onChangeText={(value) => updateProfileDraft('fullName', value)}
                    placeholder="Full Name"
                    placeholderTextColor="#90A4AE"
                    editable={!savingProfile}
                  />
                ) : (
                  <Text style={styles.value}>
                    {getFullName(userData) || 'Not set'}
                  </Text>
                )}

                <Text style={styles.label}>Contact Number</Text>
                {editingProfile ? (
                  <TextInput
                    style={styles.input}
                    value={profileDraft.phone}
                    onChangeText={(value) => updateProfileDraft('phone', value)}
                    placeholder="Contact Number"
                    placeholderTextColor="#90A4AE"
                    keyboardType="phone-pad"
                    editable={!savingProfile}
                  />
                ) : (
                  <Text style={styles.value}>{userData?.phone || 'Not set'}</Text>
                )}

                <Text style={styles.label}>Address</Text>
                {editingProfile ? (
                  <TextInput
                    style={styles.input}
                    value={profileDraft.address}
                    onChangeText={(value) => updateProfileDraft('address', value)}
                    placeholder="Address"
                    placeholderTextColor="#90A4AE"
                    editable={!savingProfile}
                  />
                ) : (
                  <Text style={styles.value}>{userData?.address || 'Not set'}</Text>
                )}

                <Text style={styles.label}>Email</Text>
                <Text style={styles.value}>{userData?.email || 'Not set'}</Text>

                {editingProfile && (
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={styles.cancelEditButton}
                      onPress={cancelProfileEdit}
                      disabled={savingProfile}
                    >
                      <Text style={styles.cancelEditText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.saveEditButton, savingProfile && styles.buttonDisabled]}
                      onPress={saveProfileChanges}
                      disabled={savingProfile}
                    >
                      <Text style={styles.saveEditText}>
                        {savingProfile ? 'Saving...' : 'Save'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>

          <View style={{ height: 40 }} />

          {/* BLUE HELP CARD */}
          <View style={styles.helpCard}>
            <View style={styles.helpRow}>
              <View>
                <Text style={styles.helpTitle}>Need help?</Text>
                <Text style={styles.helpSubtitle}>
                  Tap BlueTap AI for quick guidance inside the app.
                </Text>
              </View>

              <TouchableOpacity onPress={() => router.replace('/requester/bluetap_AI')}>
                <View style={styles.helpIconWrapper}>
                  <Image
                    source={require('../../assets/icons/bluetapwhitelogo.png')}
                    style={styles.helpIcon}
                  />
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>LOGOUT</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 120 }} />

        </ScrollView>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  phoneWrapper: { width: '100%', maxWidth: 375, alignSelf: 'center', flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 0 },

  profileTitle: { marginTop: 40, fontSize: 26, fontWeight: 'bold', color: '#187BCD' },

  infoSection: { marginTop: 20 },
  infoHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  infoTitle: { fontSize: 16, fontWeight: 'bold', color: '#187BCD' },
  editIcon: { width: 18, height: 18, tintColor: '#187BCD' },
  infoLoading: {
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: { marginTop: 10, fontSize: 13, color: '#187BCD', opacity: 0.6 },
  value: { fontSize: 15, fontWeight: 'bold', color: '#187BCD' },
  input: {
    borderWidth: 1,
    borderColor: '#BBDEFB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#187BCD',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 4,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 18,
  },
  cancelEditButton: {
    borderWidth: 1,
    borderColor: '#187BCD',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginRight: 8,
  },
  cancelEditText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: 'bold',
  },
  saveEditButton: {
    backgroundColor: '#187BCD',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  saveEditText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.7,
  },

  helpCard: {
    marginTop: 30,
    backgroundColor: '#1E88E5',
    borderRadius: 20,
    padding: 20,
  },

  helpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  helpTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 'bold' },
  helpSubtitle: { color: '#EAF4FF', fontSize: 13, marginTop: 4, maxWidth: 220 },

  helpIconWrapper: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderRadius: 999,
    padding: 6,
  },
  helpIcon: { width: 40, height: 40, tintColor: '#FFFFFF' },

  logoutButton: {
    marginTop: 20,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },

  logoutText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },

});
