import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  Animated, Easing, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BLUETAP_COLORS, BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { clearAllAuthSessions } from '../services/authSession';
import { clearPendingRegistration, completeRegistrationWithoutOtp, requestRegistrationOtp, setPendingRegistration } from '../services/emailVerification';
import { checkUsername, normalizeUsername, validateUsername } from '../services/usernameAuth';
import { acceptRegistrationTerms, createRegistrationSession } from '../services/registrationSession';

import RegistrationFaceCapture from '../components/RegistrationFaceCapture';
import { RegistrationActions, RegistrationBrand, RegistrationHeading, RegistrationNotice, RegistrationStepper, REGISTRATION_STEPS as STEPS } from '../components/RegistrationUi';
import { auth } from '../firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { getRoleHomePath, saveRoleSession } from '../services/authSession';

const { isTrustedRegistrationFaceVerification } = require('../services/webFaceCaptureCore');

const BARANGAYS = ['Awihao', 'Bagakay', 'Bato', 'Biga', 'Bulongan', 'Bunga', 'Cabitoonan', 'Calongcalong', 'Cambang-ug', 'Camp 8', 'Canlumampao', 'Cantabaco', 'Capitan Claudio', 'Carmen', 'Daanglungsod', 'Don Andres Soriano', 'Dumlog', 'Gen. Climaco', 'Ibo', 'Ilihan', 'Juan Climaco, Sr.', 'Landahan', 'Loay', 'Luray II', 'Matab-ang', 'Media Once', 'Pangamihan', 'Poblacion', 'Poog', 'Putingbato', 'Sagay', 'Sam-ang', 'Sangi', 'Santo Niño', 'Subayon', 'Talavera', 'Tubod', 'Tungkay'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^9\d{9}$/;

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
  const router = useRouter();
  const params = useLocalSearchParams();
  const { width } = useWindowDimensions();
  const initialRole = params.role === 'requester' || params.role === 'distributor' ? params.role : '';
  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState({ role: initialRole, firstName: '', lastName: '', phone: '', barangay: '', address: '', username: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = React.useState({});
  const [showBarangays, setShowBarangays] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [usernameState, setUsernameState] = React.useState({ checking: false, available: null, checked: '' });
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [retryAt, setRetryAt] = React.useState(0);
  const [registrationSessionId, setRegistrationSessionId] = React.useState('');
  const [faceVerification, setFaceVerification] = React.useState({ status: 'unverified', duplicateCheck: 'unknown' });
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [securityPolicy, setSecurityPolicy] = React.useState({ faceVerificationRequired: true, emailOtpRequired: true });
  const [now, setNow] = React.useState(Date.now());
  const submitting = React.useRef(false);
  const entrance = React.useRef(new Animated.Value(0)).current;
  const mobile = width < 600;

  React.useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entrance]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    if (key === 'username') setUsernameState({ checking: false, available: null, checked: '' });
    if (['role', 'firstName', 'lastName', 'phone', 'barangay', 'address'].includes(key) && registrationSessionId) {
      setRegistrationSessionId('');
      setFaceVerification({ status: 'unverified', duplicateCheck: 'unknown' });
    }
  };

  React.useEffect(() => {
    if (!retryAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const accountComplete = !!form.role;
  const personalComplete = !!form.firstName.trim() && !!form.lastName.trim() && PHONE.test(form.phone) && !!form.barangay && !!form.address.trim();
  const identityComplete = !!registrationSessionId && (!securityPolicy.faceVerificationRequired || isTrustedRegistrationFaceVerification(faceVerification));
  const credentialsComplete = !validateUsername(form.username) && EMAIL.test(form.email.trim()) && form.password.length >= 8 && form.password === form.confirmPassword && usernameState.available === true && termsAccepted;
  const canContinue = step === 1 ? accountComplete
    : step === 2 ? accountComplete && personalComplete
      : step === 3 ? accountComplete && personalComplete && identityComplete
        : step === 4 ? accountComplete && personalComplete && identityComplete && credentialsComplete
          : false;

  const prerequisiteNotice = step >= 2 && !accountComplete
    ? { title: 'Account type required', message: 'Complete Step 1 before continuing with registration.', target: 1, actionLabel: 'Go to Account' }
    : step >= 3 && !personalComplete
      ? { title: 'Personal information required', message: 'Complete Step 2 before continuing with account setup.', target: 2, actionLabel: 'Go to Personal Information' }
      : step >= 3 && !registrationSessionId
        ? { title: 'Verification session required', message: 'Return to Step 2 and tap Continue to start identity verification.', target: 2, actionLabel: 'Go to Personal Information' }
        : step >= 4 && !identityComplete
          ? { title: 'Identity verification required', message: 'Complete Step 3 before continuing with credentials.', target: 3, actionLabel: 'Go to Identity Verification' }
          : step >= 5 && !credentialsComplete
            ? { title: 'Credentials required', message: 'Complete Step 4 before continuing with email verification.', target: 4, actionLabel: 'Go to Credentials' }
            : step === 5
              ? { title: 'Verification code required', message: 'Return to Step 4 and send the verification code to open email verification.', target: 4, actionLabel: 'Go to Credentials' }
              : null;

  const openStep = (target) => {
    if (loading || target === step || target < 1 || target > 5) return;
    setErrors({});
    setShowBarangays(false);
    setStep(target);
  };

  const advanceOrGuide = () => {
    if (prerequisiteNotice) {
      setStep(prerequisiteNotice.target);
      setNotice({ ...prerequisiteNotice, tone: 'warning' });
      return;
    }
    if (step === 5) {
      setStep(4);
      setNotice({
        tone: 'warning',
        title: 'Verification code required',
        message: 'Complete Credentials and tap Next to receive your secure email verification code.',
      });
      return;
    }
    if (step === 4) submit();
    else next();
  };

  React.useEffect(() => {
    if (step !== 4) return undefined;
    const validation = validateUsername(form.username);
    if (validation) return undefined;
    const normalized = normalizeUsername(form.username);
    const timer = setTimeout(async () => {
      setUsernameState({ checking: true, available: null, checked: normalized });
      try {
        const result = await checkUsername(form.username);
        setUsernameState({ checking: false, available: result.available === true, checked: normalized });
      } catch {
        setUsernameState({ checking: false, available: null, checked: normalized });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [form.username, step]);

  const validateStep = (target = step) => {
    const next = {};
    if (target === 1 && !form.role) next.role = 'Choose an account type.';
    if (target === 2) {
      if (!form.firstName.trim()) next.firstName = 'First name is required.';
      if (!form.lastName.trim()) next.lastName = 'Last name is required.';
      if (!PHONE.test(form.phone)) next.phone = 'Enter a valid Philippine number (9XXXXXXXXX).';
      if (!form.barangay) next.barangay = 'Select your barangay.';
      if (!form.address.trim()) next.address = 'Address is required.';
    }
    if (target === 4) {
      const usernameError = validateUsername(form.username);
      if (usernameError) next.username = usernameError;
      else if (usernameState.checked === normalizeUsername(form.username) && usernameState.available === false) next.username = 'This username is already taken.';
      if (!EMAIL.test(form.email.trim())) next.email = 'Enter a valid email address.';
      if (form.password.length < 8) next.password = 'Password must be at least 8 characters.';
      if (form.password !== form.confirmPassword) next.confirmPassword = 'Passwords do not match.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = async () => {
    if (!validateStep() || (step === 3 && !canContinue)) return;
    if (step === 2 && !registrationSessionId) {
      setLoading(true);
      try {
        const result = await createRegistrationSession({
          role: form.role, firstName: form.firstName.trim(), lastName: form.lastName.trim(),
          phone: `+63${form.phone}`, barangay: form.barangay, address: form.address.trim(),
        });
        setRegistrationSessionId(result.registrationSessionId);
        setSecurityPolicy(result.securityPolicy || { faceVerificationRequired: true, emailOtpRequired: true });
        setFaceVerification(result.securityPolicy?.faceVerificationRequired === false
          ? { required: false, status: 'not_required', duplicateCheck: 'not_required' }
          : { required: true, status: 'unverified', duplicateCheck: 'unknown' });
        if (result.securityPolicy?.faceVerificationRequired === false) {
          setStep(4);
          setErrors({});
          return;
        }
      } catch (error) {
        setNotice({ title: 'Could not start verification', message: error.message });
        return;
      } finally { setLoading(false); }
    }
    const nextStep = Math.min(4, step + 1);
    setStep(nextStep);
    setErrors({});
  };

  const back = () => {
    if (loading) return;
    if (step === 1) router.replace('/login');
    else if (step === 4 && !securityPolicy.faceVerificationRequired) setStep(2);
    else setStep((current) => current - 1);
  };

  const submit = async () => {
    if (!validateStep(4) || loading || submitting.current || retrySeconds > 0) return;
    submitting.current = true;
    setLoading(true);
    try {
      if (!registrationSessionId || (securityPolicy.faceVerificationRequired && !isTrustedRegistrationFaceVerification(faceVerification))) {
        setNotice({ title: 'Identity verification required', message: 'Complete identity verification before continuing.' });
        return;
      }
      if (!termsAccepted) {
        setErrors((current) => ({ ...current, terms: 'Please accept the Terms of Service and Privacy Policy to continue.' }));
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
        router.replace(getRoleHomePath(completed.role));
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
        setUsernameState({ checking: false, available: false, checked: normalizeUsername(form.username) });
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

  const titles = [
    ['Create your BlueTap account', "Choose how you'll use BlueTap."],
    ['Personal information', 'Tell us a little about yourself.'],
    ['Verify your identity', 'Help us keep BlueTap accounts secure.'],
    ['Set up your account', 'Choose your login credentials and recovery email.'],
    ['Verify your email', 'Confirm your email address to finish registration.'],
  ];
  const [title, subtitle] = titles[step - 1];

  return (
    <LinearGradient colors={BLUETAP_LOGIN_GRADIENT} style={styles.screen}>
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
            <View style={[styles.card, step === 3 && styles.identityCard, step === 3 && mobile && styles.identityCardMobile]}>
              <RegistrationStepper
                currentStep={step}
                completedSteps={[
                  accountComplete && 1,
                  personalComplete && !!registrationSessionId && 2,
                  identityComplete && 3,
                  credentialsComplete && 4,
                ].filter(Boolean)}
                onStepPress={openStep}
                disabled={loading}
              />
              {mobile && <Text style={styles.stepText}>Step {step} of 5 · {STEPS[step - 1]}</Text>}
              <RegistrationHeading title={step === 3 ? 'Verify your identity' : title} subtitle={step === 3 ? 'Complete a quick face check to help protect your account and prevent duplicate registrations.' : subtitle} />

              {step === 1 && <View style={styles.roleList}>
                {[
                  ['requester', '💧', 'Requester', 'Order water from your water provider.'],
                  ['distributor', '🚚', 'Distributor', 'Receive and manage customer water requests for your station.'],
                ].map(([value, icon, name, description]) => <TouchableOpacity key={value} style={[styles.roleCard, form.role === value && styles.roleCardSelected]} onPress={() => update('role', value)} accessibilityRole="radio" accessibilityState={{ checked: form.role === value }}>
                  <Text style={styles.roleIcon}>{icon}</Text><View style={styles.roleCopy}><Text style={styles.roleTitle}>{name}</Text><Text style={styles.roleDescription}>{description}</Text></View><View style={[styles.radio, form.role === value && styles.radioSelected]} />
                </TouchableOpacity>)}
                {!!errors.role && <Text style={styles.error}>{errors.role}</Text>}
              </View>}

              {step === 2 && <View>
                <View style={!mobile && styles.row}>
                  <View style={!mobile && styles.half}><Field label="First name" error={errors.firstName}><TextInput style={[styles.input, errors.firstName && styles.inputError]} value={form.firstName} onChangeText={(v) => update('firstName', v)} autoComplete="given-name" /></Field></View>
                  <View style={!mobile && styles.half}><Field label="Last name" error={errors.lastName}><TextInput style={[styles.input, errors.lastName && styles.inputError]} value={form.lastName} onChangeText={(v) => update('lastName', v)} autoComplete="family-name" /></Field></View>
                </View>
                <Field label="Phone number" error={errors.phone}><View style={[styles.phone, errors.phone && styles.inputError]}><Text style={styles.prefix}>+63</Text><TextInput style={styles.phoneInput} value={form.phone} onChangeText={(v) => update('phone', normalizePhone(v))} keyboardType="phone-pad" maxLength={10} accessibilityLabel="Philippine mobile number" /></View></Field>
                <Field label="Barangay" error={errors.barangay}><TouchableOpacity style={[styles.input, styles.select, errors.barangay && styles.inputError]} onPress={() => setShowBarangays((v) => !v)}><Text style={form.barangay ? styles.inputText : styles.placeholder}>{form.barangay || 'Select barangay'}</Text><Text>⌄</Text></TouchableOpacity></Field>
                {showBarangays && <ScrollView style={styles.dropdown} nestedScrollEnabled>{BARANGAYS.map((item) => <TouchableOpacity key={item} style={styles.option} onPress={() => { update('barangay', item); setShowBarangays(false); }}><Text style={styles.inputText}>{item}</Text></TouchableOpacity>)}</ScrollView>}
                <Field label="Address" error={errors.address}><TextInput style={[styles.input, errors.address && styles.inputError]} value={form.address} onChangeText={(v) => update('address', v)} placeholder="Street, sitio, or house number" placeholderTextColor="#94A3B8" /></Field>
              </View>}

              {step === 3 && accountComplete && personalComplete && !!registrationSessionId && <RegistrationFaceCapture
                key={registrationSessionId}
                registrationSessionId={registrationSessionId}
                verification={faceVerification}
                onResult={setFaceVerification}
              />}

              {step === 4 && <View>
                <Field label="Username" error={errors.username} hint={usernameState.checking ? 'Checking availability…' : usernameState.available === true ? 'Username is available.' : '4–20 characters; letters, numbers, and underscores.'}>
                  <TextInput style={[styles.input, errors.username && styles.inputError, usernameState.available === true && styles.inputSuccess]} value={form.username} onChangeText={(v) => update('username', v.replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false} maxLength={20} />
                </Field>
                <Field label="Recovery email" error={errors.email}><TextInput style={[styles.input, errors.email && styles.inputError]} value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
                <Field label="Password" error={errors.password} hint="Use at least 8 characters."><View style={[styles.password, errors.password && styles.inputError]}><TextInput style={styles.passwordInput} value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry={!showPassword} autoCapitalize="none" /><TouchableOpacity onPress={() => setShowPassword((v) => !v)}><Text style={styles.show}>{showPassword ? 'Hide' : 'Show'}</Text></TouchableOpacity></View></Field>
                <Field label="Confirm password" error={errors.confirmPassword}><TextInput style={[styles.input, errors.confirmPassword && styles.inputError]} value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry={!showPassword} autoCapitalize="none" /></Field>
                <View style={styles.termsRow}>
                  <TouchableOpacity style={styles.checkboxTouch} onPress={() => { setTermsAccepted((value) => !value); setErrors((current) => ({ ...current, terms: '' })); }} accessibilityRole="checkbox" accessibilityState={{ checked: termsAccepted }}>
                    <View style={[styles.checkboxBox, termsAccepted && styles.checkboxTouchChecked]}><Text style={styles.checkboxMark}>{termsAccepted ? '✓' : ''}</Text></View>
                  </TouchableOpacity>
                  <Text style={styles.termsText}>I agree to the BlueTap <Text style={styles.termsLink} onPress={() => router.push('/terms')}>Terms of Service</Text> and <Text style={styles.termsLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>.</Text>
                </View>
                {!!errors.terms && <Text style={styles.error}>{errors.terms}</Text>}
                {!termsAccepted && <Text style={styles.termsRequired}>Terms acceptance is required to continue.</Text>}
              </View>}

              {step === 5 && <View style={styles.verifyPreview}><Text style={styles.verifyPreviewText}>Email verification becomes available only after BlueTap accepts the completed Credentials step and sends a secure verification code.</Text></View>}

              <RegistrationActions
                stacked={mobile}
                showBack={step !== 1}
                onBack={back}
                onPrimary={advanceOrGuide}
                loading={loading}
                primaryDisabled={retrySeconds > 0 || (!prerequisiteNotice && step !== 5 && !canContinue)}
                primaryLabel={retrySeconds > 0
                  ? `Try again in ${Math.floor(retrySeconds / 60)}:${String(retrySeconds % 60).padStart(2, '0')}`
                  : step === 5 ? 'Continue' : 'Next'}
              />
              <Text style={styles.loginPrompt}>Already have an account? <Text style={styles.loginLink} onPress={() => router.replace('/login')}>Log in.</Text></Text>
            </View>
          </Animated.View>
        </ScrollView>
        <Modal visible={!!notice} transparent animationType="fade"><View style={styles.modalBg}><View style={styles.modal}><RegistrationNotice tone={notice?.tone || 'error'} title={notice?.title} message={notice?.message} /><TouchableOpacity style={styles.primary} onPress={() => setNotice(null)}><Text style={styles.primaryText}>OK</Text></TouchableOpacity></View></View></Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  identityCard: { borderRadius: 20, padding: 24, shadowOpacity: 0.16, shadowRadius: 16 },
  identityCardMobile: { padding: 16 },
  verifyPreview: { borderWidth: 1, borderColor: '#D8E5EF', backgroundColor: '#F7FAFC', borderRadius: 12, padding: 18 },
  verifyPreviewText: { color: '#526E84', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  screen: { flex: 1 }, safe: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }, shell: { width: '100%' },
  card: { backgroundColor: '#FFF', borderRadius: 24, padding: 26, shadowColor: '#07518E', shadowOpacity: .24, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  stepText: { color: BLUETAP_COLORS.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: -12, marginBottom: 12 },
  roleList: { gap: 12 }, roleCard: { flexDirection: 'row', alignItems: 'center', minHeight: 94, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#D8E5EF', backgroundColor: '#FAFCFE' }, roleCardSelected: { borderColor: BLUETAP_COLORS.primary, backgroundColor: '#EDF7FF' }, roleIcon: { fontSize: 28, marginRight: 14 }, roleCopy: { flex: 1 }, roleTitle: { color: '#17324D', fontSize: 16, fontWeight: '800' }, roleDescription: { color: '#607A90', fontSize: 13, lineHeight: 18, marginTop: 3 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#A8BCCB' }, radioSelected: { borderWidth: 5, borderColor: BLUETAP_COLORS.primary },
  row: { flexDirection: 'row', gap: 12 }, half: { flex: 1 }, field: { marginBottom: 15 }, label: { color: '#29465F', fontSize: 13, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE', paddingHorizontal: 14, color: '#17324D', fontSize: 15 }, inputError: { borderColor: '#DC5757', backgroundColor: '#FFF8F8' }, inputSuccess: { borderColor: '#36A269' }, error: { color: '#B93A3A', fontSize: 12, marginTop: 5 }, hint: { color: '#68839A', fontSize: 12, marginTop: 5 },
  phone: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, prefix: { paddingHorizontal: 14, color: '#17324D', fontWeight: '700', borderRightWidth: 1, borderRightColor: '#D8E5EF' }, phoneInput: { flex: 1, minHeight: 48, paddingHorizontal: 12, color: '#17324D', fontSize: 15 }, select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inputText: { color: '#17324D', fontSize: 15 }, placeholder: { color: '#94A3B8', fontSize: 15 }, dropdown: { maxHeight: 170, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, marginTop: -10, marginBottom: 15 }, option: { padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8E5EF' },
  identityBox: { alignItems: 'center' }, faceIcon: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#E8F5FF', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, faceIconText: { color: BLUETAP_COLORS.primary, fontSize: 48 }, identityTitle: { color: '#17324D', fontSize: 17, fontWeight: '800', textAlign: 'center' }, identityText: { color: '#607A90', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 9 }, privacy: { backgroundColor: '#F1F7FB', padding: 13, borderRadius: 10, marginTop: 16 }, privacyText: { color: '#47667E', fontSize: 12, lineHeight: 18 }, status: { flexDirection: 'row', alignItems: 'center', marginTop: 14 }, successMark: { color: '#238A57', fontSize: 18, fontWeight: '900', marginRight: 7 }, reviewDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C47A13', marginRight: 7 }, faceMessage: { color: '#A34B23', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 14 }, faceSuccess: { color: '#238A57', fontSize: 13, fontWeight: '700' }, faceReview: { color: '#A5650B', fontSize: 13, fontWeight: '700' },
  faceButton: { width: '100%', minHeight: 48, marginTop: 16, borderRadius: 11, borderWidth: 1, borderColor: '#9AC7E8', alignItems: 'center', justifyContent: 'center' }, faceButtonText: { color: BLUETAP_COLORS.primary, fontSize: 14, fontWeight: '700' },
  password: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, passwordInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: '#17324D', fontSize: 15 }, show: { color: BLUETAP_COLORS.primary, fontWeight: '700', padding: 13 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 44, marginTop: 2 }, checkboxTouch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 2, marginTop: -8 }, checkboxBox: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: '#91ABC0', alignItems: 'center', justifyContent: 'center' }, checkboxTouchChecked: { backgroundColor: BLUETAP_COLORS.primary, borderColor: BLUETAP_COLORS.primary }, checkboxMark: { color: '#FFF', fontWeight: '900' }, termsText: { flex: 1, color: '#526E84', fontSize: 13, lineHeight: 20 }, termsLink: { color: BLUETAP_COLORS.primary, fontWeight: '800' }, termsRequired: { color: '#7A5C24', fontSize: 12, marginTop: 4 },
  primary: { flex: 1, minHeight: 50, borderRadius: 11, paddingHorizontal: 18, backgroundColor: BLUETAP_COLORS.primary, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' }, loginPrompt: { textAlign: 'center', color: '#6B8498', fontSize: 13, marginTop: 20 }, loginLink: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.5)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modal: { width: '100%', maxWidth: 420, backgroundColor: '#FFF', borderRadius: 20, padding: 24 },
});
