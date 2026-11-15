import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

const icons = Object.freeze({
  active: require('../../assets/icons/chat/message-circle.svg'),
  history: require('../../assets/icons/chat/archive.svg'),
});

export default function ChatTabIcon({ name, color, size = 17 }) {
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <Image source={icons[name]} contentFit="contain" tintColor={color} transition={0} accessible={false} style={{ width: size, height: size }} />
    </View>
  );
}
