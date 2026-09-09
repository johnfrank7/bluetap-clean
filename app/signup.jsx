import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  ActivityIndicator, Image, Modal, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BLUETAP_COLORS, BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { clearAllAuthSessions } from '../services/authSession';
import { clearPendingRegistration, requestRegistrationOtp, setPendingRegistration } from '../services/emailVerification';
import { checkUsername, normalizeUsername, validateUsername } from '../services/usernameAuth';

const BARANGAYS = ['Awihao', 'Bagakay', 'Bato', 'Biga', 'Bulongan', 'Bunga', 'Cabitoonan', 'Calongcalong', 'Cambang-ug', 'Camp 8', 'Canlumampao', 'Cantabaco', 'Capitan Claudio', 'Carmen', 'Daanglungsod', 'Don Andres Soriano', 'Dumlog', 'Gen. Climaco', 'Ibo', 'Ilihan', 'Juan Climaco, Sr.', 'Landahan', 'Loay', 'Luray II', 'Matab-ang', 'Media Once', 'Pangamihan', 'Poblacion', 'Poog', 'Putingbato', 'Sagay', 'Sam-ang', 'Sangi', 'Santo Niño', 'Subayon', 'Talavera', 'Tubod', 'Tungkay'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^9\d{9}$/;
const STEPS = ['Account', 'Personal', 'Identity', 'Credentials', 'Verify'];

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
  const [now, setNow] = React.useState(Date.now());
  const submitting = React.useRef(false);
  const mobile = width < 600;

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
    if (key === 'username') setUsernameState({ checking: false, available: null, checked: '' });
  };

  React.useEffect(() => {
    if (!retryAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const canContinue = step === 1 ? !!form.role
    : step === 2 ? !!form.firstName.trim() && !!form.lastName.trim() && PHONE.test(form.phone) && !!form.barangay && !!form.address.trim()
      : step === 3 ? true
        : !validateUsername(form.username) && EMAIL.test(form.email.trim()) && form.password.length >= 8 && form.password === form.confirmPassword && usernameState.available !== false;

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

  const next = () => {
    if (!validateStep()) return;
    setStep((current) => Math.min(4, current + 1));
    setErrors({});
  };
  const back = () => {
    if (loading) return;
    if (step === 1) router.replace('/login');
    else setStep((current) => current - 1);
  };

  const submit = async () => {
    if (!validateStep(4) || loading || submitting.current || retrySeconds > 0) return;
    submitting.current = true;
    setLoading(true);
    try {
      const profile = {
        role: form.role,
        firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        phone: `+63${form.phone}`, barangay: form.barangay, address: form.address.trim(),
        username: form.username.trim(), usernameNormalized: normalizeUsername(form.username),
        email: form.email.trim().toLowerCase(), password: form.password,
      };
      clearPendingRegistration();
      const result = await requestRegistrationOtp(profile.email, profile.username);
      setPendingRegistration(profile, result);
      clearAllAuthSessions();
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
    ['Verify your identity', 'BlueTap uses face verification to help protect accounts and prevent duplicate registrations.'],
    ['Set up your account', 'Choose your login credentials and recovery email.'],
  ];
  const [title, subtitle] = titles[step - 1];

  return (
    <LinearGradient colors={BLUETAP_LOGIN_GRADIENT} style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.shell, { maxWidth: mobile ? 520 : 600 }]}>
            <View style={styles.brand}>
              <Image source={require('../assets/icons/bluetapwhitelogo.png')} style={styles.logo} resizeMode="contain" />
              <View><Text style={styles.brandName}>BlueTap</Text><Text style={styles.tagline}>Water Within Reach</Text></View>
            </View>
            <View style={styles.card}>
              <View style={styles.progress}>
                {STEPS.map((name, index) => <View key={name} style={styles.progressItem}>
                  <View style={[styles.progressCircle, index + 1 <= step && styles.progressCircleActive]}><Text style={[styles.progressNumber, index + 1 <= step && styles.progressNumberActive]}>{index + 1}</Text></View>
                  {!mobile && <Text style={[styles.progressLabel, index + 1 === step && styles.progressLabelActive]}>{name}</Text>}
                  {index < STEPS.length - 1 && <View style={[styles.progressLine, index + 1 < step && styles.progressLineActive]} />}
                </View>)}
              </View>
              {mobile && <Text style={styles.stepText}>Step {step} of 5 · {STEPS[step - 1]}</Text>}
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>

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

              {step === 3 && <View style={styles.identityBox}>
                <View style={styles.faceIcon}><Text style={styles.faceIconText}>◎</Text></View>
                <Text style={styles.identityTitle}>Identity verification follows email confirmation</Text>
                <Text style={styles.identityText}>The current face provider requires a securely authenticated account ID. After your email is verified and your account is created, BlueTap will take you directly to the existing identity-verification screen.</Text>
                <View style={styles.privacy}><Text style={styles.privacyText}>🔒 BlueTap does not mark identity verified from this form. Only the trusted verification provider can approve it.</Text></View>
                <View style={styles.status}><View style={styles.statusDot} /><Text style={styles.statusText}>Verification pending until account creation</Text></View>
                <TouchableOpacity style={[styles.faceButton, styles.disabled]} disabled accessibilityRole="button"><Text style={styles.faceButtonText}>Start Face Verification · After Email</Text></TouchableOpacity>
              </View>}

              {step === 4 && <View>
                <Field label="Username" error={errors.username} hint={usernameState.checking ? 'Checking availability…' : usernameState.available === true ? 'Username is available.' : '4–20 characters; letters, numbers, and underscores.'}>
                  <TextInput style={[styles.input, errors.username && styles.inputError, usernameState.available === true && styles.inputSuccess]} value={form.username} onChangeText={(v) => update('username', v.replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false} maxLength={20} />
                </Field>
                <Field label="Recovery email" error={errors.email}><TextInput style={[styles.input, errors.email && styles.inputError]} value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" autoComplete="email" /></Field>
                <Field label="Password" error={errors.password} hint="Use at least 8 characters."><View style={[styles.password, errors.password && styles.inputError]}><TextInput style={styles.passwordInput} value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry={!showPassword} autoCapitalize="none" /><TouchableOpacity onPress={() => setShowPassword((v) => !v)}><Text style={styles.show}>{showPassword ? 'Hide' : 'Show'}</Text></TouchableOpacity></View></Field>
                <Field label="Confirm password" error={errors.confirmPassword}><TextInput style={[styles.input, errors.confirmPassword && styles.inputError]} value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry={!showPassword} autoCapitalize="none" /></Field>
              </View>}

              <View style={styles.actions}>
                <TouchableOpacity style={styles.back} onPress={back} disabled={loading}><Text style={styles.backText}>Back</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primary, (!canContinue || loading || retrySeconds > 0) && styles.disabled]} onPress={step === 4 ? submit : next} disabled={!canContinue || loading || retrySeconds > 0}>
                  {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>{retrySeconds > 0 ? `Try again in ${Math.floor(retrySeconds / 60)}:${String(retrySeconds % 60).padStart(2, '0')}` : step === 4 ? 'Send Verification Code' : 'Continue'}</Text>}
                </TouchableOpacity>
              </View>
              <Text style={styles.loginPrompt}>Already have an account? <Text style={styles.loginLink} onPress={() => router.replace('/login')}>Log in.</Text></Text>
            </View>
          </View>
        </ScrollView>
        <Modal visible={!!notice} transparent animationType="fade"><View style={styles.modalBg}><View style={styles.modal}><Text style={styles.modalTitle}>{notice?.title}</Text><Text style={styles.modalText}>{notice?.message}</Text><TouchableOpacity style={styles.primary} onPress={() => setNotice(null)}><Text style={styles.primaryText}>OK</Text></TouchableOpacity></View></View></Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, safe: { flex: 1 }, scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }, shell: { width: '100%' },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }, logo: { width: 52, height: 52, marginRight: 10 }, brandName: { color: '#FFF', fontSize: 26, fontWeight: '800' }, tagline: { color: 'rgba(255,255,255,.86)', fontSize: 13 },
  card: { backgroundColor: '#FFF', borderRadius: 24, padding: 26, shadowColor: '#07518E', shadowOpacity: .24, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }, progressItem: { flexDirection: 'row', alignItems: 'center' }, progressCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E8F1F8', alignItems: 'center', justifyContent: 'center' }, progressCircleActive: { backgroundColor: BLUETAP_COLORS.primary }, progressNumber: { color: '#68839A', fontSize: 12, fontWeight: '700' }, progressNumberActive: { color: '#FFF' }, progressLabel: { marginLeft: 5, color: '#7890A3', fontSize: 11 }, progressLabelActive: { color: BLUETAP_COLORS.primary, fontWeight: '700' }, progressLine: { width: 12, height: 2, backgroundColor: '#D9E7F1', marginHorizontal: 5 }, progressLineActive: { backgroundColor: BLUETAP_COLORS.primary }, stepText: { color: BLUETAP_COLORS.primary, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  title: { color: '#17324D', fontSize: 25, fontWeight: '800', textAlign: 'center' }, subtitle: { color: '#607A90', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 7, marginBottom: 24 },
  roleList: { gap: 12 }, roleCard: { flexDirection: 'row', alignItems: 'center', minHeight: 94, padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#D8E5EF', backgroundColor: '#FAFCFE' }, roleCardSelected: { borderColor: BLUETAP_COLORS.primary, backgroundColor: '#EDF7FF' }, roleIcon: { fontSize: 28, marginRight: 14 }, roleCopy: { flex: 1 }, roleTitle: { color: '#17324D', fontSize: 16, fontWeight: '800' }, roleDescription: { color: '#607A90', fontSize: 13, lineHeight: 18, marginTop: 3 }, radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#A8BCCB' }, radioSelected: { borderWidth: 5, borderColor: BLUETAP_COLORS.primary },
  row: { flexDirection: 'row', gap: 12 }, half: { flex: 1 }, field: { marginBottom: 15 }, label: { color: '#29465F', fontSize: 13, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE', paddingHorizontal: 14, color: '#17324D', fontSize: 15 }, inputError: { borderColor: '#DC5757', backgroundColor: '#FFF8F8' }, inputSuccess: { borderColor: '#36A269' }, error: { color: '#B93A3A', fontSize: 12, marginTop: 5 }, hint: { color: '#68839A', fontSize: 12, marginTop: 5 },
  phone: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, prefix: { paddingHorizontal: 14, color: '#17324D', fontWeight: '700', borderRightWidth: 1, borderRightColor: '#D8E5EF' }, phoneInput: { flex: 1, minHeight: 48, paddingHorizontal: 12, color: '#17324D', fontSize: 15 }, select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, inputText: { color: '#17324D', fontSize: 15 }, placeholder: { color: '#94A3B8', fontSize: 15 }, dropdown: { maxHeight: 170, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, marginTop: -10, marginBottom: 15 }, option: { padding: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D8E5EF' },
  identityBox: { alignItems: 'center' }, faceIcon: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#E8F5FF', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, faceIconText: { color: BLUETAP_COLORS.primary, fontSize: 48 }, identityTitle: { color: '#17324D', fontSize: 17, fontWeight: '800', textAlign: 'center' }, identityText: { color: '#607A90', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 9 }, privacy: { backgroundColor: '#F1F7FB', padding: 13, borderRadius: 10, marginTop: 16 }, privacyText: { color: '#47667E', fontSize: 12, lineHeight: 18 }, status: { flexDirection: 'row', alignItems: 'center', marginTop: 14 }, statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5A129', marginRight: 7 }, statusText: { color: '#8A651F', fontSize: 12, fontWeight: '700' },
  faceButton: { width: '100%', minHeight: 48, marginTop: 16, borderRadius: 11, borderWidth: 1, borderColor: '#9AC7E8', alignItems: 'center', justifyContent: 'center' }, faceButtonText: { color: BLUETAP_COLORS.primary, fontSize: 14, fontWeight: '700' },
  password: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: '#C8D9E6', borderRadius: 11, backgroundColor: '#FAFCFE' }, passwordInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, color: '#17324D', fontSize: 15 }, show: { color: BLUETAP_COLORS.primary, fontWeight: '700', padding: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 14 }, back: { minHeight: 50, paddingHorizontal: 24, borderWidth: 1, borderColor: '#B9CEDD', borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, backText: { color: '#3D607B', fontSize: 15, fontWeight: '700' }, primary: { flex: 1, minHeight: 50, borderRadius: 11, paddingHorizontal: 18, backgroundColor: BLUETAP_COLORS.primary, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFF', fontSize: 15, fontWeight: '800', textAlign: 'center' }, disabled: { opacity: .55 }, loginPrompt: { textAlign: 'center', color: '#6B8498', fontSize: 13, marginTop: 20 }, loginLink: { color: BLUETAP_COLORS.primary, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,.5)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modal: { width: '100%', maxWidth: 420, backgroundColor: '#FFF', borderRadius: 20, padding: 24 }, modalTitle: { color: '#17324D', fontSize: 19, fontWeight: '800', textAlign: 'center' }, modalText: { color: '#526E84', fontSize: 14, lineHeight: 20, textAlign: 'center', marginVertical: 18 },
});
