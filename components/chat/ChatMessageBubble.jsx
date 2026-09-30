import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ChatReceipt from './ChatReceipt';
import chatModel from './chatModel';

const { timeOf } = chatModel;

const formatTime = (value) => {
  const timestamp = timeOf(value);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function ChatMessageBubble({ message, own, receipt, colors, onRetry }) {
  return (
    <View style={[styles.row, own ? styles.outgoingRow : styles.incomingRow]}>
      <View style={[
        styles.bubble,
        own ? { backgroundColor: colors.primaryAction } : { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 },
      ]}>
        <Text style={[styles.body, { color: own ? colors.onPrimary : colors.textPrimary }]}>{message.body}</Text>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: own ? 'rgba(255,255,255,0.78)' : colors.textSecondary }]}>{formatTime(message.createdAt)}</Text>
          {own && <ChatReceipt state={receipt} color={receipt === 'failed' ? colors.onPrimary : 'rgba(255,255,255,0.88)'} />}
        </View>
        {message.failed && (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry sending message" onPress={() => onRetry?.(message)}>
            <Text style={[styles.retry, { color: colors.onPrimary }]}>Tap to retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', marginVertical: 4 },
  outgoingRow: { alignItems: 'flex-end' },
  incomingRow: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', minWidth: 76, borderRadius: 17, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7 },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 3 },
  time: { fontSize: 10, fontWeight: '600' },
  retry: { fontSize: 11, fontWeight: '800', marginTop: 5, textDecorationLine: 'underline' },
});
