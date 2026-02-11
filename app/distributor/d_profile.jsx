import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { auth, db } from '../../firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

export default function DistributorProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      const user = auth.currentUser;
      if (!user) {
        router.replace('/login');
        return;
      }

      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setUserData(snap.data());
      }
      setLoading(false);
    };

    loadProfile();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.replace('/login');
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#187BCD" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appName}>BlueTap</Text>
            <TouchableOpacity onPress={() => router.replace('/distributor/d_notification')}>
              <Image source={require('../../assets/icons/notif.png')} style={styles.notifIcon} />
            </TouchableOpacity>
          </View>

          <Text style={styles.profileTitle}>PROFILE</Text>

          {/* User Information */}
          <View style={styles.infoSection}>
            <View style={styles.infoHeader}>
              <Text style={styles.infoTitle}>User Information</Text>
              <Image source={require('../../assets/icons/pencil.png')} style={styles.editIcon} />
            </View>
            <View style={styles.infoDivider} />

            <Text style={styles.label}>Full Name</Text>
            <Text style={styles.value}>
              {userData?.firstName ? `${userData.firstName} ${userData.lastName}` : 'Not set'}
            </Text>

            <Text style={styles.label}>Contact Number</Text>
            <Text style={styles.value}>{userData?.phone || 'Not set'}</Text>

            <Text style={styles.label}>Email address</Text>
            <Text style={styles.value}>{userData?.email || 'Not set'}</Text>

            <Text style={styles.label}>Water Station</Text>
            <Text style={styles.value}>{userData?.waterStation || 'Not set'}</Text>
          </View>

          <View style={{ height: 40 }} />

          {/* Blue help card */}
          <View style={styles.helpCard}>
            <View style={styles.helpRow}>
              <View>
                <Text style={styles.helpTitle}>Need help?</Text>
                <Text style={styles.helpSubtitle}>
                  Tap BlueTap AI for quick guidance inside the app.
                </Text>
              </View>
              <TouchableOpacity onPress={() => alert('BlueTap AI for distributor coming soon')}>
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

        {/* Bottom Nav */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIconActive} />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  phoneWrapper: { width: '100%', maxWidth: 375, alignSelf: 'center', flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 10 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  appName: {
    color: '#187BCD',
    fontSize: 22,
    fontWeight: 'bold',
  },
  notifIcon: {
    width: 25,
    height: 25,
    tintColor: '#187BCD',
  },

  profileTitle: { marginTop: 40, fontSize: 26, fontWeight: 'bold', color: '#187BCD' },

  infoSection: { marginTop: 20 },
  infoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  infoTitle: { fontSize: 16, fontWeight: 'bold', color: '#187BCD' },
  editIcon: { width: 18, height: 18, tintColor: '#187BCD' },
  infoDivider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginBottom: 12,
  },

  label: { marginTop: 10, fontSize: 13, color: '#187BCD', opacity: 0.6 },
  value: { fontSize: 15, fontWeight: 'bold', color: '#187BCD' },

  helpCard: {
    marginTop: 30,
    backgroundColor: '#187BCD',
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
  navIcon: { width: 26, height: 26, tintColor: '#187BCD' },
  navIconActive: { width: 26, height: 26, tintColor: '#187BCD' },
});
