import React from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BlueTapBrandMark from './BlueTapBrandMark';

const money = (value) => `₱${(value / 100).toFixed(2)}`;
const bestTier = (offer) => offer.tiers.reduce((best, tier) => tier.savingsCentavos > best.savingsCentavos ? tier : best, offer.tiers[0]);

export function PromotionBanner({ offer, colors, onOpen, onOrder, hasActiveOrder, restricted, checkoutEnabled }) {
  const tier = bestTier(offer);
  return (
    <View style={{ borderWidth: 1, borderColor: colors.primaryAction, borderRadius: 18, overflow: 'hidden', marginTop: 12, elevation: 3, shadowColor: '#002d58', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
      <LinearGradient colors={['#073461', '#0968aa', '#1588c8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 96, overflow: 'hidden', position: 'relative' }}>
        <Image
          source={require('../assets/images/requester-promotion-water.png')}
          resizeMode="cover"
          accessible={false}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '60%',
            maxWidth: 280,
            height: '100%',
            opacity: 0.55,
          }}
        />
        <LinearGradient
          colors={[
            '#073461',
            'rgba(7, 52, 97, 0.95)',
            'rgba(8, 86, 144, 0.65)',
            'rgba(9, 104, 170, 0.25)',
            'transparent',
          ]}
          locations={[0, 0.38, 0.62, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={checkoutEnabled ? 'View bundle offer' : 'View bundle preview'} onPress={onOpen} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <BlueTapBrandMark size={19} color={colors.onPrimary} />
              <Text style={{ color: '#d8f3ff', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 }}>BLUETAP BUNDLE</Text>
            </View>
            <Text style={{ color: colors.onPrimary, fontWeight: '900', fontSize: 15, lineHeight: 19 }}>BUY MORE, SAVE MORE!</Text>
            <Text numberOfLines={2} style={{ color: '#e5f5ff', fontSize: 12, lineHeight: 16, marginTop: 3 }}>
              {offer.productName} · {tier.quantity} for {money(tier.priceCentavos)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View bundle offer"
            onPress={onOpen}
            style={({ hovered, focused }) => ({
              minHeight: 44,
              minWidth: 84,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 12,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.75)',
              backgroundColor: hovered || focused ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.17)',
            })}
          >
            <Text style={{ color: colors.onPrimary, fontWeight: '900', fontSize: 12 }}>View Offer</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </View>
  );
}

export function PromotionPopup({ offer, colors, onClose, onOrder, hasActiveOrder, restricted, checkoutEnabled }) {
  const closeRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const { height } = useWindowDimensions();
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const previous = document.activeElement;
    const timer = setTimeout(() => closeRef.current?.focus?.(), 0);
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(cardRef.current?.querySelectorAll?.('button:not([disabled]), [role="button"]:not([aria-disabled="true"])') || [])];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus?.(); };
  }, [onClose]);
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={[{ flex: 1, backgroundColor: 'rgba(4, 15, 28, 0.68)', justifyContent: 'center', alignItems: 'center', padding: 12 }, Platform.OS === 'web' ? { backdropFilter: 'blur(4px)' } : null]}>
        <View ref={cardRef} accessibilityViewIsModal accessibilityRole="alert" accessibilityLabel={checkoutEnabled ? 'Bundle promotion offer' : 'Bundle promotion preview'} style={{ width: '100%', maxWidth: 430, maxHeight: Math.max(280, height - 24), borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden', elevation: 16, shadowColor: '#00172e', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }}>
          <LinearGradient colors={['#073461', '#0874b6', '#1a98cb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 140, width: '100%', overflow: 'hidden', position: 'relative' }}>
            <Image
              source={require('../assets/images/requester-promotion-water.png')}
              resizeMode="cover"
              accessible={false}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: '60%',
                maxWidth: 260,
                height: '100%',
                opacity: 0.60,
              }}
            />
            <LinearGradient
              colors={[
                '#073461',
                'rgba(4, 58, 106, 0.96)',
                'rgba(7, 88, 148, 0.65)',
                'rgba(16, 128, 192, 0.25)',
                'transparent',
              ]}
              locations={[0, 0.38, 0.62, 0.85, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={{ flex: 1, paddingHorizontal: 18, paddingVertical: 16, flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 }}>
                  <BlueTapBrandMark size={18} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>BLUETAP REFILLS</Text>
                </View>
                <Text accessibilityRole="header" style={{ color: '#fff', fontWeight: '900', fontSize: 20, lineHeight: 24, marginTop: 10, maxWidth: 210 }}>BUY MORE, SAVE MORE!</Text>
                <Text style={{ color: '#e3f6ff', fontSize: 12, fontWeight: '700', marginTop: 5 }}>More refills. More savings.</Text>
              </View>
              <Pressable ref={closeRef} accessibilityRole="button" accessibilityLabel={checkoutEnabled ? 'Close promotion offer' : 'Close promotion preview'} onPress={onClose} style={({ hovered, focused }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', backgroundColor: hovered || focused ? 'rgba(0,28,55,0.72)' : 'rgba(0,28,55,0.4)' })}>
                <Text style={{ color: '#fff', fontSize: 22, lineHeight: 26 }}>×</Text>
              </Pressable>
            </View>
          </LinearGradient>
          <ScrollView style={{ maxHeight: Math.max(80, height - 280) }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 15, paddingBottom: 12, gap: 10 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700', lineHeight: 17 }}>{offer.container} · {offer.branchName}</Text>
            {offer.tiers.map((tier) => (
              <View key={tier.quantity} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '900', fontSize: 14, lineHeight: 19 }}>{tier.quantity} × {offer.productName}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 5 }}>Regular <Text style={{ textDecorationLine: 'line-through' }}>{money(tier.regularCentavos)}</Text></Text>
                </View>
                <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <Text style={{ color: colors.iconPrimary, fontSize: 20, lineHeight: 24, fontWeight: '900' }}>{money(tier.priceCentavos)}</Text>
                  <View style={{ backgroundColor: colors.successSoft, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4 }}>
                    <Text style={{ color: colors.iconSuccess || colors.success, fontWeight: '900', fontSize: 10 }}>Save {money(tier.savingsCentavos)}</Text>
                  </View>
                </View>
              </View>
            ))}
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 1 }}>{checkoutEnabled ? 'Subject to availability; confirm the current price at review.' : 'Preview only — promotional discounts are not applied at checkout.'}</Text>
            {restricted ? <Text style={{ color: colors.danger, fontSize: 12 }}>Ordering is currently restricted for this provider.</Text> : null}
          </ScrollView>
          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, flexDirection: 'row', gap: 10 }}>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ hovered, focused }) => ({ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: focused ? colors.primaryAction : colors.border, borderRadius: 10, backgroundColor: hovered ? colors.surfaceAlt : colors.surface })}>
              <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Maybe Later</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(restricted && !hasActiveOrder) }} disabled={Boolean(restricted && !hasActiveOrder)} onPress={onOrder} style={({ hovered, focused }) => ({ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: focused ? 2 : 0, borderColor: colors.textPrimary, backgroundColor: colors.primaryAction, opacity: restricted && !hasActiveOrder ? 0.5 : hovered ? 0.85 : 1 })}>
              <Text style={{ color: colors.onPrimary, fontWeight: '900' }}>{hasActiveOrder ? 'View Order' : 'Order Now'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PromotionTierNote({ offer, quantity, colors, checkoutEnabled }) {
  const tier = offer.tiers.find((entry) => entry.quantity === quantity);
  return <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.primarySoft, borderRadius: 9, padding: 8, marginTop: 6 }}><Text style={{ color: colors.textPrimary, fontWeight: '800', fontSize: 12 }}>{checkoutEnabled ? 'Bundle offer' : 'Bundle preview'} · {offer.container}</Text><Text style={{ color: colors.textSecondary, fontSize: 11 }}>{offer.tiers.map((entry) => `${entry.quantity} for ${money(entry.priceCentavos)}`).join(' · ')}</Text>{tier ? <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 11 }}>{checkoutEnabled ? 'Bundle savings' : 'Preview savings'}: {money(tier.savingsCentavos)} for {tier.quantity}</Text> : null}<Text style={{ color: colors.textSecondary, fontSize: 10 }}>{checkoutEnabled ? 'Subject to availability; confirm at review.' : 'Preview only; regular checkout prices apply.'}</Text></View>;
}
