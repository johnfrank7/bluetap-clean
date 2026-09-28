import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AdminIcon from '../../components/AdminIcon';
import AdminShell from '../../components/AdminShell';
import { SkeletonBlock } from '../../components/AdminSkeleton';
import { SectionCard } from '../../components/DashboardUi';
import { useAdminTheme } from '../../components/AdminTheme';
import TopToastFeedback from '../../components/TopToastFeedback';
import { ADMIN_CACHE_KEYS, useAdminData } from '../../services/adminDataCache';
import {
  getSystemMaintenance,
  previewSystemCleanup,
  runSystemCleanup,
  saveRetentionPolicy,
} from '../../services/adminSystemMaintenance';

const OPTIONS = Object.freeze({
  incompleteRegistrationRetentionHours: [[24, '24 hours'], [48, '48 hours'], [72, '72 hours'], [168, '7 days']],
  verificationRetentionHours: [[12, '12 hours'], [24, '24 hours'], [48, '48 hours'], [72, '72 hours']],
  rateLimitRetentionDays: [[1, '1 day'], [7, '7 days'], [14, '14 days'], [30, '30 days']],
  completedOrderArchiveDays: [[30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '180 days'], [365, '365 days']],
});

const COUNT_ROWS = Object.freeze([
  ['expiredNotifications', 'Expired notifications'],
  ['expiredRegistrationSessions', 'Expired registration sessions'],
  ['expiredUsernameReservations', 'Expired username reservations'],
  ['expiredVerificationSessions', 'Expired verification sessions'],
  ['expiredRateLimitRecords', 'Expired rate-limit records'],
  ['ordersEligibleForArchive', 'Orders eligible for archive'],
]);

const dateText = (value) => {
  if (!value) return 'Never run';
  const millis = typeof value?.seconds === 'number' ? value.seconds * 1000 : new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : 'Unavailable';
};

function RetentionSelect({ label, detail, value, options, onChange, styles, colors }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(([option]) => option === value)?.[1] || 'Choose retention';
  return <View style={styles.policyItem}>
    <Text style={styles.policyLabel}>{label}</Text>
    <Text style={styles.policyDetail}>{detail}</Text>
    <TouchableOpacity accessibilityRole="combobox" accessibilityLabel={`${label}: ${selected}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={styles.select}>
      <Text style={styles.selectText}>{selected}</Text><Text style={styles.chevron}>⌄</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Close ${label}`} onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.optionModal}>
          <Text style={styles.modalTitle}>{label}</Text>
          {options.map(([option, optionLabel]) => <TouchableOpacity key={option} accessibilityRole="option" accessibilityState={{ selected: value === option }} onPress={() => { onChange(option); setOpen(false); }} style={[styles.option, value === option && styles.optionSelected]}>
            <Text style={[styles.optionText, value === option && styles.optionTextSelected]}>{optionLabel}</Text>
            {value === option ? <AdminIcon name="check" color={colors.primary} size={16} /> : null}
          </TouchableOpacity>)}
        </View>
      </View>
    </Modal>
  </View>;
}

function ReadOnlyPolicy({ label, value, detail, styles }) {
  return <View style={styles.policyItem}>
    <Text style={styles.policyLabel}>{label}</Text>
    <Text style={styles.policyDetail}>{detail}</Text>
    <View style={styles.readOnlyValue}><Text style={styles.readOnlyText}>{value}</Text></View>
  </View>;
}

