import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

export default function PasswordVisibilityButton({
  visible,
  onPress,
  color = '#187BCD',
  style,
  label = 'password',
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${label}`}
      accessibilityState={{ expanded: visible }}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <View style={[styles.eye, { borderColor: color }]}>
        <View style={[styles.pupil, { backgroundColor: color }]} />
      </View>
      {!visible && <View style={[styles.slash, { backgroundColor: color }]} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eye: {
    width: 24,
    height: 15,
    borderWidth: 2,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  slash: {
    position: 'absolute',
    width: 29,
    height: 2,
    borderRadius: 2,
    transform: [{ rotate: '-42deg' }],
  },
});
