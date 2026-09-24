import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';

const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;

export default function ProductCard({ product, onOrder, compact = false, selected = false }) {
  const { colors, isDark } = useBlueTapTheme();
  const [hovered, setHovered] = React.useState(false);
  const imageUrl = product?.imageUrl || product?.image || '';
  const detail = [product?.containerType || product?.capacity, product?.size].filter(Boolean).join(' · ');
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }, compact && styles.compactCard, selected && styles.selectedCard]}>
      <View style={[styles.imageSurface, { backgroundColor: colors.surfaceAlt }, compact && styles.compactImageSurface]}>
        {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" /> : <View style={styles.placeholder}><Image source={require('../assets/icons/bluetaplogo.png')} style={styles.placeholderLogo} resizeMode="contain" /><Text style={[styles.placeholderText, { color: colors.muted }]}>BlueTap product</Text></View>}
      </View>
      <View style={styles.content}>
        <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{product?.product_name || product?.name || 'Water product'}</Text>
        {!!detail && <Text numberOfLines={1} style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text>}
        <Text style={[styles.price, { color: colors.primary }]}>{formatPrice(product?.price)}</Text>
        {!!onOrder && (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.8}
            onPress={() => onOrder(product)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={[
              styles.button,
              {
                backgroundColor: selected ? (isDark ? '#0284C7' : '#0369A1') : (hovered ? (colors.primaryDark || '#0A62A7') : colors.primary),
              }
            ]}
          >
            <Text style={styles.buttonText}>{selected ? 'Selected' : 'Order'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = createPortalStyleSheet({
  card:{width:'100%',maxWidth:340,borderWidth:1,borderRadius:BLUETAP_LAYOUT.radius.lg,overflow:'hidden',...BLUETAP_LAYOUT.shadow},compactCard:{maxWidth:280},selectedCard:{borderWidth:2},
  imageSurface:{height:158,alignItems:'center',justifyContent:'center',padding:14},compactImageSurface:{height:128},image:{width:'100%',height:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},placeholderLogo:{width:62,height:62,opacity:.45},placeholderText:{fontSize:11,fontWeight:'700',marginTop:5},
  content:{padding:14},name:{fontSize:16,lineHeight:20,fontWeight:'900'},detail:{fontSize:12,marginTop:4},price:{fontSize:18,fontWeight:'900',marginTop:8},button:{minHeight:42,marginTop:12,borderRadius:10,alignItems:'center',justifyContent:'center'},buttonText:{color:'#FFFFFF',fontSize:13,fontWeight:'900'},
});
