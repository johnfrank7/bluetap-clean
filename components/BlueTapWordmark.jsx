import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

export default function BlueTapWordmark({ children = 'BlueTap', color, containerStyle, style, ...textProps }) {
  const textStyle = StyleSheet.flatten(style) || {};
  const fontSize = typeof textStyle.fontSize === 'number' ? textStyle.fontSize : 24;
  const dropletColor = color || textStyle.color || '#FFFFFF';

  return (
    <View style={[styles.wordmark, containerStyle]}>
      <Text {...textProps} style={style}>{children}</Text>
      {Platform.OS === 'web' && (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 100 124"
          style={{
            position: 'absolute',
            top: fontSize * 0.79,
            right: -fontSize * 0.32,
            width: fontSize * 0.4,
            height: fontSize * 0.496,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <path
            d="M0 65 C18 49 31 19 52 7 C71 -4 92 5 97 22 C103 42 88 58 68 56 C43 52 25 55 0 65 Z"
            fill={dropletColor}
          />
          <path
            d="M5 77 C28 67 57 65 73 77 C91 90 92 111 76 120 C58 130 41 117 32 102 C23 88 15 81 5 77 Z"
            fill={dropletColor}
          />
        </svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { alignSelf: 'center', position: 'relative' },
});
