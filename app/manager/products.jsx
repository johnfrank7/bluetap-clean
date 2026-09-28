import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import ManagerShell from '../../components/ManagerShell';
import TopToastFeedback from '../../components/TopToastFeedback';
import { getManagerWorkspace, updateManagerProductPolicy } from '../../services/managerWorkspace';
const { WEEKDAYS } = require('../../services/productOrderPolicy');

const money = (value) => `₱${Number(value || 0).toFixed(2)}`;
const dayLabel = (days = []) => days.length === 7 ? 'Daily' : days.map((day) => day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())).join(', ');

export default function ManagerProductsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const compact = useWindowDimensions().width < 760;
  const styles = React.useMemo(() => createStyles(colors, compact), [colors, compact]);
  const [workspace, setWorkspace] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [editingId, setEditingId] = React.useState('');
  const [days, setDays] = React.useState([]);
  const [limit, setLimit] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState({ visible: false, message: '', type: 'info' });
  const load = React.useCallback(async () => {
    setError('');
    try { setWorkspace(await getManagerWorkspace()); }
    catch (nextError) { setError(nextError.message || 'Unable to load branch products.'); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const products = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return (workspace?.products || []).filter((product) => !query || [product.product_name, product.containerType, product.size].join(' ').toLowerCase().includes(query));
  }, [search, workspace?.products]);
  const editPolicy = (product) => {
    setEditingId(product.id);
    setDays(product.effectivePolicy?.configuredDeliveryDays || product.effectivePolicy?.deliveryDays || []);
    setLimit(product.effectivePolicy?.maxQuantityPerRequester == null ? '' : String(product.effectivePolicy.maxQuantityPerRequester));
  };
  const savePolicy = async (product) => {
    const parsedLimit = limit.trim() === '' ? null : Number(limit);
    if (parsedLimit !== null && (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)) {
      setToast({ visible: true, message: 'Order limit must be a whole number from 1 to 100.', type: 'error' }); return;
    }
    setSaving(true);
    try {
      const result = await updateManagerProductPolicy(product.id, { deliveryDays: days, maxQuantityPerRequester: parsedLimit });
      setWorkspace((current) => ({ ...current, products: current.products.map((item) => item.id === product.id ? { ...item, effectivePolicy: { ...result.policy, configuredDeliveryDays: result.policy.deliveryDays } } : item) }));
      setEditingId(''); setToast({ visible: true, message: 'Branch delivery rules saved successfully.', type: 'success' });
    } catch (nextError) { setToast({ visible: true, message: nextError.message || 'Unable to save branch delivery rules.', type: 'error' }); }
    finally { setSaving(false); }
  };
  const branch = workspace?.branch;
  return <ManagerShell active="products" title="Products" subtitle="Branch catalog, delivery pricing, and operational product rules">
    <TopToastFeedback visible={toast.visible} message={toast.message} type={toast.type} onDismiss={() => setToast((current) => ({ ...current, visible: false }))} />
    <View style={styles.infoGrid}>
      <View style={styles.infoCard}><Text style={styles.eyebrow}>DELIVERY PRICING</Text><Text style={styles.cardTitle}>Authoritative branch pricing</Text><Text style={styles.cardHelp}>Pricing is managed by Admin and shown here for dispatch planning.</Text><View style={styles.metricGrid}><Metric label="Base delivery fee" value={money(branch?.baseDeliveryFee)} styles={styles}/><Metric label="Included radius" value={`${branch?.includedRadiusKm || 0} km`} styles={styles}/><Metric label="Outside-radius fee" value={`${money(branch?.outsideRadiusFeePerKm)} / km`} styles={styles}/><Metric label="Service radius" value={`${branch?.serviceRadiusKm || 0} km`} styles={styles}/></View></View>
      <View style={styles.infoCard}><Text style={styles.eyebrow}>BRANCH DELIVERY RULES</Text><Text style={styles.cardTitle}>Operational policy for {branch?.name || 'your branch'}</Text><Text style={styles.cardHelp}>Overrides apply only to this branch. Admin product identity, price, image, and activation remain unchanged.</Text><View style={styles.precedence}><Text style={styles.precedenceText}>Branch override → Admin default → unrestricted legacy fallback</Text></View></View>
    </View>
    <View style={styles.catalogCard}>
      <View style={styles.toolbar}><View style={styles.toolbarCopy}><Text style={styles.cardTitle}>Branch product catalog ({workspace?.products?.length || 0})</Text><Text style={styles.cardHelp}>Configure delivery weekdays and Requester quantity limits per product.</Text></View><TextInput accessibilityLabel="Search products" value={search} onChangeText={setSearch} placeholder="Search products…" placeholderTextColor={colors.placeholder} style={styles.search}/></View>
      {loading ? <View style={styles.state}><ActivityIndicator color={colors.primary}/><Text style={styles.cardHelp}>Loading branch catalog…</Text></View> : error ? <BlueTapEmptyState compact variant="products" title="Products unavailable" description={error} actionLabel="Retry" onAction={load} themeColors={colors} dark={resolvedTheme === 'dark'}/> : products.length === 0 ? <BlueTapEmptyState compact variant="products" title="No products found" description="Active products assigned to this branch will appear here." themeColors={colors} dark={resolvedTheme === 'dark'}/> : <View style={styles.productGrid}>{products.map((product) => {
        const policy = product.effectivePolicy || {}; const editing = editingId === product.id;
        return <View key={product.id} style={styles.productCard}><View style={styles.productTop}><View style={styles.imageSurface}>{product.imageUrl || product.image ? <Image source={{ uri: product.imageUrl || product.image }} style={styles.image} resizeMode="contain"/> : <Text style={styles.imagePlaceholder}>◈</Text>}</View><View style={styles.productCopy}><View style={styles.nameRow}><Text style={styles.productName}>{product.product_name}</Text><Text style={styles.activeBadge}>{product.active === false ? 'Inactive' : 'Active'}</Text></View><Text style={styles.price}>{money(product.price)}</Text><Text style={styles.meta}>{[product.containerType, product.size].filter(Boolean).join(' · ') || 'Container details not set'}</Text></View></View><View style={styles.policySummary}><Metric label="Delivery availability" value={dayLabel(policy.deliveryDays || WEEKDAYS)} styles={styles} small/><Metric label="Requester order limit" value={policy.maxQuantityPerRequester == null ? 'No limit' : `${policy.maxQuantityPerRequester} per request`} styles={styles} small/></View>
        {editing ? <View style={styles.editor}><Text style={styles.fieldLabel}>Available delivery weekdays</Text><View style={styles.dayChoices}>{WEEKDAYS.map((day) => <TouchableOpacity key={day} accessibilityRole="checkbox" accessibilityState={{ checked: days.includes(day) }} onPress={() => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} style={[styles.dayChoice, days.includes(day) && styles.dayChoiceActive]}><Text style={[styles.dayChoiceText, days.includes(day) && styles.dayChoiceTextActive]}>{day.slice(0, 3).toUpperCase()}</Text></TouchableOpacity>)}</View><Text style={styles.fieldHint}>No selected days means daily availability.</Text><Text style={styles.fieldLabel}>Requester quantity limit</Text><TextInput accessibilityLabel="Requester quantity limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" placeholder="No limit" placeholderTextColor={colors.placeholder} style={styles.limitInput}/><View style={styles.actions}><TouchableOpacity disabled={saving} onPress={() => setEditingId('')} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity disabled={saving} onPress={() => savePolicy(product)} style={[styles.primary, saving && styles.disabled]}><Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save branch rules'}</Text></TouchableOpacity></View></View> : <TouchableOpacity accessibilityRole="button" onPress={() => editPolicy(product)} style={styles.editButton}><Text style={styles.editButtonText}>Edit branch delivery rules</Text></TouchableOpacity>}</View>;
      })}</View>}
    </View>
  </ManagerShell>;
}
function Metric({ label, value, styles, small = false }) { return <View style={[styles.metric, small && styles.metricSmall]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }
const createStyles = (colors, compact) => StyleSheet.create({
  infoGrid:{flexDirection:compact?'column':'row',gap:16,marginBottom:18},infoCard:{flex:1,minWidth:0,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:18},eyebrow:{color:colors.primary,fontSize:10,fontWeight:'900',letterSpacing:1},cardTitle:{color:colors.textPrimary,fontSize:18,fontWeight:'900',marginTop:4},cardHelp:{color:colors.textSecondary,fontSize:12,lineHeight:18,marginTop:5},metricGrid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:15},metric:{flexGrow:1,flexBasis:135,backgroundColor:colors.surfaceAlt,borderWidth:1,borderColor:colors.border,borderRadius:11,padding:12},metricSmall:{flexBasis:180},metricLabel:{color:colors.textSecondary,fontSize:10,fontWeight:'800'},metricValue:{color:colors.textPrimary,fontSize:13,fontWeight:'900',marginTop:4},precedence:{backgroundColor:colors.primarySoft,borderRadius:10,padding:12,marginTop:15},precedenceText:{color:colors.textPrimary,fontSize:12,fontWeight:'800'},catalogCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:18},toolbar:{flexDirection:compact?'column':'row',alignItems:compact?'stretch':'center',justifyContent:'space-between',gap:14,marginBottom:16},toolbarCopy:{flex:1,minWidth:0},search:{minHeight:44,minWidth:compact?0:250,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:10,paddingHorizontal:12,color:colors.textPrimary,outlineStyle:'none'},state:{minHeight:160,alignItems:'center',justifyContent:'center',gap:10},productGrid:{flexDirection:'row',flexWrap:'wrap',gap:14},productCard:{flexGrow:1,flexBasis:compact?'100%':360,maxWidth:compact?undefined:540,minWidth:0,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surfaceAlt,borderRadius:14,padding:15},productTop:{flexDirection:'row',gap:14},imageSurface:{width:92,height:92,borderRadius:12,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border},image:{width:'88%',height:'88%'},imagePlaceholder:{color:colors.primary,fontSize:32},productCopy:{flex:1,minWidth:0},nameRow:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:8},productName:{flex:1,color:colors.textPrimary,fontSize:16,fontWeight:'900'},activeBadge:{color:colors.success,backgroundColor:colors.successSoft,borderRadius:999,paddingHorizontal:8,paddingVertical:4,fontSize:10,fontWeight:'900'},price:{color:colors.primary,fontSize:16,fontWeight:'900',marginTop:8},meta:{color:colors.textSecondary,fontSize:12,marginTop:4},policySummary:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:14},editButton:{minHeight:42,borderWidth:1,borderColor:colors.primary,borderRadius:9,alignItems:'center',justifyContent:'center',marginTop:13},editButtonText:{color:colors.primary,fontWeight:'900',fontSize:12},editor:{borderTopWidth:1,borderTopColor:colors.border,marginTop:14,paddingTop:14},fieldLabel:{color:colors.textPrimary,fontSize:12,fontWeight:'900',marginBottom:7,marginTop:7},dayChoices:{flexDirection:'row',flexWrap:'wrap',gap:7},dayChoice:{minWidth:48,minHeight:36,borderWidth:1,borderColor:colors.inputBorder,borderRadius:8,alignItems:'center',justifyContent:'center'},dayChoiceActive:{backgroundColor:colors.primary,borderColor:colors.primary},dayChoiceText:{color:colors.textPrimary,fontSize:10,fontWeight:'900'},dayChoiceTextActive:{color:'#FFF'},fieldHint:{color:colors.textSecondary,fontSize:10,marginTop:6},limitInput:{minHeight:42,maxWidth:180,borderWidth:1,borderColor:colors.inputBorder,backgroundColor:colors.input,borderRadius:9,paddingHorizontal:11,color:colors.textPrimary,outlineStyle:'none'},actions:{flexDirection:'row',justifyContent:'flex-end',flexWrap:'wrap',gap:9,marginTop:14},secondary:{minHeight:42,borderWidth:1,borderColor:colors.inputBorder,borderRadius:9,paddingHorizontal:14,justifyContent:'center'},secondaryText:{color:colors.textPrimary,fontWeight:'900'},primary:{minHeight:42,backgroundColor:colors.primary,borderRadius:9,paddingHorizontal:15,justifyContent:'center'},primaryText:{color:'#FFF',fontWeight:'900'},disabled:{opacity:.55},
});
