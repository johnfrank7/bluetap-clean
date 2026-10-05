import React from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import BlueTapBrandMark from './BlueTapBrandMark';
import { useReducedMotionPreference } from './BlueTapThemeTransition';

export const ADMIN_ENTRY_DURATION_MS = 780;
export const ADMIN_ENTRY_REDUCED_DURATION_MS = 160;

export default function AdminEntryTransition({ onComplete, visible }) {
  const reduceMotion = useReducedMotionPreference();
  const dim = React.useRef(new Animated.Value(0)).current;
  const layer = React.useRef(new Animated.Value(0)).current;
  const ripple = React.useRef(new Animated.Value(0)).current;
  const identity = React.useRef(new Animated.Value(0)).current;
  const completedRef = React.useRef(false);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  React.useEffect(() => {
    if (!visible || completedRef.current) return undefined;
    const native = Platform.OS !== 'web';
    const duration = reduceMotion ? ADMIN_ENTRY_REDUCED_DURATION_MS : ADMIN_ENTRY_DURATION_MS;
    const finishTimer = setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      onCompleteRef.current?.();
    }, duration);

    const animation = reduceMotion
      ? Animated.parallel([
          Animated.timing(dim, { toValue: 1, duration, useNativeDriver: native }),
          Animated.timing(layer, { toValue: 1, duration, useNativeDriver: native }),
          Animated.timing(identity, { toValue: 1, duration, useNativeDriver: native }),
        ])
      : Animated.parallel([
          Animated.timing(dim, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: native }),
          Animated.timing(layer, { toValue: 1, duration: 360, delay: 90, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
          Animated.timing(ripple, { toValue: 1, duration: 430, delay: 100, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
          Animated.timing(identity, { toValue: 1, duration: 300, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
        ]);

    animation.start();
    return () => {
      clearTimeout(finishTimer);
      animation.stop();
    };
  }, [dim, identity, layer, reduceMotion, ripple, visible]);

  if (!visible) return null;

  return (
    <View accessibilityViewIsModal pointerEvents="auto" style={styles.overlay}>
      <Animated.View style={[styles.dim, { opacity: dim }]} />
      <Animated.View style={[styles.navyLayer, { opacity: layer }]} />
      {!reduceMotion && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              opacity: ripple.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 0.34, 0] }),
              transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.15, 7] }) }],
            },
          ]}
        />
      )}
      <Animated.View
        style={[
          styles.identity,
          {
            opacity: identity,
            transform: reduceMotion
              ? undefined
              : [
                  { translateY: identity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
                  { scale: identity.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                ],
          },
        ]}
      >
        <BlueTapBrandMark inverse color="#E8F7FF" size={70} />
        <Text style={styles.title}>Administrative Access</Text>
        <Text style={styles.subtitle}>Opening the secure BlueTap portal</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#031422' },
  navyLayer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#062846' },
  ripple: { position: 'absolute', width: 180, height: 180, borderRadius: 999, borderWidth: 2, borderColor: '#38BDF8', backgroundColor: 'rgba(24,123,205,0.18)' },
  identity: { alignItems: 'center', paddingHorizontal: 24 },
  title: { color: '#F5FBFF', fontSize: 19, fontWeight: '900', letterSpacing: 0.4, marginTop: 18, textAlign: 'center' },
  subtitle: { color: '#9DDCFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 6, textAlign: 'center' },
});
