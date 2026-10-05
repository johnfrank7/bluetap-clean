import React, { memo, useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { UserPortalFrame } from './UserPortalFrame';
import { useBlueTapTheme } from './BlueTapTheme';
import ThemeIconButton from './ThemeIconButton';
import BlueTapBrandMark from './BlueTapBrandMark';
import BlueTapIcon from './BlueTapIcon';
import useSingleFlightNavigation from './useSingleFlightNavigation';
import { useRoleNotifications } from './RoleNotifications';
const { formatNotificationBadge } = require('../services/orderNotifications');

const BlueTapHeader = memo(function BlueTapHeader({
  notificationPath,
  rightContent = null,
}) {
  const { navigateOnce, replaceOnce } = useSingleFlightNavigation();
  const { colors, isDark } = useBlueTapTheme();
  const { unseenCount } = useRoleNotifications();

  const openHome = useCallback(() => {
    replaceOnce(notificationPath?.startsWith('/distributor') ? '/distributor/d_dashboard' : '/requester/r_dashboard');
  }, [notificationPath, replaceOnce]);

  const openNotifications = useCallback(() => {
    if (notificationPath) {
      navigateOnce(notificationPath);
    }
  }, [navigateOnce, notificationPath]);

  return (
    <SafeAreaView edges={['top']} style={[styles.safeArea, { backgroundColor: colors.header }]}>
      <StatusBar style="light" />

      <UserPortalFrame>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            hitSlop={8}
            onPress={openHome}
            style={styles.brandButton}
          >
            <BlueTapBrandMark inverse color={colors.iconOnPrimary} size={24} style={styles.brandLogo} />
            <Text style={styles.appName}>BlueTap</Text>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            {rightContent}

            <ThemeIconButton inverse={!isDark} />

            <TouchableOpacity
              accessibilityLabel={unseenCount > 0 ? `Open notifications, ${unseenCount} unseen` : 'Open notifications'}
              accessibilityRole="button"
              activeOpacity={0.85}
              hitSlop={8}
              onPress={openNotifications}
              style={styles.notificationButton}
            >
              <BlueTapIcon name="notifications" size={22} color={colors.iconOnPrimary} />
              {unseenCount > 0 && <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{formatNotificationBadge(unseenCount)}</Text></View>}
            </TouchableOpacity>
          </View>
        </View>
      </UserPortalFrame>
    </SafeAreaView>
  );
});

export default BlueTapHeader;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#187BCD',
    zIndex: 30,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: USER_PORTAL_LAYOUT.gutter,
    paddingTop: 10,
    paddingBottom: 12,
  },
  brandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexShrink: 1,
  },
  brandLogo: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  notifIcon: {
    width: 22,
    height: 22,
  },
  notificationButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notificationBadge: { position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: '#EF4444', borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
});
