import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import BlueTapIcon from './BlueTapIcon';

export default function NotificationBackButton({ colors, inverse = false, onPress }) {
  const textColor = inverse
    ? (colors?.iconOnPrimary || '#FFFFFF')
    : (colors?.iconInteractive || colors?.primary || '#187BCD');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={6}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.button,
        {
          backgroundColor: inverse ? 'rgba(255,255,255,0.14)' : (colors?.surfaceAlt || '#F0F7FC'),
          borderColor: inverse ? 'rgba(255,255,255,0.34)' : (colors?.border || '#D5E6F2'),
        },
        hovered && styles.hovered,
        pressed && styles.pressed,
      ]}
    >
      <BlueTapIcon name="back" size={18} color={textColor} />
      <Text style={[styles.label, { color: textColor }]}>Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 10 },
  label: { fontSize: 12, fontWeight: '900' },
  hovered: { transform: [{ translateY: -1 }, { scale: 1.01 }] },
  pressed: { opacity: 0.84, transform: [{ scale: 0.98 }] },
});
