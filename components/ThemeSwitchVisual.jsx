import React from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

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
          <View style={styles.iconComposition}>
            <Text style={[styles.icon, { color: isDark ? '#0F172A' : '#F59E0B' }]}>{isDark ? '\u263E' : '\u2600'}</Text>
            {isDark && <Text style={styles.moonStar}>{'\u2726'}</Text>}
          </View>
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
  icon: { fontSize: 10, textAlign: 'center', lineHeight: 16, fontWeight: '900' },
  iconComposition: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  moonStar: { position: 'absolute', right: -1, top: -3, color: '#F4B942', fontSize: 6, lineHeight: 8, fontWeight: '900' },
});
