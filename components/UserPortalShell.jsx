import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';

import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';
import { useBlueTapTheme } from './BlueTapTheme';
import { UserPortalFrame } from './UserPortalFrame';

export { UserPortalFrame };

export default function UserPortalShell({ header = null, navigation }) {
  const { colors } = useBlueTapTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {header}

      <View style={styles.screenContent}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </View>

      <View pointerEvents="box-none" style={styles.navOverlay}>
        <UserPortalFrame pointerEvents="box-none" style={styles.navFrame}>
          {navigation}
        </UserPortalFrame>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minWidth: 0,
  },
  frame: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
  },
  screenContent: {
    flex: 1,
    minWidth: 0,
  },
  navOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    zIndex: 20,
  },
  navFrame: {
    flex: 1,
  },
});
