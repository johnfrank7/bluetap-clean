import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAdminTheme } from './AdminTheme';

export function SkeletonBlock({ style }) {
  const { colors } = useAdminTheme();
  return <View accessibilityLabel="Loading" style={[styles.block, { backgroundColor: colors.neutral, borderColor: colors.border }, style]} />;
}

export function CardSkeleton({ lines = 3, style }) {
  const { colors } = useAdminTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
    <SkeletonBlock style={styles.short} />
    {Array.from({ length: lines }, (_, index) => <SkeletonBlock key={index} style={[styles.line, index === lines - 1 && styles.medium]} />)}
  </View>;
}

export function TableSkeleton({ rows = 4 }) {
  const { colors } = useAdminTheme();
  return <View style={[styles.table, { borderColor: colors.border }]}>
    <SkeletonBlock style={styles.tableHeader} />
    {Array.from({ length: rows }, (_, index) => <SkeletonBlock key={index} style={styles.tableRow} />)}
  </View>;
}

export function AdminRouteSkeleton() {
  return <View style={styles.route}>
    <View style={styles.grid}><CardSkeleton /><CardSkeleton /><CardSkeleton /></View>
    <CardSkeleton lines={5} style={styles.wide} />
  </View>;
}

const styles = StyleSheet.create({
  block:{borderWidth:1,borderRadius:8,opacity:.72},
  card:{flexGrow:1,flexBasis:220,minHeight:150,borderWidth:1,borderRadius:16,padding:18},
  short:{width:'38%',height:13}, line:{height:12,marginTop:15}, medium:{width:'68%'},
  table:{borderWidth:1,borderRadius:12,padding:12,marginTop:14},tableHeader:{height:34},tableRow:{height:42,marginTop:8},
  route:{gap:16},grid:{flexDirection:'row',flexWrap:'wrap',gap:14},wide:{flexBasis:'100%',minHeight:230},
});
