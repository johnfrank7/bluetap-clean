import React, { useMemo, useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export const REQUESTER_TABS = [
  '/requester/r_dashboard',
  '/requester/r_request',
  '/requester/r_profile',
];

export const DISTRIBUTOR_TABS = [
  '/distributor/d_dashboard',
  '/distributor/d_requests',
  '/distributor/d_scheduled_requests',
  '/distributor/d_history',
  '/distributor/d_profile',
];

const isIgnoredTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    target.closest('[data-portal-swipe-ignore="true"]') ||
    target.closest('[data-portal-swipe-ignore]')
  );
};

export function PortalSwipeIgnore({ children, style, ...rest }) {
  return (
    <View
      dataSet={{ portalSwipeIgnore: 'true' }}
      style={style}
      {...rest}
    >
      {children}
    </View>
  );
}

export default function PortalSwipeContainer({
  children,
  tabs = [],
  currentRoute = '',
  enabled = true,
  style,
}) {
  const router = useRouter();

  const currentIndex = useMemo(() => {
    return tabs.findIndex((tab) => currentRoute.startsWith(tab) || tab === currentRoute);
  }, [tabs, currentRoute]);

  const isNavigatingRef = useRef(false);

  React.useEffect(() => {
    isNavigatingRef.current = false;
  }, [currentRoute, currentIndex]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (!enabled) return false;
        const target = evt?.nativeEvent?.target;
        if (target && isIgnoredTarget(target)) return false;
        const { dx, dy } = gestureState;
        // Horizontal swipe must dominate vertical swipe to prevent conflict with scrolling
        return Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.8;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (!enabled || currentIndex === -1 || isNavigatingRef.current) return;
        const target = evt?.nativeEvent?.target;
        if (target && isIgnoredTarget(target)) return;
        const { dx, dy } = gestureState;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0 && currentIndex < tabs.length - 1) {
            // Swipe left -> advance to next tab
            isNavigatingRef.current = true;
            router.replace(tabs[currentIndex + 1]);
          } else if (dx > 0 && currentIndex > 0) {
            // Swipe right -> return to previous tab
            isNavigatingRef.current = true;
            router.replace(tabs[currentIndex - 1]);
          }
        }
      },
      onPanResponderTerminationRequest: () => true,
    })
  ).current;

  return (
    <View style={[styles.container, style]} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
