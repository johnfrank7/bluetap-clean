import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';

export default function RequesterLayout() {
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
            <RequesterBottomNav dashboardVariant={isDashboard} />
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
});
