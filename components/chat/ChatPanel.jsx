import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import BlueTapChatIcon from './BlueTapChatIcon';
import { useChat } from './ChatContext';
import ChatConversationList from './ChatConversationList';
import ChatConversationView from './ChatConversationView';

export function calculateMobileChatDimensions({ width = 360, height = 700, insets = {} } = {}) {
  const topMargin = Math.max(14, (insets.top || 0) + 10);
  const bottomMargin = Math.max(14, (insets.bottom || 0) + 10);
  const horizontalMargin = width < 360 ? 10 : 12;
  const mobileWidth = Math.min(width - (horizontalMargin * 2), 440);
  const mobileHeight = Math.min(height - (topMargin + bottomMargin), 720);
  return {
    mobileWidth,
    mobileHeight,
    topMargin,
    bottomMargin,
    horizontalMargin,
    isEdgeToEdge: mobileWidth >= width,
  };
}

function PanelSurface({ mobile, onClose }) {
  const { closeChat, colors, currentConversation, role } = useChat();
  const handleClose = onClose || closeChat;

  return (
    <View style={[styles.panel, mobile ? styles.mobilePanel : styles.desktopPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <KeyboardAvoidingView style={styles.keyboardArea} behavior={mobile ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}>
        {!currentConversation && (
          <View style={[styles.header, { backgroundColor: colors.header || colors.surface, borderBottomColor: colors.border }]}>
            <View style={[styles.iconBadge, { backgroundColor: colors.primaryAction }]}><BlueTapChatIcon size={24} /></View>
            <View style={{ flex: 1 }}><Text style={[styles.heading, { color: colors.textPrimary }]}>Messages</Text><Text style={[styles.subheading, { color: colors.textSecondary }]}>Secure BlueTap conversations</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close messages" onPress={handleClose} style={styles.close}><Text style={[styles.closeText, { color: colors.textPrimary }]}>×</Text></Pressable>
          </View>
        )}
        {currentConversation ? <ChatConversationView /> : <ChatConversationList role={role} />}
      </KeyboardAvoidingView>
    </View>
  );
}

export default function ChatPanel() {
  const { closeChat, colors, isDark, panelOpen, role } = useChat();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const mobile = width < 720;

  const safeClose = React.useCallback(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    }
    closeChat();
  }, [closeChat]);

  if (!panelOpen) return null;

  if (mobile) {
    const { mobileWidth, mobileHeight, topMargin, bottomMargin } = calculateMobileChatDimensions({ width, height, insets });

    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={safeClose}>
        <View style={styles.mobileBackdropContainer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close messages backdrop"
            style={[styles.backdropPressable, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(7, 19, 31, 0.45)' }]}
            onPress={safeClose}
          />
          <View
            pointerEvents="box-none"
            style={[
              styles.mobileCenterWrap,
              {
                paddingTop: topMargin,
                paddingBottom: bottomMargin,
              },
            ]}
          >
            <View
              style={[
                styles.mobileAnchor,
                {
                  width: mobileWidth,
                  height: mobileHeight,
                },
              ]}
            >
              <PanelSurface mobile onClose={safeClose} />
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const portalRight = ['requester', 'distributor'].includes(role) ? Math.max(22, (width - 480) / 2 + 22) : 28;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[styles.desktopAnchor, { right: portalRight, height: Math.min(720, height - 44) }]}>
        <PanelSurface onClose={safeClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, overflow: 'hidden' },
  keyboardArea: { flex: 1 },
  desktopPanel: { borderWidth: 1, borderRadius: 22, shadowColor: '#07131F', shadowOpacity: 0.24, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 18 },
  mobilePanel: { borderWidth: 1, borderRadius: 20, shadowColor: '#07131F', shadowOpacity: 0.24, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 16 },
  desktopAnchor: { position: 'absolute', bottom: 22, width: 410, maxWidth: '92%', zIndex: 100 },
  mobileBackdropContainer: { flex: 1, position: 'relative' },
  backdropPressable: { ...StyleSheet.absoluteFillObject },
  mobileCenterWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mobileAnchor: { zIndex: 10, overflow: 'hidden' },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  iconBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 17, fontWeight: '950' },
  subheading: { fontSize: 11, marginTop: 2 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  closeText: { fontSize: 28, lineHeight: 30 },
});
