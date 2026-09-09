import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';

// Draft only: obtain qualified legal review before commercial launch.
const sections = [
  ['Account responsibilities', 'Keep your credentials secure and provide accurate, current registration information. You are responsible for activity performed through your account.'],
  ['Acceptable use', 'Do not use BlueTap for fraud, abuse, impersonation, duplicate-account evasion, interference with the platform, or unlawful activity.'],
  ['Requester responsibilities', 'Requesters must provide accurate delivery details, review order information, and communicate responsibly with the water provider.'],
  ['Distributor responsibilities', 'Distributors must provide accurate station and service information, manage requests responsibly, and maintain any permits or obligations applicable to their business. Distributor access may require administrator approval.'],
  ['BlueTap’s role', 'BlueTap provides software for coordinating water requests between users and participating providers. Fulfilment, product quality, pricing, and delivery commitments remain the responsibility of the relevant provider.'],
  ['Availability', 'Features may change or be temporarily unavailable because of maintenance, network conditions, provider availability, or technical issues.'],
  ['Suspension', 'BlueTap may restrict or suspend accounts reasonably believed to be involved in abuse, fraud, security threats, or violations of these terms.'],
  ['Questions', 'For questions about these draft terms, contact the BlueTap project administrator or support contact provided within the application.'],
];

export default function TermsPage() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity style={styles.back} onPress={() => router.back()}><Text style={styles.backText}>‹ Back</Text></TouchableOpacity>
    <View style={styles.card}><Text style={styles.eyebrow}>BLUETAP · VERSION 1.0</Text><Text style={styles.title}>Terms of Service</Text><Text style={styles.intro}>These draft terms describe the basic rules for using BlueTap.</Text>
      {sections.map(([heading, body]) => <View key={heading} style={styles.section}><Text style={styles.heading}>{heading}</Text><Text style={styles.body}>{body}</Text></View>)}
      <Text style={styles.review}>These terms are a project draft and should receive legal review before commercial launch.</Text>
    </View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: '#F1F8FD' }, content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 20, paddingBottom: 40 }, back: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 4 }, backText: { color: BLUETAP_COLORS.primary, fontWeight: '800', fontSize: 15 }, card: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, shadowColor: '#07518E', shadowOpacity: .12, shadowRadius: 14, elevation: 4 }, eyebrow: { color: BLUETAP_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 }, title: { color: '#17324D', fontSize: 28, fontWeight: '900', marginTop: 8 }, intro: { color: '#58738A', fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 8 }, section: { marginTop: 20 }, heading: { color: '#23445E', fontSize: 16, fontWeight: '800', marginBottom: 5 }, body: { color: '#58738A', fontSize: 14, lineHeight: 22 }, review: { color: '#7A5C24', backgroundColor: '#FFF8E8', borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 18, marginTop: 24 } });
