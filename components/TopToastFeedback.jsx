import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBlueTapTheme } from './BlueTapTheme';
import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { createShadow } from './shadowStyles';

export default function TopToastFeedback({
  visible = false,
  message = '',
  type = 'success', // 'success' | 'error' | 'warning' | 'info'
  duration = 3200,
  onDismiss,
}) {
  const { colors, isDark } = useBlueTapTheme();
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(-24)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    if (visible && message) {
      if (timerRef.current) clearTimeout(timerRef.current);

      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.spring(translateYAnim, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();

      if (duration > 0) {
        timerRef.current = setTimeout(() => {
          dismissToast();
        }, duration);
      }
    } else {
      dismissToast();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, message, duration]);

  const dismissToast = () => {
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(translateYAnim, {
        toValue: -24,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(() => {
      if (onDismiss) onDismiss();
    });
  };

  if (!visible && !message) return null;

  const getStyleForType = () => {
    switch (type) {
      case 'error':
        return {
          bg: isDark ? '#48262A' : '#FCE9E8',
          border: isDark ? '#EF4444' : '#B52F2F',
          text: isDark ? '#FCA5A5' : '#B52F2F',
          icon: '✕',
        };
      case 'warning':
        return {
          bg: isDark ? '#493814' : '#FFF8E8',
          border: isDark ? '#F59E0B' : '#A96800',
          text: isDark ? '#FCD34D' : '#A96800',
          icon: '⚠',
        };
      case 'info':
        return {
          bg: isDark ? '#163B59' : '#EAF6FF',
          border: isDark ? '#70BDF2' : BLUETAP_COLORS.primary,
          text: isDark ? '#93C5FD' : BLUETAP_COLORS.primary,
          icon: 'ℹ',
        };
      case 'success':
      default:
        return {
          bg: isDark ? '#103B2A' : '#E8F7EF',
          border: isDark ? '#22C55E' : '#167347',
          text: isDark ? '#86EFAC' : '#167347',
          icon: '✓',
        };
    }
  };

  const config = getStyleForType();

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        {
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={dismissToast}
        style={[
          styles.toastCard,
          {
            backgroundColor: config.bg,
            borderColor: config.border,
          },
        ]}
      >
        <Text style={[styles.icon, { color: config.text }]}>{config.icon}</Text>
        <Text style={[styles.message, { color: config.text }]} numberOfLines={3}>
          {message}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 20,
    left: 16,
    right: 16,
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastCard: {
    maxWidth: 440,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 10,
    ...createShadow({
      color: '#000000',
      elevation: 8,
      opacity: 0.18,
      radius: 12,
      offset: { width: 0, height: 4 },
    }),
  },
  icon: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
});

