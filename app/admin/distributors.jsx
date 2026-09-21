import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { TableSkeleton } from '../../components/AdminSkeleton';
import { useAdminTheme } from '../../components/AdminTheme';
import { getDistributors, updateDistributor } from '../../services/branchManagement';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';

const labels = { pending: 'Pending', active: 'Active', inactive: 'Inactive', rejected: 'Rejected', approved: 'Active' };

export default function DistributorManagement() {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const { data, loading, refreshing, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.distributors, getDistributors);
  const items = data || [];
  const [filter, setFilter] = React.useState('pending');
  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [busy, setBusy] = React.useState('');
  React.useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200); return () => clearTimeout(timer); }, [query]);
  const act = async (uid, action) => {
    setBusy(uid + action); setActionError('');
    try { await updateDistributor(uid, action); await refresh({ force: true }); }
    catch (caught) { setActionError(caught.message || 'Unable to update this distributor.'); }
    finally { setBusy(''); }
  };
  const visible = items.filter((item) =>
    (item.approvalStatus === filter || (filter === 'active' && item.approvalStatus === 'approved')) &&
    `${item.fullName} ${item.username} ${item.email}`.toLowerCase().includes(debouncedQuery)
  );
  const loadError = actionError || error;

  return <AdminShell title="Distributor Management" subtitle="Review distributor applications and manage approved distributor accounts.">
    <View style={styles.card}>
      <View style={styles.tabs}>{['pending','active','inactive','rejected'].map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.tab, filter === value && styles.tabActive]}><Text style={[styles.tabText, filter === value && styles.tabTextActive]}>{labels[value]} ({items.filter((item) => item.approvalStatus === value || (value === 'active' && item.approvalStatus === 'approved')).length})</Text></Pressable>)}</View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search name, username, or email" placeholderTextColor={colors.textSecondary} style={styles.search} />
      <Text style={styles.count}>{refreshing ? 'Refreshing distributors…' : `${visible.length} distributor${visible.length === 1 ? '' : 's'}`}</Text>
      {!!loadError && <View style={styles.errorBox}><Text style={styles.error}>{loadError}</Text><Pressable onPress={() => refresh({ force: true })}><Text style={styles.retry}>Retry</Text></Pressable></View>}
      {loading && !data ? <TableSkeleton rows={4} /> : visible.length === 0 ? <Text style={styles.empty}>No {labels[filter].toLowerCase()} distributors.</Text> : visible.map((item) => <View key={item.uid} style={styles.row}><View style={styles.copy}><Text style={styles.name}>{item.fullName || item.username}</Text><Text style={styles.meta}>{item.username} · {item.email}</Text><Text style={styles.meta}>{item.phone || 'No phone'} {item.barangay ? `· ${item.barangay}` : ''}</Text><Text style={styles.badge}>{labels[item.approvalStatus] || item.approvalStatus}</Text></View><View style={styles.actions}>{item.approvalStatus === 'pending' && <><Pressable disabled={!!busy} style={styles.approve} onPress={() => act(item.uid, 'approve')}><Text style={styles.buttonText}>Approve</Text></Pressable><Pressable disabled={!!busy} style={styles.reject} onPress={() => act(item.uid, 'reject')}><Text style={styles.rejectText}>Reject</Text></Pressable></>}{item.approvalStatus === 'active' && <Pressable disabled={!!busy} style={styles.reject} onPress={() => act(item.uid, 'deactivate')}><Text style={styles.rejectText}>Deactivate</Text></Pressable>}{item.approvalStatus === 'inactive' && <Pressable disabled={!!busy} style={styles.approve} onPress={() => act(item.uid, 'reactivate')}><Text style={styles.buttonText}>Reactivate</Text></Pressable>}{busy.startsWith(item.uid) && <ActivityIndicator color={colors.primary} />}</View></View>)}
    </View>
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({
  card:{backgroundColor:colors.surface,borderRadius:16,padding:20,borderWidth:1,borderColor:colors.border},tabs:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:16},tab:{paddingHorizontal:12,paddingVertical:9,borderRadius:9,backgroundColor:colors.surfaceAlt},tabActive:{backgroundColor:colors.primary},tabText:{color:colors.textSecondary,fontWeight:'700'},tabTextActive:{color:'#FFF'},search:{borderWidth:1,borderColor:colors.inputBorder,borderRadius:10,padding:12,color:colors.textPrimary,backgroundColor:colors.input,outlineStyle:'none'},count:{marginVertical:14,color:colors.textSecondary},row:{paddingVertical:15,borderTopWidth:1,borderTopColor:colors.border,flexDirection:'row',gap:12},copy:{flex:1},name:{fontWeight:'800',color:colors.textPrimary,fontSize:16},meta:{color:colors.textSecondary,marginTop:3,fontSize:12},badge:{color:colors.primary,fontWeight:'800',marginTop:7,fontSize:12},actions:{gap:8,alignItems:'flex-end'},approve:{backgroundColor:colors.success,borderRadius:8,paddingHorizontal:12,paddingVertical:9},reject:{borderWidth:1,borderColor:colors.danger,borderRadius:8,paddingHorizontal:12,paddingVertical:9},buttonText:{color:'#FFF',fontWeight:'800'},rejectText:{color:colors.danger,fontWeight:'800'},empty:{color:colors.textSecondary,textAlign:'center',padding:28},errorBox:{borderWidth:1,borderColor:colors.danger,backgroundColor:colors.dangerSoft,borderRadius:10,padding:12,marginBottom:10},error:{color:colors.danger,fontWeight:'700'},retry:{color:colors.primary,fontWeight:'900',marginTop:7},
});
