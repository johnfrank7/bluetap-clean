import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  ActivityIndicator, Animated, Easing, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../components/BlueTapTheme';
import { clearAllAuthSessions } from '../services/authSession';
import { clearPendingRegistration, completeRegistrationWithoutOtp, getPendingRegistration, requestRegistrationOtp, setPendingRegistration } from '../services/emailVerification';
import { checkUsername, normalizeUsername, validateUsername } from '../services/usernameAuth';
import { acceptRegistrationTerms, createRegistrationSession, getCachedRegistrationPolicy, getRegistrationBranches, getRegistrationSessionStatus, primeRegistrationPolicy, revalidateRegistrationPolicy } from '../services/registrationSession';
import { clearPendingFaceEnrollment } from '../services/pendingFaceEnrollment';
import { useFaceServiceWarmup } from '../services/useFaceServiceWarmup';

import RegistrationFaceCapture from '../components/RegistrationFaceCapture';
import PasswordVisibilityButton from '../components/PasswordVisibilityButton';
import { RegistrationActions, RegistrationBrand, RegistrationHeading, RegistrationNotice, RegistrationStepper } from '../components/RegistrationUi';
import { auth } from '../firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { getRoleHomePath, saveRoleSession } from '../services/authSession';

const { isTrustedRegistrationFaceVerification } = require('../services/webFaceCaptureCore');
const { REGISTRATION_STEP: STEP, REGISTRATION_STEP_LABELS, buildRegistrationDisplaySteps, buildRegistrationSteps, adjacentRegistrationStep, registrationEntryStep } = require('../services/registrationStepStatus');

const BARANGAYS = ['Awihao', 'Bagakay', 'Bato', 'Biga', 'Bulongan', 'Bunga', 'Cabitoonan', 'Calongcalong', 'Cambang-ug', 'Camp 8', 'Canlumampao', 'Cantabaco', 'Capitan Claudio', 'Carmen', 'Daanglungsod', 'Don Andres Soriano', 'Dumlog', 'Gen. Climaco', 'Ibo', 'Ilihan', 'Juan Climaco, Sr.', 'Landahan', 'Loay', 'Luray II', 'Matab-ang', 'Media Once', 'Pangamihan', 'Poblacion', 'Poog', 'Putingbato', 'Sagay', 'Sam-ang', 'Sangi', 'Santo Niño', 'Subayon', 'Talavera', 'Tubod', 'Tungkay'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^9\d{9}$/;
const firstParam = (value) => Array.isArray(value) ? value[0] : value;

const normalizePhone = (value) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('63')) return digits.slice(2, 12);
  if (digits.startsWith('0')) return digits.slice(1, 11);
  return digits.slice(0, 10);
};

const Field = ({ label, error, hint, children }) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {children}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!error && !!hint && <Text style={styles.hint}>{hint}</Text>}
  </View>
);

