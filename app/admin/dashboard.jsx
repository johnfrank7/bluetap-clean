import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import AdminShell from '../../components/AdminShell';

export default function AdminDashboard() {
  const router = useRouter();
  return <AdminShell title="Administrator Dashboard" subtitle="System-level BlueTap administration">
    <View style={styles.grid}>
      <TouchableOpacity style={styles.card} onPress={() => router.push('/admin/branches')}><Text style={styles.cardTitle}>Branches</Text><Text style={styles.muted}>Create, edit, activate, and deactivate BlueTap branches.</Text><Text style={styles.link}>Manage branches</Text></TouchableOpacity>
      <TouchableOpacity style={styles.card} onPress={() => router.push('/admin/managers')}><Text style={styles.cardTitle}>Managers</Text><Text style={styles.muted}>Assign trusted Manager accounts to one active branch.</Text><Text style={styles.link}>Manage Managers</Text></TouchableOpacity>
      {['System Overview', 'Users', 'Audit Logs'].map((title) => <View key={title} style={styles.card}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.muted}>Administrative tooling placeholder</Text></View>)}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/admin/registration-security')}><Text style={styles.cardTitle}>Registration Security</Text><Text style={styles.link}>Manage verification policy and account limits</Text></TouchableOpacity>
    </View>
  </AdminShell>;
}
const styles = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, card: { width: 280, minHeight: 130, padding: 20, borderRadius: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7ECFF' }, cardTitle: { fontSize: 18, fontWeight: '800', color: '#183B56' }, muted: { color: '#7890A3', marginTop: 10 }, link: { color: '#187BCD', marginTop: 10, fontWeight: '700' } });
