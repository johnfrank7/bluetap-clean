import React from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { useReducedMotionPreference } from './BlueTapThemeTransition';
const { createSingleFlightLock } = require('../services/navigationLock');

export const NOTIFICATION_EXIT_DURATION_MS = 160;
export const NOTIFICATION_LIST_MOTION_DURATION_MS = 360;

export default function useNotificationPageMotion(onBack) {
  const reduceMotion = useReducedMotionPreference();
  const progress = React.useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const exitLockRef = React.useRef(null);
  if (!exitLockRef.current) exitLockRef.current = createSingleFlightLock({ lockMs: 500 });
  const onBackRef = React.useRef(onBack);
  onBackRef.current = onBack;

  React.useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  React.useEffect(() => () => exitLockRef.current?.dispose(), []);

  const goBack = React.useCallback(() => {
    if (!exitLockRef.current.acquire('notification-back')) return;
    if (reduceMotion) {
      onBackRef.current?.();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: NOTIFICATION_EXIT_DURATION_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) onBackRef.current?.();
      else exitLockRef.current.release();
    });
  }, [progress, reduceMotion]);

  return {
    goBack,
    style: {
      opacity: progress,
      transform: reduceMotion ? undefined : [{
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }),
      }],
    },
  };
}
