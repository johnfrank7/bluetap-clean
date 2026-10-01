import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { acknowledgeModerationNotice, loadModerationNotices } from '../services/moderationApi';
import { useBlueTapTheme } from './BlueTapTheme';

const Context = React.createContext({ notices: [], activeRestrictions: [], loading: false, acknowledge: async () => {}, refresh: async () => {} });
const timeOf = (value) => value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime() || 0;

export function ModerationNoticeProvider({ children }) {
  const [notices, setNotices] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const refresh = React.useCallback(async () => {
    try { setNotices((await loadModerationNotices()).notices || []); } catch {} finally { setLoading(false); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  const acknowledge = React.useCallback(async (noticeId) => {
    const result = await acknowledgeModerationNotice(noticeId);
    setNotices((items) => items.map((item) => item.id === noticeId ? result.notice : item));
  }, []);
  const activeRestrictions = React.useMemo(() => notices.filter((notice) => notice.type?.startsWith('suspend_') && timeOf(notice.endsAt) > Date.now()), [notices]);
  const value = React.useMemo(() => ({ notices, activeRestrictions, loading, acknowledge, refresh }), [acknowledge, activeRestrictions, loading, notices, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useModerationNotices = () => React.useContext(Context);

export function ModerationNoticeBanner({ scope }) {
  const { colors } = useBlueTapTheme();
  const { notices, activeRestrictions, acknowledge } = useModerationNotices();
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
      {!notice.acknowledgedAt && <Pressable accessibilityRole="button" accessibilityLabel="Acknowledge safety notice" onPress={() => acknowledge(notice.id)} style={[styles.button, { backgroundColor: colors.warning }]}><Text style={styles.buttonText}>Acknowledge</Text></Pressable>}
    </View>;
  })}</View>;
}

const styles = StyleSheet.create({
  banner: { width: '100%', minWidth: 0, borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, fontWeight: '900' }, body: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  button: { minHeight: 36, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center' }, buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
});
