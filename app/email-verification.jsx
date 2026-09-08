import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signOut,
} from 'firebase/auth';
import { serverTimestamp } from 'firebase/firestore';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { auth } from '../firebase';
import { saveLocalUser } from '../localUsers';
import { clearAllAuthSessions, fetchFirestoreUserProfile } from '../services/authSession';
import { saveUserProfileWithUniqueId } from '../services/uniqueIds';

const getVerificationErrorMessage = (error) => {
  if (error?.code === 'auth/too-many-requests') {
    return 'Too many emails were requested. Please wait a few minutes before trying again.';
  }

  if (error?.code === 'auth/network-request-failed') {
    return 'We could not reach the verification service. Check your connection and try again.';
  }

  return 'We could not send the verification email. Please try again.';
};

export default function EmailVerificationPage() {
  const router = useRouter();
  const { sent } = useLocalSearchParams();
  const [user, setUser] = React.useState(auth.currentUser);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [message, setMessage] = React.useState(
    sent === 'false'
      ? 'We could not send the first verification email. Use Resend email to try again.'
      : ''
  );

  const completeVerification = React.useCallback(
    async (account = auth.currentUser, { silent = false } = {}) => {
      if (!account) {
        router.replace('/login');
        return false;
      }

      setIsChecking(true);

      try {
        await reload(account);
        const refreshedUser = auth.currentUser || account;

        if (!refreshedUser.emailVerified) {
          if (!silent) {
            setMessage('We have not confirmed this email yet. Open the verification email, then try again.');
          }
          return false;
        }

        const profile = await fetchFirestoreUserProfile(refreshedUser);

        if (!profile?.role) {
          setMessage('We could not find your BlueTap profile. Please return to login and try again.');
          return false;
        }

        const savedProfile = await saveUserProfileWithUniqueId(refreshedUser.uid, profile.role, {
          ...profile,
          emailVerificationRequired: true,
          emailVerified: true,
          emailVerifiedAt: serverTimestamp(),
        });

        saveLocalUser({
          ...profile,
          ...savedProfile,
          emailVerified: true,
        });
        clearAllAuthSessions();
        router.replace('/verification');
        return true;
      } catch (error) {
        console.log('Email verification status error:', error.message);

        if (!silent) {
          setMessage('We could not confirm your email yet. Please try again.');
        }
        return false;
      } finally {
        setIsChecking(false);
      }
    },
    [router]
  );

  React.useEffect(() => {
    let isActive = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        if (isActive) router.replace('/login');
        return;
      }

      if (!isActive) return;

      setUser(currentUser);
      setIsLoading(false);
      await completeVerification(currentUser, { silent: true });
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [completeVerification, router]);

  const resendVerification = async () => {
    const account = auth.currentUser || user;

    if (!account || isSending || isChecking) return;

    setIsSending(true);
    setMessage('');

    try {
      await reload(account);

      if ((auth.currentUser || account).emailVerified) {
        await completeVerification(auth.currentUser || account);
        return;
      }

      await sendEmailVerification(auth.currentUser || account);
      setMessage('A new verification email has been sent. Check your inbox and spam folder.');
    } catch (error) {
      console.log('Resend verification email error:', error.message);
      setMessage(getVerificationErrorMessage(error));
    } finally {
      setIsSending(false);
    }
  };

  const returnToLogin = async () => {
    clearAllAuthSessions();

    try {
      await signOut(auth);
    } catch (error) {
      console.log('Email verification sign out error:', error.message);
    }

    router.replace('/login');
  };

  return (
    <LinearGradient
      colors={BLUETAP_LOGIN_GRADIENT}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.brand}>
            <Text style={styles.brandName}>BlueTap</Text>
            <Text style={styles.tagline}>Water Within Reach</Text>
          </View>

          <View style={styles.card}>
            {isLoading ? (
              <View style={styles.stateContent}>
                <ActivityIndicator size="large" color="#187BCD" />
                <Text style={styles.stateText}>Preparing email verification…</Text>
              </View>
            ) : (
              <View style={styles.stateContent}>
                <View style={styles.emailIcon}>
                  <Text style={styles.emailIconText}>@</Text>
                </View>
                <Text style={styles.title}>Verify your email</Text>
                <Text style={styles.description}>
                  We sent a verification link to
                </Text>
                <Text style={styles.emailAddress}>{user?.email || 'your email address'}</Text>
                <Text style={styles.instructions}>
                  Open the email and select the verification link. Then return here to continue with identity verification.
                </Text>

                {!!message && <Text style={styles.notice}>{message}</Text>}

                <TouchableOpacity
                  style={[styles.primaryButton, isChecking && styles.buttonDisabled]}
                  onPress={() => completeVerification()}
                  disabled={isChecking || isSending}
                >
                  {isChecking ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>I’VE VERIFIED MY EMAIL</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, isSending && styles.buttonDisabled]}
                  onPress={resendVerification}
                  disabled={isSending || isChecking}
                >
                  <Text style={styles.secondaryButtonText}>
                    {isSending ? 'SENDING…' : 'RESEND EMAIL'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.loginButton}
                  onPress={returnToLogin}
                  disabled={isSending || isChecking}
                >
                  <Text style={styles.loginButtonText}>Back to Login</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
  },
  brand: { alignItems: 'center', marginBottom: 28 },
  brandName: { color: '#FFFFFF', fontSize: 34, fontWeight: '800' },
  tagline: { color: 'rgba(255,255,255,0.86)', fontSize: 15, marginTop: 4 },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#0B4B82',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  stateContent: { alignItems: 'center' },
  stateText: { color: '#4D6274', fontSize: 15, marginTop: 16, textAlign: 'center' },
  emailIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF6FF',
    marginBottom: 16,
  },
  emailIconText: { color: '#187BCD', fontSize: 28, fontWeight: '800' },
  title: {
    color: '#12304A',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: { color: '#4D6274', fontSize: 15, textAlign: 'center' },
  emailAddress: {
    color: '#187BCD',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  instructions: {
    color: '#4D6274',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 20,
  },
  notice: {
    width: '100%',
    color: '#9A6700',
    backgroundColor: '#FFF8E6',
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#187BCD',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  secondaryButtonText: { color: '#187BCD', fontSize: 15, fontWeight: '800' },
  loginButton: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loginButtonText: { color: '#64748B', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.65 },
});
