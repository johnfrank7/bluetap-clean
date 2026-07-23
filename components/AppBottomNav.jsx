import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { createShadow } from './shadowStyles';

const BLUE = '#187BCD';
const ICON_SIZE = 26;
const ACTIVE_SCALE = 1.1;
const INDICATOR_WIDTH = 28;
const NAV_BUTTON_WIDTH = 36;
const NAV_HORIZONTAL_PADDING = 28;
const ANIMATION_DURATION = 250;

const requesterItems = [
  {
    key: 'home',
    label: 'Home',
    route: '/requester/r_dashboard',
    matches: ['/requester/r_dashboard'],
    segments: ['r_dashboard'],
    icon: require('../assets/icons/home.png'),
    activeIcon: require('../assets/icons/home1.png'),
  },
  {
    key: 'add',
    label: 'Add Request',
    route: '/requester/r_request',
    matches: ['/requester/r_request', '/requester/requestform'],
    segments: ['r_request', 'requestform'],
    icon: require('../assets/icons/square-plus (1).png'),
    activeIcon: require('../assets/icons/square-plus.png'),
  },
  {
    key: 'profile',
    label: 'Profile',
    route: '/requester/r_profile',
    matches: ['/requester/r_profile'],
    segments: ['r_profile'],
    icon: require('../assets/icons/user (2).png'),
    activeIcon: require('../assets/icons/user.png'),
  },
];

const distributorItems = [
  {
    key: 'home',
    label: 'Home',
    route: '/distributor/d_dashboard',
    matches: ['/distributor/d_dashboard'],
    segments: ['d_dashboard'],
    icon: require('../assets/icons/home.png'),
    activeIcon: require('../assets/icons/home1.png'),
  },
  {
    key: 'requests',
    label: 'Requests',
    route: '/distributor/d_requests',
    matches: ['/distributor/d_requests'],
    segments: ['d_requests'],
    icon: require('../assets/icons/ballot (1).png'),
    activeIcon: require('../assets/icons/ballot.png'),
  },
  {
    key: 'schedule',
    label: 'Schedule',
    route: '/distributor/d_scheduled_requests',
    matches: ['/distributor/d_scheduled_requests', '/distributor/d_history'],
    segments: ['d_scheduled_requests', 'd_history'],
    icon: require('../assets/icons/calendar-clock (2).png'),
    activeIcon: require('../assets/icons/calendar-clock.png'),
    inactiveScale: 1.24,
  },
  {
    key: 'profile',
    label: 'Profile',
    route: '/distributor/d_profile',
    matches: ['/distributor/d_profile'],
    segments: ['d_profile'],
    icon: require('../assets/icons/user (2).png'),
    activeIcon: require('../assets/icons/user.png'),
  },
];

function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const reduceMotionPromise = AccessibilityInfo.isReduceMotionEnabled?.();

    reduceMotionPromise?.then((enabled) => {
      if (isMounted) setReduceMotion(Boolean(enabled));
    });

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduceMotion
    );

    return () => {
      isMounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

function getIndicatorX(width, index, itemCount) {
  if (!width || index < 0) return 0;

  const firstCenter = NAV_HORIZONTAL_PADDING + NAV_BUTTON_WIDTH / 2;
  const lastCenter = width - NAV_HORIZONTAL_PADDING - NAV_BUTTON_WIDTH / 2;
  const step = itemCount > 1 ? (lastCenter - firstCenter) / (itemCount - 1) : 0;

  return firstCenter + step * index - INDICATOR_WIDTH / 2;
}

function normalizePath(path = '') {
  const normalizedPath = path.split('?')[0].replace(/\/+$/, '');
  return normalizedPath || '/';
}

function routeMatches(item, pathname, segments) {
  const currentPath = normalizePath(pathname);
  const activeSegments = segments.filter(Boolean);
  const currentSegment = activeSegments[activeSegments.length - 1] || '';

  return (
    item.matches.some((match) => {
      const routePath = normalizePath(match);
      return currentPath === routePath || currentPath.startsWith(`${routePath}/`);
    }) || item.segments.includes(currentSegment)
  );
}

function NavIcon({
  activeIcon,
  icon,
  inactiveScale = 1,
  isActive,
  keepIconFixed,
  reduceMotion,
}) {
  const progress = useRef(new Animated.Value(isActive ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isActive ? 1 : 0,
      duration: reduceMotion ? 0 : ANIMATION_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isActive, progress, reduceMotion]);

  const activeOpacity = keepIconFixed
    ? 1
    : progress;
  const inactiveOpacity = keepIconFixed
    ? 1
    : progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      });
  const scale = keepIconFixed
    ? 1
    : progress.interpolate({
        inputRange: [0, 1],
        outputRange: [inactiveScale, ACTIVE_SCALE],
      });

  if (keepIconFixed) {
    return (
      <Image
        source={icon}
        style={styles.navIcon}
        tintColor={BLUE}
      />
    );
  }

  return (
    <Animated.View style={[styles.iconFrame, { transform: [{ scale }] }]}>
      <Animated.Image
        source={icon}
        style={[styles.navIcon, styles.iconLayer, { opacity: inactiveOpacity }]}
        tintColor={BLUE}
      />
      <Animated.Image
        source={activeIcon}
        style={[styles.navIcon, styles.iconLayer, { opacity: activeOpacity }]}
        tintColor={BLUE}
      />
    </Animated.View>
  );
}

