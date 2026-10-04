import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const { getRolePresentation } = require('../constants/rolePresentation');

export default function RoleBadge({ colors, compact = false, label, numberOfLines = 1, role, style, textStyle }) {
  const presentation = getRolePresentation(role, colors);
  return (
    <View
      accessibilityLabel={`${presentation.label} role`}
      style={[
        styles.badge,
        compact && styles.compactBadge,
        { backgroundColor: presentation.backgroundColor },
        style,
      ]}
    >
      <Text
        ellipsizeMode="tail"
        numberOfLines={numberOfLines}
        style={[styles.text, compact && styles.compactText, { color: presentation.color }, textStyle]}
      >
        {label || presentation.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    flexShrink: 0,
    minHeight: 22,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compactBadge: {
    flexShrink: 1,
    minHeight: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  text: {
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14,
  },
  compactText: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 13,
    minWidth: 0,
  },
});
