import React from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const TRANSITION_DURATION = 640;
const THEME_SWITCH_MIDPOINT = 300;
const RIPPLE_DURATION = 420;

const ThemeTransitionContext = React.createContext(null);

function eventOrigin(event) {
  const nativeEvent = event?.nativeEvent || event;
  const x = Number(nativeEvent?.pageX);
  const y = Number(nativeEvent?.pageY);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function useReducedMotionPreference() {
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => { if (mounted) setReduceMotion(Boolean(enabled)); })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    let media;
    const onMediaChange = (query) => setReduceMotion(Boolean(query.matches));
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (media) {
        onMediaChange(media);
        media.addEventListener?.('change', onMediaChange);
        media.addListener?.(onMediaChange);
      }
    }

    return () => {
      mounted = false;
      subscription?.remove?.();
      media?.removeEventListener?.('change', onMediaChange);
      media?.removeListener?.(onMediaChange);
    };
  }, []);

  return reduceMotion;
}

function ThemeTransitionOverlay({ transition, opacity, ripple, symbol }) {
  const { width, height } = useWindowDimensions();
  if (!transition) return null;

  const origin = transition.origin || { x: Math.max(24, width - 44), y: 44 };
  const radius = Math.hypot(
    Math.max(origin.x, width - origin.x),
    Math.max(origin.y, height - origin.y)
  );
  const diameter = Math.max(radius * 2, 1);
  const darkTarget = transition.nextTheme === 'dark';
  const rippleColor = darkTarget ? '#07131F' : '#EAF6FF';
  const ringColor = darkTarget ? 'rgba(112,189,242,0.34)' : 'rgba(24,123,205,0.26)';
  const badgeSurface = darkTarget ? '#0E2235' : '#FFFFFF';
  const badgeBorder = darkTarget ? '#3B9CE8' : '#9ACFEF';
  const iconColor = darkTarget ? '#70BDF2' : '#FFD67A';

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.overlay, Platform.OS === 'web' && styles.webOverlay, { opacity }]}
    >
      <Animated.View
        style={[
          styles.ripple,
          {
            backgroundColor: rippleColor,
            borderColor: ringColor,
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            left: origin.x - diameter / 2,
            top: origin.y - diameter / 2,
            transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.015, 1.04] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.centerMark,
          {
            backgroundColor: badgeSurface,
            borderColor: badgeBorder,
            opacity: symbol.interpolate({ inputRange: [0, 0.16, 0.82, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { scale: symbol.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0.72, 1, 1, 0.92] }) },
            ],
          },
        ]}
      >
        <View style={[styles.drop, { backgroundColor: darkTarget ? '#2186D9' : '#187BCD' }]} />
        <Text style={[styles.themeGlyph, { color: iconColor }]}>{darkTarget ? '☾' : '☀'}</Text>
        <View style={[styles.waterRing, { borderColor: ringColor }]} />
      </Animated.View>
    </Animated.View>
  );
}

export function BlueTapThemeTransitionProvider({ children }) {
  const reduceMotion = useReducedMotionPreference();
  const reducedMotionRef = React.useRef(reduceMotion);
  const activeRef = React.useRef(false);
  const timersRef = React.useRef([]);
  const [transition, setTransition] = React.useState(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const ripple = React.useRef(new Animated.Value(0)).current;
  const symbol = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => { reducedMotionRef.current = reduceMotion; }, [reduceMotion]);
  React.useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const startTransition = React.useCallback(({ applyTheme, event, nextTheme }) => {
    if (activeRef.current || typeof applyTheme !== 'function') return false;
    activeRef.current = true;

    if (reducedMotionRef.current) {
      applyTheme();
      activeRef.current = false;
      return true;
    }

    setTransition({ nextTheme, origin: eventOrigin(event) });
    opacity.setValue(1);
    ripple.setValue(0);
    symbol.setValue(0);

    const animationTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(ripple, {
          toValue: 1,
          duration: RIPPLE_DURATION,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(symbol, {
          toValue: 1,
          duration: TRANSITION_DURATION,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.sequence([
          Animated.delay(360),
          Animated.timing(opacity, {
            toValue: 0,
            duration: TRANSITION_DURATION - 360,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]),
      ]).start();
    }, 16);
    const midpointTimer = setTimeout(applyTheme, THEME_SWITCH_MIDPOINT);
    const completionTimer = setTimeout(() => {
      setTransition(null);
      activeRef.current = false;
    }, TRANSITION_DURATION);
    timersRef.current.push(animationTimer, midpointTimer, completionTimer);
    return true;
  }, [opacity, ripple, symbol]);

  const value = React.useMemo(
    () => ({ isTransitioning: Boolean(transition), reduceMotion, startTransition }),
    [reduceMotion, startTransition, transition]
  );

  return (
    <ThemeTransitionContext.Provider value={value}>
      <View style={styles.host}>
        {children}
        <ThemeTransitionOverlay transition={transition} opacity={opacity} ripple={ripple} symbol={symbol} />
      </View>
    </ThemeTransitionContext.Provider>
  );
}

export function useBlueTapThemeTransition() {
  const value = React.useContext(ThemeTransitionContext);
  return value || {
    isTransitioning: false,
    reduceMotion: false,
    startTransition: ({ applyTheme }) => {
      applyTheme?.();
      return true;
    },
  };
}

const styles = StyleSheet.create({
  host: { flex: 1, minWidth: 0 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
    overflow: 'hidden',
  },
  webOverlay: { position: 'fixed' },
  ripple: { position: 'absolute', borderWidth: 2 },
  centerMark: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 76,
    height: 76,
    marginLeft: -38,
    marginTop: -38,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#03111E',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 9,
  },
  drop: {
    width: 28,
    height: 28,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    transform: [{ rotate: '45deg' }],
  },
  themeGlyph: { position: 'absolute', right: 10, top: 8, fontSize: 17, fontWeight: '900' },
  waterRing: { position: 'absolute', width: 58, height: 58, borderRadius: 29, borderWidth: 1 },
});
