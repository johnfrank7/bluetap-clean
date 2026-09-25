import React from 'react';
import { StyleSheet, View } from 'react-native';
import { USER_PORTAL_LAYOUT } from '../constants/userPortalLayout';

export function UserPortalFrame({ children, style, ...props }) {
  return (
    <View {...props} style={[styles.frame, style]}>
      {children}
    </View>
  );
}

export default UserPortalFrame;

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    maxWidth: USER_PORTAL_LAYOUT.maxWidth,
    minWidth: 0,
    alignSelf: 'center',
  },
});
