import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { acknowledgeModerationNotice, loadModerationNotices, markModerationNoticeSeen } from '../services/moderationApi';
import { subscribeModerationActivity } from '../services/moderationRealtime';
import { useBlueTapTheme } from './BlueTapTheme';

const Context = React.createContext({ notices: [], activeRestrictions: [], loading: false, acknowledge: async () => {}, openNotice: () => {}, refresh: async () => {} });
const timeOf = (value) => value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime() || 0;
const categoryLabel = (value) => String(value || 'account conduct').toLowerCase().replaceAll('_', ' ');

function NoticeDetailModal({ notice, onClose, onAcknowledge }) {
  const { colors } = useBlueTapTheme();
  if (!notice) return null;
  const restriction = notice.type?.startsWith('suspend_');
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay || 'rgba(2, 16, 31, .62)' }]}>
      <View accessibilityViewIsModal style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.modalEyebrow, { color: colors.warning }]}>REPORTS &amp; SAFETY</Text>
        <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>{notice.title || 'BlueTap safety notice'}</Text>
        <Text style={[styles.modalBody, { color: colors.textSecondary }]}>{restriction
          ? `This ${categoryLabel(notice.scope)} restriction${notice.branchName ? ` applies to ${notice.branchName}` : ' applies across BlueTap'}${notice.endsAt ? ` until ${new Date(notice.endsAt).toLocaleString()}` : ''}.`
          : `A moderator issued a warning related to ${categoryLabel(notice.category)}. Please follow BlueTap's safety and conduct requirements.`}</Text>
        <Text style={[styles.modalMeta, { color: colors.textSecondary }]}>Reporter identity and private moderator notes are never disclosed.</Text>
        <View style={styles.modalActions}>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.secondaryButton, { borderColor: colors.border }]}><Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Close</Text></Pressable>
          {!notice.acknowledgedAt && <Pressable accessibilityRole="button" onPress={() => onAcknowledge(notice.id)} style={[styles.primaryButton, { backgroundColor: colors.warning }]}><Text style={styles.buttonText}>Acknowledge</Text></Pressable>}
        </View>
      </View>
    </View>
  </Modal>;
}

export function ModerationNoticeProvider({ children }) {
  const [notices, setNotices] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState('');
  const shown = React.useRef(new Set());
  const refresh = React.useCallback(async () => {
    try { setNotices((await loadModerationNotices()).notices || []); } catch {} finally { setLoading(false); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => subscribeModerationActivity({ role: 'user', onChange: refresh }), [refresh]);
  React.useEffect(() => {
    if (selectedId) return;
    const unseen = notices.find((notice) => !notice.seenAt && !shown.current.has(notice.id));
    if (!unseen) return;
    shown.current.add(unseen.id);
    setSelectedId(unseen.id);
    setNotices((items) => items.map((item) => item.id === unseen.id ? { ...item, seenAt: new Date().toISOString() } : item));
    markModerationNoticeSeen(unseen.id)
      .then((result) => setNotices((items) => items.map((item) => item.id === unseen.id ? result.notice : item)))
      .catch(() => {});
  }, [notices, selectedId]);
  const acknowledge = React.useCallback(async (noticeId) => {
    const result = await acknowledgeModerationNotice(noticeId);
    setNotices((items) => items.map((item) => item.id === noticeId ? result.notice : item));
  }, []);
  const openNotice = React.useCallback((noticeId) => setSelectedId(noticeId), []);
  const activeRestrictions = React.useMemo(() => notices.filter((notice) => notice.type?.startsWith('suspend_') && timeOf(notice.endsAt) > Date.now()), [notices]);
  const selected = notices.find((notice) => notice.id === selectedId) || null;
  const value = React.useMemo(() => ({ notices, activeRestrictions, loading, acknowledge, openNotice, refresh }), [acknowledge, activeRestrictions, loading, notices, openNotice, refresh]);
  return <Context.Provider value={value}>{children}<NoticeDetailModal notice={selected} onClose={() => setSelectedId('')} onAcknowledge={(noticeId) => acknowledge(noticeId).then(() => setSelectedId('')).catch(() => {})} /></Context.Provider>;
}

export const useModerationNotices = () => React.useContext(Context);

export function ModerationNoticeBanner({ scope }) {
  const { colors } = useBlueTapTheme();
  const { notices, activeRestrictions, acknowledge, openNotice } = useModerationNotices();
  const restrictions = activeRestrictions.filter((item) => !scope || item.scope?.includes(scope));
  const warning = notices.find((item) => item.type === 'warn' && !item.acknowledgedAt);
  const visible = [...restrictions, ...(warning ? [warning] : [])].slice(0, 3);
  if (!visible.length) return null;
  return <View>{visible.map((notice) => {
    const restriction = notice.type?.startsWith('suspend_');
    return <View key={notice.id} accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{notice.title || (restriction ? 'Account restriction' : 'Safety notice')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{restriction ? `${notice.title}${notice.branchName ? ` for ${notice.branchName}` : ''}. This remains in effect until the stated end time.` : `A moderator issued a warning related to ${String(notice.category || 'account conduct').toLowerCase().replaceAll('_', ' ')}.`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="View safety notice details" onPress={() => openNotice(notice.id)} style={[styles.detailsButton, { borderColor: colors.warning }]}><Text style={[styles.detailsText, { color: colors.warning }]}>View details</Text></Pressable>
      {!notice.acknowledgedAt && <Pressable accessibilityRole="button" accessibilityLabel="Acknowledge safety notice" onPress={() => acknowledge(notice.id)} style={[styles.button, { backgroundColor: colors.warning }]}><Text style={styles.buttonText}>Acknowledge</Text></Pressable>}
    </View>;
  })}</View>;
}

const styles = StyleSheet.create({
  banner: { width: '100%', minWidth: 0, borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, fontWeight: '900' }, body: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  button: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  detailsButton: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, justifyContent: 'center' }, detailsText: { fontSize: 12, fontWeight: '900' },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: 18, padding: 22 },
  modalEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1 }, modalTitle: { fontSize: 21, fontWeight: '900', marginTop: 8 },
  modalBody: { fontSize: 14, lineHeight: 21, marginTop: 10 }, modalMeta: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  secondaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 10 },
  primaryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 },
});
