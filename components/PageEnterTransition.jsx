import React from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { useReducedMotionPreference } from './BlueTapThemeTransition';

export default function PageEnterTransition({
  axis = 'x',
  children,
  delay = 0,
  direction = 1,
  distance = 10,
  duration = 220,
  fill = true,
  resetKey,
  scaleFrom = 1,
  style,
}) {
  const reduceMotion = useReducedMotionPreference();
  const progress = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  React.useEffect(() => {
    progress.setValue(reduceMotion ? 1 : 0);
    Animated.timing(progress, {
      toValue: 1,
      delay: reduceMotion ? 0 : delay,
      duration: reduceMotion ? 0 : duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    return () => progress.stopAnimation();
  }, [delay, direction, distance, duration, progress, reduceMotion, resetKey, scaleFrom]);

  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.sign(direction || 1) * distance, 0],
  });
  const transforms = axis === 'y'
    ? [{ translateY: offset }]
    : [{ translateX: offset }];
  if (scaleFrom !== 1) {
    transforms.push({
      scale: progress.interpolate({ inputRange: [0, 1], outputRange: [scaleFrom, 1] }),
    });
  }

  return (
    <Animated.View
      style={[
        styles.base,
        fill && styles.fill,
        style,
        {
          opacity: progress,
          transform: reduceMotion ? undefined : transforms,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: 0 },
  fill: { flex: 1 },
});