function BottomNav({ dashboardVariant = false, items }) {
  const pathname = usePathname();
  const router = useRouter();
  const segments = useSegments();
  const reduceMotion = useReduceMotion();
  const [navWidth, setNavWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const hasPositionedIndicator = useRef(false);

  const activeIndex = useMemo(
    () =>
      items.findIndex((item) => routeMatches(item, pathname, segments)),
    [items, pathname, segments]
  );

  useEffect(() => {
    if (!navWidth || activeIndex < 0) {
      Animated.timing(indicatorOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    const targetX = getIndicatorX(navWidth, activeIndex, items.length);

    if (!hasPositionedIndicator.current || reduceMotion) {
      indicatorX.setValue(targetX);
      hasPositionedIndicator.current = true;
    } else {
      Animated.timing(indicatorX, {
        toValue: targetX,
        duration: ANIMATION_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }

    Animated.timing(indicatorOpacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : ANIMATION_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [
    activeIndex,
    indicatorOpacity,
    indicatorX,
    items.length,
    navWidth,
    reduceMotion,
  ]);

  return (
    <View
      style={[styles.bottomNav, dashboardVariant && styles.dashboardBottomNav]}
      onLayout={(event) => setNavWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.activeIndicator,
          {
            opacity: indicatorOpacity,
            transform: [{ translateX: indicatorX }],
          },
        ]}
      />

      {items.map((item, index) => {
        const isActive = index === activeIndex;

        return (
          <TouchableOpacity
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={item.label}
            activeOpacity={0.78}
            onPress={() => router.replace(item.route)}
            style={styles.navButton}
          >
            <NavIcon
              activeIcon={item.activeIcon}
              icon={item.icon}
              inactiveScale={item.inactiveScale}
              isActive={isActive}
              keepIconFixed={item.keepIconFixed}
              reduceMotion={reduceMotion}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function RequesterBottomNav({ dashboardVariant = false }) {
  return <BottomNav dashboardVariant={dashboardVariant} items={requesterItems} />;
}

export function DistributorBottomNav() {
  return <BottomNav items={distributorItems} />;
}

const styles = StyleSheet.create({
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: NAV_HORIZONTAL_PADDING,
    borderRadius: 22,
    zIndex: 20,
    ...createShadow({
      color: '#000',
      elevation: 8,
      opacity: 0.12,
      radius: 6,
      offset: { width: 0, height: 3 },
    }),
  },
  dashboardBottomNav: {
    left: 34,
    right: 34,
    borderRadius: 24,
  },
  activeIndicator: {
    position: 'absolute',
    top: 7,
    left: 0,
    width: INDICATOR_WIDTH,
    height: 4,
    borderRadius: 999,
    backgroundColor: BLUE,
  },
  navButton: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFrame: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  navIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
  },
});
