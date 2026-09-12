import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { auth } from '../firebase';
import {
  fetchFirestoreUserProfile,
  getPostAuthenticationDestination,
  signOutAndClearSessions,
} from '../services/authSession';

export default function RegistrationStatusPage() {
  const router = useRouter();
  const [profile, setProfile] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (active) router.replace('/login');
        return;
      }
      try {
        const nextProfile = await fetchFirestoreUserProfile(user);
        if (!active) return;
        const destination = getPostAuthenticationDestination(nextProfile || {});
        if (destination !== '/registration-status') {
          router.replace(destination);
          return;
        }
        setProfile(nextProfile);
      } catch (error) {
        console.log('Registration status read error:', error.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [router]);

  const returnToLogin = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

  const enrollmentPending = profile?.onboardingStatus === 'face_enrollment_pending' ||
    profile?.registrationCompleted === false;
  const title = enrollmentPending ? 'Finishing secure enrollment' : 'Application submitted';
  const message = enrollmentPending
    ? 'Your email and identity verification succeeded. BlueTap is still finalizing the secure face enrollment. Please try again shortly; if this continues, contact support.'
    : 'Your identity verification succeeded. Your distributor application is awaiting administrator approval before you can access the distributor dashboard.';

  return (
    <LinearGradient colors={BLUETAP_LOGIN_GRADIENT} style={styles.gradient}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          {loading ? <ActivityIndicator size="large" color="#187BCD" /> : <>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
            <TouchableOpacity style={styles.button} onPress={returnToLogin}>
              <Text style={styles.buttonText}>Back to Login</Text>
            </TouchableOpacity>
          </>}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#FFF', borderRadius: 20, padding: 28, alignItems: 'center' },
  title: { color: '#12304A', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  message: { color: '#4D6274', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { backgroundColor: '#187BCD', borderRadius: 12, marginTop: 24, minHeight: 50, paddingHorizontal: 20, justifyContent: 'center' },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
});
