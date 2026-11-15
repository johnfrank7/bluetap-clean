import React from 'react';
import { Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { saveAdminPromotionDraft, saveAndPublishAdminPromotion, changeAdminPromotionStatus } from '../services/adminProducts';
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
  const [publishConfirmation, setPublishConfirmation] = React.useState(null);
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
    setError(''); setNotice(''); setFieldErrors({}); setConfirmSample(false); setConfirmAction(null); setPublishConfirmation(null); setStatusClock(Date.now());
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
  const validateForm = () => {
    if (!draft) return null;
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
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setNotice('');
      return null;
    }
    return {
      expectedVersion: draft.expectedVersion,
      title: draft.title.trim(),
      commercialEligibility: draft.verified ? 'refill_verified' : '',
      branchIds: draft.branchIds,
      containerChoices: draft.containerChoices,
      tiers,
      startMode: draft.startMode,
      startsAt,
      endsAt,
    };
  };
  const save = async () => {
    if (!draft || saving || savingRef.current || activeRecord) return;
    const payload = validateForm();
    if (!payload) return;
    const draftPayload = { ...payload, active: false };
    if (product.bundlePromotion && (draft.startMode !== 'scheduled' || draftPayload.startsAt) && (draft.durationMode !== 'scheduled' || draftPayload.endsAt) && promotionDraftFingerprint(draftPayload) === promotionDraftFingerprint(product.bundlePromotion)) {
      setFieldErrors({});
      setNotice('No changes to save. Your draft is already up to date.');
      setError('');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveAdminPromotionDraft(product.id, draftPayload);
      await onSaved(product.bundlePromotion ? 'updated' : 'created');
    } catch (err) {
      setError(err.message || 'The draft could not be saved.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const initiatePublish = () => {
    if (!draft || saving || savingRef.current || activeRecord || !product?.promotionActivationAvailable) return;
    const payload = validateForm();
    if (!payload) return;
    setPublishConfirmation(payload);
  };
  const executeSaveAndPublish = async () => {
    if (!publishConfirmation || saving || savingRef.current || activeRecord || !product?.promotionActivationAvailable) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await saveAndPublishAdminPromotion(product.id, publishConfirmation);
      setPublishConfirmation(null);
      await onSaved('published');
    } catch (err) {
      setPublishConfirmation(null);
      setError(err.message || 'The promotion could not be published.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Text accessibilityRole="header" style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '800', flexShrink: 1 }}>Bundle Promotions</Text><Text accessibilityLabel={`Promotion status: ${status}`} style={{ color: status === 'Active' ? (colors.successAction || colors.success || '#167347') : colors.primaryAction, backgroundColor: status === 'Active' ? (colors.successSoft || '#E3F7EC') : colors.primarySoft, fontWeight: '800', fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>{status}</Text></View>
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
          {activeRecord ? (
            <View style={[panel, { borderColor: colors.dangerSoft || colors.danger, borderWidth: 1.5 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[heading, { color: colors.danger }]}>Promotion Management</Text>
                <View style={{ backgroundColor: colors.successSoft || '#E3F7EC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ color: colors.successAction || colors.success || '#167347', fontSize: 11, fontWeight: '800' }}>ACTIVE</Text>
                </View>
              </View>
              <Text style={[muted, { marginTop: 6, fontSize: 12, lineHeight: 18 }]}>
                This promotion is currently live. To change pricing or terms, disable the promotion first.
              </Text>
              <View style={{ marginTop: 10, gap: 6 }}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Disable Promotion"
                  disabled={saving}
                  onPress={() => setConfirmAction('disable')}
                  style={[
                    button,
                    {
                      backgroundColor: colors.dangerAction || colors.danger || '#B52F2F',
                      borderColor: colors.dangerAction || colors.danger || '#B52F2F',
                      alignItems: 'center',
                      opacity: saving ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={{ color: colors.onDanger || '#FFFFFF', fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                    {saving ? 'Disabling…' : 'Disable Promotion'}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center' }}>
                  Stops this promotion for new eligible orders.
                </Text>
              </View>
            </View>
          ) : (
            <View style={panel}>
              <Text style={heading}>Status &amp; Availability</Text>
              <Text style={[muted, { marginTop: 5, fontSize: 12, lineHeight: 17 }]}>
                {status === 'Draft' ? 'Saved drafts are not visible to customers.' : `Current status: ${status}.`}
              </Text>
              {product?.promotionActivationAvailable ? (
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
                  Save and make this offer available to eligible customers.
                </Text>
              ) : (
                <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.warning || colors.textPrimary, fontWeight: '700', fontSize: 12 }}>
                    Publishing Capability Disabled
                  </Text>
                  <Text style={[muted, { fontSize: 11, marginTop: 2, lineHeight: 16 }]}>
                    Publishing must first be enabled on the server to activate promotions. You can save and test your draft at any time.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>}
        {Object.keys(fieldErrors).length > 0 && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>Review the highlighted fields above.</Text>}
        {Boolean(error) && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{error}</Text>}
        {Boolean(notice) && <Text accessibilityRole="status" style={{ color: colors.textPrimary, fontSize: 12, marginTop: 6 }}>{notice}</Text>}
        {activeRecord ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              disabled={saving}
              onPress={onClose}
              style={[
                button,
                {
                  minWidth: width < 480 ? '100%' : 120,
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                  alignItems: 'center',
                },
              ]}
            >
              <Text style={{ color: colors.textPrimary, textAlign: 'center', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 6 }}>
            <View style={{ flexDirection: width < 480 ? 'column-reverse' : 'row', gap: 8 }}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                disabled={saving}
                onPress={onClose}
                style={[
                  button,
                  {
                    flex: width < 480 ? undefined : 1,
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    alignItems: 'center',
                  },
                ]}
              >
                <Text style={{ color: colors.textPrimary, textAlign: 'center', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save Draft"
                disabled={saving}
                accessibilityState={{ disabled: saving }}
                onPress={save}
                style={[
                  button,
                  {
                    flex: width < 480 ? undefined : 1,
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    alignItems: 'center',
                    opacity: saving ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={{ color: colors.textPrimary, textAlign: 'center', fontWeight: '700' }}>
                  {saving ? 'Saving…' : 'Save Draft'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Save & Publish"
                disabled={saving || !product?.promotionActivationAvailable}
                accessibilityState={{ disabled: saving || !product?.promotionActivationAvailable }}
                onPress={initiatePublish}
                style={[
                  button,
                  {
                    flex: width < 480 ? undefined : 1.3,
                    backgroundColor: product?.promotionActivationAvailable
                      ? (colors.successAction || colors.success || '#167347')
                      : colors.surfaceAlt,
                    borderColor: product?.promotionActivationAvailable
                      ? (colors.successAction || colors.success || '#167347')
                      : colors.border,
                    alignItems: 'center',
                    opacity: saving || !product?.promotionActivationAvailable ? 0.5 : 1,
                  },
                ]}
              >
                <Text
                  style={{
                    color: product?.promotionActivationAvailable
                      ? (colors.onSuccess || '#FFFFFF')
                      : (colors.disabledText || colors.textSecondary),
                    textAlign: 'center',
                    fontWeight: '700',
                  }}
                >
                  Save &amp; Publish
                </Text>
              </TouchableOpacity>
            </View>
            {!product?.promotionActivationAvailable && (
              <Text style={{ color: colors.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
                Server publishing is disabled. Use Save Draft to store your changes.
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  </Modal><Modal visible={confirmSample} transparent animationType="fade" onRequestClose={() => setConfirmSample(false)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 }}><Text accessibilityRole="header" style={heading}>Replace current tiers?</Text><Text style={muted}>Sample tiers will replace your current entries. Nothing is saved until you choose Save draft.</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><TouchableOpacity accessibilityRole="button" onPress={() => setConfirmSample(false)} style={[button, { flexGrow: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Keep current</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={applySample} style={[button, { flexGrow: 1, backgroundColor: colors.primaryAction }]}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>Replace tiers</Text></TouchableOpacity></View></View></View></Modal><Modal visible={Boolean(confirmAction)} transparent animationType="fade" onRequestClose={() => !saving && setConfirmAction(null)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 }}><Text accessibilityRole="header" style={heading}>{confirmAction === 'publish' ? 'Publish saved promotion?' : 'Disable promotion?'}</Text><Text style={muted}>{confirmAction === 'publish' ? 'Eligible customers can see and receive the saved offer after its start time.' : 'New orders will no longer receive this offer. Existing order prices remain unchanged.'}</Text><View style={{ flexDirection: 'row', gap: 8 }}><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setConfirmAction(null)} style={[button, { flex: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Cancel</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={changeStatus} style={[button, { flex: 1, backgroundColor: confirmAction === 'disable' ? (colors.dangerAction || colors.danger || '#B52F2F') : colors.primaryAction, borderColor: confirmAction === 'disable' ? (colors.dangerAction || colors.danger || '#B52F2F') : colors.primaryAction }]}><Text style={{ color: confirmAction === 'disable' ? (colors.onDanger || '#FFFFFF') : (colors.onPrimary || '#FFFFFF'), textAlign: 'center', fontWeight: '700' }}>{saving ? (confirmAction === 'disable' ? 'Disabling…' : 'Saving…') : (confirmAction === 'disable' ? 'Disable Promotion' : 'Confirm')}</Text></TouchableOpacity></View></View></View></Modal><Modal visible={Boolean(publishConfirmation)} transparent animationType="fade" onRequestClose={() => !saving && setPublishConfirmation(null)}><View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 16 }}><View style={{ width: '100%', maxWidth: 480, maxHeight: '85%', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 }}><Text accessibilityRole="header" style={heading}>Save &amp; Publish Promotion?</Text><Text style={[muted, { fontSize: 13 }]}>This promotion will be saved and published live. Eligible customers will immediately receive promotional discounts upon activation.</Text><ScrollView style={{ maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surfaceAlt }} keyboardShouldPersistTaps="handled"><Text style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 13 }}>{product?.product_name}</Text><Text style={[muted, { fontSize: 12, marginTop: 2 }]}>Title: {publishConfirmation?.title}</Text><Text style={[muted, { fontSize: 12, marginTop: 2 }]}>Branches: {(publishConfirmation?.branchIds || []).map((id) => branches.find((b) => b.id === id)?.name || id).join(', ')}</Text><Text style={[muted, { fontSize: 12, marginTop: 2 }]}>Containers: {(publishConfirmation?.containerChoices || []).join(', ')}</Text><Text style={[muted, { fontSize: 12, marginTop: 2 }]}>Start: {scheduleLabel(publishConfirmation?.startMode, draft?.startDate, draft?.startTime, 'Immediately upon activation')}</Text><Text style={[muted, { fontSize: 12, marginTop: 2 }]}>End: {scheduleLabel(publishConfirmation?.durationMode, draft?.endDate, draft?.endTime, 'No end date')}</Text><Text style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 12, marginTop: 8, marginBottom: 4 }}>Price Tiers:</Text>{(publishConfirmation?.tiers || []).map((tier) => { const regularCents = unit !== null ? unit * tier.quantity : 0; const bundleCents = tier.bundlePriceCentavos; const savingsCents = regularCents - bundleCents; return <Text key={tier.quantity} style={{ color: colors.textPrimary, fontSize: 12, lineHeight: 18 }}>• Qty {tier.quantity}: Regular {money(regularCents / 100)} · Bundle {money(bundleCents / 100)} · Save {money(savingsCents / 100)}</Text>; })}</ScrollView><View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => setPublishConfirmation(null)} style={[button, { flex: 1 }]}><Text style={{ color: colors.textPrimary, textAlign: 'center' }}>Cancel</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={saving} onPress={executeSaveAndPublish} style={[button, { flex: 1.2, backgroundColor: colors.successAction || colors.success || '#167347', borderColor: colors.successAction || colors.success || '#167347' }]}><Text style={{ color: colors.onSuccess || '#FFFFFF', textAlign: 'center', fontWeight: '700' }}>{saving ? 'Publishing…' : 'Confirm & publish'}</Text></TouchableOpacity></View></View></View></Modal></>;
}