export default function SignupPage() {
  const { colors, isDark } = useBlueTapTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const initialRole = params.role === 'requester' || params.role === 'distributor' ? params.role : '';
  // Resume only an in-memory draft. The server still validates every session field.
  const usernameTaken = firstParam(params.usernameTaken) === 'true';
  const usernameRetryDraft = React.useRef(usernameTaken || firstParam(params.resumeRegistration) === 'true' ? getPendingRegistration() : null).current;
  const [step, setStep] = React.useState(usernameRetryDraft ? STEP.credentials : STEP.account);
  const [form, setForm] = React.useState(() => ({
    role: usernameRetryDraft?.profile?.role || initialRole,
    firstName: usernameRetryDraft?.profile?.firstName || '', lastName: usernameRetryDraft?.profile?.lastName || '',
    phone: String(usernameRetryDraft?.profile?.phone || '').replace(/^\+63/, ''),
    barangay: usernameRetryDraft?.profile?.barangay || '', address: usernameRetryDraft?.profile?.address || '', requestedBranchId: usernameRetryDraft?.profile?.requestedBranchId || '',
    username: usernameRetryDraft?.profile?.username || '', email: usernameRetryDraft?.profile?.email || '',
    password: usernameRetryDraft?.profile?.password || '', confirmPassword: usernameRetryDraft?.profile?.password || '',
  }));
  const [errors, setErrors] = React.useState(() => usernameTaken && usernameRetryDraft ? { username: 'This username was just taken. Please choose another.' } : {});
  const [showBarangays, setShowBarangays] = React.useState(false);
  const [showBranches, setShowBranches] = React.useState(false);
  const [registrationBranches, setRegistrationBranches] = React.useState([]);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [branchLoadError, setBranchLoadError] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [showPasswordConfirmation, setShowPasswordConfirmation] = React.useState(false);
  const [usernameState, setUsernameState] = React.useState(() => usernameTaken && usernameRetryDraft
    ? { status: 'taken', checked: normalizeUsername(usernameRetryDraft.profile.username) }
    : { status: 'idle', checked: '' });
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [retryAt, setRetryAt] = React.useState(0);
  const [registrationSessionId, setRegistrationSessionId] = React.useState(usernameRetryDraft?.profile?.registrationSessionId || '');
  const cachedPolicyAtMount = React.useRef(!registrationSessionId ? getCachedRegistrationPolicy() : null).current;
  const [faceVerification, setFaceVerification] = React.useState({ status: 'unverified', duplicateCheck: 'unknown' });
  const [termsAccepted, setTermsAccepted] = React.useState(Boolean(usernameRetryDraft));
  const [securityPolicy, setSecurityPolicy] = React.useState(cachedPolicyAtMount?.policy || null);
  const [securityPolicyReady, setSecurityPolicyReady] = React.useState(Boolean(cachedPolicyAtMount?.policy));
  const [policyResolving, setPolicyResolving] = React.useState(!cachedPolicyAtMount?.policy);
  const [policyError, setPolicyError] = React.useState('');
  const [policyRetry, setPolicyRetry] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const submitting = React.useRef(false);
  const securityPolicyRef = React.useRef(cachedPolicyAtMount?.policy || null);
  const usernameCheckVersion = React.useRef(0);
  const entrance = React.useRef(new Animated.Value(0)).current;
  const stepTransition = React.useRef(new Animated.Value(1)).current;
  const mobile = width < 600;
  const faceService = useFaceServiceWarmup(
    registrationSessionId,
    securityPolicyReady && securityPolicy?.faceVerificationRequired === true,
  );

  React.useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entrance]);

  React.useEffect(() => {
    let active = true;
    setPolicyError('');
    setPolicyResolving(true);
    if (!registrationSessionId) {
      const cached = getCachedRegistrationPolicy();
      if (cached?.policy) {
        securityPolicyRef.current = cached.policy;
        setSecurityPolicy(cached.policy);
        setSecurityPolicyReady(true);
        setStep((current) => registrationEntryStep(buildRegistrationSteps(cached.policy), current));
      }
    }
    const request = registrationSessionId
      ? getRegistrationSessionStatus(registrationSessionId)
      : revalidateRegistrationPolicy().then((securityPolicy) => ({ securityPolicy }));
    request.then((result) => {
      if (!active) return;
      const policy = result.securityPolicy;
      if (typeof policy?.faceVerificationRequired !== 'boolean' || typeof policy?.emailOtpRequired !== 'boolean') {
        throw new Error('Registration security settings are unavailable. Please try again.');
      }
      if (registrationSessionId && typeof result.faceVerification?.status !== 'string') {
        throw new Error('Registration verification status is unavailable. Please try again.');
      }
      securityPolicyRef.current = policy;
      setSecurityPolicy(policy);
      if (registrationSessionId) setFaceVerification(result.faceVerification);
      setStep((current) => registrationEntryStep(buildRegistrationSteps(policy), current));
      setSecurityPolicyReady(true);
    }).catch(() => {
      if (active && !securityPolicyRef.current) {
        setPolicyError('We could not confirm the registration verification steps. Try again to continue.');
      }
    }).finally(() => { if (active) setPolicyResolving(false); });
    return () => { active = false; };
  }, [registrationSessionId, policyRetry]);

  React.useEffect(() => {
    let active = true;
    if (form.role !== 'distributor') { setRegistrationBranches([]); setBranchLoadError(''); return () => { active = false; }; }
    setBranchesLoading(true); setBranchLoadError('');
    getRegistrationBranches()
      .then((branches) => { if (active) setRegistrationBranches(branches); })
      .catch((error) => { if (active) setBranchLoadError(error.message || 'BlueTap branches are unavailable.'); })
      .finally(() => { if (active) setBranchesLoading(false); });
    return () => { active = false; };
  }, [form.role]);

  React.useEffect(() => {
    Animated.timing(stepTransition, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [step, stepTransition]);

  const transitionToStep = React.useCallback((target) => {
    stepTransition.stopAnimation();
    stepTransition.setValue(0);
    setStep(target);
  }, [stepTransition]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    if (key === 'username') {
      usernameCheckVersion.current += 1;
      setUsernameState({ status: 'idle', checked: '' });
    }
    if (['role', 'firstName', 'lastName', 'phone', 'barangay', 'address', 'requestedBranchId'].includes(key) && registrationSessionId) {
      clearPendingRegistration();
      clearPendingFaceEnrollment(registrationSessionId);
      setRegistrationSessionId('');
      setFaceVerification({ status: 'unverified', duplicateCheck: 'unknown' });
      securityPolicyRef.current = null;
      setSecurityPolicy(null);
      setSecurityPolicyReady(false);
    }
  };

  React.useEffect(() => {
    if (!retryAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const accountComplete = !!form.role;
  const personalComplete = !!form.firstName.trim() && !!form.lastName.trim() && PHONE.test(form.phone) && !!form.barangay && !!form.address.trim() && (form.role !== 'distributor' || !!form.requestedBranchId);
  const identityComplete = !!registrationSessionId && (securityPolicy?.faceVerificationRequired === false || isTrustedRegistrationFaceVerification(faceVerification));
  const credentialsComplete = !validateUsername(form.username) && EMAIL.test(form.email.trim()) && form.password.length >= 8 && form.password === form.confirmPassword && usernameState.status === 'available' && termsAccepted;
  const visibleRegistrationSteps = React.useMemo(
    () => buildRegistrationSteps(securityPolicy),
    [securityPolicy?.emailOtpRequired, securityPolicy?.faceVerificationRequired],
  );
  const displayedRegistrationSteps = React.useMemo(
    () => buildRegistrationDisplaySteps(securityPolicy),
    [securityPolicy?.emailOtpRequired, securityPolicy?.faceVerificationRequired],
  );
  const visibleStepNumber = Math.max(1, displayedRegistrationSteps.indexOf(step) + 1);
  const canContinue = step === STEP.account ? accountComplete
    : step === STEP.personal ? accountComplete && personalComplete
      : step === STEP.identity ? accountComplete && personalComplete && identityComplete
        : step === STEP.credentials ? accountComplete && personalComplete && identityComplete && credentialsComplete
          : false;

  const prerequisiteNotice = step >= STEP.personal && !accountComplete
    ? { title: 'Account type required', message: 'Complete Account before continuing with registration.', target: STEP.account, actionLabel: 'Go to Account' }
    : step >= STEP.identity && !personalComplete
      ? { title: 'Personal information required', message: 'Complete Personal Information before continuing with account setup.', target: STEP.personal, actionLabel: 'Go to Personal Information' }
      : step >= STEP.identity && !registrationSessionId
        ? { title: 'Registration session required', message: 'Return to Personal Information and tap Next to continue.', target: STEP.personal, actionLabel: 'Go to Personal Information' }
        : step >= STEP.credentials && securityPolicy?.faceVerificationRequired === true && !identityComplete
          ? { title: 'Identity verification required', message: 'Complete Identity before continuing with credentials.', target: STEP.identity, actionLabel: 'Go to Identity Verification' }
          : step >= STEP.verifyEmail && !credentialsComplete
            ? { title: 'Credentials required', message: 'Complete Credentials before continuing with email verification.', target: STEP.credentials, actionLabel: 'Go to Credentials' }
            : step === STEP.verifyEmail
              ? { title: 'Verification code required', message: 'Return to Credentials and send the verification code to open email verification.', target: STEP.credentials, actionLabel: 'Go to Credentials' }
              : null;

  const openStep = (target) => {
    if (loading || !securityPolicyReady || target === step || !visibleRegistrationSteps.includes(target)) return;
    setErrors({});
    setShowBarangays(false);
    transitionToStep(target);
  };

  const advanceOrGuide = () => {
    if (prerequisiteNotice) {
      transitionToStep(prerequisiteNotice.target);
      setNotice({ ...prerequisiteNotice, tone: 'warning' });
      return;
    }
    if (step === STEP.verifyEmail) {
      transitionToStep(STEP.credentials);
      setNotice({
        tone: 'warning',
        title: 'Verification code required',
        message: 'Complete Credentials and tap Next to receive your secure email verification code.',
      });
      return;
    }
    if (step === STEP.credentials) submit();
    else next();
  };

  React.useEffect(() => {
    if (step !== STEP.credentials) return undefined;
    const validation = validateUsername(form.username);
    if (validation) {
      setUsernameState({ status: form.username.trim() ? 'invalid' : 'idle', checked: '' });
      return undefined;
    }
    const normalized = normalizeUsername(form.username);
    const version = usernameCheckVersion.current + 1;
    usernameCheckVersion.current = version;
    const timer = setTimeout(async () => {
      setUsernameState({ status: 'checking', checked: normalized });
      try {
        const result = await checkUsername(form.username);
        if (usernameCheckVersion.current === version) setUsernameState({ status: result.available === true ? 'available' : 'taken', checked: normalized });
      } catch {
        if (usernameCheckVersion.current === version) setUsernameState({ status: 'unavailable', checked: normalized });
      }
    }, 500);
    return () => { clearTimeout(timer); usernameCheckVersion.current += 1; };
  }, [form.username, step]);

  const validateStep = (target = step) => {
    const next = {};
    if (target === STEP.account && !form.role) next.role = 'Choose an account type.';
    if (target === STEP.personal) {
      if (!form.firstName.trim()) next.firstName = 'First name is required.';
      if (!form.lastName.trim()) next.lastName = 'Last name is required.';
      if (!PHONE.test(form.phone)) next.phone = 'Enter a valid Philippine number (9XXXXXXXXX).';
      if (!form.barangay) next.barangay = 'Select your barangay.';
      if (!form.address.trim()) next.address = 'Address is required.';
      if (form.role === 'distributor' && !form.requestedBranchId) next.requestedBranchId = 'Choose the BlueTap branch you are applying to.';
    }
    if (target === STEP.credentials) {
      const usernameError = validateUsername(form.username);
      if (usernameError) next.username = usernameError;
      else if (usernameState.status === 'taken' && usernameState.checked === normalizeUsername(form.username)) next.username = 'This username is already taken.';
      else if (usernameState.status === 'checking') next.username = 'Checking username availability. Please wait.';
      else if (usernameState.status === 'unavailable') next.username = 'Unable to check username. Please try again.';
      if (!EMAIL.test(form.email.trim())) next.email = 'Enter a valid email address.';
      if (form.password.length < 8) next.password = 'Password must be at least 8 characters.';
      if (form.password !== form.confirmPassword) next.confirmPassword = 'Passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = async () => {
    if (!validateStep() || (step === STEP.identity && !canContinue)) return;
    if (!securityPolicyReady) {
      if (step === STEP.account) transitionToStep(STEP.personal);
      return;
    }
    if (step === STEP.personal && !registrationSessionId) {
      setLoading(true);
      try {
        const result = await createRegistrationSession({
          role: form.role, firstName: form.firstName.trim(), lastName: form.lastName.trim(),
          phone: `+63${form.phone}`, barangay: form.barangay, address: form.address.trim(),
          ...(form.role === 'distributor' ? { requestedBranchId: form.requestedBranchId } : {}),
        });
        const sessionSteps = buildRegistrationSteps(result.securityPolicy);
        if (!sessionSteps.length) throw new Error('Registration security settings are unavailable. Please try again.');
        setRegistrationSessionId(result.registrationSessionId);
        securityPolicyRef.current = result.securityPolicy;
        setSecurityPolicy(result.securityPolicy);
        primeRegistrationPolicy(result.securityPolicy);
        setFaceVerification(result.securityPolicy?.faceVerificationRequired === false
          ? { required: false, status: 'not_required', duplicateCheck: 'not_required' }
          : { required: true, status: 'unverified', duplicateCheck: 'unknown' });
        transitionToStep(adjacentRegistrationStep(sessionSteps, STEP.personal, 1));
        setErrors({});
        return;
      } catch (error) {
        setNotice({ title: 'Could not start verification', message: error.message });
        return;
      } finally { setLoading(false); }
    }
    const nextStep = adjacentRegistrationStep(visibleRegistrationSteps, step, 1);
    if (nextStep) transitionToStep(nextStep);
    setErrors({});
  };

  const back = () => {
    if (loading) return;
    if (step === STEP.account) router.replace('/login');
    else transitionToStep(adjacentRegistrationStep(visibleRegistrationSteps, step, -1) ?? STEP.account);
  };

  const submit = async () => {
    if (!securityPolicyReady || !validateStep(STEP.credentials) || loading || submitting.current || retrySeconds > 0) return;
    submitting.current = true;
    setLoading(true);
    try {
      if (!registrationSessionId || (securityPolicy.faceVerificationRequired && !isTrustedRegistrationFaceVerification(faceVerification))) {
        setNotice({ title: 'Identity verification required', message: 'Complete identity verification before continuing.' });
        return;
      }
      if (!termsAccepted) {
        return;
      }
      await acceptRegistrationTerms(registrationSessionId);
      const profile = {
        role: form.role,
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        phone: `+63${form.phone}`, barangay: form.barangay, address: form.address.trim(),
        username: form.username.trim(), usernameNormalized: normalizeUsername(form.username),
        email: form.email.trim().toLowerCase(), password: form.password,
        registrationSessionId,
        ...(form.role === 'distributor' ? { requestedBranchId: form.requestedBranchId } : {}),
        securityPolicy,
      };
      clearPendingRegistration();
      const result = await requestRegistrationOtp(profile.email, profile.username, registrationSessionId);
      setPendingRegistration(profile, result);
      clearAllAuthSessions();
      if (result.otpRequired === false) {
        const completed = await completeRegistrationWithoutOtp();
        await signInWithCustomToken(auth, completed.customToken);
        saveRoleSession({ uid: auth.currentUser.uid, email: profile.email, role: completed.role });
        clearPendingRegistration();
        router.replace(completed.role === 'distributor' ? '/registration-status' : getRoleHomePath(completed.role));
        return;
      }
      router.replace({ pathname: '/email-verification', params: {
        registration: 'true', role: form.role, sent: 'true', expiresAt: String(result.expiresAt),
        resendAfterSeconds: String(result.resendAfterSeconds),
      } });
    } catch (error) {
      const reason = error?.details?.reason || String(error?.code || '').replace('otp/', '');
      const retry = Number(error?.details?.retryAfterSeconds || 0);
      if (retry > 0) { setRetryAt(Date.now() + retry * 1000); setNow(Date.now()); }
      if (reason === 'username-taken') {
        setErrors((current) => ({ ...current, username: 'This username is already taken.' }));
        setUsernameState({ status: 'taken', checked: normalizeUsername(form.username) });
      }
      setNotice({
        title: reason === 'account-exists' ? 'Email already registered' : reason === 'username-taken' ? 'Username unavailable' : 'Signup failed',
        message: retry > 0 ? `Too many code requests. Try again in ${Math.ceil(retry / 60)} minute(s).` : error.message,
      });
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const titles = {
    [STEP.account]: ['Create your BlueTap account', "Choose how you'll use BlueTap."],
    [STEP.personal]: ['Personal information', 'Tell us a little about yourself.'],
    [STEP.identity]: ['Verify your identity', 'Help us keep BlueTap accounts secure.'],
    [STEP.credentials]: ['Set up your account', 'Choose your login credentials and recovery email.'],
    [STEP.verifyEmail]: ['Verify your email', 'Confirm your email address to finish registration.'],
  };
  const [title, subtitle] = titles[step];

  return (
    <LinearGradient colors={isDark ? [colors.background, colors.header] : [colors.primary, colors.primaryLight]} style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Animated.View style={[
            styles.shell,
            {
              maxWidth: mobile ? 520 : 600,
              opacity: entrance,
              transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
            },
          ]}>
            <RegistrationBrand />
            <View style={[styles.card, step === STEP.identity && styles.identityCard, step === STEP.identity && mobile && styles.identityCardMobile]}>
              <RegistrationStepper
                currentStep={step}
                requiredSteps={displayedRegistrationSteps}
                visibleSteps={displayedRegistrationSteps}
                completedSteps={[
                  accountComplete && STEP.account,
                  personalComplete && !!registrationSessionId && STEP.personal,
                  securityPolicy?.faceVerificationRequired && identityComplete && STEP.identity,
                  credentialsComplete && STEP.credentials,
                ].filter(Boolean)}
                onStepPress={openStep}
                disabled={loading || !securityPolicyReady}
              />
              {mobile && <Text style={styles.stepText}>Step {visibleStepNumber} of {displayedRegistrationSteps.length} · {REGISTRATION_STEP_LABELS[step]}</Text>}
              {!securityPolicyReady && policyResolving && <View style={styles.policyStatus} accessibilityRole="progressbar" accessibilityLabel="Confirming registration verification steps"><ActivityIndicator size="small" color={BLUETAP_COLORS.primary} /><Text style={styles.policyStatusText}>Confirming secure verification steps…</Text></View>}
              {!securityPolicyReady && !!policyError && <RegistrationNotice tone="error" title="Verification steps unavailable" message={policyError} actionLabel="Try again" onAction={() => setPolicyRetry((value) => value + 1)} />}
              {(securityPolicyReady || step === STEP.account || step === STEP.personal) && <Animated.View style={{
                opacity: stepTransition,
                transform: [{ translateY: stepTransition.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
              }}>
              <RegistrationHeading title={step === STEP.identity ? 'Verify your identity' : title} subtitle={step === STEP.identity ? 'Complete a quick face check to help protect your account and prevent duplicate registrations.' : subtitle} />

              {step === STEP.account && <View style={styles.roleList}>
                {[
                  ['requester', '💧', 'Requester', 'Order water from your water provider.'],
                  ['distributor', '🚚', 'Distributor', 'Receive and manage customer water requests for your station.'],
                ].map(([value, icon, name, description]) => <TouchableOpacity key={value} style={[styles.roleCard, form.role === value && styles.roleCardSelected]} onPress={() => update('role', value)} accessibilityRole="radio" accessibilityState={{ checked: form.role === value }}>
                  <Text style={styles.roleIcon}>{icon}</Text><View style={styles.roleCopy}><Text style={styles.roleTitle}>{name}</Text><Text style={styles.roleDescription}>{description}</Text></View><View style={[styles.radio, form.role === value && styles.radioSelected]} />
                </TouchableOpacity>)}
                {!!errors.role && <Text style={styles.error}>{errors.role}</Text>}
              </View>}

              {step === STEP.personal && <View>
                <View style={!mobile && styles.row}>
                  <View style={!mobile && styles.half}><Field label="First name" error={errors.firstName}><TextInput style={[styles.input, errors.firstName && styles.inputError]} value={form.firstName} onChangeText={(v) => update('firstName', v)} autoComplete="given-name" /></Field></View>
                  <View style={!mobile && styles.half}><Field label="Last name" error={errors.lastName}><TextInput style={[styles.input, errors.lastName && styles.inputError]} value={form.lastName} onChangeText={(v) => update('lastName', v)} autoComplete="family-name" /></Field></View>
                </View>
                <Field label="Phone number" error={errors.phone}><View style={[styles.phone, errors.phone && styles.inputError]}><Text style={styles.prefix}>+63</Text><TextInput style={styles.phoneInput} value={form.phone} onChangeText={(v) => update('phone', normalizePhone(v))} keyboardType="phone-pad" maxLength={10} accessibilityLabel="Philippine mobile number" /></View></Field>
                <Field label="Barangay" error={errors.barangay}><TouchableOpacity style={[styles.input, styles.select, errors.barangay && styles.inputError]} onPress={() => setShowBarangays((v) => !v)}><Text style={form.barangay ? styles.inputText : styles.placeholder}>{form.barangay || 'Select barangay'}</Text><Text>⌄</Text></TouchableOpacity></Field>
                {showBarangays && <ScrollView style={styles.dropdown} nestedScrollEnabled>{BARANGAYS.map((item) => <TouchableOpacity key={item} style={styles.option} onPress={() => { update('barangay', item); setShowBarangays(false); }}><Text style={styles.inputText}>{item}</Text></TouchableOpacity>)}</ScrollView>}
                <Field label="Address" error={errors.address}><TextInput style={[styles.input, errors.address && styles.inputError]} value={form.address} onChangeText={(v) => update('address', v)} placeholder="Street, sitio, or house number" placeholderTextColor={colors.textSecondary} /></Field>
                {form.role === 'distributor' && <Field label="Apply to branch" error={errors.requestedBranchId} hint={branchLoadError || (branchesLoading ? 'Loading active BlueTap branches…' : 'Choose the active BlueTap branch you are applying to. Administrator approval is required before delivery access.')}><TouchableOpacity disabled={branchesLoading || !!branchLoadError} style={[styles.input, styles.select, errors.requestedBranchId && styles.inputError, (branchesLoading || !!branchLoadError) && styles.inputDisabled]} onPress={() => setShowBranches((value) => !value)} accessibilityRole="combobox" accessibilityLabel="Apply to branch"><Text style={form.requestedBranchId ? styles.inputText : styles.placeholder}>{registrationBranches.find((branch) => branch.id === form.requestedBranchId)?.name || 'Select BlueTap branch'}</Text><Text>⌄</Text></TouchableOpacity></Field>}
                {form.role === 'distributor' && showBranches && <ScrollView style={styles.dropdown} nestedScrollEnabled>{registrationBranches.map((branch) => <TouchableOpacity key={branch.id} style={styles.option} onPress={() => { update('requestedBranchId', branch.id); setShowBranches(false); }}><Text style={styles.inputText}>{branch.name}</Text></TouchableOpacity>)}{!registrationBranches.length && !branchesLoading && <Text style={styles.emptyDropdown}>No active BlueTap branches are currently available.</Text>}</ScrollView>}
              </View>}

              {step === STEP.identity && accountComplete && personalComplete && !!registrationSessionId && <RegistrationFaceCapture
                key={registrationSessionId}
                registrationSessionId={registrationSessionId}
                verification={faceVerification}
                onResult={setFaceVerification}
                serviceStatus={faceService.status}
                onCheckService={faceService.checkAgain}
              />}

              {step === STEP.credentials && <View>
                <Field label="Username" error={errors.username} hint={usernameState.status === 'checking' ? 'Checking username availability...' : usernameState.status === 'available' ? 'Username is available.' : usernameState.status === 'taken' ? 'Username is already taken.' : usernameState.status === 'invalid' ? 'Invalid username format' : usernameState.status === 'unavailable' ? 'Unable to check username' : '4-20 characters; letters, numbers, and underscores.'}>
                  <TextInput style={[styles.input, errors.username && styles.inputError, usernameState.status === 'available' && styles.inputSuccess]} value={form.username} onChangeText={(v) => update('username', v.replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false} maxLength={20} />
                </Field>
                <Field label="Recovery email" error={errors.email}><TextInput style={[styles.input, errors.email && styles.inputError]} value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
                <Field label="Password" error={errors.password} hint="Use at least 8 characters."><View style={[styles.password, errors.password && styles.inputError]}><TextInput style={styles.passwordInput} value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry={!showPassword} autoCapitalize="none" /><PasswordVisibilityButton visible={showPassword} onPress={() => setShowPassword((v) => !v)} /></View></Field>
                <Field label="Confirm password" error={errors.confirmPassword}><View style={[styles.password, errors.confirmPassword && styles.inputError]}><TextInput style={styles.passwordInput} value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry={!showPasswordConfirmation} autoCapitalize="none" /><PasswordVisibilityButton visible={showPasswordConfirmation} onPress={() => setShowPasswordConfirmation((v) => !v)} label="password confirmation" /></View></Field>
                <View style={styles.termsRow}>
                  <TouchableOpacity style={styles.checkboxTouch} onPress={() => { setTermsAccepted((value) => !value); setErrors((current) => ({ ...current, terms: '' })); }} accessibilityRole="checkbox" accessibilityState={{ checked: termsAccepted }}>
                    <View style={[styles.checkboxBox, termsAccepted && styles.checkboxTouchChecked]}><Text style={styles.checkboxMark}>{termsAccepted ? '✓' : ''}</Text></View>
                  </TouchableOpacity>
                  <Text style={styles.termsText}>I agree to the BlueTap <Text style={styles.termsLink} onPress={() => router.push('/terms')}>Terms of Service</Text> and <Text style={styles.termsLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.</Text>
                </View>
              </View>}

              {step === STEP.verifyEmail && <View style={styles.verifyPreview}><Text style={styles.verifyPreviewText}>Email verification becomes available only after BlueTap accepts the completed Credentials step and sends a secure verification code.</Text></View>}

              <RegistrationActions
                stacked={mobile}
                showBack={step !== STEP.account}
                onBack={back}
                onPrimary={advanceOrGuide}
                loading={loading}
                primaryDisabled={retrySeconds > 0 || (!securityPolicyReady && step !== STEP.account) || (!prerequisiteNotice && step !== STEP.verifyEmail && !canContinue)}
                primaryLabel={retrySeconds > 0
                  ? `Try again in ${Math.floor(retrySeconds / 60)}:${String(retrySeconds % 60).padStart(2, '0')}`
                  : !securityPolicyReady && step === STEP.personal ? 'Preparing secure registration…' : step === STEP.verifyEmail ? 'Continue' : step === STEP.credentials && !securityPolicy.emailOtpRequired ? 'Complete Registration' : 'Next'}
              />
              <Text style={styles.loginPrompt}>Already have an account? <Text style={styles.loginLink} onPress={() => router.replace('/login')}>Log in.</Text></Text>
              </Animated.View>}
            </View>
          </Animated.View>
        </ScrollView>
        <Modal visible={!!notice} transparent animationType="fade"><View style={styles.modalBg}><View style={styles.modal}><RegistrationNotice tone={notice?.tone || 'error'} title={notice?.title} message={notice?.message} /><TouchableOpacity style={styles.primary} onPress={() => setNotice(null)}><Text style={styles.primaryText}>OK</Text></TouchableOpacity></View></View></Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = createPortalStyleSheet({
  identityCard: { borderRadius: 20, padding: 24, shadowOpacity: 0.16, shadowRadius: 16 },
  identityCardMobile: { padding: 16 },
  verifyPreview: { borderWidth: 1, borderColor: '#D8E5EF', backgroundColor: '#F7FAFC', borderRadius: 12, padding: 18 },
  verifyPreviewText: { color: '#526E84', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  screen: { flex: 1 }, safe: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }, shell: { width: '100%' },
  card: { backgroundColor: '#FFF', borderRadius: 24, padding: 26, shadowColor: '#07518E', shadowOpacity: .24, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  policyStatus: { minHeight: 32, marginTop: -12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, policyStatusText: { color: BLUETAP_COLORS.muted, fontSize: 12, fontWeight: '600' },
  stepText: { color: BLUETAP_COLORS.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: -12, marginBottom: 12 },
  roleList: { gap: 12 }, roleCard: { flexDirection: 'row', alignItems: 'center', minHeight: 94, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#D8E5EF', backgroundColor: '#FAFCFE' }, roleCardSelected: { borderColor: BLUETAP_COLORS.primary, backgroundColor: '#EDF7FF' }, roleIcon: { fontSize: 28, marginRight: 14 }, roleCopy: { flex: 1 }, roleTitle: { color: '#17324D', fontSize: 16, fontWeight: '800' }, roleDescription: { color: '#607A90', fontSize: 13, lineHeight: 18, marginTop: 3 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#A8BCCB' }, radioSelected: { borderWidth: 5, borderColor: BLUETAP_COLORS.primary },
  row: { flexDirection: 'row', gap: 12 }, half: { flex: 1 }, field: { marginBottom: 15 }, label: { color: '#29465F', fontSize: 13, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE', paddingHorizontal: 14, color: '#17324D', fontSize: 15 }, inputError: { borderColor: '#DC5757', backgroundColor: '#FFF8F8' }, inputSuccess: { borderColor: '#36A269' }, error: { color: '#B93A3A', fontSize: 12, marginTop: 5 }, hint: { color: '#68839A', fontSize: 12, marginTop: 5 },
  phone: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, prefix: { paddingHorizontal: 14, color: '#17324D', fontWeight: '700', borderRightWidth: 1, borderRightColor: '#D8E5EF' }, phoneInput: { flex: 1, minHeight: 48, paddingHorizontal: 12, color: '#17324D', fontSize: 15 }, select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inputText: { color: '#17324D', fontSize: 15 }, placeholder: { color: BLUETAP_COLORS.textSecondary, fontSize: 15 }, inputDisabled: { opacity: .58 }, dropdown: { maxHeight: 170, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, marginTop: -10, marginBottom: 15 }, option: { padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8E5EF' }, emptyDropdown: { color: '#607A90', padding: 13, fontSize: 13 },
  identityBox: { alignItems: 'center' }, faceIcon: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#E8F5FF', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, faceIconText: { color: BLUETAP_COLORS.primary, fontSize: 48 }, identityTitle: { color: '#17324D', fontSize: 17, fontWeight: '800', textAlign: 'center' }, identityText: { color: '#607A90', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 9 }, privacy: { backgroundColor: '#F1F7FB', padding: 13, borderRadius: 10, marginTop: 16 }, privacyText: { color: '#47667E', fontSize: 12, lineHeight: 18 }, status: { flexDirection: 'row', alignItems: 'center', marginTop: 14 }, successMark: { color: '#238A57', fontSize: 18, fontWeight: '900', marginRight: 7 }, reviewDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C47A13', marginRight: 7 }, faceMessage: { color: '#A34B23', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 14 }, faceSuccess: { color: '#238A57', fontSize: 13, fontWeight: '700' }, faceReview: { color: '#A5650B', fontSize: 13, fontWeight: '700' },
  faceButton: { width: '100%', minHeight: 48, marginTop: 16, borderRadius: 11, borderWidth: 1, borderColor: '#9AC7E8', alignItems: 'center', justifyContent: 'center' }, faceButtonText: { color: BLUETAP_COLORS.primary, fontSize: 14, fontWeight: '700' },
  password: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, passwordInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: '#17324D', fontSize: 15 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 44, marginTop: 2 }, checkboxTouch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 2, marginTop: -8 }, checkboxBox: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: '#91ABC0', alignItems: 'center', justifyContent: 'center' }, checkboxTouchChecked: { backgroundColor: BLUETAP_COLORS.primary, borderColor: BLUETAP_COLORS.primary }, checkboxMark: { color: '#FFF', fontWeight: '900' }, termsText: { flex: 1, color: '#526E84', fontSize: 13, lineHeight: 20 }, termsLink: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  primary: { flex: 1, minHeight: 50, borderRadius: 11, paddingHorizontal: 18, backgroundColor: BLUETAP_COLORS.primary, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' }, loginPrompt: { textAlign: 'center', color: '#6B8498', fontSize: 13, marginTop: 20 }, loginLink: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.5)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modal: { width: '100%', maxWidth: 420, backgroundColor: '#FFF', borderRadius: 20, padding: 24 },
});
