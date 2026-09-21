import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';

import { auth } from '../firebase';
import { clearAllAuthSessions, getPostAuthenticationDestination, getRoleLoginPath, saveRoleSession, signOutAndClearSessions } from '../services/authSession';
import { completeRequiredPasswordChange } from '../services/requiredPasswordChange';

export default function RequiredPasswordChangePage() {
  const router = useRouter();
  const passwordChangeFlow = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user && !passwordChangeFlow.current) router.replace('/login');
    else setReady(true);
  }), [router]);

  const submit = async () => {
    if (saving) return;
    if (password !== confirmPassword) return setError('Passwords do not match.');
    passwordChangeFlow.current = true;
    setSaving(true); setError('');
    let completedRole = '';
    try {
      const accountEmail = auth.currentUser?.email || '';
      const completion = await completeRequiredPasswordChange(password);
      completedRole = completion.profile?.role || '';
      clearAllAuthSessions();
      await signOutAndClearSessions();
      try {
        if (!accountEmail) throw new Error('Account email is unavailable.');
        const credential = await signInWithEmailAndPassword(auth, accountEmail, password);
        await credential.user.getIdToken(true);
        const profile = completion.profile;
        if (!profile || profile.mustChangePassword === true) {
          throw new Error('Account profile refresh failed.');
        }
        saveRoleSession(profile);
        router.replace(getPostAuthenticationDestination(profile));
      } catch {
        await signOutAndClearSessions();
        passwordChangeFlow.current = false;
        router.replace(`${getRoleLoginPath(completedRole)}?passwordChanged=true`);
      }
    } catch (submitError) {
      passwordChangeFlow.current = false;
      setError(submitError.message || 'The password could not be changed.');
    } finally { setSaving(false); }
  };

  if (!ready) return <View style={styles.screen}><ActivityIndicator color="#187BCD" size="large" /></View>;
  return <View style={styles.screen}><View style={styles.card}>
    <Text style={styles.eyebrow}>BLUETAP ACCOUNT SECURITY</Text>
    <Text style={styles.title}>Create a new password</Text>
    <Text style={styles.help}>Your temporary password must be replaced before you can access BlueTap.</Text>
    <Text style={styles.label}>New password</Text>
    <View style={styles.passwordField}><TextInput secureTextEntry={!showPassword} autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.passwordInput} placeholder="Enter a new password" /><TouchableOpacity accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide new password' : 'Show new password'} onPress={() => setShowPassword((visible) => !visible)} style={styles.visibilityButton}><Text style={styles.visibilityText}>{showPassword ? 'Hide' : 'Show'}</Text></TouchableOpacity></View>
    <Text style={styles.hint}>Use at least 12 characters with uppercase, lowercase, and a number.</Text>
    <Text style={styles.label}>Confirm new password</Text>
    <View style={styles.passwordField}><TextInput secureTextEntry={!showConfirmation} autoCapitalize="none" value={confirmPassword} onChangeText={setConfirmPassword} style={styles.passwordInput} placeholder="Re-enter the new password" /><TouchableOpacity accessibilityRole="button" accessibilityLabel={showConfirmation ? 'Hide password confirmation' : 'Show password confirmation'} onPress={() => setShowConfirmation((visible) => !visible)} style={styles.visibilityButton}><Text style={styles.visibilityText}>{showConfirmation ? 'Hide' : 'Show'}</Text></TouchableOpacity></View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <TouchableOpacity disabled={saving} onPress={submit} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Changing password...' : 'Change password'}</Text></TouchableOpacity>
    <TouchableOpacity disabled={saving} onPress={async () => { await signOutAndClearSessions(); router.replace('/login'); }} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></TouchableOpacity>
  </View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#EAF5FD', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 480, backgroundColor: '#FFF', borderRadius: 20, padding: 26, borderWidth: 1, borderColor: '#CDE3F2' },
  eyebrow: { color: '#187BCD', fontSize: 12, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  title: { color: '#17324D', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  help: { color: '#58758B', lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  label: { color: '#294C66', fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  passwordField: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#B8D3E6', borderRadius: 10, backgroundColor: '#FAFCFE' },
  passwordInput: { flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 13, color: '#17324D' },
  visibilityButton: { minWidth: 60, minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  visibilityText: { color: '#187BCD', fontSize: 13, fontWeight: '800' },
  hint: { color: '#6A8498', fontSize: 12, lineHeight: 17, marginTop: 6 },
  error: { color: '#B52F2F', backgroundColor: '#FCE9E8', borderRadius: 8, padding: 10, marginTop: 14 },
  button: { minHeight: 48, backgroundColor: '#187BCD', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.6 },
  signOut: { alignItems: 'center', marginTop: 16 }, signOutText: { color: '#187BCD', fontWeight: '700' },
});
