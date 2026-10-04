import React, { useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useBlueTapTheme } from '../BlueTapTheme';
import { createShadow } from '../shadowStyles';

export function AssistantComposer({
  onSend,
  loading = false,
  placeholder = 'Ask BlueTap Assistant...',
}) {
  const { colors, isDark } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setText('');
  }, [text, loading, onSend]);

  const handleKeyPress = useCallback(
    (e) => {
      if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = Boolean(text.trim()) && !loading;

  return (
    <View style={[styles.outerContainer, isDesktop && styles.outerContainerDesktop]}>
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: isDark ? colors.surfaceAlt : '#FFFFFF',
            borderColor: isDark ? colors.border : '#D7ECFF',
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            {
              color: colors.textPrimary,
            },
          ]}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          value={text}
          onChangeText={setText}
          onKeyPress={handleKeyPress}
          multiline
          maxLength={500}
          editable={!loading}
          accessibilityLabel="Message input for BlueTap Assistant"
          returnKeyType="send"
        />

        {Boolean(text.length > 0) && !loading && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => setText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear message text"
          >
            <Text style={[styles.clearBtnText, { color: colors.textSecondary }]}>✕</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            styles.sendBtn,
            {
              backgroundColor: canSend ? colors.primary : (isDark ? '#2D3748' : '#E2E8F0'),
            },
          ]}
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text
              style={[
                styles.sendIcon,
                { color: canSend ? '#FFFFFF' : (isDark ? '#718096' : '#94A3B8') },
              ]}
            >
              ➤
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default AssistantComposer;

const styles = StyleSheet.create({
  outerContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: 'transparent',
  },
  outerContainerDesktop: {
    paddingTop: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    minHeight: 48,
    ...createShadow({
      color: '#0D47A1',
      elevation: 4,
      opacity: 0.1,
      radius: 8,
      offset: { width: 0, height: 2 },
    }),
  },
  input: {
    flex: 1,
    fontSize: 14,
    maxHeight: 100,
    paddingTop: Platform.OS === 'web' ? 4 : 0,
    paddingBottom: Platform.OS === 'web' ? 4 : 0,
    marginRight: 6,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      },
    }),
  },
  clearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    fontSize: 15,
    marginLeft: 2,
  },
});
