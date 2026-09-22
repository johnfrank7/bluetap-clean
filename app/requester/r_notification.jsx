import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../firebase';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from '../../components/BlueTapTheme';
import { USER_PORTAL_BOTTOM_CONTENT_INSET, USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import { normalizeRequesterOrderStatus, requesterOrderStatusLabel } from '../../constants/requesterOrderStatus';
import { refreshRequesterRequests, subscribeRequesterRequests } from '../../services/requests';

const asDate = (value) => value instanceof Date ? value : value?.toDate?.() || (value?.seconds ? new Date(value.seconds * 1000) : value ? new Date(value) : null);
const formatWhen = (value) => {
  const date = asDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Time unavailable';
};
const messageFor = (order) => {
  const id = order.request_id || order.requestId || order.id;
  const provider = order.branchNameSnapshot || order.water_station || 'your provider';
  const status = normalizeRequesterOrderStatus(order.status);
  if (order.transferState === 'accepted') return `Order ${id} was transferred to ${provider} and is awaiting distributor assignment.`;
  if (status === 'outside radius pending approval') return `Order ${id} is waiting for branch approval.`;
  if (status === 'awaiting distributor assignment') return `Order ${id} was approved and is waiting for distributor assignment.`;
  if (status === 'distributor assigned') return `A distributor has been assigned to your order ${id}.`;
  if (status === 'branch transfer pending') return `Order ${id} has a branch transfer in progress.`;
  if (status === 'declined outside service area') return `Order ${id} was declined because the delivery location is outside the branch’s service area.`;
  return status === 'pending'
    ? `Order ${id} was sent to ${provider} and is awaiting review.`
    : `Order ${id}: ${requesterOrderStatusLabel(order.status)}. Provider: ${provider}.`;
};

export default function RequesterNotification() {
  useBlueTapTheme();
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let unsubscribeOrders = () => {};
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeOrders();
      setOrders([]);
      setError('');
      if (!user?.uid) { setLoading(false); setError('Requester authentication is required.'); return; }
      setLoading(true);
      unsubscribeOrders = subscribeRequesterRequests(user.uid, (next) => { setOrders(next); setLoading(false); }, (nextError) => { setError(nextError.message); setLoading(false); });
    });
    return () => { unsubscribeAuth(); unsubscribeOrders(); };
  }, []);
  const retry = () => { const uid = auth.currentUser?.uid; if (!uid) return; setError(''); setLoading(true); refreshRequesterRequests(uid); };
  const events = useMemo(() => orders.map((order) => ({ ...order, when: order.updated_at || order.updatedAt || order.created_at || order.createdAt })), [orders]);
  return <SafeAreaView edges={['left','right','bottom']} style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content}>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹ Back</Text></TouchableOpacity>
      <Text style={styles.eyebrow}>REQUESTER</Text><Text style={styles.title}>Notifications</Text><Text style={styles.subtitle}>Updates generated from your real BlueTap orders.</Text>
      {loading ? <View style={styles.state}><ActivityIndicator color={BLUETAP_COLORS.primary}/><Text style={styles.stateText}>Loading updates…</Text></View>
        : error ? <View style={styles.state}><Text style={styles.error}>Notifications unavailable</Text><Text style={styles.stateText}>{error}</Text><TouchableOpacity onPress={retry} style={styles.button}><Text style={styles.buttonText}>Retry</Text></TouchableOpacity></View>
        : events.length === 0 ? <View style={styles.state}><Text style={styles.emptyTitle}>No notifications yet</Text><Text style={styles.stateText}>Order status updates will appear here.</Text><TouchableOpacity onPress={() => router.push('/requester/requestform')} style={styles.button}><Text style={styles.buttonText}>Place an order</Text></TouchableOpacity></View>
        : <View style={styles.list}>{events.map((event) => <TouchableOpacity key={event.id} onPress={() => router.push('/requester/r_request')} style={styles.card}><View style={styles.dot}/><View style={styles.cardBody}><Text style={styles.message}>{messageFor(event)}</Text><Text style={styles.time}>{formatWhen(event.when)}</Text></View><Text style={styles.chevron}>›</Text></TouchableOpacity>)}</View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = createPortalStyleSheet({safe:{flex:1,minWidth:0,backgroundColor:BLUETAP_COLORS.background},content:{width:'100%',maxWidth:USER_PORTAL_LAYOUT.maxWidth,minWidth:0,alignSelf:'center',paddingHorizontal:USER_PORTAL_LAYOUT.gutter,paddingTop:20,paddingBottom:USER_PORTAL_BOTTOM_CONTENT_INSET},back:{alignSelf:'flex-start',paddingVertical:8,marginBottom:10},backText:{color:BLUETAP_COLORS.primary,fontWeight:'900'},eyebrow:{color:BLUETAP_COLORS.primary,fontSize:11,fontWeight:'900',letterSpacing:1},title:{color:BLUETAP_COLORS.textPrimary,fontSize:28,fontWeight:'900',marginTop:5},subtitle:{color:BLUETAP_COLORS.textSecondary,fontSize:14,lineHeight:20,marginTop:6,marginBottom:20},list:{gap:10},card:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:BLUETAP_COLORS.surface,borderWidth:1,borderColor:BLUETAP_COLORS.border,borderRadius:BLUETAP_LAYOUT.radius.lg,padding:16,...BLUETAP_LAYOUT.shadow},dot:{width:10,height:10,borderRadius:5,backgroundColor:BLUETAP_COLORS.primary},cardBody:{flex:1,minWidth:0},message:{color:BLUETAP_COLORS.textPrimary,fontSize:14,lineHeight:20,fontWeight:'700'},time:{color:BLUETAP_COLORS.muted,fontSize:11,marginTop:6},chevron:{color:BLUETAP_COLORS.primary,fontSize:24},state:{minHeight:220,alignItems:'center',justifyContent:'center',backgroundColor:BLUETAP_COLORS.surface,borderWidth:1,borderColor:BLUETAP_COLORS.border,borderRadius:BLUETAP_LAYOUT.radius.lg,padding:24},stateText:{color:BLUETAP_COLORS.textSecondary,fontSize:13,lineHeight:19,textAlign:'center',marginTop:8},emptyTitle:{color:BLUETAP_COLORS.textPrimary,fontSize:17,fontWeight:'900'},error:{color:BLUETAP_COLORS.danger,fontSize:16,fontWeight:'900'},button:{backgroundColor:BLUETAP_COLORS.primary,borderRadius:10,paddingHorizontal:16,paddingVertical:12,marginTop:16},buttonText:{color:'#FFF',fontWeight:'900'}});
