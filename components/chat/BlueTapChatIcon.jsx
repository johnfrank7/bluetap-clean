import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function BlueTapChatIcon({ color = '#FFFFFF', size = 26 }) {
  const dropSize = size * 0.72;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, { width: size, height: size }]}>
      <View
        style={[
          styles.drop,
          {
            width: dropSize,
            height: dropSize,
            borderRadius: dropSize * 0.5,
            backgroundColor: color,
            left: size * 0.08,
            top: size * 0.12,
          },
        ]}
      />
      <View style={[styles.bubble, { width: size * 0.54, height: size * 0.38, borderRadius: size * 0.15, right: size * 0.02, bottom: size * 0.08 }]}>
        <View style={[styles.bubbleLine, { width: size * 0.26 }]} />
        <View style={[styles.bubbleTail, { borderTopWidth: size * 0.11, borderLeftWidth: size * 0.11 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative' },
  drop: { position: 'absolute', transform: [{ rotate: '45deg' }], borderTopLeftRadius: 3 },
  bubble: { position: 'absolute', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bubbleLine: { height: 2, borderRadius: 2, backgroundColor: '#187BCD' },
  bubbleTail: { position: 'absolute', right: 1, bottom: -3, width: 0, height: 0, borderTopColor: '#FFFFFF', borderLeftColor: 'transparent' },
});
