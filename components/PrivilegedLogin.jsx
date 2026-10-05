import React from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { getDocFromServer, doc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { auth, db } from '../firebase';
import { cacheValidatedPrivilegedAccess, clearAllAuthSessions, saveRoleSession } from '../services/authSession';
import { loginWithUsername } from '../services/usernameAuth';
import { warmLoginBackend } from '../services/apiWarmup';
import PasswordVisibilityButton from './PasswordVisibilityButton';
import PageEnterTransition from './PageEnterTransition';
import BlueTapBrandMark from './BlueTapBrandMark';

const { hasTrustedRole } = require('../services/privilegedAccess');
const {
  completePrivilegedLoginValidation,
  resetPrivilegedLoginValidation,
  runPrivilegedLoginValidation,
  shouldValidateExistingSession,
} = require('../services/privilegedLoginCoordinator');

const accessError = (code, details = {}) => Object.assign(new Error(code), { code, ...details });

const safeFirebaseAuthCode = (error, fallback = 'auth/internal-error') => {
  const code = String(error?.code || '');
  return code.startsWith('auth/') ? code : fallback;
};

const logPrivilegedStage = (stage, details = {}) => {
  console.info('[privileged-login]', {
    stage: `ADMIN_${stage}`,
    ...details,
  });
};

const safeAccessMessage = (code) => {
  if (code === 'ADMIN_PROFILE_READ_DENIED' || code === 'ADMIN_PROFILE_MISSING') {
    return 'Administrator profile could not be verified. Please contact support.';
  }
  if (code === 'ADMIN_TOKEN_REFRESH_FAILED') {
    return 'Your secure sign-in session could not be refreshed. Please sign in again.';
  }
  return 'Administrator access required.';
};

const safeSignInMessage = (code, error) => {
  if (code === 'auth/user-disabled' || error?.code === 'ACCOUNT_DISABLED') return 'This account is disabled. Please contact support.';
  if (code === 'auth/network-request-failed' || error?.code === 'NETWORK_ERROR') return 'Unable to reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/too-many-requests' || code === 'LOGIN_RATE_LIMITED' || code === 'username/LOGIN_RATE_LIMITED' || error?.code === 'LOGIN_RATE_LIMITED' || error?.reason === 'too-many-attempts') {
    if (error?.retryAfterSeconds) {
      const total = Math.max(1, Math.round(Number(error.retryAfterSeconds)));
      if (total >= 60) {
        const mins = Math.ceil(total / 60);
        return `Too many login attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
      }
      return `Too many login attempts. Try again in ${total} second${total === 1 ? '' : 's'}.`;
    }
    return 'Too many sign-in attempts. Please wait and try again.';
  }
  if (code === 'auth/quota-exceeded') return 'Authentication is temporarily rate-limited. Please wait and try again.';
  return 'Invalid credentials or Administrator access required.';
};

export default function PrivilegedLogin() {
  const role = 'admin';
  const router = useRouter();
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const params = useLocalSearchParams();
  const palette = {
    background: '#041C2C', backgroundEnd: '#082F49', surface: '#0E2235', input: '#0A1928',
    border: '#2B4A63', text: '#F5FAFF', secondary: '#9FB4C8', primary: '#70BDF2',
    action: '#1565C0', success: '#34D399', successSoft: '#103B2A', danger: '#FF8A91', dangerSoft: '#48262A',
  };
  const currentPathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const submitting = React.useRef(false);
  const navigationCompletedRef = React.useRef(false);
  const [pendingDestination, setPendingDestination] = React.useState(null);
  const [navigationAttempt, setNavigationAttempt] = React.useState(0);
  const pathnameRef = React.useRef(currentPathname);
  pathnameRef.current = currentPathname;
  const retryNavigation = () => {
    setError('');
    setNavigationAttempt((attempt) => attempt + 1);
  };

  React.useEffect(() => {
    if (!pendingDestination || !rootNavigationState?.key || navigationCompletedRef.current) return;
    logPrivilegedStage('NAVIGATION_ROUTER_READY', { currentPathname });
    navigationCompletedRef.current = true;
    try {
      routerRef.current.replace(pendingDestination);
      logPrivilegedStage('NAVIGATION_EXECUTED', { currentPathname });
    } catch {
      navigationCompletedRef.current = false;
      logPrivilegedStage('NAVIGATION_FAILED', { currentPathname });
      setError('Navigation could not complete. Try opening your dashboard again.');
    }
  }, [currentPathname, pendingDestination, rootNavigationState?.key, navigationAttempt]);

  React.useEffect(() => { warmLoginBackend(); }, []);

  const finishAuthenticatedLogin = React.useCallback(async (user) => {
    if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) {
      throw accessError('ADMIN_AUTH_SESSION_MISSING');
    }

    // Install a fresh token before Firestore evaluates request.auth. Running
    // this concurrently with the profile read can make a newly bootstrapped
    // account appear unauthenticated or omit its new privileged claim.
    let token;
    try {
      logPrivilegedStage('TOKEN_REFRESH_STARTED');
      // getIdTokenResult(true) performs one forced refresh and returns the
      // claims from that same token. Avoid back-to-back refresh requests.
      token = await user.getIdTokenResult(true);
    } catch (refreshError) {
      const firebaseCode = safeFirebaseAuthCode(refreshError, 'auth/token-refresh-failed');
      logPrivilegedStage('TOKEN_REFRESH_FAILED', { firebaseCode });
      throw accessError('ADMIN_TOKEN_REFRESH_FAILED', {
        firebaseCode,
      });
    }
    logPrivilegedStage('CLAIM_CHECK_STARTED');
    const hasClaim = token.claims?.admin === true || token.claims?.role === 'admin';
    if (!hasClaim) {
      logPrivilegedStage('CLAIM_MISSING');
      throw accessError('ADMIN_CLAIM_MISSING');
    }

    let profileSnapshot;
    try {
      logPrivilegedStage('PROFILE_CHECK_STARTED');
      profileSnapshot = await getDocFromServer(doc(db, 'users', user.uid));
    } catch (profileError) {
      logPrivilegedStage('PROFILE_CHECK_FAILED', {
        firebaseCode: safeFirebaseAuthCode(profileError, 'firestore/profile-read-failed'),
      });
      throw accessError('ADMIN_PROFILE_READ_DENIED');
    }
    if (!profileSnapshot.exists()) throw accessError('ADMIN_PROFILE_MISSING');

    const profile = { ...profileSnapshot.data(), uid: user.uid };
    if (profile.role !== role || !hasTrustedRole(role, token.claims, profile)) {
      throw accessError('ADMIN_ROLE_MISMATCH');
    }
    if (profile.mustChangePassword === true) {
      completePrivilegedLoginValidation(role, user.uid);
      clearAllAuthSessions();
      routerRef.current.replace('/required-password-change');
      return;
    }

    cacheValidatedPrivilegedAccess(profile);
    saveRoleSession(profile);
    completePrivilegedLoginValidation(role, user.uid);
    logPrivilegedStage('ACCESS_GRANTED');
    logPrivilegedStage('NAVIGATION_REQUESTED', { currentPathname: pathnameRef.current });
    setPendingDestination('/admin/dashboard');
  }, []);

  const rejectLogin = React.useCallback(async (loginError) => {
    resetPrivilegedLoginValidation(role);
    clearAllAuthSessions();
    try { await signOut(auth); } catch { /* already signed out */ }
    const code = String(loginError?.code || '');
    if (/^(ADMIN|MANAGER)_/.test(code)) {
      console.warn('[privileged-login]', {
        stage: 'ACCESS_VALIDATION_FAILED',
        code,
        ...(code.endsWith('TOKEN_REFRESH_FAILED') ? { firebaseCode: loginError.firebaseCode } : {}),
      });
    }
    setError(code.endsWith('TOKEN_REFRESH_FAILED') && loginError?.firebaseCode === 'auth/quota-exceeded'
      ? safeSignInMessage('auth/quota-exceeded', loginError)
      : code === 'BRANCH_INACTIVE'
      ? loginError.message
      : /^(ADMIN|MANAGER)_/.test(code)
        ? safeAccessMessage(code)
        : safeSignInMessage(safeFirebaseAuthCode(loginError, 'auth/invalid-credential'), loginError));
  }, []);

  React.useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active || !shouldValidateExistingSession(role, user, submitting.current)) return;
      setLoading(true);
      setError('');
      logPrivilegedStage('VALIDATION_CALLED_FROM_AUTH_LISTENER');
      try {
        await runPrivilegedLoginValidation(role, user, () => finishAuthenticatedLogin(user));
      }
      catch (loginError) { if (active) await rejectLogin(loginError); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; unsubscribe(); };
  }, [finishAuthenticatedLogin, rejectLogin]);

  const submit = async () => {
    if (loading || submitting.current || pendingDestination) return;
    if (!identifier.trim() || !password) return setError('Enter your username or email and password.');
    submitting.current = true;
    resetPrivilegedLoginValidation(role);
    setLoading(true); setError('');
    try {
      const normalized = identifier.trim().toLowerCase();
      logPrivilegedStage('SIGNIN_STARTED');

      // A public, Manager, or revoked Admin session may still be persisted in
      // this shared Firebase Auth instance. End it before authenticating so
      // every subsequent token operation belongs to this submission's user.
      clearAllAuthSessions();
      if (auth.currentUser) {
        try {
          await signOut(auth);
        } catch (staleSessionError) {
          logPrivilegedStage('STALE_SESSION_CLEAR_FAILED', {
            firebaseCode: safeFirebaseAuthCode(staleSessionError),
          });
        }
      }

      const credential = normalized.includes('@')
        ? await signInWithEmailAndPassword(auth, normalized, password)
        : await signInWithCustomToken(auth, await loginWithUsername(normalized, password, { portal: role }));
      logPrivilegedStage('SIGNIN_SUCCESS');
      logPrivilegedStage('VALIDATION_CALLED_FROM_LOGIN');
      await runPrivilegedLoginValidation(role, credential.user, () => finishAuthenticatedLogin(credential.user));
    } catch (loginError) {
      if (!/^(ADMIN|MANAGER)_/.test(String(loginError?.code || ''))) {
        logPrivilegedStage('SIGNIN_FAILED', {
          firebaseCode: safeFirebaseAuthCode(loginError, 'auth/invalid-credential'),
        });
      }
      await rejectLogin(loginError);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return <LinearGradient dataSet={{ bluetapTheme: 'dark' }} colors={[palette.background, palette.backgroundEnd]} style={[styles.screen, Platform.OS === 'web' && styles.webViewport]}>
    <SafeAreaView style={styles.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <PageEnterTransition axis="y" distance={8} duration={240} fill={false} scaleFrom={0.99} resetKey="admin-login-dark" style={styles.entry}>
          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: '#F4B942' }]}>
            <BlueTapBrandMark accessibilityLabel="BlueTap Administrator" color={palette.primary} size={72} style={styles.logo} />
            <Text style={[styles.title, { color: palette.text }]}>BlueTap Administrator</Text>
            <Text style={[styles.subtitle, { color: palette.secondary }]}>Authorized personnel only</Text>
            <Text style={[styles.label, { color: palette.text }]}>Username or email</Text>
            <TextInput aria-invalid={Boolean(error)} accessibilityState={{ invalid: Boolean(error) }} value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} keyboardType="default" placeholder="Username or email" placeholderTextColor={palette.secondary} selectionColor={palette.primary} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.text }]} onSubmitEditing={submit} />
            <Text style={[styles.label, { color: palette.text }]}>Password</Text>
            <View aria-invalid={Boolean(error)} dataSet={{ inputSurface: 'true' }} style={[styles.passwordField, { backgroundColor: palette.input, borderColor: palette.border }]}>
              <TextInput aria-invalid={Boolean(error)} accessibilityState={{ invalid: Boolean(error) }} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" placeholder="Password" placeholderTextColor={palette.secondary} selectionColor={palette.primary} style={[styles.passwordInput, { color: palette.text }]} onSubmitEditing={submit} />
              <PasswordVisibilityButton color={palette.primary} visible={showPassword} onPress={() => setShowPassword((visible) => !visible)} />
            </View>
            {params.passwordChanged === 'true' && !error && <Text style={[styles.success, { color: palette.success, backgroundColor: palette.successSoft }]}>Password changed successfully. Sign in with your new password.</Text>}
            {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger, backgroundColor: palette.dangerSoft }]}>{error}</Text>}
            <TouchableOpacity disabled={loading || (!!pendingDestination && !error)} onPress={pendingDestination ? retryNavigation : submit} style={[styles.button, { backgroundColor: palette.action }, loading && styles.disabled]}>{loading || (pendingDestination && !error) ? <View style={styles.loadingContent}><ActivityIndicator color="#FFF" size="small" /><Text style={styles.buttonText}>{pendingDestination ? 'Opening dashboard...' : 'Verifying administrator access...'}</Text></View> : <Text style={styles.buttonText}>{pendingDestination ? 'Open dashboard' : 'Sign in as Administrator'}</Text>}</TouchableOpacity>
            <TouchableOpacity disabled={loading} onPress={() => router.replace('/login')} style={styles.back}><Text style={[styles.backText, { color: palette.primary }]}>Back to public login</Text></TouchableOpacity>
          </View>
        </PageEnterTransition>
      </ScrollView>
    </SafeAreaView>
  </LinearGradient>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  webViewport: { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, height: '100dvh', boxSizing: 'border-box', overflow: 'hidden' },
  safe: { flex: 1, minWidth: 0 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 20, paddingVertical: 24 },
  entry: { width: '100%', maxWidth: 430, marginVertical: 'auto' },
  card: { width: '100%', maxWidth: 430, borderRadius: 22, borderWidth: 1, padding: 26, shadowColor: '#063B65', shadowOpacity: .22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  logo: { width: 72, height: 72, alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  subtitle: { fontSize: 14, textAlign: 'center', marginTop: 5, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  input: { minHeight: 49, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13 },
  passwordField: { minHeight: 49, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10 },
  passwordInput: { flex: 1, minWidth: 0, minHeight: 47, paddingHorizontal: 13 },
  success: { borderRadius: 8, padding: 10, marginTop: 14, textAlign: 'center' },
  error: { borderRadius: 8, padding: 10, marginTop: 14, textAlign: 'center' },
  button: { minHeight: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  loadingContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' }, disabled: { opacity: .65 },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, backText: { fontWeight: '700' },
});
