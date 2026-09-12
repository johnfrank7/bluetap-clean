import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { signOutAndClearSessions } from '../services/authSession';

const links = [
  ['Dashboard', '/admin/dashboard'],
  ['Registration Security', '/admin/registration-security'],
];

export default function AdminShell({ title, subtitle, children }) {
  const router = useRouter();
  const logout = async () => { await signOutAndClearSessions(); router.replace('/login'); };
  return <SafeAreaView style={styles.root}>
    <View style={styles.sidebar}>
      <Text style={styles.brand}>BlueTap Administrator</Text>
      {links.map(([label, path]) => <TouchableOpacity key={path} style={styles.link} onPress={() => router.replace(path)}><Text style={styles.linkText}>{label}</Text></TouchableOpacity>)}
      <TouchableOpacity style={styles.logout} onPress={logout}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
    </View>
    <View style={styles.main}><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>{children}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: '#F4F9FD' },
  sidebar: { width: 240, padding: 24, backgroundColor: '#123451' },
  brand: { color: '#FFF', fontSize: 20, fontWeight: '800', marginBottom: 28 },
  link: { paddingVertical: 13 }, linkText: { color: '#DCEEFF', fontWeight: '700' },
  logout: { marginTop: 'auto', paddingVertical: 13 }, logoutText: { color: '#FFBBC0', fontWeight: '700' },
  main: { flex: 1, padding: 32 }, title: { fontSize: 30, fontWeight: '900', color: '#16334C' },
  subtitle: { color: '#66839B', marginTop: 6, marginBottom: 24 },
});
