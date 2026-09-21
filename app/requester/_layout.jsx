import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { RequesterBottomNav } from '../../components/AppBottomNav';
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

        <SafeAreaView edges={['bottom']} style={styles.navArea}>
          <RequesterBottomNav />
        </SafeAreaView>
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
  navArea: {
    width: '100%',
    backgroundColor: '#FFFFFF',
  },
});
