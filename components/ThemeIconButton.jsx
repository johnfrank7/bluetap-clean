import React from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function ThemeIconButton({ inverse = false, style }) {
  const { colors, isDark, isTransitioning, toggleTheme } = useBlueTapTheme();
  const iconMotion = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    iconMotion.setValue(0);
    Animated.timing(iconMotion, {
      toValue: 1,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [iconMotion, isDark]);

  return (
    <Pressable
      accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      accessibilityRole="button"
      accessibilityState={{ disabled: isTransitioning }}
      disabled={isTransitioning}
      hitSlop={8}
      onPress={toggleTheme}
      style={({ focused, hovered, pressed }) => [
          styles.button,
          {
            backgroundColor: isDark ? '#193650' : inverse ? 'rgba(255,255,255,0.14)' : '#EEF8FF',
            borderColor: focused || hovered
              ? colors.primaryLight
              : isDark ? '#427AA2' : inverse ? 'rgba(255,255,255,0.38)' : '#CFE9F9',
            opacity: isTransitioning ? 0.72 : 1,
            transform: pressed
              ? [{ scale: 0.96 }]
              : hovered
                ? [{ translateY: -1 }, { scale: 1.02 }]
                : [{ scale: 1 }],
          },
          style,
        ]}
    >
      <Animated.Text
        style={[
          styles.icon,
          {
            color: isDark ? '#FFD67A' : inverse ? '#FFFFFF' : colors.primaryDark,
            opacity: iconMotion,
            transform: [
              { scale: iconMotion.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
              { rotate: iconMotion.interpolate({ inputRange: [0, 1], outputRange: [isDark ? '-12deg' : '12deg', '0deg'] }) },
            ],
          },
        ]}
      >
        {isDark ? '☀' : '☾'}
      </Animated.Text>
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
});
