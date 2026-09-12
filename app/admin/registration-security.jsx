import React from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { getRegistrationSecurity, updateRegistrationSecurity } from '../../services/adminRegistrationSecurity';

export default function RegistrationSecurityPage() {
  const [settings, setSettings] = React.useState(null);
  const [message, setMessage] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { getRegistrationSecurity().then(setSettings).catch((error) => setMessage(error.message)); }, []);
  const toggle = (key) => {
    const next = { ...settings, [key]: !settings[key] };
    if (!next.faceVerificationEnabled && !next.emailOtpEnabled) return setMessage('At least one registration verification method must remain enabled.');
    setMessage(''); setSettings(next);
  };
  const save = async () => {
    const next = { ...settings, maxAccountsPerDevice: Number(settings.maxAccountsPerDevice), maxAccountsPerIp: Number(settings.maxAccountsPerIp) };
    if (!next.faceVerificationEnabled && !next.emailOtpEnabled) return setMessage('At least one registration verification method must remain enabled.');
    if (![next.maxAccountsPerDevice, next.maxAccountsPerIp].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) return setMessage('Account limits must be whole numbers from 1 to 20.');
    setSaving(true); setMessage('');
    try { setSettings(await updateRegistrationSecurity(next)); setMessage('Registration security settings saved.'); }
    catch (error) { setMessage(error.message); } finally { setSaving(false); }
  };
  return <AdminShell title="Registration Security" subtitle="Admin-only verification policy and registration abuse controls">
    {!settings ? <ActivityIndicator color="#187BCD" /> : <View style={styles.card}>
      {[['faceVerificationEnabled', 'Face Verification'], ['emailOtpEnabled', 'Email OTP Verification']].map(([key, label]) => <View style={styles.row} key={key}><Text style={styles.label}>{label}</Text><Switch value={settings[key]} onValueChange={() => toggle(key)} /></View>)}
      {[['maxAccountsPerDevice', 'Maximum Accounts Per Device'], ['maxAccountsPerIp', 'Maximum Accounts Per Network/IP']].map(([key, label]) => <View key={key} style={styles.field}><Text style={styles.label}>{label}</Text><TextInput keyboardType="number-pad" value={String(settings[key])} onChangeText={(value) => setSettings({ ...settings, [key]: value })} style={styles.input} /></View>)}
      {!!message && <Text style={styles.message}>{message}</Text>}
      <TouchableOpacity disabled={saving} onPress={save} style={styles.button}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Changes'}</Text></TouchableOpacity>
    </View>}
  </AdminShell>;
}
const styles = StyleSheet.create({ card: { maxWidth: 620, padding: 24, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7ECFF' }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 }, field: { marginTop: 18 }, label: { color: '#20384D', fontWeight: '700' }, input: { marginTop: 8, borderWidth: 1, borderColor: '#BBD7EB', borderRadius: 10, padding: 12 }, message: { color: '#B73737', marginTop: 18 }, button: { backgroundColor: '#187BCD', borderRadius: 10, padding: 14, marginTop: 22, alignItems: 'center' }, buttonText: { color: '#FFF', fontWeight: '800' } });
