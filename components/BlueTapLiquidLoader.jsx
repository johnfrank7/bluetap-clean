import React from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useBlueTapTheme } from './BlueTapTheme';
import { useAdminTheme } from './AdminTheme';
import { startLiquidFormation } from './blueTapLiquidMotion';

const OFFICIAL_MARK = require('../assets/icons/bluetapwhitelogo.png');
const SIZE = 128; // The official PNG's transparent margins leave a ~103px tall mark.
// Temporary vector liquid only. The completed symbol always uses the original asset.
const DROP = require('../assets/animations/liquid-drop.svg');
const LEFT_FLOW = require('../assets/animations/liquid-left.svg');
const RIGHT_FLOW = require('../assets/animations/liquid-right.svg');
const TRAIL = require('../assets/animations/liquid-trail.svg');
const TINY_DROP = require('../assets/animations/liquid-small-drop.svg');

function initialMotionPreference() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
  }
  return null;
}

function useLoaderReducedMotion() {
  // Native preference is asynchronous. Do not start moving before it is known.
  const [reduced, setReduced] = React.useState(initialMotionPreference);
  React.useEffect(() => {
    let active = true;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const update = () => setReduced(media?.matches ?? true);
      update();
      if (media?.addEventListener) media.addEventListener('change', update);
      else media?.addListener?.(update);
      return () => {
        if (media?.removeEventListener) media.removeEventListener('change', update);
        else media?.removeListener?.(update);
      };
    }
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      if (active) setReduced(Boolean(value));
    });
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(Boolean(value));
    }).catch(() => { if (active) setReduced(true); });
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

const curve = (progress, inputRange, outputRange) => progress.interpolate({
  inputRange, outputRange, extrapolate: 'clamp',
});

function LiquidShape({ source, progress, opacity, x, y, scaleX, scaleY, rotation }) {
  return (
    <Animated.View style={[styles.layer, {
      opacity: curve(progress, ...opacity),
      transform: [
        { translateX: curve(progress, ...x) },
        { translateY: curve(progress, ...y) },
        { rotate: curve(progress, ...rotation) },
        { scaleX: curve(progress, ...scaleX) },
        { scaleY: curve(progress, ...scaleY) },
      ],
    }]}>
      <Image source={source} style={styles.layer} contentFit="contain" transition={0} />
    </Animated.View>
  );
}

