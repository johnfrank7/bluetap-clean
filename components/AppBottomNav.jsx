import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter, useSegments } from 'expo-router';
import { BLUETAP_COLORS, BLUETAP_DARK_COLORS } from '../constants/bluetapTheme';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { createShadow } from './shadowStyles';

const BLUE = BLUETAP_COLORS.primary;
const ICON_SIZE = 26;
const ACTIVE_SCALE = 1.1;
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
  tintColor = BLUE,
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
        tintColor={tintColor}
      />
    );
  }

  return (
    <Animated.View style={[styles.iconFrame, { transform: [{ scale }] }]}>
      <Animated.Image
        source={icon}
        style={[styles.navIcon, styles.iconLayer, { opacity: inactiveOpacity }]}
        tintColor={tintColor}
      />
      <Animated.Image
        source={activeIcon}
        style={[styles.navIcon, styles.iconLayer, { opacity: activeOpacity }]}
        tintColor={tintColor}
      />
    </Animated.View>
  );
}

function BottomNav({ items, floating = true }) {
  const pathname = usePathname();
  const router = useRouter();
  const segments = useSegments();
  const reduceMotion = useReduceMotion();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const navSurface = isDark ? BLUETAP_DARK_COLORS.surface : BLUETAP_COLORS.surface;
  const navBorder = isDark ? BLUETAP_DARK_COLORS.border : BLUETAP_COLORS.border;
  const navIconColor = isDark ? BLUETAP_DARK_COLORS.primaryLight : BLUE;

  const activeIndex = useMemo(
    () =>
      items.findIndex((item) => routeMatches(item, pathname, segments)),
    [items, pathname, segments]
  );

  return (
    <View
      style={[
        styles.bottomNav,
        { backgroundColor: navSurface, borderColor: navBorder },
        floating && styles.floatingNav,
        floating && { bottom: USER_PORTAL_LAYOUT.navBottomOffset + insets.bottom },
      ]}
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const isPrimaryAction = item.key === 'add';

        return (
          <TouchableOpacity
            key={item.key}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={item.label}
            activeOpacity={0.78}
            onPress={() => router.replace(item.route)}
            style={[
              styles.navButton,
              isPrimaryAction && styles.primaryNavButton,
              isPrimaryAction && { borderColor: navSurface },
              isPrimaryAction && isActive && styles.primaryNavButtonActive,
            ]}
          >
            <NavIcon
              activeIcon={item.activeIcon}
              icon={item.icon}
              inactiveScale={item.inactiveScale}
              isActive={isActive}
              keepIconFixed={item.keepIconFixed}
              reduceMotion={reduceMotion}
              tintColor={isPrimaryAction ? BLUETAP_COLORS.white : navIconColor}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function RequesterBottomNav() {
  return <BottomNav items={requesterItems} />;
}

export function DistributorBottomNav() {
  return <BottomNav items={distributorItems} />;
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: NAV_HORIZONTAL_PADDING,
    borderRadius: USER_PORTAL_LAYOUT.cardRadius,
    borderWidth: 1,
    zIndex: 20,
    ...createShadow({
      color: '#000',
      elevation: 8,
      opacity: 0.12,
      radius: 6,
      offset: { width: 0, height: 3 },
    }),
  },
  floatingNav: {
    position: 'absolute',
    left: USER_PORTAL_LAYOUT.gutter,
    right: USER_PORTAL_LAYOUT.gutter,
    minHeight: USER_PORTAL_LAYOUT.navHeight,
    minWidth: 0,
  },
  navButton: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryNavButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginTop: -24,
    backgroundColor: BLUE,
    borderWidth: 4,
    borderColor: BLUETAP_COLORS.surface,
    alignSelf: 'center',
    ...createShadow({ color: BLUE, elevation: 6, opacity: 0.28, radius: 8, offset: { width: 0, height: 4 } }),
  },
  primaryNavButtonActive: {
    backgroundColor: BLUETAP_COLORS.primaryDark,
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
