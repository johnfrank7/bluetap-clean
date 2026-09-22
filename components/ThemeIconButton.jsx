import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function ThemeIconButton({ inverse = false, style }) {
  const { colors, isDark, toggleTheme } = useBlueTapTheme();
  return (
    <Pressable
      accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      accessibilityRole="button"
      hitSlop={8}
      onPress={toggleTheme}
      style={({ focused, hovered, pressed }) => [
          styles.button,
          {
            backgroundColor: isDark ? '#193650' : inverse ? 'rgba(255,255,255,0.14)' : '#EEF8FF',
            borderColor: focused || hovered
              ? colors.primaryLight
              : isDark ? '#427AA2' : inverse ? 'rgba(255,255,255,0.38)' : '#CFE9F9',
            opacity: pressed ? 0.76 : 1,
          },
          focused && styles.focused,
          style,
        ]}
    >
      <Text style={[styles.icon, { color: isDark ? '#FFD67A' : inverse ? '#FFFFFF' : colors.primaryDark }]}>
        {isDark ? '☀' : '☾'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 21,
  },
  focused: {
    borderWidth: 2,
  },
});
