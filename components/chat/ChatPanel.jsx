import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import BlueTapChatIcon from './BlueTapChatIcon';
import { useChat } from './ChatContext';
import ChatConversationList from './ChatConversationList';
import ChatConversationView from './ChatConversationView';

function PanelSurface({ mobile }) {
  const { closeChat, colors, currentConversation, role } = useChat();
  return (
    <SafeAreaView style={[styles.panel, mobile ? styles.mobilePanel : styles.desktopPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior={mobile ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}>
        {!currentConversation && (
          <View style={[styles.header, { backgroundColor: colors.header || colors.surface, borderBottomColor: colors.border }]}>
            <View style={[styles.iconBadge, { backgroundColor: colors.primaryAction }]}><BlueTapChatIcon size={24} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.heading, { color: colors.textPrimary }]}>Messages</Text><Text style={[styles.subheading, { color: colors.textSecondary }]}>Secure BlueTap conversations</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close messages" onPress={closeChat} style={styles.close}><Text style={[styles.closeText, { color: colors.textPrimary }]}>x</Text></Pressable>
          </View>
        )}
        {currentConversation ? <ChatConversationView /> : <ChatConversationList role={role} />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function ChatPanel() {
  const { closeChat, colors, panelOpen, role } = useChat();
  const { width, height } = useWindowDimensions();
  const mobile = width < 720;
  if (!panelOpen) return null;
  if (mobile) {
    return (
      <Modal visible transparent={false} animationType="slide" statusBarTranslucent={false} onRequestClose={closeChat}>
        <PanelSurface mobile />
      </Modal>
    );
  }
  const portalRight = ['requester', 'distributor'].includes(role) ? Math.max(22, (width - 480) / 2 + 22) : 28;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.desktopAnchor, { right: portalRight, height: Math.min(720, height - 44) }]}>
        <PanelSurface />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, overflow: 'hidden' },
  keyboardArea: { flex: 1 },
  desktopPanel: { borderWidth: 1, borderRadius: 22, shadowColor: '#07131F', shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 18 },
  mobilePanel: { borderWidth: 0 },
  desktopAnchor: { position: 'absolute', bottom: 22, width: 410, maxWidth: '92%', zIndex: 100 },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  iconBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 17, fontWeight: '950' },
  subheading: { fontSize: 11, marginTop: 2 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  closeText: { fontSize: 28, lineHeight: 30 },
});
