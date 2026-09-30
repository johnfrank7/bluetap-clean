import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useChat } from './ChatContext';
import ChatComposer from './ChatComposer';
import ChatMessageBubble from './ChatMessageBubble';
import ChatOrderContextCard from './ChatOrderContextCard';

export default function ChatConversationView() {
  const {
    backToList, closeChat, colors, currentConversation, hasEarlierMessages, loadEarlierMessages,
    loadingEarlier, messages, retryMessage, role, sendCurrentMessage, threadError,
    isOwnMessage, receiptForMessage, canSend,
  } = useChat();
  const scrollRef = React.useRef(null);
  const didInitialScroll = React.useRef(false);

  React.useEffect(() => {
    didInitialScroll.current = false;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: false }), 40);
    return () => clearTimeout(timer);
  }, [currentConversation?.id]);

  if (!currentConversation) return null;
  return (
    <View style={styles.root}>
      <View style={[styles.threadHeader, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" onPress={backToList} style={styles.back}><Text style={[styles.backText, { color: colors.primary }]}>‹</Text></Pressable>
        <View style={{ flex: 1 }}><Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{currentConversation.displayName}</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{currentConversation.contextLabel}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close messages" onPress={closeChat} style={styles.close}><Text style={[styles.closeText, { color: colors.textPrimary }]}>×</Text></Pressable>
      </View>
      <ChatOrderContextCard order={currentConversation.orderContextLocal} colors={colors} />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.messages}
        onContentSizeChange={() => {
          if (!didInitialScroll.current) {
            didInitialScroll.current = true;
            scrollRef.current?.scrollToEnd?.({ animated: false });
          }
        }}
      >
        {hasEarlierMessages && (
          <Pressable accessibilityRole="button" accessibilityLabel="Load earlier messages" disabled={loadingEarlier} onPress={loadEarlierMessages} style={styles.earlier}>
            {loadingEarlier ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.earlierText, { color: colors.primary }]}>Load earlier messages</Text>}
          </Pressable>
        )}
        {messages.length === 0 && !threadError && <Text style={[styles.empty, { color: colors.textSecondary }]}>Start a secure BlueTap conversation.</Text>}
        {!!threadError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{threadError}</Text>}
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id || `pending-${message.clientMutationId}`}
            message={message}
            own={isOwnMessage(message)}
            receipt={receiptForMessage(message)}
            colors={colors}
            onRetry={retryMessage}
          />
        ))}
      </ScrollView>
      <ChatComposer colors={colors} disabled={!canSend} onSend={sendCurrentMessage} />
      {!canSend && !threadError && <Text style={[styles.readOnly, { color: colors.textSecondary, backgroundColor: colors.surfaceAlt }]}>Sending is unavailable for this conversation.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  threadHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1 },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 34, fontWeight: '500' },
  title: { fontSize: 15, fontWeight: '900' },
  subtitle: { fontSize: 11, marginTop: 2 },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 26, lineHeight: 28 },
  messages: { flexGrow: 1, padding: 12, justifyContent: 'flex-end' },
  earlier: { minHeight: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  earlierText: { fontSize: 12, fontWeight: '900' },
  empty: { textAlign: 'center', fontSize: 12, marginVertical: 24 },
  error: { textAlign: 'center', fontSize: 12, marginVertical: 10 },
  readOnly: { textAlign: 'center', paddingVertical: 7, fontSize: 11, fontWeight: '700' },
});
