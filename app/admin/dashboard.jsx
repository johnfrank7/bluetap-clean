import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import AdminShell from '../../components/AdminShell';
import { CardSkeleton } from '../../components/AdminSkeleton';
import { EmptyState, SectionCard, StatCard, StatusBadge } from '../../components/DashboardUi';
import { useAdminTheme } from '../../components/AdminTheme';
import { getAdminDashboardOverview } from '../../services/branchManagement';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import { prefetchLikelyAdminDestinations } from '../../services/adminPrefetch';

const quickActions = [
  ['Create branch', 'Set up a location and its operating status.', '/admin/branches'],
  ['Create account', 'Provision requester, distributor, or Manager access.', '/admin/managers'],
  ['Review security', 'Manage verification, registration limits, and session policy.', '/admin/registration-security'],
];
const toTime = (value) => value?.toMillis?.() || value?.seconds * 1000 || new Date(value || 0).getTime() || 0;
const dateLabel = (value) => { const time = toTime(value); return time ? new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Recently'; };

function SectionError({ message, onRetry, styles }) {
  return <View style={styles.sectionError}><Text style={styles.noticeText}>{message}</Text><TouchableOpacity onPress={onRetry}><Text style={styles.retry}>Retry</Text></TouchableOpacity></View>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const { data, loading, refreshing, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.dashboard, getAdminDashboardOverview);
  React.useEffect(() => data ? prefetchLikelyAdminDestinations() : undefined, [data]);
  const retry = () => refresh({ force: true });
  const summary = data?.summary;
  const security = data?.security;
  const registrationLabel = security
    ? `${security.faceVerificationEnabled ? 'Face' : ''}${security.faceVerificationEnabled && security.emailOtpEnabled ? ' + ' : ''}${security.emailOtpEnabled ? 'Email OTP' : ''}`
    : '';

  return <AdminShell title="Administrator Dashboard" subtitle="A live overview of BlueTap branches, managed accounts, and registration policy.">
    <View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.eyebrow}>BLUETAP CONTROL CENTER</Text><Text style={styles.heroTitle}>Operate the platform with confidence.</Text><Text style={styles.heroBody}>Monitor operational coverage, account access, and registration safeguards from one workspace.</Text></View><View style={styles.heroChip}><Text style={styles.heroChipLabel}>REGISTRATION</Text><Text style={styles.heroChipValue}>{registrationLabel || (loading ? 'Loading…' : 'Unavailable')}</Text></View></View>
    {!!error && !data && <SectionError message={error} onRetry={retry} styles={styles} />}
    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Operational overview</Text>{refreshing && <Text style={styles.refreshing}>Refreshing…</Text>}</View>
    <View style={styles.statGrid}>{summary ? <>
      <StatCard label="Total branches" value={summary.totalBranches ?? '—'} detail={summary.activeBranches == null ? 'Temporarily unavailable' : `${summary.activeBranches} active`} />
      <StatCard label="Managers" value={summary.managers ?? '—'} detail={summary.managers == null ? 'Temporarily unavailable' : 'Assigned administrator accounts'} tone="navy" />
      <StatCard label="Managed accounts" value={summary.totalAccounts ?? '—'} detail={summary.activeAccounts == null ? 'Temporarily unavailable' : `${summary.activeAccounts} active`} tone="green" />
      <StatCard label="Requesters" value={summary.requesters ?? '—'} detail={summary.requesters == null ? 'Temporarily unavailable' : 'Registered and provisioned'} />
      <StatCard label="Distributors" value={summary.distributors ?? '—'} detail={summary.pendingDistributors == null ? 'Temporarily unavailable' : `${summary.pendingDistributors} pending`} tone="navy" />
    </> : Array.from({ length: 5 }, (_, index) => <CardSkeleton key={index} style={styles.statSkeleton} />)}</View>

    <View style={styles.mainGrid}>
      <SectionCard style={styles.salesCard}><View style={styles.sectionHeader}><View><Text style={styles.cardTitle}>Sales overview</Text><Text style={styles.cardSubtitle}>Platform-wide sales reporting</Text></View><StatusBadge status="Unavailable" /></View><EmptyState title="No sales data yet" detail="A platform-wide sales aggregate is not available through the current Admin data sources." /></SectionCard>
      {!data && loading ? <CardSkeleton lines={5} style={styles.securityCard} /> : <SectionCard style={styles.securityCard}><Text style={styles.cardTitle}>Security policy</Text><Text style={styles.cardSubtitle}>Current verification and account safeguards</Text>{data?.errors?.security || !security ? <SectionError message={data?.errors?.security || 'Security overview is unavailable.'} onRetry={retry} styles={styles} /> : <><View style={styles.policyRow}><Text style={styles.policyLabel}>Face verification</Text><StatusBadge status={security.faceVerificationEnabled ? 'enabled' : 'disabled'} /></View><View style={styles.policyRow}><Text style={styles.policyLabel}>Email OTP</Text><StatusBadge status={security.emailOtpEnabled ? 'enabled' : 'disabled'} /></View><Text style={styles.policyLimit}>{security.maxAccountsPerDevice} accounts/device · {security.maxAccountsPerIp} accounts/network</Text></>}<TouchableOpacity onPress={() => router.push('/admin/registration-security')}><Text style={styles.inlineLink}>Open security settings →</Text></TouchableOpacity></SectionCard>}
    </View>

    <View style={styles.mainGrid}>
      {!data && loading ? <CardSkeleton lines={6} style={styles.performanceCard} /> : <SectionCard style={styles.performanceCard}><View style={styles.sectionHeader}><View><Text style={styles.cardTitle}>Branch coverage</Text><Text style={styles.cardSubtitle}>Current branch activity and Manager assignment</Text></View><TouchableOpacity onPress={() => router.push('/admin/branches')}><Text style={styles.inlineLink}>View branches</Text></TouchableOpacity></View>{data?.errors?.branches ? <SectionError message={data.errors.branches} onRetry={retry} styles={styles} /> : data?.branches?.length === 0 ? <EmptyState title="No branches yet" detail="Create a branch to begin assigning Managers and operating locations." /> : data?.branches?.map((branch) => <View key={branch.id} style={styles.branchRow}><View style={styles.branchNameWrap}><Text style={styles.branchName}>{branch.name}</Text><Text style={styles.branchMeta}>{branch.code} · {branch.city || 'No city set'}</Text></View><Text style={styles.managerCount}>{branch.managerCount} Manager{branch.managerCount === 1 ? '' : 's'}</Text><StatusBadge status={branch.status} /></View>)}</SectionCard>}
      {!data && loading ? <CardSkeleton lines={6} style={styles.activityCard} /> : <SectionCard style={styles.activityCard}><Text style={styles.cardTitle}>Recent system activity</Text><Text style={styles.cardSubtitle}>Latest branch and managed-account records</Text>{data?.errors?.accounts && data?.errors?.branches ? <SectionError message="Recent activity is temporarily unavailable." onRetry={retry} styles={styles} /> : data?.recentActivity?.length === 0 ? <EmptyState title="No recent activity" detail="New branch and account activity will appear here." style={styles.compactEmpty} /> : data?.recentActivity?.map((item, index) => <View key={`${item.type}-${item.name}-${index}`} style={styles.activityRow}><View style={styles.activityDot} /><View style={styles.activityCopy}><Text style={styles.activityTitle}>{item.name}</Text><Text style={styles.activityMeta}>{item.type} · {dateLabel(item.date)}</Text></View></View>)}</SectionCard>}
    </View>

    <Text style={styles.sectionTitle}>Quick actions</Text><View style={styles.actionGrid}>{quickActions.map(([title, body, path]) => <TouchableOpacity key={path} activeOpacity={.85} onPress={() => router.push(path)} style={styles.actionTouch}><SectionCard style={styles.actionCard}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.actionBody}>{body}</Text><Text style={styles.inlineLink}>Open →</Text></SectionCard></TouchableOpacity>)}</View>
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({
  hero:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:20,backgroundColor:colors.primary,borderRadius:20,padding:26,marginBottom:26},heroCopy:{flex:1,minWidth:220},eyebrow:{color:'#CBEAFF',fontSize:11,fontWeight:'900',letterSpacing:1},heroTitle:{color:'#FFF',fontSize:25,fontWeight:'900',marginTop:6},heroBody:{color:'#E3F2FD',lineHeight:20,marginTop:7,maxWidth:600},heroChip:{minWidth:135,backgroundColor:'rgba(255,255,255,.14)',borderWidth:1,borderColor:'rgba(255,255,255,.2)',borderRadius:14,padding:14},heroChipLabel:{color:'#CBEAFF',fontSize:10,fontWeight:'900',letterSpacing:.6},heroChipValue:{color:'#FFF',fontWeight:'800',marginTop:5},
  sectionHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},sectionTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'900',marginBottom:12},refreshing:{color:colors.textSecondary,fontSize:12,marginBottom:12},statGrid:{flexDirection:'row',flexWrap:'wrap',gap:14,marginBottom:24},statSkeleton:{minHeight:152,flexBasis:180},
  mainGrid:{flexDirection:'row',flexWrap:'wrap',gap:16,marginBottom:16},salesCard:{flexGrow:1,flexBasis:430},securityCard:{flexGrow:1,flexBasis:290},performanceCard:{flexGrow:1,flexBasis:430},activityCard:{flexGrow:1,flexBasis:290},sectionHeader:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:18},cardTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'900'},cardSubtitle:{color:colors.textSecondary,fontSize:12,marginTop:4},
  policyRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border},policyLabel:{color:colors.textPrimary,fontWeight:'700'},policyLimit:{color:colors.textSecondary,fontSize:12,marginTop:14},inlineLink:{color:colors.primary,fontWeight:'800',fontSize:13,marginTop:13},branchRow:{minHeight:62,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:1,borderTopColor:colors.border,paddingVertical:10},branchNameWrap:{flex:1,minWidth:120},branchName:{color:colors.textPrimary,fontWeight:'800'},branchMeta:{color:colors.textSecondary,fontSize:12,marginTop:3},managerCount:{color:colors.textSecondary,fontSize:12,fontWeight:'700'},
  activityRow:{flexDirection:'row',alignItems:'center',paddingVertical:11,borderTopWidth:1,borderTopColor:colors.border},activityDot:{width:9,height:9,borderRadius:5,backgroundColor:colors.primary,marginRight:11},activityCopy:{flex:1},activityTitle:{color:colors.textPrimary,fontWeight:'800'},activityMeta:{color:colors.textSecondary,fontSize:12,marginTop:2},compactEmpty:{minHeight:130,marginTop:16},actionGrid:{flexDirection:'row',flexWrap:'wrap',gap:14},actionTouch:{flexGrow:1,flexBasis:230,maxWidth:390},actionCard:{minHeight:145},actionTitle:{color:colors.textPrimary,fontSize:16,fontWeight:'900'},actionBody:{color:colors.textSecondary,lineHeight:19,marginTop:7},
  sectionError:{marginTop:14,borderWidth:1,borderColor:colors.danger,borderRadius:10,padding:12,backgroundColor:colors.dangerSoft},noticeText:{color:colors.danger,fontWeight:'700'},retry:{color:colors.primary,fontWeight:'900',marginTop:8},
});
