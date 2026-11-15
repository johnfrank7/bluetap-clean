import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { auth } from '../firebase';
import { useBlueTapTheme } from './BlueTapTheme';
import { fetchDistributorDeliveryReview, fetchDistributorDeliveryReviews } from '../services/distributorDeliveryReviews';
const { reviewViewModel } = require('../services/distributorReviewPresentation');

const timeLabel = (value) => value ? new Date(value).toLocaleString() : '';

export default function DistributorDeliveryReviews({ uid }) {
  const { colors } = useBlueTapTheme();
  const [state, setState] = React.useState({ uid: '', reviews: [], cursor: null, pageCursor: '',
    loaded: false, loading: false, error: '' });
  const [selected, setSelected] = React.useState(null);
  const [detailError, setDetailError] = React.useState('');
  const epochRef = React.useRef(0);
  const busyRef = React.useRef(false);
  const validSession = Boolean(uid && auth.currentUser?.uid === uid && state.uid === uid);
  const visible = validSession ? state : { reviews: [], cursor: null, pageCursor: '', loaded: false, loading: false, error: '' };

  const load = React.useCallback(async (ownerUid, cursor = '') => {
    if (busyRef.current || !ownerUid || auth.currentUser?.uid !== ownerUid) return;
    busyRef.current = true;
    const epoch = epochRef.current;
    setState((current) => ({ ...current, uid: ownerUid, loading: true, error: '' }));
    try {
      const result = await fetchDistributorDeliveryReviews({ cursor, limit: 5, expectedUid: ownerUid });
      if (epoch !== epochRef.current || auth.currentUser?.uid !== ownerUid) return;
      if (!Array.isArray(result.reviews) || result.reviews.length > 5
        || !(result.nextCursor === null || /^[a-f0-9]{64}$/.test(result.nextCursor))
        || result.nextCursor === cursor) throw new Error('Invalid review page. Please retry.');
      const page = result.reviews.map(reviewViewModel);
      if (page.some((item) => !item)) throw new Error('Invalid review page. Please retry.');
      setSelected(null);
      setState({ uid: ownerUid, reviews: page, cursor: result.nextCursor, pageCursor: cursor,
        loaded: true, loading: false, error: '' });
    } catch (error) {
      if (epoch === epochRef.current && auth.currentUser?.uid === ownerUid) {
        setState((current) => ({ ...current, uid: ownerUid, loaded: true,
          loading: false, error: error.message || 'Delivery reviews could not load.' }));
      }
    } finally { if (epoch === epochRef.current) busyRef.current = false; }
  }, []);

  React.useEffect(() => {
    epochRef.current += 1;
    busyRef.current = false;
    setSelected(null);
    setDetailError('');
    setState({ uid: '', reviews: [], cursor: null, pageCursor: '', loaded: false, loading: false, error: '' });
    if (uid && auth.currentUser?.uid === uid) load(uid);
    return () => { epochRef.current += 1; };
  }, [uid, load]);

  const open = async (item) => {
    if (!validSession || busyRef.current) return;
    const epoch = epochRef.current;
    const ownerUid = uid;
    busyRef.current = true;
    setDetailError('');
    try {
      const result = await fetchDistributorDeliveryReview(item.attemptId, ownerUid);
      if (epoch !== epochRef.current || auth.currentUser?.uid !== ownerUid) return;
      const detail = reviewViewModel(result.review);
      if (!detail || detail.attemptId !== item.attemptId || detail.orderId !== item.orderId) throw new Error('Review details are unavailable.');
      setSelected(detail);
    } catch (error) {
      if (epoch === epochRef.current && auth.currentUser?.uid === ownerUid) {
        setSelected(null);
        setDetailError(error.message || 'Review details are unavailable.');
      }
    } finally { if (epoch === epochRef.current) busyRef.current = false; }
  };

  if (!uid || auth.currentUser?.uid !== uid) return null;

  return <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <Text style={[styles.heading, { color: colors.textPrimary }]}>Delivery reviews</Text>
    <Text style={[styles.subheading, { color: colors.textSecondary }]}>Your reported failed attempts, including transferred orders.</Text>
    {!visible.loaded && <ActivityIndicator color={colors.primary} />}
    {!!visible.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{visible.error}</Text>}
    {visible.loaded && !visible.reviews.length && !visible.error &&
      <Text style={{ color: colors.textSecondary }}>{visible.cursor ? 'No reviews on this page. More may be available.' : 'No delivery reviews on this page.'}</Text>}
    {visible.reviews.map((item) => <Pressable key={item.attemptId} accessibilityRole="button"
      accessibilityLabel={`Order ${item.orderReference}, ${item.statusLabel}. View review`}
      onPress={() => open(item)} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
      <Text numberOfLines={1} style={[styles.order, { color: colors.textPrimary }]}>Order {item.orderReference}</Text>
      <Text style={[styles.status, { color: item.reviewStatus === 'completed' ? colors.success : colors.primary }]}>{item.statusLabel}</Text>
    </Pressable>)}
    {validSession && !!detailError && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{detailError}</Text>}
    {validSession && !!selected && <View style={[styles.detail, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Text style={[styles.order, { color: colors.textPrimary }]}>{selected.statusLabel}</Text>
      <Text style={{ color: colors.textSecondary }}>{selected.summary}</Text>
      {selected.reviewStatus === 'completed' && <>
        <Text style={{ color: colors.textPrimary }}>{selected.responsibilityLabel}</Text>
        <Text style={{ color: colors.textSecondary }}>Decided: {timeLabel(selected.decidedAt)}</Text>
      </>}
    </View>}
    {!!visible.cursor && <Pressable accessibilityRole="button" accessibilityLabel="Show next delivery reviews"
      disabled={visible.loading} onPress={() => load(uid, visible.cursor)} style={styles.more}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{visible.loading ? 'Loading…' : 'Next reviews'}</Text>
    </Pressable>}
    {!!visible.pageCursor && <Pressable accessibilityRole="button" accessibilityLabel="Show first delivery review page"
      disabled={visible.loading} onPress={() => load(uid)} style={styles.more}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>Back to first page</Text>
    </Pressable>}
    {visible.loaded && !visible.pageCursor && !visible.error && <Pressable accessibilityRole="button"
      accessibilityLabel="Refresh delivery reviews" disabled={visible.loading} onPress={() => load(uid)} style={styles.more}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>Refresh reviews</Text>
    </Pressable>}
    {!!visible.error && <Pressable accessibilityRole="button" accessibilityLabel="Retry delivery reviews"
      onPress={() => load(uid, visible.pageCursor)} style={styles.more}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>Retry</Text>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, marginBottom: 14 },
  heading: { fontSize: 16, fontWeight: '800' },
  subheading: { fontSize: 12, lineHeight: 17 },
  row: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  order: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  status: { fontSize: 12, fontWeight: '700' },
  detail: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6 },
  more: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});
