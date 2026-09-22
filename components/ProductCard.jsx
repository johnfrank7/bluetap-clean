import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';

const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;

export default function ProductCard({ product, onOrder, compact = false, selected = false }) {
  useBlueTapTheme();
  const imageUrl = product?.imageUrl || product?.image || '';
  const detail = [product?.containerType || product?.capacity, product?.size].filter(Boolean).join(' · ');
  return <View style={[styles.card, compact && styles.compactCard, selected && styles.selectedCard]}>
    <View style={[styles.imageSurface, { backgroundColor: BLUETAP_COLORS.surfaceAlt }, compact && styles.compactImageSurface]}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" /> : <View style={styles.placeholder}><Image source={require('../assets/icons/bluetaplogo.png')} style={styles.placeholderLogo} resizeMode="contain" /><Text style={[styles.placeholderText, { color: BLUETAP_COLORS.muted }]}>BlueTap product</Text></View>}
    </View>
    <View style={styles.content}>
      <Text numberOfLines={2} style={styles.name}>{product?.product_name || product?.name || 'Water product'}</Text>
      {!!detail && <Text numberOfLines={1} style={styles.detail}>{detail}</Text>}
      <Text style={styles.price}>{formatPrice(product?.price)}</Text>
      {!!onOrder && <TouchableOpacity accessibilityRole="button" onPress={() => onOrder(product)} style={styles.button}><Text style={styles.buttonText}>{selected ? 'Selected' : 'Order'}</Text></TouchableOpacity>}
    </View>
  </View>;
}

const styles = createPortalStyleSheet({
  card:{width:'100%',maxWidth:340,backgroundColor:BLUETAP_COLORS.surface,borderWidth:1,borderColor:BLUETAP_COLORS.border,borderRadius:BLUETAP_LAYOUT.radius.lg,overflow:'hidden',...BLUETAP_LAYOUT.shadow},compactCard:{maxWidth:280},selectedCard:{borderColor:BLUETAP_COLORS.primary,borderWidth:2},
  imageSurface:{height:158,backgroundColor:BLUETAP_COLORS.surfaceAlt,alignItems:'center',justifyContent:'center',padding:14},compactImageSurface:{height:128},image:{width:'100%',height:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},placeholderLogo:{width:62,height:62,opacity:.45},placeholderText:{color:BLUETAP_COLORS.muted,fontSize:11,fontWeight:'700',marginTop:5},
  content:{padding:14},name:{color:BLUETAP_COLORS.textPrimary,fontSize:16,lineHeight:20,fontWeight:'900'},detail:{color:BLUETAP_COLORS.textSecondary,fontSize:12,marginTop:4},price:{color:BLUETAP_COLORS.primary,fontSize:18,fontWeight:'900',marginTop:8},button:{minHeight:42,marginTop:12,borderRadius:10,backgroundColor:BLUETAP_COLORS.primary,alignItems:'center',justifyContent:'center'},buttonText:{color:'#FFF',fontSize:13,fontWeight:'900'},
});
