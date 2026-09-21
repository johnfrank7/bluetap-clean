import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { SkeletonBlock } from '../../components/AdminSkeleton';
import { SectionCard, StatusBadge } from '../../components/DashboardUi';
import { useAdminTheme } from '../../components/AdminTheme';
import { getRegistrationSecurity, updateRegistrationSecurity } from '../../services/adminRegistrationSecurity';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';

const IDLE_OPTIONS = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']];
const ABSOLUTE_OPTIONS = [[8, '8 hours'], [12, '12 hours'], [24, '24 hours'], [168, '7 days']];
const ROLES = [['requester', 'Requester'], ['distributor', 'Distributor'], ['manager', 'Manager']];

function PolicySelect({ label, value, options, onChange, colors, styles }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(([option]) => option === value)?.[1] || '';
  return <View style={styles.selectField}>
    <Text style={styles.inputLabel}>{label}</Text>
    <TouchableOpacity accessibilityRole="combobox" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={styles.select}>
      <Text style={styles.selectText}>{selected}</Text><Text style={styles.chevron}>⌄</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={styles.modalTitle}>{label}</Text>
          {options.map(([option, optionLabel]) => <TouchableOpacity key={option} accessibilityRole="option" accessibilityState={{ selected: option === value }} onPress={() => { onChange(option); setOpen(false); }} style={[styles.option, option === value && styles.optionSelected]}>
            <Text style={[styles.optionText, option === value && styles.optionTextSelected]}>{optionLabel}</Text>{option === value && <Text style={styles.optionCheck}>✓</Text>}
          </TouchableOpacity>)}
        </View>
      </View>
    </Modal>
  </View>;
}

