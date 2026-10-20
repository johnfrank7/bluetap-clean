import React from 'react';
import { Animated, Easing, View } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

export default function DropdownChevron({ color, expanded = false, size = 16, strokeWidth = 1.75, style }) {
  const { colors } = useBlueTapTheme();
  const iconColor = color || colors.iconSecondary || colors.iconPrimary || colors.primary || '#187BCD';
  const armSize = size * 0.38;
  const progress = React.useRef(new Animated.Value(expanded ? 1 : 0)).current;

  React.useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, progress]);

  const rotation = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['45deg', '225deg'],
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      pointerEvents="none"
      style={[styles.frame, { width: size, height: size }, style]}
    >
      <Animated.View
        style={{
          width: armSize,
          height: armSize,
          borderRightWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: iconColor,
          transform: [{ rotate: rotation }],
        }}
      />
    </View>
  );
}

const styles = {
  frame: { alignItems: 'center', flexShrink: 0, justifyContent: 'center' },
};
