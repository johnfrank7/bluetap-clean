import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useSegments } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { createShadow } from './shadowStyles';
import { useBlueTapTheme } from './BlueTapTheme';
import { useRoleNotifications } from './RoleNotifications';
import useSingleFlightNavigation from './useSingleFlightNavigation';
import { useRequesterTourTarget } from './RequesterTutorialModal';
const { formatNotificationBadge } = require('../services/orderNotifications');

const ICON_SIZE = 27;
const NAV_HORIZONTAL_PADDING = 28;
// A 24-unit canvas with 2-unit strokes renders at 27px with 2.25px strokes.
// Reuse the existing matching clipboard artwork (license in icons/sidebar).
const PORTAL_NAV_ICONS = Object.freeze({
  house: require('../assets/icons/portal/house.svg'),
  plus: require('../assets/icons/portal/plus.svg'),
  userRound: require('../assets/icons/portal/user-round.svg'),
  clipboardList: require('../assets/icons/sidebar/clipboard-list.svg'),
  calendarClock: require('../assets/icons/portal/calendar-clock.svg'),
});

const requesterItems = [
  {
    key: 'home',
    label: 'Home',
    route: '/requester/r_dashboard',
    matches: ['/requester/r_dashboard'],
    segments: ['r_dashboard'],
    icon: PORTAL_NAV_ICONS.house,
  },
  {
    key: 'add',
    label: 'Add Request',
    route: '/requester/r_request',
    matches: ['/requester/r_request', '/requester/requestform'],
    segments: ['r_request', 'requestform'],
    icon: PORTAL_NAV_ICONS.plus,
  },
  {
    key: 'profile',
    label: 'Profile',
    route: '/requester/r_profile',
    matches: ['/requester/r_profile'],
    segments: ['r_profile'],
    icon: PORTAL_NAV_ICONS.userRound,
  },
];

const distributorItems = [
  {
    key: 'home',
    label: 'Home',
    route: '/distributor/d_dashboard',
    matches: ['/distributor/d_dashboard'],
    segments: ['d_dashboard'],
    icon: PORTAL_NAV_ICONS.house,
  },
  {
    key: 'requests',
    label: 'Requests',
    route: '/distributor/d_requests',
    matches: ['/distributor/d_requests'],
    segments: ['d_requests'],
    icon: PORTAL_NAV_ICONS.clipboardList,
  },
  {
    key: 'schedule',
    label: 'Schedule',
    route: '/distributor/d_scheduled_requests',
    matches: ['/distributor/d_scheduled_requests', '/distributor/d_history'],
    segments: ['d_scheduled_requests', 'd_history'],
    icon: PORTAL_NAV_ICONS.calendarClock,
  },
  {
    key: 'profile',
    label: 'Profile',
    route: '/distributor/d_profile',
    matches: ['/distributor/d_profile'],
    segments: ['d_profile'],
    icon: PORTAL_NAV_ICONS.userRound,
  },
];

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

function NavIcon({ source, color }) {
  return (
    <ExpoImage
      source={source}
      contentFit="contain"
      tintColor={color}
      transition={0}
      accessible={false}
      style={styles.navIcon}
    />
  );
}

function BottomNav({ items, floating = true, tourTargets = {} }) {
  const pathname = usePathname();
  const { replaceOnce } = useSingleFlightNavigation();
  const segments = useSegments();
  const { colors } = useBlueTapTheme();
  const { attentionCounts } = useRoleNotifications();
  const insets = useSafeAreaInsets();
  const navSurface = colors.navSurface;
  const navBorder = colors.border;
  const navIconColor = colors.navIconMuted;

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
        const badgeCount = item.key === 'requests' ? attentionCounts.requests : item.key === 'schedule' ? attentionCounts.schedule : 0;

        return (
          <View key={item.key} style={styles.navSlot}>
            <Pressable
              ref={tourTargets[item.key]}
              dataSet={{ bluetapBottomNav: 'true' }}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={badgeCount > 0 ? `${item.label}, ${badgeCount} items require attention` : item.label}
              onPress={() => replaceOnce(item.route)}
              style={({ hovered, pressed }) => [
                styles.navButton,
                (hovered || pressed) && { backgroundColor: colors.surfaceAlt },
                isActive && {
                  backgroundColor: colors.primarySoft,
                  borderColor: colors.navSelectedBorder,
                },
                pressed && styles.navButtonPressed,
              ]}
            >
              <View style={styles.navIconWrap}>
                <NavIcon
                  source={item.icon}
                  color={isActive ? colors.iconPrimary : navIconColor}
                />
                {badgeCount > 0 && <View style={[styles.navBadge, { borderColor: navSurface }]}><Text style={styles.navBadgeText}>{formatNotificationBadge(badgeCount)}</Text></View>}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export function RequesterBottomNav() {
  const home = useRequesterTourTarget('home');
  const add = useRequesterTourTarget('add-nav');
  const profile = useRequesterTourTarget('profile');
  return <BottomNav items={requesterItems} tourTargets={{ home, add, profile }} />;
}

export function DistributorBottomNav() {
  return <BottomNav items={distributorItems} />;
}

const styles = StyleSheet.create({
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
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
  navSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Immediate feedback for every tab; no scaling, cross-fade or motion to reduce.
  navButtonPressed: { opacity: 0.88 },
  navIcon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    flexShrink: 0,
  },
  navIconWrap: { position: 'relative', width: ICON_SIZE, height: ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  navBadge: { position: 'absolute', top: -18, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, borderWidth: 1.5, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  navBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
});