export default function SecuritySettingsPage() {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const { data, refreshing, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.security, getRegistrationSecurity);
  const [savedSettings, setSavedSettings] = React.useState(data || null);
  const [draftSettings, setDraftSettings] = React.useState(data || null);
  const [dirty, setDirty] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [isError, setIsError] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!data || dirty) return;
    setSavedSettings(data); setDraftSettings(data); setIsError(false);
  }, [data, dirty]);

  const toggleVerification = (key) => {
    const next = { ...draftSettings, [key]: !draftSettings[key] };
    if (!next.faceVerificationEnabled && !next.emailOtpEnabled) {
      setMessage('At least one registration verification method must remain enabled.'); setIsError(true); return;
    }
    setMessage(''); setIsError(false); setDirty(true); setDraftSettings(next);
  };
  const updateSession = (role, key, value) => { setDirty(true); setDraftSettings((current) => ({ ...current, sessionSecurity: { ...current.sessionSecurity, [role]: { ...current.sessionSecurity[role], [key]: value } } })); };
  const save = async () => {
    const next = { ...draftSettings, maxAccountsPerDevice: Number(draftSettings.maxAccountsPerDevice), maxAccountsPerIp: Number(draftSettings.maxAccountsPerIp) };
    if (![next.maxAccountsPerDevice, next.maxAccountsPerIp].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) {
      setMessage('Account limits must be whole numbers from 1 to 20.'); setIsError(true); return;
    }
    setSaving(true); setMessage('');
    try {
      const authoritative = await updateRegistrationSecurity(next);
      await refresh();
      setSavedSettings(authoritative); setDraftSettings(authoritative); setDirty(false); setMessage('Security settings saved.'); setIsError(false);
    } catch (error) { setDraftSettings(savedSettings); setDirty(false); setMessage(error.message); setIsError(true); }
    finally { setSaving(false); }
  };

  const settings = draftSettings;
  return <AdminShell title="Security Settings" subtitle="Manage registration protection, account limits, verification methods, and user session security.">
    <View style={styles.stack}>{!settings ? <>
      <SectionCard><Text style={styles.sectionEyebrow}>SAVED POLICY</Text><Text style={styles.title}>BlueTap account protection</Text><SkeletonBlock style={styles.skeletonWide} /><SkeletonBlock style={styles.skeletonGrid} /></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>VERIFICATION METHODS</Text><Text style={styles.title}>Registration verification</Text><SkeletonBlock style={styles.skeletonRow} /><SkeletonBlock style={styles.skeletonRow} /></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>REGISTRATION LIMITS</Text><Text style={styles.title}>Account limits</Text><SkeletonBlock style={styles.skeletonRow} /></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>SESSION SECURITY</Text><Text style={styles.title}>Automatic logout policy</Text><SkeletonBlock style={styles.skeletonTall} /></SectionCard>
      {!!error && <View accessibilityRole="alert" style={[styles.notice, styles.errorNotice]}><Text style={[styles.noticeText, styles.errorText]}>{error}</Text><TouchableOpacity onPress={() => refresh({ force: true })}><Text style={styles.retry}>Try again</Text></TouchableOpacity></View>}
    </> : <>
      <SectionCard style={styles.summaryCard}><Text style={styles.summaryEyebrow}>SAVED POLICY</Text><Text style={styles.title}>BlueTap account protection is active</Text><View style={styles.summaryGrid}>
        <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Face verification</Text><StatusBadge status={savedSettings.faceVerificationEnabled ? 'enabled' : 'disabled'} /></View>
        <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Email OTP</Text><StatusBadge status={savedSettings.emailOtpEnabled ? 'enabled' : 'disabled'} /></View>
        <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Device / IP limits</Text><Text style={styles.summaryValue}>{savedSettings.maxAccountsPerDevice} / {savedSettings.maxAccountsPerIp}</Text></View>
        <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Requester / Manager idle</Text><Text style={styles.summaryValue}>{savedSettings.sessionSecurity.requester.idleTimeoutMinutes}m / {savedSettings.sessionSecurity.manager.idleTimeoutMinutes}m</Text></View>
      </View></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>VERIFICATION METHODS</Text><Text style={styles.title}>Registration verification</Text><Text style={styles.help}>At least one method must stay enabled so new accounts can be verified.</Text>{[['faceVerificationEnabled', 'Face verification', 'Confirm a registrant is physically present.'], ['emailOtpEnabled', 'Email OTP verification', 'Confirm access to the submitted email address.']].map(([key, label, help]) => <View style={styles.setting} key={key}><View style={styles.settingCopy}><Text style={styles.label}>{label}</Text><Text style={styles.help}>{help}</Text></View><Switch trackColor={{ false: colors.neutral, true: colors.primaryLight }} thumbColor={settings[key] ? colors.primary : colors.surface} value={settings[key]} onValueChange={() => toggleVerification(key)} /></View>)}</SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>REGISTRATION LIMITS</Text><Text style={styles.title}>Account limits</Text><Text style={styles.help}>Limit finalized registrations from a single device or network. Use whole numbers from 1 to 20.</Text><View style={styles.fields}>{[['maxAccountsPerDevice', 'Maximum accounts per device'], ['maxAccountsPerIp', 'Maximum accounts per network/IP']].map(([key, label]) => <View key={key} style={styles.field}><Text style={styles.inputLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="number-pad" value={String(settings[key])} onChangeText={(value) => { setDirty(true); setDraftSettings({ ...settings, [key]: value }); }} style={styles.input} /></View>)}</View></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>SESSION SECURITY</Text><Text style={styles.title}>Automatic logout policy</Text><Text style={styles.help}>Idle warnings and absolute session limits apply to Requester, Distributor, and Manager sessions. Administrator sessions are unchanged.</Text><View style={styles.roleGrid}>{ROLES.map(([role, label]) => { const policy = settings.sessionSecurity[role]; return <View key={role} style={styles.roleCard}><Text style={styles.roleTitle}>{label}</Text><PolicySelect label="Idle timeout" value={policy.idleTimeoutMinutes} options={IDLE_OPTIONS} onChange={(value) => updateSession(role, 'idleTimeoutMinutes', value)} colors={colors} styles={styles} /><PolicySelect label="Absolute session lifetime" value={policy.absoluteSessionHours} options={ABSOLUTE_OPTIONS} onChange={(value) => updateSession(role, 'absoluteSessionHours', value)} colors={colors} styles={styles} /><View style={styles.forceRow}><View style={styles.forceCopy}><Text style={styles.label}>Force logout after password change</Text><Text style={styles.help}>Revoke other Firebase sessions after a required password change.</Text></View><Switch value={policy.forceLogoutAfterPasswordChange} onValueChange={(value) => updateSession(role, 'forceLogoutAfterPasswordChange', value)} trackColor={{ false: colors.neutral, true: colors.primaryLight }} thumbColor={policy.forceLogoutAfterPasswordChange ? colors.primary : colors.surface} /></View></View>; })}</View></SectionCard>
      <SectionCard><Text style={styles.sectionEyebrow}>SECURITY NOTE</Text><Text style={styles.help}>Individual account session termination remains available in Accounts & Audit. Policy changes are Admin-only and recorded in the audit log.</Text></SectionCard>
      {!!error && !message && <View accessibilityRole="alert" style={[styles.notice, styles.errorNotice]}><Text style={[styles.noticeText, styles.errorText]}>{error}</Text><TouchableOpacity onPress={() => refresh({ force: true })}><Text style={styles.retry}>Retry refresh</Text></TouchableOpacity></View>}
      {!!message && <View accessibilityRole="alert" style={[styles.notice, isError ? styles.errorNotice : styles.successNotice]}><Text style={[styles.noticeText, isError ? styles.errorText : styles.successText]}>{message}</Text></View>}
      <TouchableOpacity disabled={saving} onPress={save} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
      {refreshing && !dirty && <Text style={styles.refreshing}>Refreshing saved policy…</Text>}
    </>}</View>
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({
  stack:{maxWidth:1040,gap:16}, summaryCard:{backgroundColor:colors.primarySoft}, summaryEyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:6}, sectionEyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:6},
  summaryGrid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:18}, summaryItem:{flexGrow:1,flexBasis:190,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12}, summaryLabel:{color:colors.textSecondary,fontSize:11,fontWeight:'800',marginBottom:8}, summaryValue:{color:colors.textPrimary,fontSize:18,fontWeight:'900'},
  title:{color:colors.textPrimary,fontSize:18,fontWeight:'800'}, help:{color:colors.textSecondary,fontSize:13,lineHeight:19,marginTop:5}, setting:{minHeight:72,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:20,borderTopWidth:1,borderTopColor:colors.border,marginTop:16,paddingTop:16}, settingCopy:{flex:1}, label:{color:colors.textPrimary,fontWeight:'800'},
  fields:{flexDirection:'row',flexWrap:'wrap',gap:14,marginTop:18}, field:{flexGrow:1,flexBasis:230}, inputLabel:{color:colors.textSecondary,fontSize:12,fontWeight:'700',marginBottom:7}, input:{minHeight:46,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12,color:colors.textPrimary,outlineStyle:'none'},
  roleGrid:{flexDirection:'row',flexWrap:'wrap',gap:14,marginTop:18}, roleCard:{flexGrow:1,flexBasis:280,backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:16}, roleTitle:{color:colors.textPrimary,fontSize:16,fontWeight:'900',marginBottom:12}, selectField:{marginTop:10}, select:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12}, selectText:{color:colors.textPrimary,fontWeight:'700'}, chevron:{color:colors.primary,fontSize:20},
  forceRow:{minHeight:72,flexDirection:'row',alignItems:'center',gap:12,borderTopWidth:1,borderTopColor:colors.border,marginTop:16,paddingTop:14}, forceCopy:{flex:1}, modalBackdrop:{flex:1,alignItems:'center',justifyContent:'center',padding:20}, modalCard:{width:'100%',maxWidth:420,borderWidth:1,borderRadius:16,padding:18}, modalTitle:{color:colors.textPrimary,fontSize:18,fontWeight:'900',marginBottom:10}, option:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderRadius:9,paddingHorizontal:12}, optionSelected:{backgroundColor:colors.primarySoft}, optionText:{color:colors.textSecondary,fontWeight:'700'}, optionTextSelected:{color:colors.primary,fontWeight:'900'}, optionCheck:{color:colors.primary,fontWeight:'900'},
  notice:{borderRadius:12,padding:14,borderWidth:1}, errorNotice:{backgroundColor:colors.dangerSoft,borderColor:colors.danger}, successNotice:{backgroundColor:colors.successSoft,borderColor:colors.success}, noticeText:{fontWeight:'700'}, errorText:{color:colors.danger}, successText:{color:colors.success}, retry:{color:colors.primary,fontWeight:'900',marginTop:8}, refreshing:{color:colors.textSecondary,fontSize:12}, skeletonWide:{height:18,width:'42%',marginTop:16}, skeletonGrid:{height:88,marginTop:12}, skeletonRow:{height:58,marginTop:14}, skeletonTall:{height:180,marginTop:16}, button:{alignSelf:'flex-start',minHeight:46,paddingHorizontal:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary,borderRadius:10}, buttonText:{color:'#FFF',fontWeight:'800'}, disabled:{opacity:.55},
});
