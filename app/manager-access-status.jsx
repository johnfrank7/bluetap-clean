import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { signOutAndClearSessions } from '../services/authSession';

const messages = {
  BRANCH_INACTIVE: 'This branch is currently inactive. Please contact the BlueTap administrator.',
  BRANCH_ACCESS_DENIED: 'Your Manager account is not assigned to an active branch. Please contact the BlueTap administrator.',
  MANAGER_INACTIVE: 'This Manager account is inactive. Please contact the BlueTap administrator.',
};

export default function ManagerAccessStatusPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const leave = async () => { await signOutAndClearSessions(); router.replace('/login'); };
  return <SafeAreaView style={styles.screen}><View style={styles.card}><Text style={styles.title}>Manager access unavailable</Text><Text style={styles.message}>{messages[reason] || 'Your Manager account cannot access operations right now. Please contact the BlueTap administrator.'}</Text><TouchableOpacity onPress={leave} style={styles.button}><Text style={styles.buttonText}>Back to Login</Text></TouchableOpacity></View></SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#EAF6FF', alignItems: 'center', justifyContent: 'center', padding: 20 }, card: { width: '100%', maxWidth: 460, borderRadius: 20, backgroundColor: '#FFF', padding: 28, borderWidth: 1, borderColor: '#CFE4F3' }, title: { color: '#17324D', fontSize: 24, fontWeight: '900', textAlign: 'center' }, message: { color: '#58738A', lineHeight: 22, textAlign: 'center', marginTop: 12 }, button: { minHeight: 50, borderRadius: 11, backgroundColor: '#187BCD', justifyContent: 'center', alignItems: 'center', marginTop: 24 }, buttonText: { color: '#FFF', fontWeight: '800' } });
