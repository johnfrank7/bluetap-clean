import React from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import ChatReceipt from './ChatReceipt';
import chatModel from './chatModel';

const { timeOf } = chatModel;
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

const finePointerMatches = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(FINE_POINTER_QUERY).matches;

const useFinePointer = () => {
  const [matches, setMatches] = React.useState(finePointerMatches);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(FINE_POINTER_QUERY);
    const update = (event) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
    } else {
      mediaQuery.addListener?.(update);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', update);
      } else {
        mediaQuery.removeListener?.(update);
      }
    };
  }, []);

  return matches;
};

const formatTime = (value) => {
  const timestamp = timeOf(value);
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function ChatMessageBubble({ message, own, receipt, colors, onRetry, onReport, onEdit, onDelete, onReply }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const groupRef = React.useRef(null);
  const finePointer = useFinePointer();
  const useActionSheet = Platform.OS !== 'web' || !finePointer;
  const deleted = Boolean(message.deletedAt);
  const withinWindow = Boolean(message.id) && !deleted && Date.now() - timeOf(message.createdAt) <= 15 * 60 * 1000;
  const reportable = !own && Boolean(message.id && onReport && !deleted);
  const replyable = Boolean(onReply && message.id && !deleted);
  const actions = chatModel.messageActionNames({ own, withinWindow, reportable, replyable });
  const hasOptions = actions.length > 0;
  const buttonVisible = chatModel.messageActionTriggerVisible({ hovered, focused, menuOpen });
  const failure = chatModel.messageFailurePresentation(message.errorCode);

  React.useEffect(() => {
    if (!menuOpen || useActionSheet || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const closeOutside = (event) => {
      const node = groupRef.current;
      const eventPath = event.composedPath?.() || [];
      if (!eventPath.includes(node) && !node?.contains?.(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen, useActionSheet]);

  const chooseAction = (action) => {
    setMenuOpen(false);
    if (action === 'Reply') onReply?.(message);
    else if (action === 'Edit') onEdit?.(message);
    else if (action === 'Delete') onDelete?.(message);
    else if (action === 'Report') onReport?.(message);
  };

  const desktopControl = !useActionSheet && hasOptions ? (
    <View style={styles.actionSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="More message actions"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={() => setMenuOpen((open) => !open)}
        pointerEvents={buttonVisible ? 'auto' : 'none'}
        style={[styles.menuButton, !buttonVisible && styles.menuButtonHidden]}
      >
        <Text style={[styles.menuGlyph, { color: colors.textSecondary }]}>{'\u2022\u2022\u2022'}</Text>
      </Pressable>
      {menuOpen && (
        <View style={[styles.menu, own ? styles.outgoingMenu : styles.incomingMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {actions.map((action) => (
            <Pressable key={action} accessibilityRole="button" accessibilityLabel={`${action} message`} onPress={() => chooseAction(action)} style={styles.menuItem}>
              <Text style={[styles.menuText, { color: action === 'Edit' ? colors.textPrimary : colors.danger }]}>{action === 'Report' ? 'Report this message' : action}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  ) : null;

  const panX = React.useRef(new Animated.Value(0)).current;
  const isSwipingRef = React.useRef(false);

  const panResponder = React.useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (!replyable || !onReply) return false;
        const { dx, dy } = gestureState;
        const isHorizontal = Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;
        if (isHorizontal) {
          isSwipingRef.current = true;
          return true;
        }
        return false;
      },
      onPanResponderMove: (_, gestureState) => {
        const { dx } = gestureState;
        let clampedDx = 0;
        if (!own) {
          clampedDx = Math.max(0, Math.min(dx, 68));
        } else {
          if (dx < 0) {
            clampedDx = Math.max(-68, Math.min(0, dx));
          } else {
            clampedDx = Math.max(0, Math.min(dx, 68));
          }
        }
        panX.setValue(clampedDx);
      },
      onPanResponderRelease: (_, gestureState) => {
        const { dx } = gestureState;
        const SWIPE_THRESHOLD = 48;
        const triggered = (!own && dx >= SWIPE_THRESHOLD) || (own && Math.abs(dx) >= SWIPE_THRESHOLD);
        if (triggered && onReply && replyable) {
          onReply(message);
        }
        isSwipingRef.current = false;
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: false,
          friction: 7,
          tension: 80,
        }).start();
      },
      onPanResponderTerminate: () => {
        isSwipingRef.current = false;
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: false,
          friction: 7,
          tension: 80,
        }).start();
      },
    });
  }, [message, onReply, own, replyable, panX]);

  const replyOpacity = panX.interpolate({
    inputRange: [-48, -20, 0, 20, 48],
    outputRange: [1, 0.4, 0, 0.4, 1],
    extrapolate: 'clamp',
  });
  const replyScale = panX.interpolate({
    inputRange: [-48, -20, 0, 20, 48],
    outputRange: [1, 0.8, 0.6, 0.8, 1],
    extrapolate: 'clamp',
  });

  return (
    <View
      ref={groupRef}
      onMouseEnter={Platform.OS === 'web' ? () => setHovered(true) : undefined}
      onMouseLeave={Platform.OS === 'web' ? () => setHovered(false) : undefined}
      style={[styles.row, own ? styles.outgoingRow : styles.incomingRow]}
    >
      <View style={[styles.messageGroup, own ? styles.outgoingGroup : styles.incomingGroup]}>
        {own && desktopControl}
        <View style={styles.bubbleContainer} {...panResponder.panHandlers}>
          {replyable && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.replyAffordance,
                own ? styles.replyAffordanceRight : styles.replyAffordanceLeft,
                {
                  opacity: replyOpacity,
                  transform: [{ scale: replyScale }],
                },
              ]}
            >
              <View style={[styles.replyIconCircle, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.replyIconText, { color: colors.primary }]}>{'\u21A9'}</Text>
              </View>
            </Animated.View>
          )}
          <Animated.View style={{ transform: [{ translateX: panX }] }}>
            <Pressable
              accessibilityRole="text"
              accessibilityActions={hasOptions ? [{ name: 'activate', label: 'More message actions' }] : undefined}
              onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'activate' && hasOptions) setMenuOpen(true); }}
              delayLongPress={500}
              onLongPress={useActionSheet && hasOptions ? () => setMenuOpen(true) : undefined}
              onContextMenu={useActionSheet && hasOptions ? (event) => { event?.preventDefault?.(); setMenuOpen(true); } : undefined}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[
                styles.bubble,
                own ? { backgroundColor: colors.primaryAction } : { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 },
              ]}
            >
              {message.replyTo && (
                <View style={[styles.replyQuote, {
                  backgroundColor: own ? 'rgba(0,0,0,0.18)' : (colors.surface || '#FFFFFF'),
                  borderLeftColor: own ? '#FFFFFF' : (colors.primary || '#187BCD'),
                }]}>
                  <Text style={[styles.replySender, { color: own ? '#FFFFFF' : (colors.primary || '#187BCD') }]} numberOfLines={1}>
                    {message.replyTo.senderDisplayName || 'User'}
                  </Text>
                  <Text style={[styles.replySnippet, { color: own ? 'rgba(255,255,255,0.88)' : (colors.textSecondary || '#6F8EA8') }]} numberOfLines={2}>
                    {message.replyTo.snippet === 'Message deleted' ? 'Deleted message' : message.replyTo.snippet}
                  </Text>
                </View>
              )}
              <Text style={[styles.body, deleted && styles.deleted, { color: own ? colors.onPrimary : colors.textPrimary }]}>{deleted ? 'Message deleted' : message.body}</Text>
              <View style={styles.meta}>
                {!!message.editedAt && !deleted && <Text style={[styles.time, { color: own ? 'rgba(255,255,255,0.78)' : colors.textSecondary }]}>{'Edited \u00B7'}</Text>}
                <Text style={[styles.time, { color: own ? 'rgba(255,255,255,0.78)' : colors.textSecondary }]}>{formatTime(message.createdAt)}</Text>
                {own && <ChatReceipt state={receipt} color={receipt === 'failed' ? colors.onPrimary : 'rgba(255,255,255,0.88)'} />}
              </View>
              {message.failed && (failure.retryable
                ? <Pressable accessibilityRole="button" accessibilityLabel="Retry sending message" onPress={() => onRetry?.(message)}><Text style={[styles.retry, { color: colors.onPrimary }]}>{failure.label}</Text></Pressable>
                : <Text accessibilityRole="alert" style={[styles.failure, { color: colors.onPrimary }]}>{failure.label}</Text>)}
            </Pressable>
          </Animated.View>
        </View>
        {!own && desktopControl}
      </View>
      <Modal visible={useActionSheet && menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel message actions" onPress={() => setMenuOpen(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Message actions</Text>
            {actions.map((action) => (
              <Pressable key={action} accessibilityRole="button" accessibilityLabel={`${action} message`} onPress={() => chooseAction(action)} style={[styles.sheetAction, { borderTopColor: colors.border }]}>
                <Text style={[styles.sheetActionText, { color: action === 'Report' ? colors.danger : (action === 'Delete' ? colors.danger : colors.textPrimary) }]}>
                  {action === 'Report' ? 'Report this message' : action}
                </Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setMenuOpen(false)} style={[styles.sheetAction, { borderTopColor: colors.border }]}><Text style={[styles.sheetActionText, { color: colors.textSecondary }]}>Cancel</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: '100%', marginVertical: 4 },
  outgoingRow: { alignItems: 'flex-end' },
  incomingRow: { alignItems: 'flex-start' },
  messageGroup: { maxWidth: '92%', minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  outgoingGroup: { justifyContent: 'flex-end' },
  incomingGroup: { justifyContent: 'flex-start' },
  bubbleContainer: {
    position: 'relative',
    maxWidth: '100%',
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  replyAffordance: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAffordanceLeft: {
    left: 4,
  },
  replyAffordanceRight: {
    right: 4,
  },
  replyIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  replyIconText: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 18,
  },
  bubble: {
    maxWidth: '100%',
    minWidth: 72,
    flexShrink: 1,
    borderRadius: 17,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    ...Platform.select({
      web: {
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      },
      default: {},
    }),
  },
  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  replySender: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 1,
  },
  replySnippet: {
    fontSize: 12,
    lineHeight: 16,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    ...Platform.select({
      web: {
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      },
      default: {},
    }),
  },
  deleted: { fontStyle: 'italic', opacity: .78 },
  actionSlot: { width: 34, height: 34, flexShrink: 0, position: 'relative', alignItems: 'center', justifyContent: 'center' },
  menuButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  menuButtonHidden: { opacity: 0 },
  menuGlyph: { fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  menu: { position: 'absolute', top: 32, minWidth: 144, borderWidth: 1, borderRadius: 10, zIndex: 20, paddingVertical: 4, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 8, elevation: 8 },
  outgoingMenu: { right: 0 },
  incomingMenu: { left: 0 },
  menuItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  menuText: { fontSize: 12, fontWeight: '800' },
  meta: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end', alignSelf: 'stretch', gap: 4, marginTop: 3 },
  time: { flexShrink: 0, fontSize: 10, lineHeight: 13, fontWeight: '600' },
  retry: { fontSize: 11, fontWeight: '800', marginTop: 5, textDecorationLine: 'underline' },
  failure: { fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 5 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,20,32,.55)' },
  sheet: { width: '100%', borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 18 },
  sheetTitle: { paddingHorizontal: 18, paddingVertical: 16, fontSize: 15, fontWeight: '900' },
  sheetAction: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center', paddingHorizontal: 18 },
  sheetActionText: { fontSize: 15, fontWeight: '800' },
});
