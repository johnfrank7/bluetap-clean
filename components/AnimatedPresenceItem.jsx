import React from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { useReducedMotionPreference } from './BlueTapThemeTransition';

export default function AnimatedPresenceItem({ children, delay = 0, phase = 'present', style }) {
  const reduceMotion = useReducedMotionPreference();
  const progress = React.useRef(new Animated.Value(phase === 'entering' ? 0 : 1)).current;

  React.useEffect(() => {
    const entering = phase !== 'exiting';
    const animation = Animated.timing(progress, {
      toValue: entering ? 1 : 0,
      delay: entering && phase === 'entering' && !reduceMotion ? Math.max(0, delay) : 0,
      duration: reduceMotion ? 140 : 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [delay, phase, progress, reduceMotion]);

  const transform = reduceMotion
    ? undefined
    : [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [phase === 'exiting' ? -6 : 8, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.985, 1],
          }),
        },
      ];

  return (
    <Animated.View pointerEvents={phase === 'exiting' ? 'none' : 'auto'} style={[style, { opacity: progress, transform }]}>
      {children}
    </Animated.View>
  );
}