function CleanupModal({ mode, preview, busy, onClose, onContinue, onConfirm, styles, colors }) {
  if (!mode || !preview) return null;
  const confirming = mode === 'confirm';
  return <Modal visible transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
    <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Close cleanup dialog" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={styles.cleanupModal}>
        <ScrollView contentContainerStyle={styles.modalScroll}>
          <View style={[styles.modalIcon, { backgroundColor: confirming ? colors.warningSoft : colors.primarySoft }]}>
            <AdminIcon name="maintenance" color={confirming ? colors.warning : colors.primary} size={24} />
          </View>
          <Text style={styles.modalTitle}>{confirming ? 'Run Cleanup Now?' : 'Cleanup Preview'}</Text>
          <Text style={styles.modalBody}>{confirming
            ? 'BlueTap will permanently remove only expired temporary records covered by the current retention policy. Protected account, UID, order, branch, security, and Admin audit records will not be deleted.'
            : 'These authoritative counts were calculated by the backend. Previewing does not change any records.'}</Text>
          <View style={styles.previewList}>{COUNT_ROWS.map(([key, label]) => <View key={key} style={styles.previewRow}><Text style={styles.previewLabel}>{label}</Text><Text style={styles.previewValue}>{Number(preview.counts?.[key] || 0)}</Text></View>)}</View>
          <View style={styles.protectedPreview}><Text style={styles.protectedPreviewTitle}>Protected</Text><Text style={styles.protectedPreviewText}>User accounts · Public UID counters · Admin audit records · Historical completed orders</Text></View>
          <View style={styles.modalActions}>
            <TouchableOpacity disabled={busy} onPress={onClose} style={[styles.secondaryButton, busy && styles.disabled]}><Text style={styles.secondaryButtonText}>Cancel</Text></TouchableOpacity>
            {confirming
              ? <TouchableOpacity disabled={busy} onPress={onConfirm} style={[styles.warningButton, busy && styles.disabled]}><Text style={styles.warningButtonText}>{busy ? 'Running cleanup…' : 'Confirm Cleanup'}</Text></TouchableOpacity>
              : <TouchableOpacity disabled={busy} onPress={onContinue} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Run Cleanup</Text></TouchableOpacity>}
          </View>
        </ScrollView>
      </View>
    </View>
  </Modal>;
}

