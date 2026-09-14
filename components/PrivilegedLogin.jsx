import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getDocFromServer, doc } from 'firebase/firestore';
import { signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';

import { auth, db } from '../firebase';
import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { clearAllAuthSessions, saveRoleSession } from '../services/authSession';
import { getManagerContext } from '../services/managerAccess';
import { loginWithUsername } from '../services/usernameAuth';

const { hasTrustedRole } = require('../services/privilegedAccess');

export default function PrivilegedLogin({ role }) {
  const router = useRouter();
  const params = useLocalSearchParams();
  const admin = role === 'admin';
  const [identifier, setIdentifier] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const submit = async () => {
    if (loading) return;
    if (!identifier.trim() || !password) return setError('Enter your username or email and password.');
    setLoading(true); setError('');
    try {
      const normalized = identifier.trim().toLowerCase();
      const credential = normalized.includes('@')
        ? await signInWithEmailAndPassword(auth, normalized, password)
        : await signInWithCustomToken(auth, await loginWithUsername(normalized, password));
      const [token, profileSnapshot] = await Promise.all([
        credential.user.getIdTokenResult(true),
        getDocFromServer(doc(db, 'users', credential.user.uid)),
      ]);
      const profile = profileSnapshot.exists() ? { uid: credential.user.uid, ...profileSnapshot.data() } : null;
      if (!hasTrustedRole(role, token.claims, profile)) {
        clearAllAuthSessions();
        await signOut(auth);
        setError(admin ? 'Administrator access required.' : 'Manager access required.');
        return;
      }
      if (admin && profile.mustChangePassword === true) {
        clearAllAuthSessions();
        router.replace('/required-password-change');
        return;
      }
      let trustedProfile = profile;
      if (!admin) {
        const context = await getManagerContext();
        trustedProfile = { ...profile, ...context.manager, branch: context.branch, branchName: context.branch?.name || '' };
      }
      saveRoleSession(trustedProfile);
      router.replace(admin ? '/admin/dashboard' : '/manager/dashboard');
    } catch (loginError) {
      clearAllAuthSessions();
      try { await signOut(auth); } catch { /* already signed out */ }
      setError(loginError?.code === 'BRANCH_INACTIVE'
        ? loginError.message
        : admin ? 'Invalid credentials or Administrator access required.' : 'Invalid credentials or Manager access required.');
    } finally { setLoading(false); }
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
    <TouchableOpacity disabled={loading} onPress={submit} style={[styles.button, loading && styles.disabled]}>{loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>{admin ? 'Sign in as Administrator' : 'Sign in as Manager'}</Text>}</TouchableOpacity>
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
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '800' }, disabled: { opacity: .65 },
  back: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, backText: { color: '#187BCD', fontWeight: '700' },
});
