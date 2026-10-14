import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { createPortalStyleSheet, useBlueTapTheme } from './BlueTapTheme';

const formatPrice = (price) => `₱${Number(price || 0).toFixed(2)}`;

export default function ProductCard({ product, onOrder, compact = false, compactSelection = false, selected = false, style }) {
  const { colors, isDark } = useBlueTapTheme();
  const imageUrl = product?.imageUrl || product?.image || '';
  const description = typeof product?.description === 'string' ? product.description.trim() : '';
  const detail = [product?.containerType || product?.capacity, product?.size].filter(Boolean).join(' · ');

  const cardBg = isDark ? colors.surfaceAlt : colors.surface;
  const cardBorder = selected ? colors.primary : (isDark ? '#234E72' : colors.border);
  const imageBg = isDark ? colors.surface : colors.surfaceAlt;
  const nameColor = colors.textPrimary;
  const descColor = isDark ? '#CBD5E1' : colors.textSecondary;
  const detailColor = isDark ? (colors.primaryLight || '#70BDF2') : colors.textSecondary;
  const priceColor = isDark ? (colors.primaryLight || '#70BDF2') : colors.primary;
  const policyColor = isDark ? '#9FB4C8' : colors.textSecondary;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: cardBg, borderColor: cardBorder },
        compact && styles.compactCard,
        compactSelection && styles.compactSelectionCard,
        selected && styles.selectedCard,
        style,
      ]}
    >
      <View style={[styles.imageSurface, { backgroundColor: imageBg }, compact && styles.compactImageSurface, compactSelection && styles.compactSelectionImageSurface]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={styles.placeholder}>
            <Image
              source={require('../assets/icons/bluetaplogo.png')}
              style={[styles.placeholderLogo, isDark && { opacity: 0.6 }]}
              resizeMode="contain"
            />
            <Text style={[styles.placeholderText, { color: isDark ? '#9FB4C8' : colors.muted }]}>
              BlueTap product
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.content, compactSelection && styles.compactSelectionContent]}>
        <View style={styles.headerBlock}>
          <Text numberOfLines={2} style={[styles.name, compactSelection && styles.compactSelectionName, { color: nameColor }]}>
            {product?.product_name || product?.name || 'Water product'}
          </Text>

          {!!description && (
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.description, compactSelection && styles.compactSelectionDescription, { color: descColor }]}>
              {description}
            </Text>
          )}

          {!!detail && (
            <Text numberOfLines={1} style={[styles.detail, compactSelection && styles.compactSelectionDetail, { color: detailColor }]}>
              {detail}
            </Text>
          )}
        </View>

        <View style={[styles.metaBlock, compactSelection && styles.compactSelectionMetaBlock]}>
          <Text style={[styles.price, compactSelection && styles.compactSelectionPrice, { color: priceColor }]}>
            {formatPrice(product?.price)}
          </Text>

          <Text numberOfLines={1} style={[styles.policyNote, compactSelection && styles.compactSelectionPolicyNote, { color: policyColor }]}>
            {product?.deliveryDays?.length
              ? `Delivery days: ${product.deliveryDays.map((day) => day.slice(0, 3).replace(/^./, (letter) => letter.toUpperCase())).join(', ')}`
              : 'Delivery: Available daily'}
          </Text>

          {product?.maxQuantityPerRequester != null && (
            <Text numberOfLines={1} style={[styles.policyNote, compactSelection && styles.compactSelectionPolicyNote, { color: policyColor }]}>
              Order limit: {product.maxQuantityPerRequester}
            </Text>
          )}
        </View>

        {!!onOrder && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${selected ? 'Selected' : 'Order'} ${product?.product_name || product?.name || 'product'}`}
            onPress={() => onOrder(product)}
            style={({ hovered, pressed }) => [
              styles.button,
              {
                backgroundColor: selected
                  ? (isDark ? '#0284C7' : '#0369A1')
                  : (hovered ? (colors.primaryDark || '#0A62A7') : (isDark ? '#1D78C1' : colors.primary)),
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
  card:{width:'100%',maxWidth:320,minHeight:356,height:356,borderWidth:1,borderRadius:USER_PORTAL_LAYOUT.cardRadius,overflow:'hidden',...BLUETAP_LAYOUT.shadow},compactCard:{maxWidth:304,minHeight:344},compactSelectionCard:{minHeight:312,height:312},selectedCard:{borderWidth:2},
  imageSurface:{height:142,width:'100%',alignItems:'center',justifyContent:'center',padding:8,overflow:'hidden'},compactImageSurface:{height:112,width:'100%',padding:6},compactSelectionImageSurface:{height:92,width:'100%',padding:6},image:{width:'100%',height:'100%',maxWidth:'100%',maxHeight:'100%'},placeholder:{alignItems:'center',justifyContent:'center'},placeholderLogo:{width:44,height:44,opacity:.45},placeholderText:{fontSize:11,fontWeight:'700',marginTop:4},
  content:{flex:1,paddingHorizontal:16,paddingTop:12,paddingBottom:16,minWidth:0,justifyContent:'space-between'},compactSelectionContent:{paddingHorizontal:14,paddingTop:10,paddingBottom:12},headerBlock:{minWidth:0},name:{minHeight:38,fontSize:18,lineHeight:22,fontWeight:'800'},compactSelectionName:{minHeight:36,fontSize:16,lineHeight:20},description:{fontSize:13,lineHeight:17,marginTop:3},compactSelectionDescription:{fontSize:12,lineHeight:15,marginTop:2},detail:{minHeight:17,fontSize:13,lineHeight:17,marginTop:3,fontWeight:'600'},compactSelectionDetail:{minHeight:15,fontSize:12,lineHeight:15,marginTop:2},metaBlock:{marginTop:10,marginBottom:8,minWidth:0},compactSelectionMetaBlock:{marginTop:6,marginBottom:4},price:{fontSize:22,lineHeight:26,fontWeight:'900'},compactSelectionPrice:{fontSize:20,lineHeight:24},policyNote:{fontSize:12,lineHeight:16,marginTop:2},compactSelectionPolicyNote:{fontSize:11,lineHeight:14,marginTop:2},button:{minHeight:44,marginTop:'auto',borderRadius:12,alignItems:'center',justifyContent:'center',paddingVertical:11,paddingHorizontal:16},buttonText:{color:'#FFFFFF',fontSize:14,fontWeight:'800',letterSpacing:0.3},
  buttonHovered:{transform:[{translateY:-1},{scale:1.01}]},buttonPressed:{opacity:.84,transform:[{scale:.98}]},
});
