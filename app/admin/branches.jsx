import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { CardSkeleton } from '../../components/AdminSkeleton';
import { StatusBadge } from '../../components/DashboardUi';
import { BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { useAdminTheme } from '../../components/AdminTheme';
import { createBranch, getBranches, updateBranch } from '../../services/branchManagement';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';

const empty = { name: '', code: '', barangay: '', city: '', address: '' };

export default function AdminBranchesPage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  const { data, loading, refreshing, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.branches, getBranches);
  const branches = data || [];
  const [form, setForm] = React.useState(empty);
  const [editingId, setEditingId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const edit = (branch) => { setEditingId(branch.id); setForm({ name: branch.name, code: branch.code, barangay: branch.barangay, city: branch.city, address: branch.address }); setMessage(''); };
  const cancel = () => { setEditingId(''); setForm(empty); setMessage(''); };
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      if (editingId) await updateBranch(editingId, { name: form.name, barangay: form.barangay, city: form.city, address: form.address });
      else await createBranch(form);
      cancel(); await refresh({ force: true }); setMessage(editingId ? 'Branch updated.' : 'Branch created.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const toggle = async (branch) => {
    setSaving(true); setMessage('');
    try { await updateBranch(branch.id, { status: branch.status === 'active' ? 'inactive' : 'active' }); await refresh({ force: true }); }
    catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  return <AdminShell title="Branches" subtitle="Create locations and control whether assigned Managers can operate.">
    <View style={styles.formCard}>
      <Text style={styles.cardEyebrow}>BRANCH DIRECTORY</Text><Text style={styles.cardTitle}>{editingId ? 'Edit branch' : 'Create branch'}</Text><Text style={styles.cardHelp}>Add a location, then assign an active Manager from Account Management.</Text>
      <View style={styles.fields}>{[['name', 'Branch name'], ['code', 'Code'], ['barangay', 'Barangay'], ['city', 'City'], ['address', 'Address']].map(([key, label]) => <View key={key} style={styles.field}><Text style={styles.label}>{label}</Text><TextInput editable={key !== 'code' || !editingId} value={form[key]} onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))} style={[styles.input, key === 'code' && editingId && styles.inputDisabled]} /></View>)}</View>
      <View style={styles.actions}>{editingId && <TouchableOpacity style={styles.secondary} onPress={cancel}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>}<TouchableOpacity disabled={saving} style={styles.primary} onPress={save}><Text style={styles.primaryText}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Create branch'}</Text></TouchableOpacity></View>
    </View>
    {!!message && <View accessibilityRole="alert" style={[styles.notice, /created|updated/i.test(message) && styles.noticeSuccess]}><Text style={[styles.message, /created|updated/i.test(message) && styles.messageSuccess]}>{message}</Text></View>}
    <View style={styles.listHeader}><View><Text style={styles.listTitle}>Existing branches</Text><Text style={styles.listHelp}>Location status and current Manager coverage.</Text></View><Text style={styles.branchTotal}>{refreshing ? 'Refreshing…' : `${branches.length} total`}</Text></View>{error && <View style={styles.notice}><Text style={styles.message}>{error}</Text><TouchableOpacity onPress={() => refresh({ force: true })}><Text style={styles.retry}>Try again</Text></TouchableOpacity></View>}{loading && !data ? <View style={styles.grid}>{Array.from({ length: 3 }, (_, index) => <CardSkeleton key={index} style={styles.branchSkeleton} />)}</View> : branches.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No branches yet</Text><Text style={styles.emptyText}>Create the first branch using the form above.</Text></View> : <View style={styles.grid}>{branches.map((branch) => <View key={branch.id} style={styles.branchCard}>
      <View style={styles.cardHeader}><View><Text style={styles.branchName}>{branch.name}</Text><Text style={styles.code}>{branch.code}</Text></View><StatusBadge status={branch.status} /></View>
      <Text style={styles.location}>{branch.address}, {branch.barangay}, {branch.city}</Text>
      <Text style={styles.manager}>Managers: {branch.managers?.length ? branch.managers.map((manager) => `${manager.firstName} ${manager.lastName}`.trim() || manager.email).join(', ') : 'Unassigned'}</Text>
      <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => edit(branch)}><Text style={styles.secondaryText}>Edit</Text></TouchableOpacity><TouchableOpacity disabled={saving} style={[styles.secondary, branch.status === 'active' && styles.danger]} onPress={() => toggle(branch)}><Text style={[styles.secondaryText, branch.status === 'active' && styles.dangerText]}>{branch.status === 'active' ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity></View>
    </View>)}</View>}
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({ formCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:20,marginBottom:18,...BLUETAP_LAYOUT.shadow},cardEyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:5},cardTitle:{color:colors.textPrimary,fontSize:18,fontWeight:'800'},cardHelp:{color:colors.textSecondary,fontSize:13,lineHeight:19,marginTop:5,marginBottom:16},fields:{flexDirection:'row',flexWrap:'wrap',gap:12},field:{minWidth:180,flex:1},label:{color:colors.textSecondary,fontSize:12,fontWeight:'700',marginBottom:6},input:{minHeight:46,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12,color:colors.textPrimary,outlineStyle:'none'},inputDisabled:{backgroundColor:colors.neutral,color:colors.disabled},actions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:10,marginTop:16},primary:{minHeight:44,paddingHorizontal:18,borderRadius:10,backgroundColor:colors.primary,justifyContent:'center'},primaryText:{color:'#FFF',fontWeight:'800'},secondary:{minHeight:42,paddingHorizontal:16,borderWidth:1,borderColor:colors.inputBorder,borderRadius:10,justifyContent:'center',backgroundColor:colors.surface},secondaryText:{color:colors.primary,fontWeight:'700'},danger:{borderColor:colors.danger},dangerText:{color:colors.danger},notice:{backgroundColor:colors.dangerSoft,borderWidth:1,borderColor:colors.danger,padding:12,borderRadius:10,marginBottom:15},noticeSuccess:{backgroundColor:colors.successSoft,borderColor:colors.success},message:{color:colors.danger,fontWeight:'700'},messageSuccess:{color:colors.success},retry:{color:colors.primary,fontWeight:'900',marginTop:7},listHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:8,marginBottom:12},listTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'900'},listHelp:{color:colors.textSecondary,fontSize:12,marginTop:3},branchTotal:{color:colors.primary,fontSize:12,fontWeight:'800',backgroundColor:colors.primarySoft,borderRadius:999,paddingHorizontal:10,paddingVertical:6},grid:{flexDirection:'row',flexWrap:'wrap',gap:14},branchSkeleton:{flexBasis:300,maxWidth:480},branchCard:{flexGrow:1,flexBasis:300,maxWidth:480,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:18,...BLUETAP_LAYOUT.shadow},cardHeader:{flexDirection:'row',justifyContent:'space-between',gap:12},branchName:{color:colors.textPrimary,fontSize:17,fontWeight:'800'},code:{color:colors.textSecondary,fontSize:12,marginTop:3},location:{color:colors.textSecondary,lineHeight:20,marginTop:14},manager:{color:colors.textPrimary,fontWeight:'700',marginTop:12},empty:{alignItems:'center',padding:34,borderWidth:1,borderStyle:'dashed',borderColor:colors.border,borderRadius:16,backgroundColor:colors.surfaceAlt},emptyTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'800'},emptyText:{color:colors.textSecondary,marginTop:6} });
