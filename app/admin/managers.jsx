import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { getBranches, getManagers, promoteManager, updateManagerAssignment } from '../../services/branchManagement';

export default function AdminManagersPage() {
  const [managers, setManagers] = React.useState([]);
  const [branches, setBranches] = React.useState([]);
  const [identifier, setIdentifier] = React.useState('');
  const [selectedBranchId, setSelectedBranchId] = React.useState('');
  const [editingUid, setEditingUid] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const load = React.useCallback(async () => {
    try { const [m, b] = await Promise.all([getManagers(), getBranches()]); setManagers(m); setBranches(b); setMessage(''); }
    catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const activeBranches = branches.filter((branch) => branch.status === 'active');
  const reset = () => { setIdentifier(''); setSelectedBranchId(''); setEditingUid(''); };
  const save = async () => {
    if (!selectedBranchId || (!editingUid && !identifier.trim())) return setMessage('Choose an active branch and enter an existing username or email.');
    setSaving(true); setMessage('');
    const wasEditing = !!editingUid;
    try {
      if (editingUid) await updateManagerAssignment(editingUid, { branchId: selectedBranchId, managerStatus: 'active' });
      else await promoteManager(identifier.trim(), selectedBranchId);
      reset(); await load(); setMessage(wasEditing ? 'Manager reassigned. They must refresh their session.' : 'Manager assigned. They must sign in again to refresh their role claim.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  const edit = (manager) => { setEditingUid(manager.uid); setIdentifier(manager.email || manager.username); setSelectedBranchId(manager.branchId || ''); setMessage(''); };
  const deactivate = async (manager) => {
    setSaving(true); setMessage('');
    try { await updateManagerAssignment(manager.uid, { managerStatus: 'inactive' }); reset(); await load(); setMessage('Manager access deactivated.'); }
    catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  };
  return <AdminShell title="Managers" subtitle="Promote existing trusted accounts and control their single Branch assignment.">
    <View style={styles.formCard}>
      <Text style={styles.cardTitle}>{editingUid ? 'Reassign Manager' : 'Assign a Manager'}</Text>
      <Text style={styles.help}>{editingUid ? "Choose the Manager's new active branch." : 'Enter an existing completed BlueTap account username or email. Public signup cannot create Managers.'}</Text>
      <Text style={styles.label}>Username or email</Text><TextInput editable={!editingUid} autoCapitalize="none" value={identifier} onChangeText={setIdentifier} style={[styles.input, editingUid && styles.inputDisabled]} />
      <Text style={styles.label}>Active branch</Text><View style={styles.branchChoices}>{activeBranches.map((branch) => <TouchableOpacity key={branch.id} onPress={() => setSelectedBranchId(branch.id)} style={[styles.choice, selectedBranchId === branch.id && styles.choiceSelected]}><Text style={[styles.choiceText, selectedBranchId === branch.id && styles.choiceTextSelected]}>{branch.name} ({branch.code})</Text></TouchableOpacity>)}</View>
      {!activeBranches.length && <Text style={styles.warning}>Create and activate a branch before assigning a Manager.</Text>}
      <View style={styles.actions}>{editingUid && <TouchableOpacity onPress={reset} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>}<TouchableOpacity disabled={saving || !activeBranches.length} onPress={save} style={[styles.primary, (saving || !activeBranches.length) && styles.disabled]}><Text style={styles.primaryText}>{saving ? 'Saving...' : editingUid ? 'Reassign Manager' : 'Assign Manager'}</Text></TouchableOpacity></View>
    </View>
    {!!message && <Text style={styles.message}>{message}</Text>}
    {loading ? <ActivityIndicator color="#187BCD" /> : <View style={styles.list}>{managers.map((manager) => <View key={manager.uid} style={styles.managerCard}>
      <View style={styles.summary}><View><Text style={styles.managerName}>{`${manager.firstName} ${manager.lastName}`.trim() || manager.username || manager.email}</Text><Text style={styles.detail}>{manager.email}</Text><Text style={styles.detail}>Branch: {manager.branch?.name || 'Unassigned'}</Text></View><Text style={[styles.status, manager.managerStatus === 'active' ? styles.active : styles.inactive]}>{manager.managerStatus}</Text></View>
      <View style={styles.actions}><TouchableOpacity onPress={() => edit(manager)} style={styles.secondary}><Text style={styles.secondaryText}>{manager.managerStatus === 'active' ? 'Reassign' : 'Reactivate'}</Text></TouchableOpacity>{manager.managerStatus === 'active' && <TouchableOpacity disabled={saving} onPress={() => deactivate(manager)} style={[styles.secondary, styles.danger]}><Text style={styles.dangerText}>Deactivate</Text></TouchableOpacity>}</View>
    </View>)}</View>}
  </AdminShell>;
}

const styles = StyleSheet.create({
  formCard: { maxWidth: 760, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7E7F3', borderRadius: 16, padding: 20, marginBottom: 18 }, cardTitle: { color: '#17324D', fontSize: 18, fontWeight: '800' }, help: { color: '#668198', lineHeight: 20, marginTop: 6, marginBottom: 16 }, label: { color: '#38566E', fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#BDD5E6', backgroundColor: '#FAFCFE', borderRadius: 10, paddingHorizontal: 12, color: '#17324D' }, inputDisabled: { backgroundColor: '#EEF3F7', color: '#74899A' }, branchChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { borderWidth: 1, borderColor: '#B9D3E6', borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9 }, choiceSelected: { backgroundColor: '#187BCD', borderColor: '#187BCD' }, choiceText: { color: '#365D78', fontWeight: '700' }, choiceTextSelected: { color: '#FFF' }, warning: { color: '#A25A17', marginTop: 10 }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 16 }, primary: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#187BCD', justifyContent: 'center' }, primaryText: { color: '#FFF', fontWeight: '800' }, disabled: { opacity: .5 }, secondary: { minHeight: 42, paddingHorizontal: 16, borderWidth: 1, borderColor: '#8DBADD', borderRadius: 10, justifyContent: 'center' }, secondaryText: { color: '#1269AD', fontWeight: '700' }, danger: { borderColor: '#DF9898' }, dangerText: { color: '#B52F2F', fontWeight: '700' }, message: { color: '#A23B35', marginBottom: 15 }, list: { gap: 12, maxWidth: 900 }, managerCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7E7F3', borderRadius: 15, padding: 18 }, summary: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, managerName: { color: '#17324D', fontSize: 16, fontWeight: '800' }, detail: { color: '#607C91', marginTop: 4 }, status: { textTransform: 'capitalize', fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' }, active: { color: '#167347', backgroundColor: '#E3F7EC' }, inactive: { color: '#A53631', backgroundColor: '#FCE9E8' },
});
