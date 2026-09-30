import React from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export default function ChatComposer({ colors, disabled, onSend }) {
  const [body, setBody] = React.useState('');
  const normalized = body.trim();
  const submit = () => {
    if (!normalized || disabled) return;
    onSend(normalized);
    setBody('');
  };
  return (
    <View style={[styles.wrap, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
      <TextInput
        accessibilityLabel="Message"
        multiline
        maxLength={2000}
        placeholder="Write a message…"
        placeholderTextColor={colors.textSecondary}
        value={body}
        onChangeText={setBody}
        onKeyPress={(event) => {
          if (Platform.OS === 'web' && event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) {
            event.preventDefault?.();
            submit();
          }
        }}
        style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.input || colors.surfaceAlt, borderColor: colors.border }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !normalized || disabled }}
        disabled={!normalized || disabled}
        onPress={submit}
        style={({ pressed }) => [styles.send, { backgroundColor: colors.primaryAction }, pressed && styles.pressed, (!normalized || disabled) && { backgroundColor: colors.disabled }]}
      >
        <Text style={[styles.sendText, { color: colors.onPrimary }]}>Send</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 42, maxHeight: 108, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, fontSize: 14 },
  send: { minHeight: 42, paddingHorizontal: 14, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
