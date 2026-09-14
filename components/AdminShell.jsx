import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { signOutAndClearSessions } from '../services/authSession';

const links = [
  ['Dashboard', '/admin/dashboard'],
  ['Branches', '/admin/branches'],
  ['Managers', '/admin/managers'],
  ['Registration Security', '/admin/registration-security'],
];

export default function AdminShell({ title, subtitle, children }) {
  const router = useRouter();
  const compact = useWindowDimensions().width < 820;
  const logout = async () => { await signOutAndClearSessions(); router.replace('/login'); };
  return <SafeAreaView style={[styles.root, compact && styles.rootCompact]}>
    <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
      <Text style={styles.brand}>BlueTap Administrator</Text>
      <View style={[styles.nav, compact && styles.navCompact]}>{links.map(([label, path]) => <TouchableOpacity key={path} style={styles.link} onPress={() => router.replace(path)}><Text style={styles.linkText}>{label}</Text></TouchableOpacity>)}</View>
      <TouchableOpacity style={[styles.logout, compact && styles.logoutCompact]} onPress={logout}><Text style={styles.logoutText}>Logout</Text></TouchableOpacity>
    </View>
    <ScrollView style={styles.mainScroll} contentContainerStyle={[styles.main, compact && styles.mainCompact]}><Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text>{children}</ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: '#F4F9FD' },
  rootCompact: { flexDirection: 'column' },
  sidebar: { width: 240, padding: 24, backgroundColor: '#123451' },
  sidebarCompact: { width: '100%', paddingHorizontal: 18, paddingVertical: 14 },
  brand: { color: '#FFF', fontSize: 20, fontWeight: '800', marginBottom: 20 },
  nav: {}, navCompact: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  link: { paddingVertical: 13 }, linkText: { color: '#DCEEFF', fontWeight: '700' },
  logout: { marginTop: 'auto', paddingVertical: 13 }, logoutText: { color: '#FFBBC0', fontWeight: '700' },
  logoutCompact: { position: 'absolute', right: 18, top: 10 },
  mainScroll: { flex: 1 },
  main: { flexGrow: 1, padding: 32 }, mainCompact: { padding: 18 },
  title: { fontSize: 30, fontWeight: '900', color: '#16334C' }, titleCompact: { fontSize: 25 },
  subtitle: { color: '#66839B', marginTop: 6, marginBottom: 24 },
});
