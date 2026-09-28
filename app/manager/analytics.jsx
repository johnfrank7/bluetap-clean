import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAdminTheme } from '../../components/AdminTheme';
import BlueTapEmptyState from '../../components/BlueTapEmptyState';
import ManagerShell from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';

const normalizedStatus = (value) => String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
const deliveredStats = (order = {}) => {
  if (Array.isArray(order.items) && order.items.length) return order.items.reduce((total, item) => ({
    units: total.units + Number(item.quantity || 0),
    revenue: total.revenue + (Number(item.totalAtOrder ?? item.line_total ?? (Number(item.unitPriceAtOrder || 0) * Number(item.quantity || 0))) || 0),
  }), { units: 0, revenue: 0 });
  return { units: Number(order.quantity || 0), revenue: Number(order.totalAtOrder ?? order.total_cost ?? 0) || 0 };
};
const money = (value) => `₱${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ManagerAnalyticsPage() {
  const { colors, resolvedTheme } = useAdminTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { branch, requests, users, loading, error } = useManagerRealtimeData();
  const metrics = React.useMemo(() => {
    const result = { total: requests.length, delivered: 0, ongoing: 0, issues: 0, revenue: 0, units: 0 };
    const products = new Map();
    requests.forEach((order) => {
      const status = normalizedStatus(order.status);
      if (status === 'delivered') {
        result.delivered++;
        const stats = deliveredStats(order); result.revenue += stats.revenue; result.units += stats.units;
        (order.items || []).forEach((item) => {
          const name = item.productNameSnapshot || item.product_name || 'Product';
          const existing = products.get(name) || { name, units: 0, revenue: 0 };
          existing.units += Number(item.quantity || 0);
          existing.revenue += Number(item.totalAtOrder ?? item.line_total ?? 0) || 0;
          products.set(name, existing);
        });
      } else if (['cancelled','canceled','delivery_failed','declined','rejected','declined_outside_service_area'].includes(status)) result.issues++;
      else result.ongoing++;
    });
    return { ...result, products: [...products.values()].sort((a, b) => b.revenue - a.revenue) };
  }, [requests]);
  const roleCount = (role) => users.filter((user) => user.role === role).length;
  const maxStatus = Math.max(metrics.delivered, metrics.ongoing, metrics.issues, 1);

  return <ManagerShell active="analytics" title="Analytics" subtitle={`Authoritative performance for ${branch?.name || 'your assigned branch'}`}>
    <View style={styles.scope}><Text style={styles.scopeEyebrow}>BRANCH-ONLY SCOPE</Text><Text style={styles.scopeTitle}>{branch?.name || 'Assigned branch'}</Text><Text style={styles.scopeText}>Revenue and units use delivered-order price snapshots. No catalog prices, gallons, or generated trend points are used.</Text></View>
    {loading && requests.length === 0 ? <View style={styles.state}><ActivityIndicator color={colors.primary}/><Text style={styles.secondary}>Loading branch analytics…</Text></View> : error && requests.length === 0 ? <BlueTapEmptyState compact variant="analytics" title="Analytics unavailable" description={error} themeColors={colors} dark={resolvedTheme === 'dark'}/> : <>
      <View style={styles.metrics}>
        <Metric styles={styles} label="Snapshot revenue" value={money(metrics.revenue)} detail={`${metrics.delivered} delivered orders`}/>
        <Metric styles={styles} label="Units sold" value={metrics.units.toLocaleString()} detail="Delivered items only"/>
        <Metric styles={styles} label="Total orders" value={metrics.total.toLocaleString()} detail="Current branch records"/>
        <Metric styles={styles} label="Delivered" value={metrics.delivered.toLocaleString()} detail="Completed fulfillment"/>
        <Metric styles={styles} label="Ongoing" value={metrics.ongoing.toLocaleString()} detail="Non-terminal orders"/>
        <Metric styles={styles} label="Issues & cancelled" value={metrics.issues.toLocaleString()} detail="Failed, declined, or cancelled" danger/>
      </View>
      {metrics.total === 0 ? <BlueTapEmptyState compact variant="analytics" title="Insufficient analytics data" description="Real branch metrics will appear after orders are created." themeColors={colors} dark={resolvedTheme === 'dark'}/> : <View style={styles.grid}>
        <View style={styles.panel}><Text style={styles.panelTitle}>Order status distribution</Text>{[['Delivered',metrics.delivered,colors.success],['Ongoing',metrics.ongoing,colors.warning],['Issues & cancelled',metrics.issues,colors.danger]].map(([label,value,color]) => <View key={label} style={styles.barRow}><View style={styles.barHeader}><Text style={styles.barLabel}>{label}</Text><Text style={styles.barValue}>{value}</Text></View><View style={styles.track}><View style={[styles.fill,{width:`${Math.max(value ? 8 : 0,(value/maxStatus)*100)}%`,backgroundColor:color}]}/></View></View>)}</View>
        <View style={styles.panel}><Text style={styles.panelTitle}>Branch people</Text><View style={styles.peopleRow}><Metric styles={styles} label="Requesters" value={roleCount('requester')} detail="Seen in branch records" compact/><Metric styles={styles} label="Distributors" value={roleCount('distributor')} detail="Assigned to branch" compact/></View></View>
        <View style={[styles.panel,styles.productPanel]}><Text style={styles.panelTitle}>Delivered product breakdown</Text>{metrics.products.length === 0 ? <Text style={styles.secondary}>No delivered product snapshots are available yet.</Text> : metrics.products.map((product) => <View key={product.name} style={styles.productRow}><Text style={styles.productName}>{product.name}</Text><Text style={styles.productMeta}>{product.units} units · {money(product.revenue)}</Text></View>)}</View>
      </View>}
    </>}
  </ManagerShell>;
}
function Metric({ styles, label, value, detail, danger, compact }) { return <View style={[styles.metric,compact&&styles.metricCompact,danger&&styles.metricDanger]}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></View>; }
const createStyles = (colors) => StyleSheet.create({
  scope:{backgroundColor:colors.primary,borderRadius:18,padding:20,marginBottom:18},scopeEyebrow:{color:'#CBEAFF',fontSize:10,fontWeight:'900',letterSpacing:1},scopeTitle:{color:'#FFF',fontSize:23,fontWeight:'900',marginTop:5},scopeText:{color:'#E3F2FD',fontSize:12,lineHeight:18,marginTop:5,maxWidth:720},state:{minHeight:220,alignItems:'center',justifyContent:'center',gap:10},secondary:{color:colors.textSecondary,fontSize:12,lineHeight:18,marginTop:8},metrics:{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:18},metric:{flexGrow:1,flexBasis:170,minHeight:125,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:15},metricCompact:{minHeight:105,flexBasis:130},metricDanger:{borderTopWidth:4,borderTopColor:colors.danger},metricLabel:{color:colors.textSecondary,fontSize:10,fontWeight:'900',textTransform:'uppercase'},metricValue:{color:colors.textPrimary,fontSize:23,fontWeight:'900',marginTop:8},metricDetail:{color:colors.textSecondary,fontSize:11,lineHeight:16,marginTop:5},grid:{flexDirection:'row',flexWrap:'wrap',gap:14},panel:{flexGrow:1,flexBasis:300,minWidth:0,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:14,padding:17},productPanel:{flexBasis:'100%'},panelTitle:{color:colors.textPrimary,fontSize:15,fontWeight:'900',marginBottom:12},barRow:{marginTop:11},barHeader:{flexDirection:'row',justifyContent:'space-between',gap:12},barLabel:{color:colors.textSecondary,fontSize:12,fontWeight:'700'},barValue:{color:colors.textPrimary,fontSize:12,fontWeight:'900'},track:{height:9,borderRadius:5,backgroundColor:colors.surfaceAlt,overflow:'hidden',marginTop:6},fill:{height:'100%',borderRadius:5},peopleRow:{flexDirection:'row',flexWrap:'wrap',gap:10},productRow:{flexDirection:'row',justifyContent:'space-between',gap:14,paddingVertical:10,borderTopWidth:1,borderTopColor:colors.border},productName:{flex:1,minWidth:0,color:colors.textPrimary,fontSize:13,fontWeight:'800'},productMeta:{color:colors.textSecondary,fontSize:12,fontWeight:'700'},
});
