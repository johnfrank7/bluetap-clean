import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

export default function ChatReceipt({ state, color }) {
  if (!state) return null;
  if (state === 'pending') {
    return <ActivityIndicator accessibilityLabel="Sending" size="small" color={color} style={{ transform: [{ scale: 0.62 }] }} />;
  }
  if (state === 'failed') {
    return <Text accessibilityLabel="Message failed to send" style={{ color, fontSize: 11, fontWeight: '800' }}>!</Text>;
  }
  const seen = state === 'seen';
  return (
    <View accessibilityLabel={seen ? 'Seen' : 'Sent'} accessibilityRole="text">
      <Text style={{ color, fontSize: 11, fontWeight: '900' }}>{seen ? '✓✓' : '✓'}</Text>
    </View>
  );
}
