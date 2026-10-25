import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { CardSkeleton } from '../../components/AdminSkeleton';
import { StatusBadge } from '../../components/DashboardUi';
import LocationMap from '../../components/LocationMap';
import { BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { useAdminTheme } from '../../components/AdminTheme';
import { createBranch, getBranches, updateBranch } from '../../services/branchManagement';
import { requestCurrentLocation } from '../../services/location';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import TopToastFeedback from '../../components/TopToastFeedback';
import useUnsavedChangesGuard from '../../components/useUnsavedChangesGuard';
import { normalizeBranchDeliveryPricing } from '../../services/deliveryPricing';

const { DEFAULT_SERVICE_RADIUS_KM, TOLEDO_BARANGAYS, TOLEDO_CITY } = require('../../constants/toledoBarangays.json');
const RADIUS_CHOICES = [3, 5, 10, 15];
const empty = { name: '', code: '', barangay: '', city: TOLEDO_CITY, address: '', latitude: '', longitude: '', serviceRadiusKm: String(DEFAULT_SERVICE_RADIUS_KM), baseDeliveryFee: '20', includedRadiusKm: String(DEFAULT_SERVICE_RADIUS_KM), outsideRadiusFeePerKm: '10' };
const isValidLocation = (form) => Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude)) && form.latitude !== '' && form.longitude !== '';
export const parseCoordinateText = (value) => {
  const match = String(value || '').trim().match(/^(?:lat(?:itude)?\s*:\s*)?(-?\d+(?:\.\d+)?)\s*,\s*(?:(?:lng|lon|longitude)\s*:\s*)?(-?\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const latitude = Number(match[1]); const longitude = Number(match[2]);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null;
};

const displayBranchAddress = (branch) => {
  const address = String(branch.address || '').trim();
  const remaining = [branch.barangay, branch.city].filter((part) => part && !address.toLowerCase().includes(String(part).toLowerCase()));
  return [address, ...remaining].filter(Boolean).join(', ') || 'Address not provided';
};

function BranchActionWebStyles({ colors }) {
  if (Platform.OS !== 'web') return null;
  return React.createElement('style', {
    dangerouslySetInnerHTML: {
      __html: `
        button[data-admin-branch-edit="true"],
        button[data-admin-branch-primary="true"] {
          background-color: ${colors.primaryAction} !important;
          border-color: ${colors.primaryAction} !important;
        }
        button[data-admin-branch-edit="true"]:hover:not(:disabled),
        button[data-admin-branch-edit="true"]:focus-visible:not(:disabled),
        button[data-admin-branch-primary="true"]:hover:not(:disabled),
        button[data-admin-branch-primary="true"]:focus-visible:not(:disabled) {
          background-color: ${colors.primaryDeep || colors.primaryAction} !important;
          border-color: ${colors.primaryDeep || colors.primaryAction} !important;
        }
        button[data-admin-branch-edit="true"] > div,
        button[data-admin-branch-primary="true"] > div {
          color: ${colors.onPrimary} !important;
        }
        button[data-admin-branch-edit="true"]:disabled,
        button[data-admin-branch-primary="true"]:disabled {
          background-color: ${colors.neutral} !important;
          border-color: ${colors.border} !important;
          opacity: 1 !important;
        }
        button[data-admin-branch-edit="true"]:disabled > div,
        button[data-admin-branch-primary="true"]:disabled > div {
          color: ${colors.disabledText} !important;
        }
      `,
    },
  });
}

export default function AdminBranchesPage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  const { data, loading, refreshing, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.branches, getBranches);
  const branches = data || [];
  const contentScrollRef = React.useRef(null);
  const scrollToForm = React.useCallback(() => contentScrollRef.current?.scrollTo({ y: 0, animated: true }), []);
  const [form, setForm] = React.useState(empty); const [editingId, setEditingId] = React.useState(''); const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState({ visible: false, message: '', type: 'info' });
  const showToast = (msg, type = 'info') => setToast({ visible: true, message: msg, type });
  const [barangayOpen, setBarangayOpen] = React.useState(false); const [barangayQuery, setBarangayQuery] = React.useState(''); const [locating, setLocating] = React.useState(false); const [locationError, setLocationError] = React.useState('');
  const barangayFieldRef = React.useRef(null);
  const [coordinateText, setCoordinateText] = React.useState('');
  const customRadius = !RADIUS_CHOICES.includes(Number(form.serviceRadiusKm));
  const filteredBarangays = React.useMemo(() => TOLEDO_BARANGAYS.filter((barangay) => barangay.toLowerCase().includes(barangayQuery.trim().toLowerCase())), [barangayQuery]);
  React.useEffect(() => {
    if (!barangayOpen || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const closeOnOutsideInteraction = (event) => {
      if (!barangayFieldRef.current?.contains(event.target)) setBarangayOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setBarangayOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideInteraction, true);
    document.addEventListener('focusin', closeOnOutsideInteraction, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction, true);
      document.removeEventListener('focusin', closeOnOutsideInteraction, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [barangayOpen]);
  const edit = (branch) => {
    const pricing = normalizeBranchDeliveryPricing(branch);
    setEditingId(branch.id);
    setForm({
      name: branch.name || '',
      code: branch.code || '',
      barangay: branch.barangay || '',
      city: TOLEDO_CITY,
      address: branch.address || '',
      latitude: String(branch.latitude ?? ''),
      longitude: String(branch.longitude ?? ''),
      serviceRadiusKm: String(pricing.serviceRadiusKm),
      baseDeliveryFee: String(pricing.baseDeliveryFee),
      includedRadiusKm: String(pricing.includedRadiusKm),
      outsideRadiusFeePerKm: String(pricing.outsideRadiusFeePerKm),
    });
    setBarangayQuery(branch.barangay || '');
    setCoordinateText(branch.latitude == null ? '' : `${Number(branch.latitude).toFixed(6)}, ${Number(branch.longitude).toFixed(6)}`);
    setBarangayOpen(false);
    setLocationError('');
    requestAnimationFrame(scrollToForm);
  };
  const cancel = () => { setEditingId(''); setForm(empty); setBarangayQuery(''); setCoordinateText(''); setBarangayOpen(false); setLocationError(''); };

  const editingBranch = React.useMemo(() => branches.find((b) => b.id === editingId) || null, [branches, editingId]);
  const isBranchDirty = React.useMemo(() => {
    if (editingId && editingBranch) {
      const editingPricing = normalizeBranchDeliveryPricing(editingBranch);
      return (
        form.name !== (editingBranch.name || '') ||
        form.barangay !== (editingBranch.barangay || '') ||
        form.address !== (editingBranch.address || '') ||
        form.latitude !== String(editingBranch.latitude ?? '') ||
        form.longitude !== String(editingBranch.longitude ?? '') ||
        form.serviceRadiusKm !== String(editingPricing.serviceRadiusKm) ||
        form.baseDeliveryFee !== String(editingPricing.baseDeliveryFee) ||
        form.includedRadiusKm !== String(editingPricing.includedRadiusKm) ||
        form.outsideRadiusFeePerKm !== String(editingPricing.outsideRadiusFeePerKm)
      );
    }
    return (
      form.name.trim() !== '' ||
      form.code.trim() !== '' ||
      form.barangay.trim() !== '' ||
      form.address.trim() !== '' ||
      form.latitude !== '' ||
      form.longitude !== '' ||
      form.serviceRadiusKm !== String(DEFAULT_SERVICE_RADIUS_KM) ||
      form.baseDeliveryFee !== '20' ||
      form.includedRadiusKm !== String(DEFAULT_SERVICE_RADIUS_KM) ||
      form.outsideRadiusFeePerKm !== '10'
    );
  }, [editingId, editingBranch, form]);

  const { confirmLeave, UnsavedModal } = useUnsavedChangesGuard({
    isDirty: Boolean(editingId) || isBranchDirty,
    isSubmitting: saving,
    onDiscard: cancel,
    onContinueEditing: scrollToForm,
  });
  const guardNavigation = (proceed) => {
    if (saving) { showToast('Wait until the branch change finishes saving.', 'info'); return false; }
    return confirmLeave(proceed);
  };
  const setLocation = (location) => { setForm((current) => ({ ...current, latitude: location.latitude.toFixed(6), longitude: location.longitude.toFixed(6) })); setCoordinateText(`${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`); };
  const applyCoordinates = () => { const parsed = parseCoordinateText(coordinateText); if (!parsed) { setLocationError('Enter valid coordinates such as 10.123456, 123.456789.'); showToast('Unable to use these coordinates.', 'error'); return; } setLocationError(''); setLocation(parsed); showToast('Map pin moved to the pasted coordinates.', 'success'); };
  const useCurrentLocation = async () => {
    if (locating) return;
    setLocating(true); setLocationError('');
    try { setLocation(await requestCurrentLocation()); }
    catch (locationFailure) { setLocationError(locationFailure.message); }
    finally { setLocating(false); }
  };
  const selectBarangay = (barangay) => { setForm((current) => ({ ...current, barangay })); setBarangayQuery(barangay); setBarangayOpen(false); };
  const save = async () => {
    setSaving(true);
    try {
      const payload = { name: form.name, barangay: form.barangay, city: TOLEDO_CITY, address: form.address, latitude: Number(form.latitude), longitude: Number(form.longitude), serviceRadiusKm: Number(form.serviceRadiusKm), baseDeliveryFee: Number(form.baseDeliveryFee || 0), includedRadiusKm: Number(form.includedRadiusKm || form.serviceRadiusKm), outsideRadiusFeePerKm: Number(form.outsideRadiusFeePerKm || 0) };
      if (editingId) await updateBranch(editingId, payload); else await createBranch({ ...payload, code: form.code });
      const wasEditing = Boolean(editingId); cancel(); await refresh({ force: true }); const branchMsg = wasEditing ? 'Branch updated.' : 'Branch created.'; showToast(branchMsg, 'success');
    } catch (saveError) { showToast(saveError.message, 'error'); } finally { setSaving(false); }
  };
  const toggle = async (branch) => { setSaving(true); try { await updateBranch(branch.id, { status: branch.status === 'active' ? 'inactive' : 'active' }); await refresh({ force: true }); const toggleMsg = branch.status === 'active' ? 'Branch deactivated.' : 'Branch activated.'; showToast(toggleMsg, 'success'); } catch (toggleError) { showToast(toggleError.message, 'error'); } finally { setSaving(false); } };
  const previewLocation = isValidLocation(form) ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null;

  return <AdminShell title="Branches" subtitle="Create provider locations and set their normal delivery coverage." contentScrollRef={contentScrollRef} onNavigate={guardNavigation} overlay={<UnsavedModal title="Leave branch editing?" message="Keep editing this branch, or discard this edit and leave the page? Any unsaved changes will be lost." />}>
    <BranchActionWebStyles colors={colors} />
    <TopToastFeedback visible={toast.visible} message={toast.message} type={toast.type} onDismiss={() => setToast((t) => ({ ...t, visible: false }))} />
    <View style={[styles.formCard, styles.formCardRefined, !!editingId && styles.formCardEditing]}>
      <View style={styles.formIntro}>
        <Text style={[styles.eyebrow, styles.formIntroEyebrow]}>{editingId ? 'EDIT MODE' : 'BRANCH DIRECTORY'}</Text>
        <Text style={[styles.cardTitle, styles.formIntroTitle]}>{editingId ? 'Edit branch' : 'Create branch'}</Text>
        {!!editingId && <Text style={[styles.editNotice, styles.formIntroEditNotice]}>Editing {editingBranch?.name || form.name}. Save changes or cancel when you're done.</Text>}
        <Text style={[styles.help, styles.formIntroHint]}>Set up the branch address, pin its location, and configure delivery coverage.</Text>
      </View>
      <View style={[styles.formSection, barangayOpen && styles.formSectionDropdownOpen]}>
        <View style={styles.formSectionHeader}>
          <Text style={styles.formSectionNumber}>01</Text>
          <View style={styles.formSectionHeading}>
            <Text style={styles.formSectionTitle}>Branch details</Text>
            <Text style={styles.formSectionHint}>Identify this branch and choose its Toledo City address.</Text>
          </View>
        </View>
        <View style={styles.fields}>
        <Field styles={styles} label="Branch name"><TextInput value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} style={styles.input} /></Field>
        <Field styles={styles} label="Branch code"><TextInput editable={!editingId} value={form.code} onChangeText={(value) => setForm((current) => ({ ...current, code: value.toUpperCase() }))} style={[styles.input, editingId && styles.disabled, editingId && styles.readOnlyInput]} autoCapitalize="characters" /></Field>
        <Field styles={styles} label="Barangay" fieldRef={barangayFieldRef}><TextInput value={barangayOpen ? barangayQuery : form.barangay} placeholder="Search Toledo City barangays" placeholderTextColor={colors.muted} onFocus={() => { setBarangayQuery(form.barangay); setBarangayOpen(true); }} onChangeText={(value) => { setBarangayQuery(value); setBarangayOpen(true); }} style={styles.input} /><Text style={styles.fieldHint}>Search and select from the approved list.</Text>{barangayOpen && <View style={styles.combobox}><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.optionList}>{filteredBarangays.length ? filteredBarangays.map((barangay) => <TouchableOpacity key={barangay} onPress={() => selectBarangay(barangay)} style={[styles.option, form.barangay === barangay && styles.optionSelected]}><Text style={[styles.optionText, form.barangay === barangay && styles.optionTextSelected]}>{barangay}</Text></TouchableOpacity>) : <Text style={styles.noOptions}>No approved barangay found.</Text>}</ScrollView></View>}</Field>
        <Field styles={styles} label="City"><TextInput editable={false} value={TOLEDO_CITY} style={[styles.input, styles.disabled, styles.readOnlyInput]} /></Field>
        <Field styles={styles} label="Street / Landmark / Address" wide><TextInput value={form.address} onChangeText={(value) => setForm((current) => ({ ...current, address: value }))} placeholder="Street, landmark, or detailed address" placeholderTextColor={colors.muted} style={styles.input} /></Field>
        </View>
      </View>
      <View style={styles.formSection}>
        <View style={styles.formSectionHeader}>
          <Text style={styles.formSectionNumber}>02</Text>
          <View style={styles.formSectionHeading}>
            <Text style={styles.formSectionTitle}>Location pin</Text>
            <Text style={styles.formSectionHint}>Use your current location, paste coordinates, or place the pin on the map.</Text>
          </View>
        </View>
      <View style={[styles.coordinatePaste, styles.coordinatePasteRefined]}><TextInput accessibilityLabel="Paste branch coordinates" value={coordinateText} onChangeText={setCoordinateText} onSubmitEditing={applyCoordinates} placeholder="Paste: 10.123456, 123.456789" placeholderTextColor={colors.muted} style={[styles.input, styles.coordinateInput]} /><TouchableOpacity onPress={applyCoordinates} style={styles.secondary}><Text style={styles.secondaryText}>Use coordinates</Text></TouchableOpacity></View>
      <View style={styles.locationActions}><TouchableOpacity accessibilityRole="button" dataSet={{ adminBranchPrimary: 'true' }} disabled={locating} onPress={useCurrentLocation} style={[styles.primary, locating && styles.primaryDisabled]}><Text style={[styles.primaryText, locating && styles.primaryTextDisabled]}>{locating ? 'Finding your location…' : 'Use my current location'}</Text></TouchableOpacity><Text style={styles.locationHint}>Requests permission once and never tracks continuously.</Text></View>
      {!!locationError && <View accessibilityRole="alert" style={styles.errorNotice}><Text style={styles.errorText}>{locationError}</Text><TouchableOpacity onPress={useCurrentLocation}><Text style={styles.retry}>Retry location</Text></TouchableOpacity></View>}
        <Text style={styles.mapLabel}>Map preview</Text><LocationMap location={previewLocation} branches={[]} onLocationChange={setLocation} markerLabel="Branch pin" serviceRadiusKm={Number(form.serviceRadiusKm) || DEFAULT_SERVICE_RADIUS_KM} />
        <View style={styles.coordinates}><Text style={styles.coordinatesLabel}>PIN COORDINATES</Text><Text style={styles.coordinatesValue}>{previewLocation ? `${previewLocation.latitude.toFixed(6)}, ${previewLocation.longitude.toFixed(6)}` : 'Pin the branch using GPS or the map.'}</Text></View>
      </View>
      <View style={styles.formSection}>
        <View style={styles.formSectionHeader}>
          <Text style={styles.formSectionNumber}>03</Text>
          <View style={styles.formSectionHeading}>
            <Text style={styles.formSectionTitle}>Coverage & pricing</Text>
            <Text style={styles.formSectionHint}>Set the normal service area and the branch delivery fee.</Text>
          </View>
        </View>
      <View style={[styles.coverage, styles.coverageRefined]}><Text style={styles.coverageTitle}>Delivery coverage</Text><Text style={styles.coverageHint}>Normal delivery area. It is set by Admin and is never inferred from GPS.</Text><View style={styles.radiusChoices}>{RADIUS_CHOICES.map((radius) => <TouchableOpacity key={radius} accessibilityRole="radio" accessibilityState={{ selected: Number(form.serviceRadiusKm) === radius }} onPress={() => setForm((current) => ({ ...current, serviceRadiusKm: String(radius) }))} style={[styles.radiusChoice, Number(form.serviceRadiusKm) === radius && styles.radiusChoiceSelectedSoft]}><Text style={[styles.radiusChoiceText, Number(form.serviceRadiusKm) === radius && styles.radiusChoiceTextSelectedSoft]}>{radius} km</Text></TouchableOpacity>)}<TouchableOpacity accessibilityRole="radio" accessibilityState={{ selected: customRadius }} onPress={() => setForm((current) => ({ ...current, serviceRadiusKm: customRadius ? String(DEFAULT_SERVICE_RADIUS_KM) : '' }))} style={[styles.radiusChoice, customRadius && styles.radiusChoiceSelectedSoft]}><Text style={[styles.radiusChoiceText, customRadius && styles.radiusChoiceTextSelectedSoft]}>Custom</Text></TouchableOpacity></View>{customRadius && <TextInput value={form.serviceRadiusKm} onChangeText={(value) => setForm((current) => ({ ...current, serviceRadiusKm: value }))} keyboardType="decimal-pad" placeholder="Custom radius in km" placeholderTextColor={colors.muted} style={[styles.input, styles.customRadiusInput]} />}</View>
      <View style={[styles.coverage, styles.coverageSecondary]}>
        <Text style={styles.coverageTitle}>Delivery Fee Settings</Text>
        <Text style={styles.coverageHint}>Configure the standard delivery fee and extra distance rate for this branch.</Text>
        <View style={styles.fields}>
          <Field styles={styles} label="Base delivery fee (₱)"><TextInput value={form.baseDeliveryFee} onChangeText={(value) => setForm((c) => ({ ...c, baseDeliveryFee: value }))} keyboardType="decimal-pad" placeholder="e.g. 20" placeholderTextColor={colors.muted} style={styles.input} /></Field>
          <Field styles={styles} label="Included radius (km)"><TextInput value={form.includedRadiusKm} onChangeText={(value) => setForm((c) => ({ ...c, includedRadiusKm: value }))} keyboardType="decimal-pad" placeholder="e.g. 5" placeholderTextColor={colors.muted} style={styles.input} /></Field>
          <Field styles={styles} label="Outside radius fee / km (₱)"><TextInput value={form.outsideRadiusFeePerKm} onChangeText={(value) => setForm((c) => ({ ...c, outsideRadiusFeePerKm: value }))} keyboardType="decimal-pad" placeholder="e.g. 10" placeholderTextColor={colors.muted} style={styles.input} /></Field>
        </View>
      </View>
      </View>
      <View style={styles.formFooter}>
        <Text style={styles.formFooterHint}>Review the address, map pin, and delivery fees before saving.</Text>
        <View style={styles.formFooterActions}>{!!editingId && <TouchableOpacity style={styles.secondary} onPress={() => confirmLeave(cancel)}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>}<TouchableOpacity accessibilityRole="button" dataSet={{ adminBranchPrimary: 'true' }} disabled={saving} style={[styles.primary, styles.formSubmit, saving && styles.primaryDisabled]} onPress={save}><Text style={[styles.primaryText, saving && styles.primaryTextDisabled]}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create branch'}</Text></TouchableOpacity></View>
      </View>
    </View>
    <View style={styles.listHeader}><View><Text style={styles.listTitle}>Existing branches</Text><Text style={styles.listHelp}>Only active branches with coordinates are shown to Requesters.</Text></View><Text style={styles.total}>{refreshing ? 'Refreshing…' : `${branches.length} total`}</Text></View>
    {error ? <View style={styles.empty}><Text style={styles.noticeText}>{error}</Text><TouchableOpacity onPress={() => refresh({ force: true })}><Text style={styles.retry}>Try again</Text></TouchableOpacity></View> : loading && !data ? <View style={styles.grid}>{[1, 2, 3].map((key) => <CardSkeleton key={key} style={styles.skeleton} />)}</View> : branches.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No branches yet</Text></View> : <View style={styles.grid}>{branches.map((branch) => {
      const pricing = normalizeBranchDeliveryPricing(branch);
      const managers = branch.managers?.map((manager) => `${manager.firstName || ''} ${manager.lastName || ''}`.trim() || manager.email).filter(Boolean) || [];
      return <View key={branch.id} style={[styles.branchCard, styles.directoryCard]}>
        <View style={styles.directoryHeader}>
          <View style={styles.branchHeading}>
            <Text style={styles.directoryEyebrow}>BRANCH {branch.code}</Text>
            <Text style={styles.branchName}>{branch.name}</Text>
          </View>
          <StatusBadge status={branch.status} />
        </View>
        <View style={styles.directoryLocation}>
          <Text style={styles.directoryLabel}>LOCATION</Text>
          <Text style={styles.directoryAddress}>{displayBranchAddress(branch)}</Text>
          <Text style={styles.directoryCoordinates}>{branch.latitude == null ? 'Location pin required' : `${branch.latitude.toFixed(5)}, ${branch.longitude.toFixed(5)}`}</Text>
        </View>
        <View style={styles.directoryPricing}>
          <View style={styles.directoryPricingRow}>
            <Text style={styles.directoryPricingLabel}>Normal delivery area</Text>
            <Text style={styles.directoryPricingValue}>{pricing.serviceRadiusKm} km</Text>
          </View>
          <View style={styles.directoryDivider} />
          <View style={styles.directoryPricingRow}>
            <View style={styles.directoryPricingCopy}>
              <Text style={styles.directoryPricingLabel}>Delivery fee</Text>
              <Text style={styles.directoryPricingHint}>First {pricing.includedRadiusKm} km · +₱{pricing.outsideRadiusFeePerKm}/km outside</Text>
            </View>
            <Text style={styles.directoryPricingValue}>₱{pricing.baseDeliveryFee}</Text>
          </View>
        </View>
        <View style={styles.directoryManagers}>
          <Text style={styles.directoryLabel}>MANAGERS</Text>
          <Text style={[styles.directoryManagerNames, !managers.length && styles.directoryMuted]}>{managers.length ? managers.join(', ') : 'Unassigned'}</Text>
        </View>
        <View style={styles.directoryActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${branch.name}`} dataSet={{ adminBranchEdit: 'true' }} disabled={saving} style={[styles.directoryAction, styles.directoryEdit, saving && styles.directoryEditDisabled]} onPress={() => confirmLeave(() => edit(branch))}>
            <Text style={[styles.directoryEditText, saving && styles.directoryEditTextDisabled]}>Edit branch</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${branch.status === 'active' ? 'Deactivate' : 'Activate'} ${branch.name}`} disabled={saving} style={[styles.directoryAction, styles.directoryToggle, { borderColor: branch.status === 'active' ? colors.danger : colors.success }, saving && styles.buttonDisabled]} onPress={() => toggle(branch)}>
            <Text style={[styles.directoryToggleText, { color: branch.status === 'active' ? colors.danger : colors.success }]}>{branch.status === 'active' ? 'Deactivate' : 'Activate'}</Text>
          </TouchableOpacity>
        </View>
      </View>;
    })}</View>}
  </AdminShell>;
}

function Field({ styles, label, wide = false, fieldRef, children }) { return <View ref={fieldRef} style={[styles.field, wide && styles.fieldWide, label === 'Barangay' && { zIndex: 100, elevation: 20 }]}><Text style={styles.label}>{label}</Text>{children}</View>; }

const createStyles = (colors) => {
  const styles = StyleSheet.create({
    formCard:{marginTop:18,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:20,marginBottom:18,...BLUETAP_LAYOUT.shadow},formCardEditing:{borderWidth:2,borderColor:colors.primaryAction},editNotice:{color:colors.primary,fontSize:13,fontWeight:'800',marginTop:6},eyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:.8},cardTitle:{color:colors.textPrimary,fontSize:19,fontWeight:'900',marginTop:4},help:{color:colors.textSecondary,fontSize:13,lineHeight:19,marginTop:5,marginBottom:16},fields:{flexDirection:'row',flexWrap:'wrap',gap:12},field:{minWidth:210,flex:1,position:'relative'},fieldWide:{flexBasis:'100%'},label:{color:colors.textSecondary,fontSize:12,fontWeight:'800',marginBottom:6},input:{minHeight:46,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12,color:colors.textPrimary,outlineStyle:'none'},disabled:{backgroundColor:colors.neutral,color:colors.disabled},fieldHint:{color:colors.muted,fontSize:10,marginTop:4},combobox:{position:'absolute',top:75,left:0,right:0,zIndex:20,maxHeight:218,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.inputBorder,borderRadius:10,...BLUETAP_LAYOUT.shadow},optionList:{maxHeight:216},option:{minHeight:39,paddingHorizontal:12,justifyContent:'center',borderBottomWidth:1,borderBottomColor:colors.border},optionSelected:{backgroundColor:colors.primarySoft},optionText:{color:colors.textPrimary,fontSize:13,fontWeight:'700'},optionTextSelected:{color:colors.primary},noOptions:{color:colors.textSecondary,padding:12,fontSize:12},locationActions:{flexDirection:'row',alignItems:'center',gap:12,flexWrap:'wrap',marginTop:18},locationHint:{color:colors.textSecondary,fontSize:11,flex:1,minWidth:180},mapLabel:{color:colors.textPrimary,fontSize:13,fontWeight:'900',marginTop:18,marginBottom:8},errorNotice:{backgroundColor:colors.dangerSoft,borderWidth:1,borderColor:colors.danger,padding:12,borderRadius:10,marginTop:12},errorText:{color:colors.danger,fontWeight:'700',fontSize:12,lineHeight:18},retry:{color:colors.primary,fontWeight:'900',marginTop:7},coverage:{marginTop:18,padding:14,backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,borderRadius:12},coverageTitle:{color:colors.textPrimary,fontSize:14,fontWeight:'900'},coverageHint:{color:colors.textSecondary,fontSize:11,lineHeight:16,marginTop:3},radiusChoices:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:12},radiusChoice:{minHeight:38,paddingHorizontal:12,borderWidth:1,borderColor:colors.inputBorder,borderRadius:9,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},radiusChoiceSelected:{borderColor:colors.primaryAction,backgroundColor:colors.primaryAction},radiusChoiceText:{color:colors.textPrimary,fontSize:12,fontWeight:'800'},radiusChoiceTextSelected:{color:colors.onPrimary},customRadiusInput:{marginTop:10,maxWidth:250},coordinates:{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:14},coordinatesLabel:{color:colors.textSecondary,fontSize:12,fontWeight:'900'},coordinatesValue:{color:colors.primary,fontSize:12,fontWeight:'800'},actions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:10,marginTop:16},primary:{minHeight:44,paddingHorizontal:18,borderRadius:10,backgroundColor:colors.primaryAction,justifyContent:'center',alignItems:'center'},primaryText:{color:colors.onPrimary,fontWeight:'900'},buttonDisabled:{opacity:.55},secondary:{minHeight:42,paddingHorizontal:16,borderWidth:1,borderColor:colors.inputBorder,borderRadius:10,justifyContent:'center',backgroundColor:colors.surface},secondaryText:{color:colors.primary,fontWeight:'800'},danger:{borderColor:colors.danger},dangerText:{color:colors.danger},notice:{backgroundColor:colors.primarySoft,borderWidth:1,borderColor:colors.border,padding:12,borderRadius:10,marginBottom:15},noticeText:{color:colors.textPrimary,fontWeight:'700'},listHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:8,marginBottom:12},listTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'900'},listHelp:{color:colors.textSecondary,fontSize:12,marginTop:3},total:{color:colors.primary,fontSize:12,fontWeight:'800',backgroundColor:colors.primarySoft,borderRadius:999,paddingHorizontal:10,paddingVertical:6},grid:{flexDirection:'row',flexWrap:'wrap',gap:14},skeleton:{flexBasis:300,maxWidth:480},branchCard:{flexGrow:1,flexBasis:300,maxWidth:480,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:18,...BLUETAP_LAYOUT.shadow},row:{flexDirection:'row',justifyContent:'space-between',gap:12},branchHeading:{flex:1,minWidth:0},branchName:{color:colors.textPrimary,fontSize:17,fontWeight:'900'},code:{color:colors.textSecondary,fontSize:12,marginTop:3},location:{color:colors.textSecondary,lineHeight:20,marginTop:14},coverageCard:{color:colors.textPrimary,fontSize:12,fontWeight:'800',marginTop:6},manager:{color:colors.textPrimary,fontWeight:'700',marginTop:12},empty:{alignItems:'center',padding:34,borderWidth:1,borderStyle:'dashed',borderColor:colors.border,borderRadius:16,backgroundColor:colors.surfaceAlt},emptyTitle:{color:colors.textPrimary,fontSize:17,fontWeight:'900'},
    coordinatePaste:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:10,marginTop:18,zIndex:1},
    coordinateInput:{flexGrow:1,flexBasis:280,minWidth:0},
    formCardRefined:{padding:0,borderRadius:18},
    formIntro:{paddingHorizontal:22,paddingTop:22,paddingBottom:20,backgroundColor:colors.primaryAction,borderTopLeftRadius:18,borderTopRightRadius:18},
    formIntroEyebrow:{color:colors.onPrimary},
    formIntroTitle:{color:colors.onPrimary,fontSize:23,marginTop:6},
    formIntroEditNotice:{color:colors.onPrimary},
    formIntroHint:{color:colors.onPrimary,marginTop:8,marginBottom:0,maxWidth:680},
    formSection:{padding:20,borderBottomWidth:1,borderBottomColor:colors.border},
    formSectionDropdownOpen:{position:'relative',zIndex:100,elevation:20},
    formSectionHeader:{flexDirection:'row',alignItems:'flex-start',gap:12,marginBottom:16},
    formSectionNumber:{width:34,height:34,lineHeight:34,textAlign:'center',borderRadius:10,backgroundColor:colors.primarySoft,color:colors.iconPrimary,fontSize:12,fontWeight:'900'},
    formSectionHeading:{flex:1,minWidth:0},
    formSectionTitle:{color:colors.textPrimary,fontSize:16,fontWeight:'900'},
    formSectionHint:{color:colors.textSecondary,fontSize:12,lineHeight:18,marginTop:3},
    coordinatePasteRefined:{marginTop:0},
    coverageRefined:{marginTop:0},
    coverageSecondary:{marginTop:12},
    radiusChoiceSelectedSoft:{backgroundColor:colors.primarySoft,borderColor:colors.primaryAction,borderWidth:2},
    radiusChoiceTextSelectedSoft:{color:colors.iconPrimary,fontWeight:'900'},
    formFooter:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:14,padding:20,backgroundColor:colors.surfaceAlt,borderBottomLeftRadius:18,borderBottomRightRadius:18},
    formFooterHint:{flex:1,minWidth:180,color:colors.textSecondary,fontSize:12,lineHeight:18},
    formFooterActions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10},
    formSubmit:{minWidth:154},
    readOnlyInput:{color:colors.disabledText},
    primaryDisabled:{backgroundColor:colors.neutral,borderColor:colors.border},
    primaryTextDisabled:{color:colors.disabledText},
    directoryCard:{padding:0},
    directoryHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12,paddingHorizontal:18,paddingTop:18,paddingBottom:16},
    directoryEyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:1,marginBottom:5},
    directoryLocation:{paddingHorizontal:18,paddingBottom:16},
    directoryLabel:{color:colors.textSecondary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:6},
    directoryAddress:{color:colors.textPrimary,fontSize:13,fontWeight:'700',lineHeight:19},
    directoryCoordinates:{color:colors.textSecondary,fontSize:11,marginTop:5},
    directoryPricing:{marginHorizontal:18,padding:14,backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,borderRadius:12,gap:11},
    directoryPricingRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},
    directoryPricingCopy:{flex:1,minWidth:0},
    directoryPricingLabel:{color:colors.textSecondary,fontSize:11,fontWeight:'700',flexShrink:1},
    directoryPricingHint:{color:colors.textSecondary,fontSize:11,lineHeight:16,marginTop:3},
    directoryPricingValue:{color:colors.textPrimary,fontSize:15,fontWeight:'900',flexShrink:0},
    directoryDivider:{height:1,backgroundColor:colors.border},
    directoryManagers:{paddingHorizontal:18,paddingVertical:16,flex:1},
    directoryManagerNames:{color:colors.textPrimary,fontSize:12,fontWeight:'700',lineHeight:18},
    directoryMuted:{color:colors.textSecondary},
    directoryActions:{flexDirection:'row',flexWrap:'wrap',gap:10,padding:14,borderTopWidth:1,borderTopColor:colors.border,backgroundColor:colors.surfaceAlt,borderBottomLeftRadius:16,borderBottomRightRadius:16},
    directoryAction:{flexGrow:1,minWidth:110,minHeight:44,paddingHorizontal:12,borderWidth:1,borderRadius:10,alignItems:'center',justifyContent:'center'},
    directoryEdit:{backgroundColor:colors.primaryAction,borderColor:colors.primaryAction},
    directoryEditText:{color:colors.onPrimary,fontSize:12,fontWeight:'900'},
    directoryEditDisabled:{backgroundColor:colors.neutral,borderColor:colors.border},
    directoryEditTextDisabled:{color:colors.disabledText},
    directoryToggle:{backgroundColor:colors.surface},
    directoryToggleText:{fontSize:12,fontWeight:'900'},
  });
  return styles;
};
