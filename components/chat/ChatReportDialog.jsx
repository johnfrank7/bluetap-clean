import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import categoriesModule from '../../constants/reportCategories';
import { submitChatReport } from '../../services/moderationApi';

const { REPORT_CATEGORIES } = categoriesModule;

export default function ChatReportDialog({ colors, conversation, message, visible, onClose }) {
  const [category, setCategory] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [error, setError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [complete, setComplete] = React.useState(null);
  React.useEffect(() => { if (visible) { setCategory(''); setDetails(''); setError(''); setComplete(null); } }, [visible, message?.id]);
  const submit = async () => {
    if (!category) return setError('Choose a report category.');
    if (category === 'OTHER' && !details.trim()) return setError('Add details for Other.');
    setSubmitting(true); setError('');
    try {
      setComplete(await submitChatReport({ conversationId: conversation.id, ...(message?.id ? { messageId: message.id } : {}), ...(conversation.orderId ? { orderId: conversation.orderId } : {}), category, details: details.trim() }));
    } catch (submitError) { setError(submitError.message || 'The report could not be submitted.'); }
    finally { setSubmitting(false); }
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{complete ? 'Report received' : message ? 'Report message' : 'Report user'}</Text>
      {complete ? <><Text style={[styles.help, { color: colors.textSecondary }]}>Reference {complete.reportId}. BlueTap will review this report. Reports do not automatically restrict an account.</Text><Pressable onPress={onClose} style={[styles.primary, { backgroundColor: colors.primaryAction }]}><Text style={styles.primaryText}>Done</Text></Pressable></> : <>
        <Text style={[styles.help, { color: colors.textSecondary }]}>Choose the closest category. The reported user will not see your private report details.</Text>
        <ScrollView style={styles.options}>{REPORT_CATEGORIES.map((item) => <Pressable key={item.code} accessibilityRole="radio" accessibilityState={{ checked: category === item.code }} onPress={() => setCategory(item.code)} style={[styles.option, { borderColor: category === item.code ? colors.primary : colors.border, backgroundColor: category === item.code ? colors.primarySoft : colors.surfaceAlt }]}><Text style={[styles.optionText, { color: colors.textPrimary }]}>{item.label}</Text></Pressable>)}</ScrollView>
        <TextInput accessibilityLabel="Report details" value={details} onChangeText={(value) => setDetails(value.slice(0, 1000))} multiline maxLength={1000} placeholder={category === 'OTHER' ? 'Required details' : 'Optional details'} placeholderTextColor={colors.textSecondary} style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} />
        <Text style={[styles.count, { color: colors.textSecondary }]}>{details.length}/1000</Text>
        {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>}
        <View style={styles.actions}><Pressable onPress={onClose} style={[styles.secondary, { borderColor: colors.border }]}><Text style={[styles.secondaryText, { color: colors.textPrimary }]}>Cancel</Text></Pressable><Pressable disabled={submitting} onPress={submit} style={[styles.primary, { backgroundColor: colors.primaryAction, opacity: submitting ? .6 : 1 }]}><Text style={styles.primaryText}>{submitting ? 'Submitting…' : 'Submit report'}</Text></Pressable></View>
      </>}
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,20,32,.62)', padding: 20, justifyContent: 'center', alignItems: 'center' },
  card: { width: '100%', maxWidth: 500, maxHeight: '88%', borderRadius: 18, borderWidth: 1, padding: 20 }, title: { fontSize: 20, fontWeight: '900' },
  help: { fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 12 }, options: { maxHeight: 290 }, option: { borderWidth: 1, borderRadius: 10, padding: 11, marginBottom: 7 }, optionText: { fontSize: 13, fontWeight: '800' },
  input: { minHeight: 82, borderWidth: 1, borderRadius: 10, padding: 11, textAlignVertical: 'top', marginTop: 8 }, count: { fontSize: 10, textAlign: 'right', marginTop: 3 }, error: { fontSize: 12, marginTop: 7 }, actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 15 },
  primary: { minHeight: 42, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' }, primaryText: { color: '#FFFFFF', fontWeight: '900' }, secondary: { minHeight: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, justifyContent: 'center' }, secondaryText: { fontWeight: '800' },
});
