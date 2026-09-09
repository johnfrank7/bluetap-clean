import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';

// Draft only: obtain qualified legal review before commercial launch.
const sections = [
  ['Information used by BlueTap', 'BlueTap processes registration and profile information such as your name, username, email address, phone number, role, barangay, and delivery address.'],
  ['Requests and service activity', 'The platform processes water requests, status updates, scheduling information, amounts, and related communications needed to operate the service.'],
  ['Identity verification', 'BlueTap records limited verification metadata such as status, verification time, liveness result, duplicate-check result, and a provider reference. A verification provider may separately process a selfie, video, face representation, or other biometric information according to its own implementation and retention practices. Raw biometric material is not placed in the BlueTap user profile by this registration flow.'],
  ['Why information is used', 'Information is used to create and secure accounts, prevent duplicate or abusive registrations, route requests, support delivery operations, send verification or recovery messages, and administer distributor approval.'],
  ['Security', 'BlueTap uses access controls and trusted backend operations for sensitive registration decisions. No internet service can guarantee absolute security.'],
  ['Retention', 'Account, request, and verification metadata may be retained while needed to operate the service, resolve disputes, prevent abuse, or meet applicable obligations. Provider-side biometric retention must be confirmed when a production verification provider is selected.'],
  ['Your choices and requests', 'Users may request help accessing or correcting profile information, or ask about account deletion and retention, through the BlueTap project administrator or support contact available in the application. Some information may need to be retained for security or operational reasons.'],
];

export default function PrivacyPage() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity style={styles.back} onPress={() => router.back()}><Text style={styles.backText}>‹ Back</Text></TouchableOpacity>
    <View style={styles.card}><Text style={styles.eyebrow}>BLUETAP · VERSION 1.0</Text><Text style={styles.title}>Privacy Policy</Text><Text style={styles.intro}>This draft explains the information BlueTap uses and why.</Text>
      {sections.map(([heading, body]) => <View key={heading} style={styles.section}><Text style={styles.heading}>{heading}</Text><Text style={styles.body}>{body}</Text></View>)}
      <Text style={styles.review}>This privacy policy is a project draft and should receive legal review before commercial launch.</Text>
    </View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F1F8FD' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 40 }, back: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 }, backText: { color: BLUETAP_COLORS.primary, fontWeight: '800', fontSize: 15 }, card: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, shadowColor: '#07518E', shadowOpacity: .12, shadowRadius: 14, elevation: 4 }, eyebrow: { color: BLUETAP_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 }, title: { color: '#17324D', fontSize: 28, fontWeight: '900', marginTop: 8 }, intro: { color: '#58738A', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 8 }, section: { marginTop: 20 }, heading: { color: '#23445E', fontSize: 16, fontWeight: '800', marginBottom: 5 }, body: { color: '#58738A', fontSize: 14, lineHeight: 22 }, review: { color: '#7A5C24', backgroundColor: '#FFF8E8', borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 18, marginTop: 24 } });
