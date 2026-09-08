import React from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, reload } from 'firebase/auth';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { auth } from '../firebase';
import {
  fetchFirestoreUserProfile,
  getDistributorApplicationStatus,
  normalizeRole,
  signOutAndClearSessions,
} from '../services/authSession';
import {
  createUnverifiedFaceVerification,
  normalizeFaceVerification,
  startFaceVerification,
  subscribeFaceVerification,
} from '../services/faceVerification';

const isVerificationRole = (role) => role === 'requester' || role === 'distributor';

export default function VerificationPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [isStarting, setIsStarting] = React.useState(false);
  const [profile, setProfile] = React.useState(null);
  const [verification, setVerification] = React.useState(
    createUnverifiedFaceVerification()
  );
  const [message, setMessage] = React.useState('');
  const [distributorApprovalRequired, setDistributorApprovalRequired] =
    React.useState(false);

  const returnToLogin = React.useCallback(async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  }, [router]);

  const continueToHome = React.useCallback(() => {
    const role = normalizeRole(profile?.role);

    if (role === 'requester') {
      router.replace('/requester/r_dashboard');
      return;
    }

    if (role === 'distributor') {
      if (getDistributorApplicationStatus(profile) === 'approved') {
        router.replace('/distributor/d_dashboard');
      } else {
        setDistributorApprovalRequired(true);
      }
    }
  }, [profile, router]);

  React.useEffect(() => {
    let isActive = true;
    let unsubscribeVerification = () => {};

    const loadProfile = async (user) => {
      unsubscribeVerification();
      unsubscribeVerification = () => {};

      if (!user) {
        if (isActive) router.replace('/login');
        return;
      }

      setIsLoading(true);
      setMessage('');
      setDistributorApprovalRequired(false);

      try {
        const nextProfile = await fetchFirestoreUserProfile(user);

        if (!isActive) return;

        const role = normalizeRole(nextProfile?.role);

        if (role === 'admin') {
          router.replace('/admin/dashboard');
          return;
        }

        if (!nextProfile || !isVerificationRole(role)) {
          await signOutAndClearSessions();
          if (isActive) router.replace('/login');
          return;
        }

        await reload(user);

        if (
          nextProfile.emailVerificationRequired === true &&
          !(auth.currentUser || user).emailVerified
        ) {
          if (isActive) router.replace('/email-verification');
          return;
        }

        const initialVerification = normalizeFaceVerification(nextProfile);
        setProfile(nextProfile);
        setVerification(initialVerification);

        // Users who were already verified before opening this route can continue
        // directly. A newly received verified status remains visible as success.
        if (initialVerification.status === 'verified') {
          if (role === 'requester') {
            router.replace('/requester/r_dashboard');
            return;
          }

          if (getDistributorApplicationStatus(nextProfile) === 'approved') {
            router.replace('/distributor/d_dashboard');
            return;
          }

          setDistributorApprovalRequired(true);
          setIsLoading(false);
          return;
        }

        unsubscribeVerification = subscribeFaceVerification(
          user.uid,
          (nextVerification) => {
            if (!isActive) return;

            setVerification(nextVerification);
            setMessage('');
          },
          () => {
            if (isActive) {
              setMessage('We could not refresh your verification status. Please try again later.');
            }
          }
        );
        setIsLoading(false);
      } catch (error) {
        console.log('Verification profile read error:', error.message);

        if (isActive) {
          setMessage('We could not load your verification status. Please try again later.');
          setIsLoading(false);
        }
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, loadProfile);

    return () => {
      isActive = false;
      unsubscribeAuth();
      unsubscribeVerification();
    };
  }, [router]);

  const handleStartVerification = async () => {
    if (isStarting) return;

    setIsStarting(true);
    setMessage('');

    try {
      const result = await startFaceVerification(auth.currentUser);

      if (result.reason === 'not-configured') {
        setMessage('Verification service is not configured yet. Please contact BlueTap support.');
      } else if (result.reason === 'unauthenticated') {
        router.replace('/login');
      } else if (!result.started) {
        setMessage('Verification could not be started yet. Please try again later.');
      }
    } catch (error) {
      console.log('Face verification start error:', error.message);
      setMessage('Verification could not be started. Please try again later.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleRequestReview = () => {
    Alert.alert(
      'Manual review',
      'Manual review is not yet configured. Please contact BlueTap support.'
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.stateContent}>
          <ActivityIndicator size="large" color="#187BCD" />
          <Text style={styles.stateText}>Loading your verification status…</Text>
        </View>
      );
    }

    if (distributorApprovalRequired) {
      return (
        <View style={styles.stateContent}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.title}>Identity verified</Text>
          <Text style={styles.description}>
            Your identity is verified, but your distributor application is still awaiting
            administrator approval.
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={returnToLogin}>
            <Text style={styles.secondaryButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (verification.status === 'verified') {
      return (
        <View style={styles.stateContent}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.title}>Identity verified</Text>
          <Text style={styles.description}>Your verification was successful.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={continueToHome}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (verification.status === 'pending') {
      return (
        <View style={styles.stateContent}>
          <ActivityIndicator size="large" color="#187BCD" />
          <Text style={styles.title}>Checking your verification</Text>
          <Text style={styles.description}>
            Please keep this screen open while your verification is checked.
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={returnToLogin}>
            <Text style={styles.secondaryButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (verification.status === 'review_required') {
      return (
        <View style={styles.stateContent}>
          <Text style={styles.reviewIcon}>!</Text>
          <Text style={styles.title}>Verification needs review</Text>
          <Text style={styles.description}>
            We found a possible match with an existing BlueTap account. For security,
            this needs review before another account can be used.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRequestReview}>
            <Text style={styles.primaryButtonText}>Request Review</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={returnToLogin}>
            <Text style={styles.secondaryButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (verification.status === 'failed') {
      return (
        <View style={styles.stateContent}>
          <Text style={styles.reviewIcon}>!</Text>
          <Text style={styles.title}>We couldn’t verify your identity</Text>
          {!!verification.failureReason && (
            <Text style={styles.description}>{verification.failureReason}</Text>
          )}
          <TouchableOpacity
            style={[styles.primaryButton, isStarting && styles.buttonDisabled]}
            onPress={handleStartVerification}
            disabled={isStarting}
          >
            <Text style={styles.primaryButtonText}>
              {isStarting ? 'Starting…' : 'Try Again'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={returnToLogin}>
            <Text style={styles.secondaryButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.stateContent}>
        <Text style={styles.title}>Verify your identity</Text>
        <Text style={styles.description}>
          We use a quick face verification step to help prevent duplicate accounts and
          account abuse.
        </Text>

        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>Before you begin</Text>
          <Text style={styles.instruction}>• Use good lighting.</Text>
          <Text style={styles.instruction}>• Keep your face centered.</Text>
          <Text style={styles.instruction}>
            • Remove sunglasses, hats, or anything covering your face.
          </Text>
          <Text style={styles.instruction}>• Make sure only one person is visible.</Text>
        </View>

        {!!message && <Text style={styles.notice}>{message}</Text>}

        <TouchableOpacity
          style={[styles.primaryButton, isStarting && styles.buttonDisabled]}
          onPress={handleStartVerification}
          disabled={isStarting}
        >
          <Text style={styles.primaryButtonText}>
            {isStarting ? 'Starting…' : 'Start Verification'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={returnToLogin}>
          <Text style={styles.secondaryButtonText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    );
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

          <View style={styles.card}>{renderContent()}</View>
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
  title: {
    color: '#12304A',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    color: '#4D6274',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  stateText: { color: '#4D6274', fontSize: 15, marginTop: 16, textAlign: 'center' },
  instructions: {
    width: '100%',
    backgroundColor: '#EAF6FF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
  instructionsTitle: { color: '#187BCD', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  instruction: { color: '#36556C', fontSize: 14, lineHeight: 21 },
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
    marginBottom: 12,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: '#187BCD', fontSize: 15, fontWeight: '800' },
  buttonDisabled: { opacity: 0.65 },
  successIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#DCFCE7',
    color: '#15803D',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
  reviewIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFF3CD',
    color: '#B7791F',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 16,
  },
});
