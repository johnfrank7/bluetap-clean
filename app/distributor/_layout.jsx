import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { DistributorBottomNav } from '../../components/AppBottomNav';
import RoleGate from '../../components/RoleGate';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <View style={styles.root}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
          }}
        />

        <View style={styles.navOverlay}>
          <View style={styles.navFrame}>
            <DistributorBottomNav />
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
