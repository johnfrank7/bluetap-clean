import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import AdminShell from '../../components/AdminShell';
import { SectionCard } from '../../components/DashboardUi';
import { BLUETAP_COLORS } from '../../constants/bluetapTheme';

const destinations = [
  ['Branches', 'Create locations and control whether assigned Managers can operate.', '/admin/branches', 'Manage branches'],
  ['Account management', 'Create requester, distributor, and Manager accounts with secure first sign-in.', '/admin/managers', 'Manage accounts'],
  ['Registration security', 'Configure verification methods and account limits for new registrations.', '/admin/registration-security', 'Review policy'],
];
export default function AdminDashboard() {
  const router = useRouter();
  return <AdminShell title="Administrator Dashboard" subtitle="System-level BlueTap administration">
    <View style={styles.welcome}><Text style={styles.eyebrow}>BLUETAP CONTROL CENTER</Text><Text style={styles.welcomeTitle}>Keep every branch and account operating securely.</Text><Text style={styles.welcomeText}>Use the administration tools below to manage the live BlueTap workspace.</Text></View>
    <Text style={styles.sectionTitle}>Quick access</Text><View style={styles.grid}>{destinations.map(([title, body, path, action]) => <TouchableOpacity key={path} activeOpacity={.85} onPress={() => router.push(path)} style={styles.touch}><SectionCard style={styles.card}><View style={styles.icon}><Text style={styles.iconText}>{title.charAt(0)}</Text></View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.body}>{body}</Text><Text style={styles.link}>{action} →</Text></SectionCard></TouchableOpacity>)}</View>
  </AdminShell>;
}
const styles = StyleSheet.create({ welcome:{backgroundColor:BLUETAP_COLORS.primarySoft,borderRadius:16,padding:24,borderWidth:1,borderColor:'#C8E6FB',marginBottom:26},eyebrow:{color:BLUETAP_COLORS.primary,fontSize:11,fontWeight:'800',letterSpacing:1},welcomeTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:22,fontWeight:'800',marginTop:7},welcomeText:{color:BLUETAP_COLORS.textSecondary,marginTop:7,lineHeight:20},sectionTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:17,fontWeight:'800',marginBottom:12},grid:{flexDirection:'row',flexWrap:'wrap',gap:16},touch:{flexGrow:1,flexBasis:250,maxWidth:390},card:{minHeight:205},icon:{width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:BLUETAP_COLORS.primarySoft},iconText:{color:BLUETAP_COLORS.primary,fontWeight:'800'},cardTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:17,fontWeight:'800',marginTop:16},body:{color:BLUETAP_COLORS.textSecondary,lineHeight:20,marginTop:8},link:{color:BLUETAP_COLORS.primary,fontWeight:'800',marginTop:16} });
