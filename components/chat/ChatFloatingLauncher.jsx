import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';

import { USER_PORTAL_LAYOUT } from '../../constants/userPortalLayout';
import BlueTapChatIcon from './BlueTapChatIcon';
import { useChat } from './ChatContext';
import ChatPanel from './ChatPanel';

export default function ChatFloatingLauncher() {
  const { colors, openChat, panelOpen, role, totalUnread, totalUnreadLabel } = useChat();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  if (role === 'admin') return null;
  const isAssistantRoute = pathname === '/requester/bluetap_AI' || pathname?.includes('bluetap_AI');
  const portalRole = role === 'requester' || role === 'distributor';
  const right = portalRole ? Math.max(18, (width - USER_PORTAL_LAYOUT.maxWidth) / 2 + 18) : 24;
  const bottom = portalRole
    ? USER_PORTAL_LAYOUT.navBottomOffset + USER_PORTAL_LAYOUT.navHeight + insets.bottom + 18
    : 24 + insets.bottom;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {!panelOpen && !isAssistantRoute && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open BlueTap messages${totalUnread ? `, ${totalUnread} unread` : ''}`}
          onPress={openChat}
          style={({ pressed, hovered, focused }) => [
            styles.launcher,
            { right, bottom, backgroundColor: colors.primaryAction, borderColor: colors.onPrimary },
            hovered && styles.hovered,
            focused && styles.focused,
            pressed && styles.pressed,
          ]}
        >
          <BlueTapChatIcon size={24} />
          {totalUnread > 0 && <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.surface }]}><Text style={styles.badgeText}>{totalUnreadLabel}</Text></View>}
        </Pressable>
      )}
      <ChatPanel />
    </View>
  );
}

const styles = StyleSheet.create({
  launcher: { position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 90, shadowColor: '#07131F', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  hovered: { opacity: 0.94 },
  focused: { borderWidth: 3 },
  pressed: { opacity: 0.82 },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 23, height: 23, paddingHorizontal: 5, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
});
