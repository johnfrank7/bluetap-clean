import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { StatusBadge } from '../../components/DashboardUi';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createBranch, getBranches, updateBranch } from '../../services/branchManagement';

const empty = { name: '', code: '', barangay: '', city: '', address: '' };

export default function AdminBranchesPage() {
  const [branches, setBranches] = React.useState([]);
  const [form, setForm] = React.useState(empty);
  const [editingId, setEditingId] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const load = React.useCallback(async () => {
    try { setBranches(await getBranches()); setMessage(''); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const edit = (branch) => { setEditingId(branch.id); setForm({ name: branch.name, code: branch.code, barangay: branch.barangay, city: branch.city, address: branch.address }); setMessage(''); };
  const cancel = () => { setEditingId(''); setForm(empty); setMessage(''); };
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      if (editingId) await updateBranch(editingId, { name: form.name, barangay: form.barangay, city: form.city, address: form.address });
      else await createBranch(form);
      cancel(); await load(); setMessage(editingId ? 'Branch updated.' : 'Branch created.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const toggle = async (branch) => {
    setSaving(true); setMessage('');
    try { await updateBranch(branch.id, { status: branch.status === 'active' ? 'inactive' : 'active' }); await load(); }
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
    <View style={styles.listHeader}><View><Text style={styles.listTitle}>Existing branches</Text><Text style={styles.listHelp}>Location status and current Manager coverage.</Text></View><Text style={styles.branchTotal}>{branches.length} total</Text></View>{loading ? <ActivityIndicator color={BLUETAP_COLORS.primary} /> : branches.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No branches yet</Text><Text style={styles.emptyText}>Create the first branch using the form above.</Text></View> : <View style={styles.grid}>{branches.map((branch) => <View key={branch.id} style={styles.branchCard}>
      <View style={styles.cardHeader}><View><Text style={styles.branchName}>{branch.name}</Text><Text style={styles.code}>{branch.code}</Text></View><StatusBadge status={branch.status} /></View>
      <Text style={styles.location}>{branch.address}, {branch.barangay}, {branch.city}</Text>
      <Text style={styles.manager}>Managers: {branch.managers?.length ? branch.managers.map((manager) => `${manager.firstName} ${manager.lastName}`.trim() || manager.email).join(', ') : 'Unassigned'}</Text>
      <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => edit(branch)}><Text style={styles.secondaryText}>Edit</Text></TouchableOpacity><TouchableOpacity disabled={saving} style={[styles.secondary, branch.status === 'active' && styles.danger]} onPress={() => toggle(branch)}><Text style={[styles.secondaryText, branch.status === 'active' && styles.dangerText]}>{branch.status === 'active' ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity></View>
    </View>)}</View>}
  </AdminShell>;
}

const styles = StyleSheet.create({
  formCard: { backgroundColor: BLUETAP_COLORS.surface, borderWidth: 1, borderColor: BLUETAP_COLORS.border, borderRadius: 16, padding: 20, marginBottom: 18, ...BLUETAP_LAYOUT.shadow }, cardEyebrow:{color:BLUETAP_COLORS.primary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:5}, cardTitle: { color: BLUETAP_COLORS.textPrimary, fontSize: 18, fontWeight: '800' },cardHelp:{color:BLUETAP_COLORS.textSecondary,fontSize:13,lineHeight:19,marginTop:5,marginBottom:16}, fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, field: { minWidth: 180, flex: 1 }, label: { color: '#38566E', fontSize: 12, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#BDD5E6', backgroundColor: BLUETAP_COLORS.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, color: BLUETAP_COLORS.textPrimary, outlineStyle:'none' }, inputDisabled: { backgroundColor: '#EEF3F7', color: '#74899A' }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 16 }, primary: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: BLUETAP_COLORS.primary, justifyContent: 'center' }, primaryText: { color: '#FFF', fontWeight: '800' }, secondary: { minHeight: 42, paddingHorizontal: 16, borderWidth: 1, borderColor: '#8DBADD', borderRadius: 10, justifyContent: 'center', backgroundColor:'#FFF' }, secondaryText: { color: BLUETAP_COLORS.primary, fontWeight: '700' }, danger: { borderColor: '#DF9898' }, dangerText: { color: BLUETAP_COLORS.danger }, notice:{backgroundColor:'#FFF5F4',borderWidth:1,borderColor:'#F1C5C2',padding:12,borderRadius:10,marginBottom:15},noticeSuccess:{backgroundColor:'#EFFAF4',borderColor:'#BDE6CF'},message: { color: BLUETAP_COLORS.danger, fontWeight:'700' },messageSuccess:{color:BLUETAP_COLORS.success},listHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:8,marginBottom:12},listTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:17,fontWeight:'900'},listHelp:{color:BLUETAP_COLORS.textSecondary,fontSize:12,marginTop:3},branchTotal:{color:BLUETAP_COLORS.primary,fontSize:12,fontWeight:'800',backgroundColor:BLUETAP_COLORS.primarySoft,borderRadius:999,paddingHorizontal:10,paddingVertical:6}, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, branchCard: { flexGrow: 1, flexBasis: 300, maxWidth: 480, backgroundColor: BLUETAP_COLORS.surface, borderWidth: 1, borderColor: BLUETAP_COLORS.border, borderRadius: 16, padding: 18, ...BLUETAP_LAYOUT.shadow }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, branchName: { color: BLUETAP_COLORS.textPrimary, fontSize: 17, fontWeight: '800' }, code: { color: '#6A8498', fontSize: 12, marginTop: 3 }, location: { color: '#527087', lineHeight: 20, marginTop: 14 }, manager: { color: '#294C66', fontWeight: '700', marginTop: 12 }, empty:{alignItems:'center',padding:34,borderWidth:1,borderStyle:'dashed',borderColor:BLUETAP_COLORS.border,borderRadius:16,backgroundColor:BLUETAP_COLORS.surfaceAlt},emptyTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:17,fontWeight:'800'},emptyText:{color:BLUETAP_COLORS.textSecondary,marginTop:6},
});
