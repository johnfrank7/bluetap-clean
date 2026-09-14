import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
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
      <Text style={styles.cardTitle}>{editingId ? 'Edit branch' : 'Create branch'}</Text>
      <View style={styles.fields}>{[['name', 'Branch name'], ['code', 'Code'], ['barangay', 'Barangay'], ['city', 'City'], ['address', 'Address']].map(([key, label]) => <View key={key} style={styles.field}><Text style={styles.label}>{label}</Text><TextInput editable={key !== 'code' || !editingId} value={form[key]} onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))} style={[styles.input, key === 'code' && editingId && styles.inputDisabled]} /></View>)}</View>
      <View style={styles.actions}>{editingId && <TouchableOpacity style={styles.secondary} onPress={cancel}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>}<TouchableOpacity disabled={saving} style={styles.primary} onPress={save}><Text style={styles.primaryText}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Create branch'}</Text></TouchableOpacity></View>
    </View>
    {!!message && <Text style={styles.message}>{message}</Text>}
    {loading ? <ActivityIndicator color="#187BCD" /> : <View style={styles.grid}>{branches.map((branch) => <View key={branch.id} style={styles.branchCard}>
      <View style={styles.cardHeader}><View><Text style={styles.branchName}>{branch.name}</Text><Text style={styles.code}>{branch.code}</Text></View><Text style={[styles.status, branch.status === 'active' ? styles.active : styles.inactive]}>{branch.status}</Text></View>
      <Text style={styles.location}>{branch.address}, {branch.barangay}, {branch.city}</Text>
      <Text style={styles.manager}>Managers: {branch.managers?.length ? branch.managers.map((manager) => `${manager.firstName} ${manager.lastName}`.trim() || manager.email).join(', ') : 'Unassigned'}</Text>
      <View style={styles.actions}><TouchableOpacity style={styles.secondary} onPress={() => edit(branch)}><Text style={styles.secondaryText}>Edit</Text></TouchableOpacity><TouchableOpacity disabled={saving} style={[styles.secondary, branch.status === 'active' && styles.danger]} onPress={() => toggle(branch)}><Text style={[styles.secondaryText, branch.status === 'active' && styles.dangerText]}>{branch.status === 'active' ? 'Deactivate' : 'Activate'}</Text></TouchableOpacity></View>
    </View>)}</View>}
  </AdminShell>;
}

const styles = StyleSheet.create({
  formCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7E7F3', borderRadius: 16, padding: 20, marginBottom: 18 }, cardTitle: { color: '#17324D', fontSize: 18, fontWeight: '800', marginBottom: 14 }, fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, field: { minWidth: 180, flex: 1 }, label: { color: '#38566E', fontSize: 12, fontWeight: '700', marginBottom: 6 }, input: { minHeight: 46, borderWidth: 1, borderColor: '#BDD5E6', backgroundColor: '#FAFCFE', borderRadius: 10, paddingHorizontal: 12, color: '#17324D' }, inputDisabled: { backgroundColor: '#EEF3F7', color: '#74899A' }, actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 16 }, primary: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#187BCD', justifyContent: 'center' }, primaryText: { color: '#FFF', fontWeight: '800' }, secondary: { minHeight: 42, paddingHorizontal: 16, borderWidth: 1, borderColor: '#8DBADD', borderRadius: 10, justifyContent: 'center' }, secondaryText: { color: '#1269AD', fontWeight: '700' }, danger: { borderColor: '#DF9898' }, dangerText: { color: '#B52F2F' }, message: { color: '#A23B35', marginBottom: 15 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, branchCard: { flexGrow: 1, flexBasis: 300, maxWidth: 480, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7E7F3', borderRadius: 16, padding: 18 }, cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, branchName: { color: '#17324D', fontSize: 17, fontWeight: '800' }, code: { color: '#6A8498', fontSize: 12, marginTop: 3 }, status: { textTransform: 'capitalize', fontSize: 12, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }, active: { color: '#167347', backgroundColor: '#E3F7EC' }, inactive: { color: '#A53631', backgroundColor: '#FCE9E8' }, location: { color: '#527087', lineHeight: 20, marginTop: 14 }, manager: { color: '#294C66', fontWeight: '700', marginTop: 12 },
});
