import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { REQUESTER_FLOATING_NAV_RESERVE, RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';

export default function RequesterLayout() {
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

        <SafeAreaView pointerEvents="box-none" edges={['bottom']} style={styles.navOverlay}>
          <View pointerEvents="box-none" style={styles.navFrame}>
            <RequesterBottomNav />
          </View>
        </SafeAreaView>
      </View>
    </RoleGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
  },
  screenContent: {
    flex: 1,
    minWidth: 0,
    paddingBottom: REQUESTER_FLOATING_NAV_RESERVE,
  },
  navOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    minWidth: 0,
    zIndex: 20,
  },
  navFrame: {
    width: '100%',
    maxWidth: 480,
    minWidth: 0,
    flex: 1,
  },
});
