import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { clearAllAuthSessions, signOutAndClearSessions } from '../services/authSession';
import { completeRequiredPasswordChange } from '../services/requiredPasswordChange';

export default function RequiredPasswordChangePage() {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) router.replace('/login');
    else setReady(true);
  }), [router]);

  const submit = async () => {
    if (saving) return;
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setSaving(true); setError('');
    try {
      await completeRequiredPasswordChange(password);
      clearAllAuthSessions();
      await signOutAndClearSessions();
      router.replace('/login?passwordChanged=true');
    } catch (submitError) {
      setError(submitError.message || 'The password could not be changed.');
    } finally { setSaving(false); }
  };

  if (!ready) return <View style={styles.screen}><ActivityIndicator color="#187BCD" size="large" /></View>;
  return <View style={styles.screen}><View style={styles.card}>
    <Text style={styles.eyebrow}>BLUETAP ADMIN SECURITY</Text>
    <Text style={styles.title}>Create a new password</Text>
    <Text style={styles.help}>Your temporary Admin password must be replaced before you can access BlueTap administration.</Text>
    <Text style={styles.label}>New password</Text>
    <TextInput secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} style={styles.input} placeholder="Enter a new password" />
    <Text style={styles.hint}>Use at least 12 characters with uppercase, lowercase, and a number.</Text>
    <Text style={styles.label}>Confirm new password</Text>
    <TextInput secureTextEntry autoCapitalize="none" value={confirmPassword} onChangeText={setConfirmPassword} style={styles.input} placeholder="Re-enter the new password" />
    {!!error && <Text style={styles.error}>{error}</Text>}
    <TouchableOpacity disabled={saving} onPress={submit} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Changing password...' : 'Change password'}</Text></TouchableOpacity>
    <TouchableOpacity disabled={saving} onPress={async () => { await signOutAndClearSessions(); router.replace('/login'); }} style={styles.signOut}><Text style={styles.signOutText}>Back to Login</Text></TouchableOpacity>
  </View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#EAF5FD', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 480, backgroundColor: '#FFF', borderRadius: 20, padding: 26, borderWidth: 1, borderColor: '#CDE3F2' },
  eyebrow: { color: '#187BCD', fontSize: 12, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  title: { color: '#17324D', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  help: { color: '#58758B', lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 20 },
  label: { color: '#294C66', fontSize: 13, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#B8D3E6', borderRadius: 10, paddingHorizontal: 13, color: '#17324D', backgroundColor: '#FAFCFE' },
  hint: { color: '#6A8498', fontSize: 12, lineHeight: 17, marginTop: 6 },
  error: { color: '#B52F2F', backgroundColor: '#FCE9E8', borderRadius: 8, padding: 10, marginTop: 14 },
  button: { minHeight: 48, backgroundColor: '#187BCD', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.6 },
  signOut: { alignItems: 'center', marginTop: 16 }, signOutText: { color: '#187BCD', fontWeight: '700' },
});