function LogoReveal({ progress, rect, begin, end }) {
  const [left, top, width, height] = rect;
  const offset = curve(progress, [begin, (begin + end) / 2, end], [height, height * 0.22, 0]);
  // Counter-translation reveals the original pixels without stretching the logo.
  return (
    <View style={{ position: 'absolute', left, top, width, height, overflow: 'hidden' }}>
      <Animated.View style={{ width, height, overflow: 'hidden', transform: [{ translateY: offset }] }}>
        <Animated.View style={{ width, height, transform: [{ translateY: Animated.multiply(offset, -1) }] }}>
          <Image source={OFFICIAL_MARK} transition={0} contentFit="contain"
            style={{ position: 'absolute', left: -left, top: -top, width: SIZE, height: SIZE }} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Full-screen in-app loading presentation; its parent owns readiness and errors. */
export default function BlueTapLiquidLoader({ role }) {
  const portal = useBlueTapTheme();
  const privileged = useAdminTheme();
  const managerTheme = role === 'manager' || role === 'admin';
  const colors = managerTheme ? privileged.colors : portal.colors;
  const dark = managerTheme ? privileged.resolvedTheme === 'dark' : portal.isDark;
  const themeReady = managerTheme ? privileged.ready : portal.ready;
  const reduced = useLoaderReducedMotion();
  const progress = React.useRef(new Animated.Value(0)).current;
  const breathing = React.useRef(new Animated.Value(1)).current;
  const started = React.useRef(false);
  const [refined, setRefined] = React.useState(false);

  React.useEffect(() => {
    if (reduced === null || !themeReady) return undefined;
    if (reduced || started.current) {
      setRefined(true);
      breathing.setValue(1);
      return undefined;
    }
    started.current = true;
    return startLiquidFormation(progress, breathing, () => setRefined(true));
  }, [breathing, progress, reduced, themeReady]);

  const finalLogo = reduced || refined;
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading BlueTap"
      accessibilityState={{ busy: true }} style={[styles.screen, { backgroundColor: dark ? colors.background : colors.primary }]}>
      <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.canvas, { transform: [{ scale: reduced ? 1 : breathing }] }]}>
        {finalLogo ? <Image source={OFFICIAL_MARK} style={styles.layer} contentFit="contain" transition={0} /> : reduced !== null && themeReady ? (
          <>
            <LogoReveal progress={progress} rect={[38, 38, 52, 90]} begin={350} end={1100} />
            <LogoReveal progress={progress} rect={[0, 38, 38, 90]} begin={550} end={1500} />
            <LogoReveal progress={progress} rect={[90, 38, 38, 90]} begin={600} end={1500} />
            <LogoReveal progress={progress} rect={[0, 0, 128, 38]} begin={800} end={1500} />
            <LiquidShape source={DROP} progress={progress}
              opacity={[[0, 100, 550, 1000], [0, 1, 1, 0]]}
              x={[[0, 350, 700], [0, -13, 0]]} y={[[0, 350, 850], [16, 9, 0]]}
              scaleX={[[0, 350, 850], [0.3, 1.6, 0.9]]} scaleY={[[0, 350, 850], [0.3, 0.8, 1.5]]}
              rotation={[[0, 350, 850], ['-25deg', '-40deg', '0deg']]} />
            <LiquidShape source={LEFT_FLOW} progress={progress}
              opacity={[[100, 350, 1000, 1650], [0, 0.95, 0.85, 0]]}
              x={[[100, 700, 1500], [10, -4, 0]]} y={[[100, 700, 1500], [-4, 3, 0]]}
              scaleX={[[100, 700, 1500], [0.3, 1.08, 1]]} scaleY={[[100, 700, 1500], [0.4, 1.04, 1]]}
              rotation={[[100, 700, 1500], ['-55deg', '-8deg', '0deg']]} />
            <LiquidShape source={RIGHT_FLOW} progress={progress}
              opacity={[[250, 550, 1100, 1750], [0, 0.9, 0.85, 0]]}
              x={[[250, 800, 1500], [-8, 4, 0]]} y={[[250, 800, 1500], [8, 2, 0]]}
              scaleX={[[250, 800, 1500], [0.35, 1.05, 1]]} scaleY={[[250, 800, 1500], [0.4, 1.08, 1]]}
              rotation={[[250, 800, 1500], ['45deg', '8deg', '0deg']]} />
            <LiquidShape source={TRAIL} progress={progress}
              opacity={[[250, 650, 1100, 1700], [0, 0.7, 0.4, 0]]}
              x={[[250, 1100, 1700], [-4, 0, 0]]} y={[[250, 1100, 1700], [14, 0, 2]]}
              scaleX={[[250, 1100, 1700], [0.65, 1, 0.8]]} scaleY={[[250, 1100, 1700], [0.7, 1, 0.7]]}
              rotation={[[250, 1100, 1700], ['-25deg', '0deg', '12deg']]} />
            {[-1, 1].map((side) => (
              <LiquidShape key={side} source={TINY_DROP} progress={progress}
                opacity={[[150, 400, 900, 1350], [0, 0.8, 0.6, 0]]}
                x={[[150, 550, 1350], [side * 26, side * 45, side * 25]]}
                y={[[150, 550, 1350], [12, side * 21, 10]]}
                scaleX={[[150, 550, 1350], [0.2, 0.5, 0.1]]} scaleY={[[150, 550, 1350], [0.2, 0.7, 0.1]]}
                rotation={[[150, 1350], [`${side * 25}deg`, '0deg']]} />
            ))}
          </>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 160 },
  canvas: { width: SIZE, height: SIZE },
  layer: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE },
});
