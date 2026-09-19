import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import { onAuthStateChanged, reload, signInWithCustomToken, signOut } from 'firebase/auth';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { RegistrationActions, RegistrationBrand, RegistrationNotice, RegistrationStepper } from '../components/RegistrationUi';
import { auth } from '../firebase';
import { clearAllAuthSessions, fetchFirestoreUserProfile, getPostAuthenticationDestination } from '../services/authSession';
import { requestEmailOtp, verifyEmailOtp, getPendingRegistration, clearPendingRegistration,
  setPendingRegistration, requestRegistrationOtp, completeRegistration, retryRegistrationFinalization } from '../services/emailVerification';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000;

const firstParam = (value) => (Array.isArray(value) ? value[0] : value);
const positiveNumber = (value) => {
  const number = Number(firstParam(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const formatTime = (seconds) =>
  String(Math.floor(seconds / 60)).padStart(2, '0') +
  ':' +
  String(seconds % 60).padStart(2, '0');

const getOtpError = (error) => {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  const reason = details.reason;
  const code = String(error?.code || '');

  if (reason === 'incorrect-code') return 'The verification code you entered is incorrect.';
  if (reason === 'code-expired') {
    return 'This verification code has expired. Please request a new code.';
  }
  if (reason === 'attempt-limit-reached') {
    return 'Too many incorrect attempts. Please request a new verification code.';
  }
  if (reason === 'resend-too-soon') {
    return 'Please wait before requesting another verification code.';
  }
  if (reason === 'resend-limit-reached') {
    return 'Too many verification codes have been requested. Please try again later.';
  }
  if (reason === 'provider-unavailable') {
    return 'Unable to send verification email. Please try again.';
  }
  if (reason === 'no-active-code') return 'Please request a new verification code.';
  if (['registration-expired', 'invalid-registration', 'account-exists', 'username-taken'].includes(reason)) return error.message;
  if (['face-service-preparing', 'FACE_SERVICE_PREPARING'].includes(reason)) {
    return 'Face verification service is preparing. Please try again in a moment.';
  }
  if (['invalid-face-response', 'face-review-required', 'registration-finalization-failed'].includes(reason)) {
    return 'Registration could not be completed. Your verification code was accepted, but BlueTap could not finish creating your account. Please try again.';
  }
  if (reason === 'service-unavailable') {
    return 'The email verification service is currently unavailable. Please try again later or contact BlueTap support.';
  }
  if (code.includes('unauthenticated')) return 'Your session has expired. Please log in again.';
  if (code.includes('unavailable') || code.includes('network')) {
    return 'Verification email could not be sent. Please check your connection and try again.';
  }
  return 'We could not complete email verification. Please try again.';
};

export default function EmailVerificationPage() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const params = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const sent = firstParam(params.sent);
  const registration = firstParam(params.registration) === 'true';
  const draft = registration ? getPendingRegistration() : null;
  const automaticRequestRef = React.useRef(false);
  const registrationCompletedRef = React.useRef(false);
  const verificationInFlightRef = React.useRef(false);
  const [pendingDestination, setPendingDestination] = React.useState('');

  const [user, setUser] = React.useState(registration ? { email: draft?.profile.email } : auth.currentUser);
  const [loading, setLoading] = React.useState(true);
  const [sending, setSending] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [verified, setVerified] = React.useState(false);
  const [otp, setOtp] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState(positiveNumber(params.expiresAt));
  const [codeSent, setCodeSent] = React.useState(
    sent === 'true' && positiveNumber(params.expiresAt) > 0
  );
  const [cooldownEndsAt, setCooldownEndsAt] = React.useState(() => {
    const seconds = positiveNumber(params.resendAfterSeconds);
    return seconds ? Date.now() + seconds * 1000 : 0;
  });
  const [now, setNow] = React.useState(Date.now());
  const [message, setMessage] = React.useState(
    sent === 'false' ? 'Verification email could not be sent. Please try again.' : ''
  );
  const [messageType, setMessageType] = React.useState(sent === 'false' ? 'error' : 'info');
  const [registrationFinalizationFailed, setRegistrationFinalizationFailed] = React.useState(false);

  const secondsRemaining = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const resendSeconds = cooldownEndsAt
    ? Math.max(0, Math.ceil((cooldownEndsAt - now) / 1000))
    : 0;
  const codeExpired = Boolean(expiresAt) && secondsRemaining === 0;

  React.useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    if (!pendingDestination || !rootNavigationState?.key) return;
    setPendingDestination('');
    router.replace(pendingDestination);
  }, [pendingDestination, rootNavigationState?.key, router]);

  const continueAfterVerification = React.useCallback(
    async (account = auth.currentUser) => {
      if (!account) {
        router.replace('/login');
        return false;
      }

      try {
        await reload(account);
        const refreshedUser = auth.currentUser || account;
        if (!refreshedUser.emailVerified) return false;

        await refreshedUser.getIdToken(true);
        // The server does not report registration success until this profile is
        // complete. Do not turn a transient post-token read into the legacy
        // missing-profile recovery state.
        let profile = null;
        let lastError = null;
        for (let attempt = 0; attempt < 3 && !profile; attempt += 1) {
          try {
            profile = await fetchFirestoreUserProfile(refreshedUser);
          } catch (error) {
            lastError = error;
          }
        }
        if (!profile) throw lastError || new Error('Your finalized profile is not available yet.');
        const destination = getPostAuthenticationDestination(profile);
        if (!rootNavigationState?.key) {
          setPendingDestination(destination);
          setMessage('Finishing your account setup...');
          setMessageType('info');
          return false;
        }
        router.replace(destination);
        return true;
      } catch (error) {
        console.log('Email OTP account refresh error:', error.message);
        if (registration) setRegistrationFinalizationFailed(true);
        setMessage('Registration could not be completed. Your verification code was accepted, but BlueTap could not finish creating your account. Please try again.');
        setMessageType('error');
        return false;
      }
    },
    [registration, rootNavigationState?.key, router]
  );

  const requestOtp = React.useCallback(
    async ({ account = auth.currentUser, showSentMessage = true } = {}) => {
      if ((!registration && !account) || sending || verifying || verified) return null;

      setSending(true);
      setMessage('');

      try {
        if (!registration) await reload(account);
        const currentUser = auth.currentUser || account;
        if (!registration && currentUser.emailVerified) {
          await continueAfterVerification(currentUser);
          return { alreadyVerified: true };
        }

        const currentDraft = registration ? getPendingRegistration() : null;
        if (registration && !currentDraft) {
          router.replace('/signup?role=' + (firstParam(params.role) === 'distributor' ? 'distributor' : 'requester'));
          return null;
        }
        const response = registration
          ? await requestRegistrationOtp(currentDraft.profile.email, currentDraft.profile.username, currentDraft.profile.registrationSessionId)
          : await requestEmailOtp();
        if (registration) setPendingRegistration(currentDraft.profile, response);
        if (response.alreadyVerified) {
          await continueAfterVerification(currentUser);
          return response;
        }

        const responseExpiry = Number(response.expiresAt);
        const nextCooldownSeconds = Number(response.resendAfterSeconds || 60);
        setExpiresAt(
          Number.isFinite(responseExpiry) && responseExpiry > Date.now()
            ? responseExpiry
            : Date.now() + OTP_EXPIRY_MS
        );
        setCooldownEndsAt(Date.now() + Math.max(1, nextCooldownSeconds) * 1000);
        setOtp('');
        setCodeSent(true);

        if (showSentMessage) {
          setMessage('A new 6-digit verification code has been sent to your email.');
          setMessageType('info');
        }
        return response;
      } catch (error) {
        const details = error?.details && typeof error.details === 'object' ? error.details : {};
        const retryAfterSeconds = Number(details.retryAfterSeconds);
        const activeExpiry = Number(details.expiresAt);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          setCooldownEndsAt(Date.now() + retryAfterSeconds * 1000);
        }
        if (Number.isFinite(activeExpiry) && activeExpiry > 0) {
          setExpiresAt(activeExpiry);
          setCodeSent(true);
        }

        console.log('Email OTP request error:', error.message);
        setMessage(getOtpError(error));
        setMessageType('error');
        if (String(error?.code || '').includes('unauthenticated')) router.replace('/login');
        return null;
      } finally {
        setSending(false);
      }
    },
    [continueAfterVerification, router, sending, verified, verifying, registration, params.role]
  );

  React.useEffect(() => {
    if (registration) {
      if (registrationCompletedRef.current) return;
      if (!getPendingRegistration()) {
        router.replace('/signup?role=' + (firstParam(params.role) === 'distributor' ? 'distributor' : 'requester'));
      } else {
        setLoading(false);
      }
      return;
    }
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        if (active) router.replace('/login');
        return;
      }
      if (!active) return;

      setUser(currentUser);
      try {
        await reload(currentUser);
        const refreshedUser = auth.currentUser || currentUser;
        if (refreshedUser.emailVerified) {
          await continueAfterVerification(refreshedUser);
          return;
        }
      } catch (error) {
        console.log('Email OTP initial refresh error:', error.message);
      } finally {
        if (active) setLoading(false);
      }

      // A fresh signup has already requested a code. A direct return or refresh
      // has no route parameters, so ask the backend; its cooldown remains authoritative.
      if (sent === undefined && !automaticRequestRef.current && active) {
        automaticRequestRef.current = true;
        await requestOtp({ account: currentUser, showSentMessage: false });
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [continueAfterVerification, requestOtp, router, sent, registration, params.role]);

  const changeOtp = (value) => {
    setOtp(value.replace(/\D/g, '').slice(0, OTP_LENGTH));
    if (messageType === 'error') {
      setMessage('');
      setMessageType('info');
    }
  };

  const verify = async () => {
    let account = auth.currentUser || user;
    if ((!registration && !account) || otp.length !== OTP_LENGTH || !codeSent || sending || verifying || verificationInFlightRef.current || codeExpired || verified) return;

    verificationInFlightRef.current = true;
    setVerifying(true);
    setMessage('');
    try {
      const response = registration ? await completeRegistration(otp) : await verifyEmailOtp(otp);
      if (!response.verified) throw new Error('Email verification did not complete.');
      if (registration) {
        const credential = await signInWithCustomToken(auth, response.customToken);
        account = credential.user;
        registrationCompletedRef.current = true;
        clearPendingRegistration();
        setRegistrationFinalizationFailed(false);
      }

      await reload(account);
      const refreshedUser = auth.currentUser || account;
      if (!refreshedUser.emailVerified) throw new Error('Email verification did not complete.');

      await refreshedUser.getIdToken(true);
      setVerified(true);
      setMessage('Email verified successfully.');
      setMessageType('success');
      await continueAfterVerification(account);
    } catch (error) {
      const reason = error?.details?.reason;
      if (registration && reason === 'username-taken') {
        router.replace({ pathname: '/signup', params: { role: draft?.profile?.role || 'requester', usernameTaken: 'true' } });
        return;
      }
      if (registration && ['face-service-preparing', 'FACE_SERVICE_PREPARING', 'invalid-face-response', 'INVALID_FACE_RESPONSE', 'face-review-required', 'registration-finalization-failed'].includes(reason)) {
        setRegistrationFinalizationFailed(true);
        setOtp('');
        setCodeSent(false);
        setExpiresAt(0);
      }
      if (reason === 'code-expired' || reason === 'attempt-limit-reached') {
        setExpiresAt(0);
        setCodeSent(false);
        setOtp('');
      }
      console.log('Email OTP verification error:', error.message);
      setMessage(getOtpError(error));
      setMessageType('error');
      if (String(error?.code || '').includes('unauthenticated')) router.replace('/login');
    } finally {
      verificationInFlightRef.current = false;
      setVerifying(false);
    }
  };

  const retryFinalization = async () => {
    if (!registration || sending || verifying || verificationInFlightRef.current) return;
    verificationInFlightRef.current = true;
    setVerifying(true);
    setMessage('Your email has been verified. BlueTap is finishing your account setup.');
    setMessageType('info');
    try {
      if (registrationCompletedRef.current && auth.currentUser) {
        await auth.currentUser.getIdToken(true);
        await continueAfterVerification(auth.currentUser);
        return;
      }
      const response = await retryRegistrationFinalization();
      const credential = await signInWithCustomToken(auth, response.customToken);
      await credential.user.getIdToken(true);
      registrationCompletedRef.current = true;
      setRegistrationFinalizationFailed(false);
      await continueAfterVerification(credential.user);
    } catch (error) {
      console.log('Registration finalization retry error:', error.message);
      setRegistrationFinalizationFailed(true);
      setMessage(getOtpError(error));
      setMessageType('error');
    } finally {
      verificationInFlightRef.current = false;
      setVerifying(false);
    }
  };

  const returnToLogin = async () => {
    clearPendingRegistration();
    clearAllAuthSessions();
    try {
      await signOut(auth);
    } catch (error) {
      console.log('Email OTP sign out error:', error.message);
    }
    router.replace('/login');
  };

  const verifyDisabled = otp.length !== OTP_LENGTH || !codeSent || sending || verifying || codeExpired || verified;
  const resendDisabled = resendSeconds > 0 || sending || verifying || verified;

  return (
    <LinearGradient
      colors={BLUETAP_LOGIN_GRADIENT}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <RegistrationBrand />

          <View style={[styles.card, { maxWidth: width >= 768 ? 600 : 520 }]}>
            {registration && !loading && <RegistrationStepper
              currentStep={5}
              completedSteps={[1, 2, 3, 4]}
              requiredSteps={[1, 2, ...(draft?.profile?.securityPolicy?.faceVerificationRequired === false ? [] : [3]), 4, 5]}
              visibleSteps={[1, 2, ...(draft?.profile?.securityPolicy?.faceVerificationRequired === false ? [] : [3]), 4, 5]}
            />}
            {loading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color="#187BCD" />
                <Text style={styles.loadingText}>Preparing email verification...</Text>
              </View>
            ) : (
              <>
                <View style={styles.emailIcon} accessibilityElementsHidden>
                  <Text style={styles.emailIconText}>✉</Text>
                </View>
                <Text style={styles.title}>Verify your email</Text>
                <Text style={styles.description}>
                  {sending
                    ? 'Sending a verification code to'
                    : codeSent
                      ? "We've sent a 6-digit verification code to"
                      : 'Request a 6-digit verification code for'}
                </Text>
                <Text style={styles.emailAddress}>{user?.email || 'your email address'}</Text>
                <Text style={styles.instructions}>
                  Enter all 6 digits, then tap Confirm Code.
                </Text>

                <View style={styles.otpInputArea}>
                  <View pointerEvents="none" style={styles.otpBoxes}>
                    {Array.from({ length: OTP_LENGTH }, (_, index) => {
                      const digit = otp[index] || '';
                      const active = !verified && index === otp.length;
                      return (
                        <View
                          key={index}
                          style={[
                            styles.otpBox,
                            active && styles.otpBoxActive,
                            digit && styles.otpBoxFilled,
                          ]}
                        >
                          <Text style={styles.otpDigit}>{digit}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <TextInput
                    accessibilityLabel="Six digit email verification code"
                    autoComplete="one-time-code"
                    importantForAutofill="yes"
                    keyboardType="number-pad"
                    maxLength={OTP_LENGTH}
                    editable={!sending && !verifying && !verified}
                    onChangeText={changeOtp}
                    onSubmitEditing={verify}
                    returnKeyType="done"
                    style={styles.hiddenOtpInput}
                    textContentType="oneTimeCode"
                    value={otp}
                  />
                </View>

                <Text style={[styles.expiryText, codeExpired && styles.expiredText]}>
                  {codeExpired
                    ? 'This verification code has expired. Please request a new code.'
                    : secondsRemaining > 0
                      ? 'This code expires in ' + formatTime(secondsRemaining) + '.'
                      : !codeSent
                        ? 'Request a verification code to continue.'
                      : 'This code will expire in 10 minutes.'}
                </Text>

                {!!message && <RegistrationNotice
                  tone={messageType === 'error' ? 'error' : messageType === 'success' ? 'success' : 'info'}
                  title={messageType === 'error' ? 'Verification problem' : messageType === 'success' ? 'Verification successful' : undefined}
                  message={message}
                />}

                <RegistrationActions
                  stacked={width < 520}
                  backLabel={registration ? 'Cancel registration' : 'Back to Login'}
                  primaryLabel={verifying
                    ? registrationFinalizationFailed ? 'Finishing...' : 'Verifying...'
                    : registrationFinalizationFailed ? 'Try Again' : verified ? 'Email Verified' : 'Confirm Code'}
                  onBack={returnToLogin}
                  onPrimary={registrationFinalizationFailed ? retryFinalization : verify}
                  backDisabled={sending || verifying || verified}
                  primaryDisabled={registrationFinalizationFailed ? sending || verifying : verifyDisabled}
                  loading={verifying}
                />

                <View style={styles.resendSection}>
                  <Text style={styles.resendPrompt}>Didn't receive the code?</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.resendButton, resendDisabled && styles.resendButtonDisabled]}
                    onPress={() => requestOtp()}
                    disabled={resendDisabled}
                  >
                    <Text
                      style={[
                        styles.resendButtonText,
                        resendDisabled && styles.resendButtonTextDisabled,
                      ]}
                    >
                      {sending
                        ? 'Sending...'
                        : resendSeconds > 0
                          ? 'Resend code in ' + resendSeconds + 's'
                          : 'Resend code'}
                    </Text>
                  </TouchableOpacity>
                </View>

              </>
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  card: {
    width: '100%',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 26,
    shadowColor: '#07518E',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  loadingState: { minHeight: 300, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#40617A', fontSize: 15, marginTop: 14 },
  emailIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E6F4FF',
    marginBottom: 16,
  },
  emailIconText: { color: '#187BCD', fontSize: 28, fontWeight: '700', marginTop: -2 },
  title: {
    color: '#17324D',
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  description: { color: '#52708A', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  emailAddress: {
    color: '#187BCD',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 3,
  },
  instructions: {
    color: '#52708A',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 20,
  },
  otpInputArea: { height: 58, width: '100%', position: 'relative', marginBottom: 14 },
  otpBoxes: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  otpBox: {
    width: '14.5%',
    height: 56,
    borderWidth: 1,
    borderColor: '#BEDAF0',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FCFF',
  },
  otpBoxActive: { borderColor: '#187BCD', borderWidth: 2, backgroundColor: '#F3FAFF' },
  otpBoxFilled: { borderColor: '#63B6EC', backgroundColor: '#EDF8FF' },
  otpDigit: { color: '#17324D', fontSize: 23, fontWeight: '700' },
  hiddenOtpInput: {
    ...StyleSheet.absoluteFillObject,
    color: 'transparent',
    opacity: 0.02,
    fontSize: 1,
  },
  expiryText: {
    color: '#52708A',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  expiredText: { color: '#B45309' },
  resendSection: { alignItems: 'center', marginTop: 20 },
  resendPrompt: { color: '#52708A', fontSize: 14, marginBottom: 8 },
  resendButton: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8 },
  resendButtonDisabled: { opacity: 0.8 },
  resendButtonText: { color: '#187BCD', fontSize: 14, fontWeight: '700' },
  resendButtonTextDisabled: { color: '#6E8AA2' },
});