export default function SystemMaintenancePage() {
  const { colors } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { data, loading, error, refresh } = useAdminData(ADMIN_CACHE_KEYS.maintenance, getSystemMaintenance);
  const [draft, setDraft] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const [modalMode, setModalMode] = React.useState(null);
  const [toast, setToast] = React.useState({ visible: false, message: '', type: 'success' });

  React.useEffect(() => { if (data?.policy) setDraft(data.policy); }, [data]);
  const showToast = React.useCallback((message, type = 'success') => setToast({ visible: true, message, type }), []);
  const updatePolicy = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const policy = await saveRetentionPolicy(draft);
      setDraft(policy);
      await refresh({ force: true });
      showToast('Data retention policy saved.', 'success');
    } catch (saveError) { showToast(saveError.message || 'Unable to save the retention policy.', 'error'); }
    finally { setSaving(false); }
  };

  const openPreview = async (mode) => {
    setPreviewing(true);
    try {
      const authoritative = await previewSystemCleanup();
      setPreview(authoritative);
      setModalMode(mode);
    } catch (previewError) { showToast(previewError.message || 'Unable to preview cleanup.', 'error'); }
    finally { setPreviewing(false); }
  };

  const confirmCleanup = async () => {
    setRunning(true);
    try {
      const { result } = await runSystemCleanup();
      setModalMode(null);
      setPreview(null);
      await refresh({ force: true });
      const removed = Number(result.summary?.totalTemporaryRecordsRemoved || 0);
      const archived = Number(result.summary?.archivedOrders || 0);
      const partial = result.result === 'partial';
      showToast(`${partial ? 'Cleanup completed with a safe skip' : 'Cleanup complete'}: ${removed} temporary records removed and ${archived} orders archived.`, partial ? 'warning' : 'success');
    } catch (cleanupError) { showToast(cleanupError.message || 'Cleanup could not be completed.', 'error'); }
    finally { setRunning(false); }
  };

  const status = data?.status;
  const history = Array.isArray(data?.history) ? data.history : [];
  return <AdminShell title="System Maintenance" subtitle="Manage BlueTap's automatic data retention and cleanup policies while protecting permanent account, order, and audit records.">
    <TopToastFeedback visible={toast.visible} message={toast.message} type={toast.type} onDismiss={() => setToast((current) => ({ ...current, visible: false }))} />
    <View style={styles.stack}>
      <SectionCard style={styles.introCard}>
        <View style={styles.introIcon}><AdminIcon name="maintenance" color={colors.primary} size={25} /></View>
        <View style={styles.introCopy}><Text style={styles.eyebrow}>SYSTEM MAINTENANCE</Text><Text style={styles.sectionTitle}>Data Retention & Cleanup</Text><Text style={styles.body}>Control how long temporary and operational records are retained without removing protected historical data.</Text></View>
      </SectionCard>

      {loading && !data ? <SectionCard><SkeletonBlock style={styles.skeletonTitle} /><SkeletonBlock style={styles.skeletonGrid} /></SectionCard> : null}
      {error && !data ? <SectionCard><Text style={styles.errorText}>{error}</Text><TouchableOpacity onPress={() => refresh({ force: true })} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></TouchableOpacity></SectionCard> : null}

      {draft ? <SectionCard>
        <Text style={styles.eyebrow}>DATA RETENTION POLICY</Text>
        <Text style={styles.sectionTitle}>Safe retention periods</Text>
        <Text style={styles.body}>The backend validates each setting. Zero-day and arbitrary deletion values are unavailable.</Text>
        <View style={styles.policyGrid}>
          <ReadOnlyPolicy label="Notifications" value="30 days" detail="Derived from recent lifecycle data; no notification collection is deleted." styles={styles} />
          <RetentionSelect label="Incomplete Registrations" detail="Delete expired, unfinished registration sessions after:" value={draft.incompleteRegistrationRetentionHours} options={OPTIONS.incompleteRegistrationRetentionHours} onChange={(value) => updatePolicy('incompleteRegistrationRetentionHours', value)} styles={styles} colors={colors} />
          <RetentionSelect label="Verification Sessions" detail="Delete expired email OTP and password verification sessions after:" value={draft.verificationRetentionHours} options={OPTIONS.verificationRetentionHours} onChange={(value) => updatePolicy('verificationRetentionHours', value)} styles={styles} colors={colors} />
          <RetentionSelect label="Rate Limit / Temporary Security Records" detail="Delete expired temporary security counters after:" value={draft.rateLimitRetentionDays} options={OPTIONS.rateLimitRetentionDays} onChange={(value) => updatePolicy('rateLimitRetentionDays', value)} styles={styles} colors={colors} />
          <RetentionSelect label="Completed Orders" detail="Archive terminal orders in place after:" value={draft.completedOrderArchiveDays} options={OPTIONS.completedOrderArchiveDays} onChange={(value) => updatePolicy('completedOrderArchiveDays', value)} styles={styles} colors={colors} />
          <ReadOnlyPolicy label="Audit Logs" value="Protected / permanent" detail="Admin audit records are excluded from automatic deletion." styles={styles} />
        </View>
        <TouchableOpacity disabled={saving} onPress={save} style={[styles.primaryButton, styles.saveButton, saving && styles.disabled]}><Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save Retention Policy'}</Text></TouchableOpacity>
      </SectionCard> : null}

      {status ? <SectionCard>
        <Text style={styles.eyebrow}>CLEANUP STATUS</Text><Text style={styles.sectionTitle}>Manual cleanup</Text>
        <View style={styles.statusGrid}>
          <View style={styles.statusItem}><Text style={styles.statusLabel}>Last Cleanup</Text><Text style={styles.statusValue}>{dateText(status.lastCleanupAt)}</Text></View>
          <View style={styles.statusItem}><Text style={styles.statusLabel}>Next Scheduled Cleanup</Text><Text style={styles.statusValue}>{status.nextScheduledCleanupAt ? dateText(status.nextScheduledCleanupAt) : 'Not scheduled'}</Text></View>
          <View style={styles.statusItem}><Text style={styles.statusLabel}>Cleanup Mode</Text><Text style={styles.statusValue}>{status.cleanupMode || 'Manual'}</Text><Text style={styles.statusNote}>Automatic cleanup: Not configured</Text></View>
        </View>
        <View style={styles.warningCallout}><Text style={styles.warningTitle}>Cleanup changes are permanent for expired temporary records.</Text><Text style={styles.warningText}>Preview is calculated by the server. Orders are archived in place and remain available to history, analytics, Buy Again, and audit workflows.</Text></View>
        <View style={styles.actionRow}>
          <TouchableOpacity disabled={previewing || running} onPress={() => openPreview('preview')} style={[styles.secondaryButton, (previewing || running) && styles.disabled]}><Text style={styles.secondaryButtonText}>{previewing ? 'Calculating…' : 'Preview Cleanup'}</Text></TouchableOpacity>
          <TouchableOpacity disabled={previewing || running} onPress={() => openPreview('confirm')} style={[styles.warningButton, (previewing || running) && styles.disabled]}><Text style={styles.warningButtonText}>Run Cleanup Now</Text></TouchableOpacity>
        </View>
      </SectionCard> : null}

      <SectionCard style={styles.protectedCard}>
        <Text style={styles.eyebrow}>PROTECTED DATA</Text><Text style={styles.sectionTitle}>Never automatically deleted</Text>
        <Text style={styles.body}>System Maintenance has no cleanup target for these permanent records.</Text>
        <View style={styles.protectedGrid}>{(data?.protectedData || ['User accounts', 'Firebase Auth identities', 'Public UID counters', 'Branch records', 'Authoritative historical orders', 'Financial and order snapshots', 'Admin audit records', 'Security configuration']).map((item) => <View key={item} style={styles.protectedItem}><AdminIcon name="check" color={colors.success} size={15} /><Text style={styles.protectedText}>{item}</Text></View>)}</View>
      </SectionCard>

      <SectionCard>
        <Text style={styles.eyebrow}>RECENT CLEANUP ACTIVITY</Text><Text style={styles.sectionTitle}>Recent Cleanup Activity</Text>
        {history.length ? <View style={styles.historyList}>{history.map((entry) => <View key={entry.id} style={styles.historyRow}>
          <View style={styles.historyDate}><Text style={styles.historyPrimary}>{dateText(entry.createdAt)}</Text><Text style={styles.historySecondary}>Triggered by {entry.triggeredBy}</Text></View>
          <View style={styles.historyMetric}><Text style={styles.historyNumber}>{entry.temporaryRecordsRemoved}</Text><Text style={styles.historySecondary}>Temporary removed</Text></View>
          <View style={styles.historyMetric}><Text style={styles.historyNumber}>{entry.ordersArchived}</Text><Text style={styles.historySecondary}>Orders archived</Text></View>
          <View style={[styles.resultBadge, entry.result === 'success' ? styles.successBadge : styles.neutralBadge]}><Text style={entry.result === 'success' ? styles.successBadgeText : styles.neutralBadgeText}>{entry.result}</Text></View>
        </View>)}</View> : <View style={styles.emptyState}><View style={styles.emptyIcon}><AdminIcon name="maintenance" color={colors.primary} size={24} /></View><Text style={styles.emptyTitle}>No cleanup history yet</Text><Text style={styles.emptyBody}>Cleanup activity will appear here after the first maintenance run.</Text></View>}
      </SectionCard>
    </View>
    {previewing ? <View pointerEvents="none" style={styles.loadingOverlay}><ActivityIndicator color={colors.primary} /></View> : null}
    <CleanupModal mode={modalMode} preview={preview} busy={running} onClose={() => { if (!running) { setModalMode(null); setPreview(null); } }} onContinue={() => setModalMode('confirm')} onConfirm={confirmCleanup} styles={styles} colors={colors} />
  </AdminShell>;
}

