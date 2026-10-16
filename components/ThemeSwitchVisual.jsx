import React from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import SidebarIcon from './SidebarIcon';

export default function ThemeSwitchVisual({ colors, isDark }) {
  const position = React.useRef(new Animated.Value(isDark ? 1 : 0)).current;
  const iconMotion = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    iconMotion.setValue(0);
    Animated.parallel([
      Animated.timing(position, {
        toValue: isDark ? 1 : 0,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(iconMotion, {
        toValue: 1,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [iconMotion, isDark, position]);

  return (
    <View style={[styles.track, { backgroundColor: isDark ? colors.primary : 'rgba(255,255,255,0.28)' }]}>
      <Animated.View
        style={[
          styles.thumb,
          { transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 24] }) }] },
        ]}
      >
        <Animated.View
          style={{
            opacity: iconMotion,
            transform: [
              { scale: iconMotion.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
              { rotate: iconMotion.interpolate({ inputRange: [0, 1], outputRange: [isDark ? '-12deg' : '12deg', '0deg'] }) },
            ],
          }}
        >
          <SidebarIcon name={isDark ? 'Moon' : 'Sun'} size={14} color={colors.primaryAction} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 52, height: 28, borderRadius: 999, position: 'relative' },
  thumb: {
    position: 'absolute',
    left: 3,
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
