import React from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { saveAdminPromotionDraft, changeAdminPromotionStatus } from '../services/adminProducts';
const { manilaDateTimeFields, manilaDateTimeToIso } = require('../services/promotionSchedule');
const { promotionStatus, samplePromotionTiers, promotionDraftFingerprint } = require('../services/adminPromotionDraft');

const blankTier = () => ({ quantity: '', price: '' });
const money = (value) => `₱${value.toFixed(2)}`;
const fromCents = (value) => Number.isSafeInteger(value) ? (value / 100).toFixed(2) : '';
const parseCents = (value) => {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(result) ? result : null;
};

export default function AdminBundlePromotionModal({ product, branches, colors, onClose, onSaved }) {
  const { width } = useWindowDimensions();
  const [draft, setDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [notice, setNotice] = React.useState('');
  const [confirmSample, setConfirmSample] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState(null);
  const initialDraft = React.useRef('');
  const [statusClock, setStatusClock] = React.useState(Date.now());
  React.useEffect(() => {
    if (!product) return;
    const saved = product.bundlePromotion;
    const start = manilaDateTimeFields(saved?.startsAt);
    const end = manilaDateTimeFields(saved?.endsAt);
    const next = { title: saved?.title || '', verified: saved?.commercialEligibility === 'refill_verified', branchIds: saved?.branchIds || [], containerChoices: saved?.containerChoices || [], tiers: saved?.tiers?.length ? saved.tiers.map((tier) => ({ quantity: String(tier.quantity), price: fromCents(tier.bundlePriceCentavos) })) : [blankTier()], startMode: saved?.startMode || (saved?.startsAt ? 'scheduled' : 'activation'), startDate: start.date, startTime: start.time, durationMode: saved?.endsAt ? 'scheduled' : 'indefinite', endDate: end.date, endTime: end.time, expectedVersion: saved?.version || 0 };
    initialDraft.current = JSON.stringify(next);
    setDraft(next);
    setError(''); setNotice(''); setFieldErrors({}); setConfirmSample(false); setConfirmAction(null); setStatusClock(Date.now());
  }, [product]);
  React.useEffect(() => {
    const now = Date.now();
    const boundaries = [product?.bundlePromotion?.startsAt, product?.bundlePromotion?.endsAt].filter(Boolean).map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value) && value > now);
    if (!boundaries.length) return undefined;
    const delay = Math.min(...boundaries) - now;
    const timer = setTimeout(() => setStatusClock(Date.now()), Math.min(2147483646, delay + 1));
    return () => clearTimeout(timer);
  }, [product, statusClock]);
  const label = { color: colors.textPrimary, fontWeight: '700', marginTop: 10, marginBottom: 5 };
  const muted = { color: colors.textSecondary, flexShrink: 1 };
  const input = { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, color: colors.textPrimary, backgroundColor: colors.surface, minWidth: 0 };
  const button = { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' };
  const patch = (field, value) => { setFieldErrors({}); setError(''); setNotice(''); setDraft((current) => ({ ...current, [field]: value })); };
  const toggle = (field, value) => patch(field, draft[field].includes(value) ? draft[field].filter((item) => item !== value) : [...draft[field], value]);
  const choices = branches.filter((branch) => !product?.branchIds?.length || product.branchIds.includes(branch.id));
  const selectedLimits = (draft?.branchIds || []).map((id) => {
    const limits = product?.promotionBranchLimits;
    return limits && Object.prototype.hasOwnProperty.call(limits, id) ? limits[id] : product?.maxQuantityPerRequester;
  }).filter((limit) => Number.isInteger(limit) && limit > 0);
  const maxQuantity = selectedLimits.length ? Math.min(...selectedLimits) : 100;
  const status = promotionStatus(product?.bundlePromotion, statusClock);
  const activeRecord = product?.bundlePromotion?.active === true;
  const unsavedDraft = draft && JSON.stringify(draft) !== initialDraft.current;
  const unit = parseCents(String(product?.price));
  const samples = draft?.branchIds?.length ? samplePromotionTiers(unit, maxQuantity) : [];
  const applySample = () => { patch('tiers', samples); setConfirmSample(false); };
  const fillSample = () => {
    if (!samples.length) { setFieldErrors({ tiers: 'Choose eligible branches and a positive product price for sample tiers.' }); return; }
    if (draft.tiers.some((tier) => tier.quantity.trim() || tier.price.trim())) setConfirmSample(true);
    else applySample();
  };
  const save = async () => {
    if (!draft || saving || savingRef.current || activeRecord) return;
    const tiers = draft.tiers.map((tier) => ({ quantity: Number(tier.quantity), bundlePriceCentavos: parseCents(tier.price) }));
    const errors = {};
    if (!draft.title.trim()) errors.title = 'Enter a promotion title.';
    if (!draft.verified) errors.verified = 'Confirm that this product is a refill.';
    if (!draft.branchIds.length) errors.branchIds = 'Select at least one branch.';
    if (!draft.containerChoices.length) errors.containerChoices = 'Select at least one container choice.';
    if (unit === null || unit <= 0 || !tiers.length) errors.tiers = 'Enter a positive product price and at least one bundle tier.';
    else if (tiers.some((tier) => !Number.isSafeInteger(tier.quantity) || tier.quantity < 1 || tier.quantity > maxQuantity)) errors.tiers = `Use whole quantities from 1 to ${maxQuantity}.`;
    else if (new Set(tiers.map((tier) => tier.quantity)).size !== tiers.length) errors.tiers = 'Each tier must use a different quantity.';
    else if (tiers.some((tier) => !Number.isSafeInteger(tier.quantity * unit) || tier.bundlePriceCentavos === null || tier.bundlePriceCentavos <= 0 || tier.bundlePriceCentavos >= tier.quantity * unit)) errors.tiers = 'Every bundle price must be positive and below its regular total.';
    const startsAt = draft.startMode === 'scheduled' ? manilaDateTimeToIso(draft.startDate, draft.startTime) : null;
    const endsAt = draft.durationMode === 'scheduled' ? manilaDateTimeToIso(draft.endDate, draft.endTime) : null;
    if (draft.startMode === 'scheduled' && !startsAt) errors.start = 'Choose a valid start date and time.';
    if (draft.durationMode === 'scheduled' && !endsAt) errors.end = 'Choose a valid end date and time.';
    if (endsAt && (startsAt ? Date.parse(endsAt) <= Date.parse(startsAt) : Date.parse(endsAt) <= Date.now())) errors.end = 'The end must be after the start and, for an immediate start, in the future.';
    const payload = { expectedVersion: draft.expectedVersion, title: draft.title.trim(), commercialEligibility: draft.verified ? 'refill_verified' : '', active: false, branchIds: draft.branchIds, containerChoices: draft.containerChoices, tiers, startMode: draft.startMode, startsAt, endsAt };
    if (product.bundlePromotion && (draft.startMode !== 'scheduled' || startsAt) && (draft.durationMode !== 'scheduled' || endsAt) && promotionDraftFingerprint(payload) === promotionDraftFingerprint(product.bundlePromotion)) { setFieldErrors({}); setNotice('No changes to save. Your draft is already up to date.'); setError(''); return; }
    if (Object.keys(errors).length) { setFieldErrors(errors); setNotice(''); return; }
    savingRef.current = true; setSaving(true); setError(''); setNotice('');
    try {
      await saveAdminPromotionDraft(product.id, payload);
      await onSaved(product.bundlePromotion ? 'updated' : 'created');
    } catch (err) { setError(err.message || 'The draft could not be saved.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const changeStatus = async () => {
    if (!confirmAction || saving || savingRef.current || !product?.bundlePromotion ||
        (confirmAction === 'publish' ? !product?.promotionActivationAvailable : !product?.promotionDisableAvailable)) return;
    if (confirmAction === 'publish' && unsavedDraft) { setConfirmAction(null); setError('Save your draft before publishing.'); return; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      await changeAdminPromotionStatus(product.id, confirmAction, product.bundlePromotion.version);
      const action = confirmAction; setConfirmAction(null); await onSaved(action);
    } catch (err) { setConfirmAction(null); setError(err.message || 'The promotion status could not be changed.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const issue = (key) => fieldErrors[key] ? <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{fieldErrors[key]}</Text> : null;
  const choice = (title, selected, onPress, role = 'checkbox') => <TouchableOpacity key={title} accessibilityRole={role} accessibilityState={{ checked: selected }} onPress={onPress} style={[button, selected && { borderColor: colors.primaryAction, backgroundColor: colors.primarySoft }]}><Text style={{ color: colors.textPrimary, fontWeight: selected ? '700' : '400' }}>{selected ? '☑' : '☐'} {title}</Text></TouchableOpacity>;
  const dateTime = (prefix) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {['Date', 'Time'].map((part) => {
      const field = `${prefix}${part}`;
      const accessibilityLabel = `Promotion ${prefix} ${part.toLowerCase()}`;
      const shared = { value: draft[field], style: [input, { flexGrow: 1, flexBasis: part === 'Date' ? 160 : 120 }] };
      return <View key={field} style={{ flexGrow: 1, flexBasis: part === 'Date' ? 160 : 120, minWidth: 0 }}><Text style={muted}>{part}</Text>{Platform.OS === 'web'
        ? React.createElement('input', { type: part.toLowerCase(), 'aria-label': accessibilityLabel, value: shared.value, onChange: (event) => patch(field, event.target.value), ...(part === 'Time' ? { step: '0.001' } : {}), style: { ...input, width: '100%', boxSizing: 'border-box' } })
        : <TextInput accessibilityLabel={accessibilityLabel} placeholder={part === 'Date' ? 'YYYY-MM-DD' : 'HH:MM'} placeholderTextColor={colors.placeholder} value={shared.value} onChangeText={(value) => patch(field, value)} style={shared.style} />}</View>;
    })}
  </View>;
  const panel = { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginTop: 10 };
  const heading = { color: colors.textPrimary, fontWeight: '900', fontSize: 15 };
  const summary = (draft?.branchIds || []).map((id) => branches.find((branch) => branch.id === id)?.name || 'Unavailable branch').join(', ') || 'None selected';
  const scheduleLabel = (mode, date, time, fallback) => mode === 'scheduled' ? (date && time ? `${date} ${time} PHT` : 'Choose date and time') : fallback;
  return <><Modal visible={Boolean(product && draft)} transparent animationType="fade" onRequestClose={() => { if (!saving) onClose(); }}>
    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <View style={{ width: '100%', maxWidth: 620, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Text accessibilityRole="header" style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '800', flexShrink: 1 }}>Bundle Promotions</Text><Text accessibilityLabel={`Promotion status: ${status}`} style={{ color: status === 'Active' ? colors.success : colors.primaryAction, backgroundColor: colors.primarySoft, fontWeight: '800', fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>{status}</Text></View>
        <Text style={[muted, { marginTop: 3 }]}>{product?.product_name} · {product ? money(Number(product.price)) : '—'} per unit</Text>
        {Boolean(product && draft) && <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          <View style={panel}><Text style={heading}>Promotion Overview</Text>
          <Text style={label}>Promotion title</Text><TextInput accessibilityLabel="Promotion title" value={draft.title} onChangeText={(v) => patch('title', v)} style={input} />{issue('title')}
          <Text style={[muted, { fontSize: 12, lineHeight: 18, marginTop: 8 }]}>Branches: {summary}{'\n'}Containers: {draft.containerChoices.join(', ') || 'None selected'} · Tiers: {draft.tiers.filter((tier) => tier.quantity.trim() && tier.price.trim()).length}{'\n'}Start: {scheduleLabel(draft.startMode, draft.startDate, draft.startTime, 'When activated')}{'\n'}End: {scheduleLabel(draft.durationMode, draft.endDate, draft.endTime, 'No end date')}</Text></View>
          <View style={panel}><Text style={heading}>Eligible Products &amp; Branches</Text>
          <Text style={[muted, { marginTop: 5 }]}>Verify the refill and choose where this offer applies.</Text>{choice('Verified refill product', draft.verified, () => patch('verified', !draft.verified))}{issue('verified')}
          <Text style={label}>Eligible branches</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{choices.map((branch) => choice(branch.name, draft.branchIds.includes(branch.id), () => toggle('branchIds', branch.id)))}</View>{issue('branchIds')}
          <Text style={label}>Allowed containers</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{['Exchange', 'New Container'].map((value) => choice(value, draft.containerChoices.includes(value), () => toggle('containerChoices', value)))}</View>{issue('containerChoices')}</View>
          <View style={panel}><Text style={heading}>Bundle Pricing Tiers</Text><Text style={[muted, { marginVertical: 6, fontSize: 12 }]}>Exact quantities only; bundles do not combine. {maxQuantity < 100 ? `Selected branches allow up to ${maxQuantity}.` : 'Maximum quantity: 100.'}</Text>
          {draft.tiers.map((tier, index) => { const qty = Number(tier.quantity); const price = parseCents(tier.price); const regularCents = unit !== null && Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(unit * qty) ? unit * qty : null; const regular = regularCents === null ? null : regularCents / 100; const savings = price === null || regularCents === null ? null : (regularCents - price) / 100; return <View key={index} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, marginBottom: 7, gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <TextInput accessibilityLabel={`Tier ${index + 1} quantity`} placeholder="Quantity" placeholderTextColor={colors.placeholder} keyboardType="number-pad" value={tier.quantity} onChangeText={(value) => patch('tiers', draft.tiers.map((t, i) => i === index ? { ...t, quantity: value } : t))} style={[input, { flexGrow: 1, flexBasis: 90 }]} />
              <TextInput accessibilityLabel={`Tier ${index + 1} bundle price`} placeholder="Bundle price" placeholderTextColor={colors.placeholder} keyboardType="decimal-pad" value={tier.price} onChangeText={(value) => patch('tiers', draft.tiers.map((t, i) => i === index ? { ...t, price: value } : t))} style={[input, { flexGrow: 1, flexBasis: 120 }]} />
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove tier ${index + 1}`} onPress={() => patch('tiers', draft.tiers.filter((_, i) => i !== index))} style={button}><Text style={muted}>Remove</Text></TouchableOpacity>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Regular {Number.isFinite(regular) && qty > 0 ? money(regular) : '—'}</Text><Text style={{ color: colors.primaryAction, fontWeight: '800' }}>Bundle {price === null ? '—' : money(price / 100)} · Save {savings === null || !Number.isFinite(savings) || savings <= 0 ? '—' : money(savings)}</Text>
          </View>; })}
          {issue('tiers')}<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}><TouchableOpacity accessibilityRole="button" onPress={() => patch('tiers', [...draft.tiers, blankTier()])} style={button}><Text style={{ color: colors.primaryAction, fontWeight: '700' }}>Add tier</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={!samples.length} accessibilityState={{ disabled: !samples.length }} onPress={fillSample} style={[button, !samples.length && { opacity: 0.55 }]}><Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Fill sample tiers</Text></TouchableOpacity></View><Text style={[muted, { fontSize: 11, marginTop: 5 }]}>Suggestions scale with the unit price; review before saving.</Text></View>
          <View style={panel}><Text style={heading}>Promotion Schedule</Text><Text style={[muted, { fontSize: 12, marginTop: 5 }]}>Philippine Time (UTC+08:00)</Text>
          <Text style={label}>Start</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 6, marginTop: 5 }}>{choice('Start when activated', draft.startMode === 'activation', () => patch('startMode', 'activation'), 'radio')}{choice('Schedule start date and time', draft.startMode === 'scheduled', () => patch('startMode', 'scheduled'), 'radio')}</View>
          {draft.startMode === 'scheduled' && dateTime('start')}{issue('start')}
          <Text style={label}>Duration</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 6, marginTop: 5 }}>{choice('Keep promotion running (No end date)', draft.durationMode === 'indefinite', () => patch('durationMode', 'indefinite'), 'radio')}{choice('End on selected date and time', draft.durationMode === 'scheduled', () => patch('durationMode', 'scheduled'), 'radio')}</View>
          {draft.durationMode === 'scheduled' && dateTime('end')}{issue('end')}</View>
          <View style={panel}><Text style={heading}>Status &amp; Actions</Text><Text style={[muted, { marginTop: 5 }]}>{status === 'Draft' ? 'Saved drafts are not visible to customers.' : `Current status: ${status}.`}</Text>{!product?.promotionActivationAvailable && <Text style={[muted, { marginTop: 4 }]}>Activation is currently unavailable until an authorized release.</Text>}{product?.bundlePromotion && (activeRecord ? product?.promotionDisableAvailable : product?.promotionActivationAvailable) && <TouchableOpacity accessibilityRole="button" disabled={saving || (!activeRecord && unsavedDraft)} onPress={() => setConfirmAction(activeRecord ? 'disable' : 'publish')} style={[button, { marginTop: 8, opacity: saving || (!activeRecord && unsavedDraft) ? 0.55 : 1 }]}><Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{activeRecord ? 'Disable promotion' : 'Publish saved draft'}</Text></TouchableOpacity>}{product?.promotionActivationAvailable && !activeRecord && unsavedDraft && <Text style={[muted, { marginTop: 4 }]}>Save changes before publishing.</Text>}{activeRecord && <Text style={[muted, { marginTop: 4 }]}>This active record cannot be changed from the draft editor.</Text>}</View>
        </ScrollView>}
        {Object.keys(fieldErrors).length > 0 && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>Review the highlighted fields above.</Text>}
        {Boolean(error) && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{error}</Text>}
        {Boolean(notice) && <Text accessibilityRole="status" style={{ color: colors.textPrimary, fontSize: 12, marginTop: 6 }}>{notice}</Text>}
        <View style={{ flexDirection: width < 360 ? 'column-reverse' : 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={onClose} style={[button, { flexGrow: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={saving || activeRecord} accessibilityState={{ disabled: saving || activeRecord }} onPress={save} style={[button, { flexGrow: 1, backgroundColor: colors.primaryAction, borderColor: colors.primaryAction, opacity: saving || activeRecord ? 0.6 : 1 }]}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save draft'}</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  </Modal><Modal visible={confirmSample} transparent animationType="fade" onRequestClose={() => setConfirmSample(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 }}><Text accessibilityRole="header" style={heading}>Replace current tiers?</Text><Text style={muted}>Sample tiers will replace your current entries. Nothing is saved until you choose Save draft.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><TouchableOpacity accessibilityRole="button" onPress={() => setConfirmSample(false)} style={[button, { flexGrow: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Keep current</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={applySample} style={[button, { flexGrow: 1, backgroundColor: colors.primaryAction }]}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>Replace tiers</Text></TouchableOpacity></View></View></View></Modal><Modal visible={Boolean(confirmAction)} transparent animationType="fade" onRequestClose={() => !saving && setConfirmAction(null)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 }}><Text accessibilityRole="header" style={heading}>{confirmAction === 'publish' ? 'Publish saved promotion?' : 'Disable promotion?'}</Text><Text style={muted}>{confirmAction === 'publish' ? 'Eligible customers can see and receive the saved offer after its start time.' : 'New orders will no longer receive this offer. Existing order prices remain unchanged.'}</Text><View style={{ flexDirection: 'row', gap: 8 }}><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setConfirmAction(null)} style={[button, { flex: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Cancel</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={changeStatus} style={[button, { flex: 1, backgroundColor: colors.primaryAction }]}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Confirm'}</Text></TouchableOpacity></View></View></View></Modal></>;
}
