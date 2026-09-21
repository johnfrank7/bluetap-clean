import React from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminShell from '../../components/AdminShell';
import { SectionCard, StatusBadge } from '../../components/DashboardUi';
import { useAdminTheme } from '../../components/AdminTheme';
import { getRegistrationSecurity, updateRegistrationSecurity } from '../../services/adminRegistrationSecurity';

export default function RegistrationSecurityPage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  const [savedSettings, setSavedSettings] = React.useState(null);
  const [draftSettings, setDraftSettings] = React.useState(null);
  const [message, setMessage] = React.useState('');
  const [isError, setIsError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const authoritative = await getRegistrationSecurity();
      setSavedSettings(authoritative);
      setDraftSettings(authoritative);
      setIsError(false);
    } catch (error) {
      setMessage(error.message);
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const toggle = (key) => {
    const next = { ...draftSettings, [key]: !draftSettings[key] };
    if (!next.faceVerificationEnabled && !next.emailOtpEnabled) {
      setMessage('At least one registration verification method must remain enabled.');
      setIsError(true);
      return;
    }
    setMessage('');
    setIsError(false);
    setDraftSettings(next);
  };

  const save = async () => {
    const next = {
      ...draftSettings,
      maxAccountsPerDevice: Number(draftSettings.maxAccountsPerDevice),
      maxAccountsPerIp: Number(draftSettings.maxAccountsPerIp),
    };
    if (![next.maxAccountsPerDevice, next.maxAccountsPerIp].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) {
      setMessage('Account limits must be whole numbers from 1 to 20.');
      setIsError(true);
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const authoritative = await updateRegistrationSecurity(next);
      setSavedSettings(authoritative);
      setDraftSettings(authoritative);
      setMessage('Registration security settings saved.');
      setIsError(false);
    } catch (error) {
      // A failed save must never make an unsaved policy look active.
      setDraftSettings(savedSettings);
      setMessage(error.message);
      setIsError(true);
    } finally {
      setSaving(false);
    }
  };

  const settings = draftSettings;
  return <AdminShell title="Registration Security" subtitle="Control identity verification and registration abuse safeguards">
    {loading ? <ActivityIndicator color={colors.primary} /> : !settings ? <View style={styles.stack}>
      {!!message && <View accessibilityRole="alert" style={[styles.notice, styles.errorNotice]}><Text style={[styles.noticeText, styles.errorText]}>{message}</Text></View>}
      <TouchableOpacity onPress={load} style={styles.button}><Text style={styles.buttonText}>Try again</Text></TouchableOpacity>
    </View> : <View style={styles.stack}>
      <SectionCard style={styles.summaryCard}><Text style={styles.summaryEyebrow}>SAVED POLICY</Text><Text style={styles.title}>Registration protection is active</Text><View style={styles.summaryGrid}><View style={styles.summaryItem}><Text style={styles.summaryLabel}>Face verification</Text><StatusBadge status={savedSettings.faceVerificationEnabled ? 'enabled' : 'disabled'} /></View><View style={styles.summaryItem}><Text style={styles.summaryLabel}>Email OTP</Text><StatusBadge status={savedSettings.emailOtpEnabled ? 'enabled' : 'disabled'} /></View><View style={styles.summaryItem}><Text style={styles.summaryLabel}>Device limit</Text><Text style={styles.summaryValue}>{savedSettings.maxAccountsPerDevice}</Text></View><View style={styles.summaryItem}><Text style={styles.summaryLabel}>Network/IP limit</Text><Text style={styles.summaryValue}>{savedSettings.maxAccountsPerIp}</Text></View></View></SectionCard>
      <SectionCard><Text style={styles.title}>Verification methods</Text><Text style={styles.help}>At least one method must stay enabled so new accounts can be verified.</Text>{[['faceVerificationEnabled','Face verification','Confirm a registrant is physically present.'],['emailOtpEnabled','Email OTP verification','Confirm access to the submitted email address.']].map(([key,label,help]) => <View style={styles.setting} key={key}><View style={styles.settingCopy}><Text style={styles.label}>{label}</Text><Text style={styles.help}>{help}</Text></View><Switch trackColor={{ false:'#C8D5DF', true:'#8EC9F2' }} thumbColor={settings[key] ? colors.primary : '#FFF'} value={settings[key]} onValueChange={() => toggle(key)} /></View>)}</SectionCard>
      <SectionCard><Text style={styles.title}>Account limits</Text><Text style={styles.help}>Limit registrations from a single device or network. Use whole numbers from 1 to 20.</Text><View style={styles.fields}>{[['maxAccountsPerDevice','Maximum accounts per device'],['maxAccountsPerIp','Maximum accounts per network/IP']].map(([key,label]) => <View key={key} style={styles.field}><Text style={styles.inputLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="number-pad" value={String(settings[key])} onChangeText={(value) => setDraftSettings({ ...settings, [key]: value })} style={styles.input} /></View>)}</View></SectionCard>
      {!!message && <View accessibilityRole="alert" style={[styles.notice, isError ? styles.errorNotice : styles.successNotice]}><Text style={[styles.noticeText, isError ? styles.errorText : styles.successText]}>{message}</Text></View>}
      <TouchableOpacity disabled={saving} onPress={save} style={[styles.button, saving && styles.disabled]}><Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
    </View>}
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({ stack:{maxWidth:820,gap:16},summaryCard:{backgroundColor:'#F0F8FF'},summaryEyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:.8,marginBottom:6},summaryGrid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:18},summaryItem:{flexGrow:1,flexBasis:150,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12},summaryLabel:{color:colors.textSecondary,fontSize:11,fontWeight:'800',marginBottom:8},summaryValue:{color:colors.textPrimary,fontSize:21,fontWeight:'900'},title:{color:colors.textPrimary,fontSize:18,fontWeight:'800'},help:{color:colors.textSecondary,fontSize:13,lineHeight:19,marginTop:5},setting:{minHeight:72,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:20,borderTopWidth:1,borderTopColor:colors.border,marginTop:16,paddingTop:16},settingCopy:{flex:1},label:{color:colors.textPrimary,fontWeight:'800'},fields:{flexDirection:'row',flexWrap:'wrap',gap:14,marginTop:18},field:{flexGrow:1,flexBasis:230},inputLabel:{color:colors.textSecondary,fontSize:12,fontWeight:'700',marginBottom:7},input:{minHeight:46,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12,color:colors.textPrimary,outlineStyle:'none'},notice:{borderRadius:12,padding:14,borderWidth:1},errorNotice:{backgroundColor:'#FFF5F4',borderColor:'#F1C5C2'},successNotice:{backgroundColor:'#EFFAF4',borderColor:'#BDE6CF'},noticeText:{fontWeight:'700'},errorText:{color:colors.danger},successText:{color:colors.success},button:{alignSelf:'flex-start',minHeight:46,paddingHorizontal:22,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary,borderRadius:10},buttonText:{color:'#FFF',fontWeight:'800'},disabled:{opacity:.55} });
