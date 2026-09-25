import React, { memo, useCallback } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { UserPortalFrame } from './UserPortalFrame';
import { useBlueTapTheme } from './BlueTapTheme';
import ThemeIconButton from './ThemeIconButton';

const BlueTapHeader = memo(function BlueTapHeader({
  notificationPath,
  rightContent = null,
}) {
  const router = useRouter();
  const { colors, isDark } = useBlueTapTheme();

  const openHome = useCallback(() => {
    router.replace(notificationPath?.startsWith('/distributor') ? '/distributor/d_dashboard' : '/requester/r_dashboard');
  }, [notificationPath, router]);

  const openNotifications = useCallback(() => {
    if (notificationPath) {
      router.push(notificationPath);
    }
  }, [notificationPath, router]);

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
            <Image
              source={require('../assets/icons/bluetapwhitelogo.png')}
              style={styles.brandLogo}
              tintColor="#FFFFFF"
            />
            <Text style={styles.appName}>BlueTap</Text>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            {rightContent}

            <ThemeIconButton inverse={!isDark} />

            <TouchableOpacity
              accessibilityLabel="Open notifications"
              accessibilityRole="button"
              activeOpacity={0.85}
              hitSlop={8}
              onPress={openNotifications}
            >
              <Image
                source={require('../assets/icons/notif.png')}
                style={styles.notifIcon}
                tintColor="#FFFFFF"
              />
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
});
