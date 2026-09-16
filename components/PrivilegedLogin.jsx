import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { getDocFromServer, doc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { auth, db } from '../firebase';
import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { cacheValidatedPrivilegedAccess, clearAllAuthSessions, saveRoleSession } from '../services/authSession';
import { getManagerContext } from '../services/managerAccess';
import { loginWithUsername } from '../services/usernameAuth';
import { warmLoginBackend } from '../services/apiWarmup';

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

const logPrivilegedStage = (admin, stage, details = {}) => {
  console.info('[privileged-login]', {
    stage: `${admin ? 'ADMIN' : 'MANAGER'}_${stage}`,
    ...details,
  });
};

const safeAccessMessage = (admin, code) => {
  if (code === 'ADMIN_PROFILE_READ_DENIED' || code === 'ADMIN_PROFILE_MISSING') {
    return 'Administrator profile could not be verified. Please contact support.';
  }
  if (code === 'MANAGER_PROFILE_READ_DENIED' || code === 'MANAGER_PROFILE_MISSING') {
    return 'Manager profile could not be verified. Please contact support.';
  }
  if (code === 'ADMIN_TOKEN_REFRESH_FAILED' || code === 'MANAGER_TOKEN_REFRESH_FAILED') {
    return 'Your secure sign-in session could not be refreshed. Please sign in again.';
  }
  return admin ? 'Administrator access required.' : 'Manager access required.';
};

const safeSignInMessage = (admin, code) => {
  if (code === 'auth/user-disabled') return 'This account is disabled. Please contact support.';
  if (code === 'auth/network-request-failed') return 'Unable to reach the sign-in service. Check your connection and try again.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Please wait and try again.';
  if (code === 'auth/quota-exceeded') return 'Authentication is temporarily rate-limited. Please wait and try again.';
  return admin ? 'Invalid credentials or Administrator access required.' : 'Invalid credentials or Manager access required.';
};

export default function PrivilegedLogin({ role }) {
  const router = useRouter();
  const routerRef = React.useRef(router);
  routerRef.current = router;
  const params = useLocalSearchParams();
  const currentPathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const admin = role === 'admin';
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
    logPrivilegedStage(admin, 'NAVIGATION_ROUTER_READY', { currentPathname });
    navigationCompletedRef.current = true;
    try {
      routerRef.current.replace(pendingDestination);
      logPrivilegedStage(admin, 'NAVIGATION_EXECUTED', { currentPathname });
    } catch {
      navigationCompletedRef.current = false;
      logPrivilegedStage(admin, 'NAVIGATION_FAILED', { currentPathname });
      setError('Navigation could not complete. Try opening your dashboard again.');
    }
  }, [admin, currentPathname, pendingDestination, rootNavigationState?.key, navigationAttempt]);

  React.useEffect(() => { warmLoginBackend(); }, []);

  const finishAuthenticatedLogin = React.useCallback(async (user) => {
    if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) {
      throw accessError(admin ? 'ADMIN_AUTH_SESSION_MISSING' : 'MANAGER_AUTH_SESSION_MISSING');
    }

    // Install a fresh token before Firestore evaluates request.auth. Running
    // this concurrently with the profile read can make a newly bootstrapped
    // account appear unauthenticated or omit its new privileged claim.
    let token;
    try {
      logPrivilegedStage(admin, 'TOKEN_REFRESH_STARTED');
      // getIdTokenResult(true) performs one forced refresh and returns the
      // claims from that same token. Avoid back-to-back refresh requests.
      token = await user.getIdTokenResult(true);
    } catch (refreshError) {
      const firebaseCode = safeFirebaseAuthCode(refreshError, 'auth/token-refresh-failed');
      logPrivilegedStage(admin, 'TOKEN_REFRESH_FAILED', { firebaseCode });
      throw accessError(admin ? 'ADMIN_TOKEN_REFRESH_FAILED' : 'MANAGER_TOKEN_REFRESH_FAILED', {
        firebaseCode,
      });
    }
    logPrivilegedStage(admin, 'CLAIM_CHECK_STARTED');
    const hasClaim = admin
      ? token.claims?.admin === true || token.claims?.role === 'admin'
      : token.claims?.manager === true || token.claims?.role === 'manager';
    if (!hasClaim) {
      logPrivilegedStage(admin, 'CLAIM_MISSING');
      throw accessError(admin ? 'ADMIN_CLAIM_MISSING' : 'MANAGER_CLAIM_MISSING');
    }

    let profileSnapshot;
    try {
      logPrivilegedStage(admin, 'PROFILE_CHECK_STARTED');
      profileSnapshot = await getDocFromServer(doc(db, 'users', user.uid));
    } catch (profileError) {
      logPrivilegedStage(admin, 'PROFILE_CHECK_FAILED', {
        firebaseCode: safeFirebaseAuthCode(profileError, 'firestore/profile-read-failed'),
      });
      throw accessError(admin ? 'ADMIN_PROFILE_READ_DENIED' : 'MANAGER_PROFILE_READ_DENIED');
    }
    if (!profileSnapshot.exists()) throw accessError(admin ? 'ADMIN_PROFILE_MISSING' : 'MANAGER_PROFILE_MISSING');

    const profile = { uid: user.uid, ...profileSnapshot.data() };
    if (profile.role !== role || !hasTrustedRole(role, token.claims, profile)) {
      throw accessError(admin ? 'ADMIN_ROLE_MISMATCH' : 'MANAGER_ROLE_MISMATCH');
    }
    if (profile.mustChangePassword === true) {
      completePrivilegedLoginValidation(role, user.uid);
      clearAllAuthSessions();
      routerRef.current.replace('/required-password-change');
      return;
    }

    let trustedProfile = profile;
    if (!admin) {
      const context = await getManagerContext();
      trustedProfile = { ...profile, ...context.manager, branch: context.branch, branchName: context.branch?.name || '' };
    }
    cacheValidatedPrivilegedAccess(trustedProfile);
    saveRoleSession(trustedProfile);
    completePrivilegedLoginValidation(role, user.uid);
    logPrivilegedStage(admin, 'ACCESS_GRANTED');
    if (admin) {
      logPrivilegedStage(admin, 'NAVIGATION_REQUESTED', { currentPathname: pathnameRef.current });
      setPendingDestination('/admin/dashboard');
    } else {
      routerRef.current.replace('/manager/dashboard');
    }
  }, [admin, role]);

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
      ? safeSignInMessage(admin, 'auth/quota-exceeded')
      : code === 'BRANCH_INACTIVE'
      ? loginError.message
      : /^(ADMIN|MANAGER)_/.test(code)
        ? safeAccessMessage(admin, code)
        : safeSignInMessage(admin, safeFirebaseAuthCode(loginError, 'auth/invalid-credential')));
  }, [admin, role]);

  React.useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active || !shouldValidateExistingSession(role, user, submitting.current)) return;
      setLoading(true);
      setError('');
      logPrivilegedStage(admin, 'VALIDATION_CALLED_FROM_AUTH_LISTENER');
      try {
        await runPrivilegedLoginValidation(role, user, () => finishAuthenticatedLogin(user));
      }
      catch (loginError) { if (active) await rejectLogin(loginError); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; unsubscribe(); };
  }, [admin, finishAuthenticatedLogin, rejectLogin, role]);

  const submit = async () => {
    if (loading || submitting.current || pendingDestination) return;
    if (!identifier.trim() || !password) return setError('Enter your username or email and password.');
    submitting.current = true;
    resetPrivilegedLoginValidation(role);
    setLoading(true); setError('');
    try {
      const normalized = identifier.trim().toLowerCase();
      logPrivilegedStage(admin, 'SIGNIN_STARTED');

      // A public, Manager, or revoked Admin session may still be persisted in
      // this shared Firebase Auth instance. End it before authenticating so
      // every subsequent token operation belongs to this submission's user.
      clearAllAuthSessions();
      if (auth.currentUser) {
        try {
          await signOut(auth);
        } catch (staleSessionError) {
          logPrivilegedStage(admin, 'STALE_SESSION_CLEAR_FAILED', {
            firebaseCode: safeFirebaseAuthCode(staleSessionError),
          });
        }
      }

      const credential = normalized.includes('@')
        ? await signInWithEmailAndPassword(auth, normalized, password)
        : await signInWithCustomToken(auth, await loginWithUsername(normalized, password, { portal: role }));
      logPrivilegedStage(admin, 'SIGNIN_SUCCESS');
      logPrivilegedStage(admin, 'VALIDATION_CALLED_FROM_LOGIN');
      await runPrivilegedLoginValidation(role, credential.user, () => finishAuthenticatedLogin(credential.user));
    } catch (loginError) {
      if (!/^(ADMIN|MANAGER)_/.test(String(loginError?.code || ''))) {
        logPrivilegedStage(admin, 'SIGNIN_FAILED', {
          firebaseCode: safeFirebaseAuthCode(loginError, 'auth/invalid-credential'),
        });
      }
      await rejectLogin(loginError);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return <LinearGradient colors={BLUETAP_LOGIN_GRADIENT} style={styles.screen}><View style={styles.card}>
    <Image source={require('../assets/icons/bluetaplogo.png')} style={styles.logo} resizeMode="contain" />
    <Text style={styles.title}>{admin ? 'BlueTap Administrator' : 'BlueTap Manager'}</Text>
    <Text style={styles.subtitle}>{admin ? 'Authorized personnel only' : 'Branch operations access'}</Text>
    <Text style={styles.label}>Username or email</Text>
    <TextInput value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} style={styles.input} onSubmitEditing={submit} />
    <Text style={styles.label}>Password</Text>
    <View style={styles.passwordField}>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" style={styles.passwordInput} onSubmitEditing={submit} />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword((visible) => !visible)} style={styles.visibilityButton}>
        <Text style={styles.visibilityText}>{showPassword ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
    </View>
    {admin && params.passwordChanged === 'true' && !error && <Text style={styles.success}>Password changed successfully. Sign in with your new password.</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <TouchableOpacity disabled={loading || (!!pendingDestination && !error)} onPress={pendingDestination ? retryNavigation : submit} style={[styles.button, loading && styles.disabled]}>{loading || (pendingDestination && !error) ? <View style={styles.loadingContent}><ActivityIndicator color="#FFF" size="small" /><Text style={styles.buttonText}>{pendingDestination ? 'Opening dashboard...' : admin ? 'Verifying administrator access...' : 'Verifying Manager access...'}</Text></View> : <Text style={styles.buttonText}>{pendingDestination ? 'Open dashboard' : admin ? 'Sign in as Administrator' : 'Sign in as Manager'}</Text>}</TouchableOpacity>
    <TouchableOpacity disabled={loading} onPress={() => router.replace('/login')} style={styles.back}><Text style={styles.backText}>Back to public login</Text></TouchableOpacity>
  </View></LinearGradient>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 430, borderRadius: 22, padding: 26, backgroundColor: '#FFF', shadowColor: '#063B65', shadowOpacity: .22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  logo: { width: 72, height: 72, alignSelf: 'center' },
  title: { color: '#17324D', fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  subtitle: { color: '#607A90', fontSize: 14, textAlign: 'center', marginTop: 5, marginBottom: 20 },
  label: { color: '#294C66', fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  input: { minHeight: 49, borderWidth: 1, borderColor: '#BDD5E6', backgroundColor: '#FAFCFE', borderRadius: 10, paddingHorizontal: 13, color: '#17324D' },
  passwordField: { minHeight: 49, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#BDD5E6', backgroundColor: '#FAFCFE', borderRadius: 10 },
  passwordInput: { flex: 1, minWidth: 0, minHeight: 47, paddingHorizontal: 13, color: '#17324D' },
  visibilityButton: { minWidth: 60, minHeight: 47, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  visibilityText: { color: '#187BCD', fontSize: 13, fontWeight: '800' },
  success: { color: '#167347', backgroundColor: '#E3F7EC', borderRadius: 8, padding: 10, marginTop: 14, textAlign: 'center' },
  error: { color: '#A72C25', backgroundColor: '#FFF1F0', borderRadius: 8, padding: 10, marginTop: 14, textAlign: 'center' },
  button: { minHeight: 50, borderRadius: 10, backgroundColor: '#187BCD', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  loadingContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' }, disabled: { opacity: .65 },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, backText: { color: '#187BCD', fontWeight: '700' },
});
