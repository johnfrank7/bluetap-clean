import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function AccountAccessState({ state = 'inactive', onBack }) {
  const { colors } = useBlueTapTheme();
  const terminated = state === 'terminated';
  const title = terminated ? 'Account terminated' : state === 'suspended' ? 'Account temporarily suspended' : 'Account unavailable';
  const message = terminated
    ? 'This BlueTap account has been terminated and can no longer access ordering, delivery, or messaging services.'
    : state === 'suspended'
      ? 'This BlueTap account is temporarily suspended. Access will remain unavailable until an Administrator reactivates it.'
      : 'This BlueTap account is inactive. Contact BlueTap support if you believe this is an error.';
  return <View style={[styles.root, { backgroundColor: colors.background }]}><View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.icon, { backgroundColor: colors.dangerSoft }]}><Text style={[styles.iconText, { color: colors.danger }]}>!</Text></View><Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text><Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text><Text style={[styles.help, { color: colors.textSecondary }]}>For privacy, report details, reporter identity, and moderator notes are not shown here.</Text><Pressable accessibilityRole="button" onPress={onBack} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={styles.buttonText}>Back to sign in</Text></Pressable></View></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  card: { width: '100%', maxWidth: 500, borderWidth: 1, borderRadius: 20, padding: 24, alignItems: 'center' },
  icon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }, iconText: { fontSize: 28, fontWeight: '900' },
  title: { fontSize: 23, fontWeight: '900', textAlign: 'center', marginTop: 16 }, message: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 }, help: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12 },
  button: { minHeight: 46, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 22 }, buttonText: { color: '#FFFFFF', fontWeight: '900' },
});
