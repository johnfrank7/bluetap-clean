import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useBlueTapTheme } from '../BlueTapTheme';

export default function BlueTapChatIcon({ color, bubbleColor, detailColor, size = 26 }) {
  const { colors } = useBlueTapTheme();
  const resolvedColor = color || colors.iconInteractive || colors.primary;
  const resolvedBubbleColor = bubbleColor || colors.surface;
  const resolvedDetailColor = detailColor || colors.iconInteractive || colors.primary;
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
            backgroundColor: resolvedColor,
            left: size * 0.08,
            top: size * 0.12,
          },
        ]}
      />
      <View style={[styles.bubble, { backgroundColor: resolvedBubbleColor, width: size * 0.54, height: size * 0.38, borderRadius: size * 0.15, right: size * 0.02, bottom: size * 0.08 }]}>
        <View style={[styles.bubbleLine, { backgroundColor: resolvedDetailColor, width: size * 0.26 }]} />
        <View style={[styles.bubbleTail, { borderTopColor: resolvedBubbleColor, borderTopWidth: size * 0.11, borderLeftWidth: size * 0.11 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative' },
  drop: { position: 'absolute', transform: [{ rotate: '45deg' }], borderTopLeftRadius: 3 },
  bubble: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  bubbleLine: { height: 2, borderRadius: 2 },
  bubbleTail: { position: 'absolute', right: 1, bottom: -3, width: 0, height: 0, borderLeftColor: 'transparent' },
});
