import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';

const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;

export default function ProductCard({ product, onOrder, compact = false, selected = false }) {
  const { colors, isDark } = useBlueTapTheme();
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
        <Text style={[styles.policyNote, { color: colors.textSecondary }]}>{product?.deliveryDays?.length ? `Delivery days: ${product.deliveryDays.map((day) => day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())).join(', ')}` : 'Delivery: Available daily'}</Text>
        {product?.maxQuantityPerRequester != null && <Text style={[styles.policyNote, { color: colors.textSecondary }]}>Order limit: {product.maxQuantityPerRequester}</Text>}
        {!!onOrder && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onOrder(product)}
            style={({ hovered, pressed }) => [
              styles.button,
              {
                backgroundColor: selected ? (isDark ? '#0284C7' : '#0369A1') : (hovered ? (colors.primaryDark || '#0A62A7') : colors.primary),
              },
              hovered && styles.buttonHovered,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>{selected ? 'Selected' : 'Order'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = createPortalStyleSheet({
  card:{width:'100%',maxWidth:320,minHeight:356,borderWidth:1,borderRadius:USER_PORTAL_LAYOUT.cardRadius,overflow:'hidden',...BLUETAP_LAYOUT.shadow},compactCard:{maxWidth:304,minHeight:344},selectedCard:{borderWidth:2},
  imageSurface:{height:142,alignItems:'center',justifyContent:'center',padding:12},compactImageSurface:{height:124},image:{width:'100%',height:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},placeholderLogo:{width:56,height:56,opacity:.45},placeholderText:{fontSize:11,fontWeight:'700',marginTop:5},
  content:{flex:1,padding:14},name:{minHeight:38,fontSize:16,lineHeight:19,fontWeight:'900'},detail:{minHeight:16,fontSize:12,marginTop:3},price:{fontSize:18,fontWeight:'900',marginTop:7},policyNote:{fontSize:11,lineHeight:15,marginTop:3},button:{minHeight:44,marginTop:'auto',borderRadius:10,alignItems:'center',justifyContent:'center'},buttonText:{color:'#FFFFFF',fontSize:13,fontWeight:'900'},
  buttonHovered:{transform:[{translateY:-1},{scale:1.01}]},buttonPressed:{opacity:.84,transform:[{scale:.98}]},
});
