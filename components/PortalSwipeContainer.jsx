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

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (!enabled) return false;
        const { dx, dy } = gestureState;
        // Horizontal swipe must dominate vertical swipe
        return Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 2.2;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (!enabled || currentIndex === -1) return;
        const { dx, dy } = gestureState;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
          if (dx < 0 && currentIndex < tabs.length - 1) {
            // Swipe left -> next tab
            router.push(tabs[currentIndex + 1]);
          } else if (dx > 0 && currentIndex > 0) {
            // Swipe right -> previous tab
            router.push(tabs[currentIndex - 1]);
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
