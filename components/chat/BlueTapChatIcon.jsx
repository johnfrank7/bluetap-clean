import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function BlueTapChatIcon({ color = '#FFFFFF', size = 26 }) {
  const dropSize = size * 0.82;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.frame, { width: size, height: size }]}>
      <View
        style={[
          styles.drop,
          {
            width: dropSize,
            height: dropSize,
            borderRadius: dropSize * 0.48,
            backgroundColor: color,
            left: size * 0.03,
            top: size * 0.09,
          },
        ]}
      />
      <View style={[styles.bubble, { width: size * 0.56, height: size * 0.39, borderRadius: size * 0.13, right: 0, bottom: size * 0.05 }]}>
        <View style={[styles.bubbleLine, { width: size * 0.3 }]} />
        <View style={[styles.bubbleTail, { borderTopWidth: size * 0.13, borderLeftWidth: size * 0.13 }]} />
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