const createStyles = (colors) => StyleSheet.create({
  stack:{maxWidth:1100,gap:16}, introCard:{flexDirection:'row',alignItems:'flex-start',gap:14,backgroundColor:colors.primarySoft}, introIcon:{width:48,height:48,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border}, introCopy:{flex:1,minWidth:0}, eyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:1,marginBottom:6}, sectionTitle:{color:colors.textPrimary,fontSize:19,fontWeight:'900'}, body:{color:colors.textSecondary,fontSize:13,lineHeight:20,marginTop:5},
  policyGrid:{flexDirection:'row',flexWrap:'wrap',gap:12,marginTop:18}, policyItem:{flexGrow:1,flexBasis:300,minHeight:154,padding:15,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surfaceAlt}, policyLabel:{color:colors.textPrimary,fontSize:14,fontWeight:'900'}, policyDetail:{color:colors.textSecondary,fontSize:12,lineHeight:18,marginTop:4,flex:1}, select:{minHeight:44,marginTop:12,paddingHorizontal:12,borderWidth:1,borderColor:colors.inputBorder,borderRadius:10,backgroundColor:colors.input,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, selectText:{color:colors.textPrimary,fontWeight:'800'}, chevron:{color:colors.primary,fontSize:19,fontWeight:'900'}, readOnlyValue:{minHeight:44,marginTop:12,paddingHorizontal:12,borderWidth:1,borderColor:colors.border,borderRadius:10,backgroundColor:colors.neutral,justifyContent:'center'}, readOnlyText:{color:colors.textPrimary,fontWeight:'800'},
  primaryButton:{minHeight:46,paddingHorizontal:18,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:colors.primary}, primaryButtonText:{color:'#FFFFFF',fontWeight:'900'}, saveButton:{alignSelf:'flex-start',marginTop:16}, secondaryButton:{minHeight:46,paddingHorizontal:18,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.inputBorder}, secondaryButtonText:{color:colors.primary,fontWeight:'900'}, warningButton:{minHeight:46,paddingHorizontal:18,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:colors.warning}, warningButtonText:{color:'#FFFFFF',fontWeight:'900'}, disabled:{opacity:.5},
  statusGrid:{flexDirection:'row',flexWrap:'wrap',gap:12,marginTop:18}, statusItem:{flexGrow:1,flexBasis:220,minHeight:94,borderWidth:1,borderColor:colors.border,borderRadius:12,padding:14,backgroundColor:colors.surfaceAlt}, statusLabel:{color:colors.textSecondary,fontSize:11,fontWeight:'800',textTransform:'uppercase'}, statusValue:{color:colors.textPrimary,fontSize:15,fontWeight:'900',marginTop:7}, statusNote:{color:colors.textSecondary,fontSize:11,marginTop:5}, warningCallout:{marginTop:16,borderWidth:1,borderColor:colors.warning,borderRadius:12,padding:14,backgroundColor:colors.warningSoft}, warningTitle:{color:colors.warning,fontWeight:'900'}, warningText:{color:colors.textPrimary,fontSize:12,lineHeight:18,marginTop:4}, actionRow:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:16},
  protectedCard:{backgroundColor:colors.surface}, protectedGrid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:16}, protectedItem:{flexGrow:1,flexBasis:245,minHeight:42,flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:12,borderRadius:10,backgroundColor:colors.successSoft}, protectedText:{color:colors.textPrimary,fontSize:12,fontWeight:'700',flex:1},
  historyList:{marginTop:16,gap:8}, historyRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:14,padding:13,borderWidth:1,borderColor:colors.border,borderRadius:11,backgroundColor:colors.surfaceAlt}, historyDate:{flexGrow:1,flexBasis:240}, historyMetric:{minWidth:120}, historyPrimary:{color:colors.textPrimary,fontWeight:'800'}, historySecondary:{color:colors.textSecondary,fontSize:11,marginTop:3}, historyNumber:{color:colors.textPrimary,fontSize:16,fontWeight:'900'}, resultBadge:{borderRadius:999,paddingHorizontal:10,paddingVertical:5}, successBadge:{backgroundColor:colors.successSoft}, neutralBadge:{backgroundColor:colors.neutral}, successBadgeText:{color:colors.success,fontSize:11,fontWeight:'900',textTransform:'capitalize'}, neutralBadgeText:{color:colors.textSecondary,fontSize:11,fontWeight:'900',textTransform:'capitalize'},
  emptyState:{minHeight:180,marginTop:16,alignItems:'center',justifyContent:'center',padding:24,borderRadius:12,borderWidth:1,borderStyle:'dashed',borderColor:colors.border,backgroundColor:colors.surfaceAlt}, emptyIcon:{width:48,height:48,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.primarySoft,marginBottom:12}, emptyTitle:{color:colors.textPrimary,fontSize:15,fontWeight:'900'}, emptyBody:{color:colors.textSecondary,fontSize:12,lineHeight:18,textAlign:'center',marginTop:5},
  modalBackdrop:{flex:1,alignItems:'center',justifyContent:'center',padding:18}, optionModal:{width:'100%',maxWidth:420,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:18,backgroundColor:colors.surface}, option:{minHeight:44,paddingHorizontal:12,borderRadius:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, optionSelected:{backgroundColor:colors.primarySoft}, optionText:{color:colors.textSecondary,fontWeight:'700'}, optionTextSelected:{color:colors.primary,fontWeight:'900'}, cleanupModal:{width:'100%',maxWidth:580,maxHeight:'90%',borderWidth:1,borderColor:colors.border,borderRadius:18,backgroundColor:colors.surface,overflow:'hidden'}, modalScroll:{padding:22}, modalIcon:{width:48,height:48,borderRadius:14,alignItems:'center',justifyContent:'center',marginBottom:14}, modalTitle:{color:colors.textPrimary,fontSize:20,fontWeight:'900'}, modalBody:{color:colors.textSecondary,fontSize:13,lineHeight:20,marginTop:7}, previewList:{marginTop:16,borderTopWidth:1,borderTopColor:colors.border}, previewRow:{minHeight:42,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,borderBottomWidth:1,borderBottomColor:colors.border}, previewLabel:{color:colors.textSecondary,fontSize:13,flex:1}, previewValue:{color:colors.textPrimary,fontSize:16,fontWeight:'900'}, protectedPreview:{marginTop:16,padding:13,borderRadius:11,backgroundColor:colors.successSoft}, protectedPreviewTitle:{color:colors.success,fontWeight:'900'}, protectedPreviewText:{color:colors.textPrimary,fontSize:12,lineHeight:18,marginTop:4}, modalActions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:10,marginTop:20},
  skeletonTitle:{height:20,width:'35%'}, skeletonGrid:{height:260,marginTop:18}, errorText:{color:colors.danger,fontWeight:'700'}, retryButton:{alignSelf:'flex-start',marginTop:12}, retryText:{color:colors.primary,fontWeight:'900'}, loadingOverlay:{position:'absolute',top:16,right:16,width:38,height:38,borderRadius:19,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
});
