import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import { createShadow } from '../../components/shadowStyles';

const dashboardRoutes = ['/requester/r_dashboard'];
const requestsRoutes = ['/requester/r_request', '/requester/r_notification'];

const getMiddleRoute = (pathname) =>
  requestsRoutes.some((route) => pathname.startsWith(route)) ||
  dashboardRoutes.some((route) => pathname.startsWith(route))
    ? '/requester/r_request'
    : '/requester/requestform';

export default function RequesterLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const isDashboard = pathname.startsWith('/requester/r_dashboard');

  return (
    <RoleGate role="requester">
      <View style={styles.root}>
        <RequesterHeader />

        <View style={styles.screenContent}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'none',
            }}
          />
        </View>

        <View style={styles.navOverlay}>
          <View style={styles.navFrame}>
            <View style={[styles.bottomNav, isDashboard && styles.dashboardBottomNav]}>
              <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
                <Image
                  source={require('../../assets/icons/home.png')}
                  style={styles.navIcon}
                  tintColor="#187BCD"
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.replace(getMiddleRoute(pathname))}>
                <Image
                  source={require('../../assets/icons/square-plus.png')}
                  style={styles.navIcon}
                  tintColor="#187BCD"
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
                <Image
                  source={require('../../assets/icons/user.png')}
                  style={styles.navIcon}
                  tintColor="#187BCD"
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screenContent: {
    flex: 1,
  },
  navOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    zIndex: 20,
    pointerEvents: 'box-none',
  },
  navFrame: {
    width: '100%',
    maxWidth: 375,
    flex: 1,
    pointerEvents: 'box-none',
  },
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
    paddingHorizontal: 28,
    borderRadius: 22,
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
  navIcon: {
    width: 26,
    height: 26,
  },
});
