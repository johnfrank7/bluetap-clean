import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useChat } from './ChatContext';
import ChatComposer from './ChatComposer';
import ChatMessageBubble from './ChatMessageBubble';
import chatModel from './chatModel';
import ChatOrderContextCard from './ChatOrderContextCard';
import ChatReportDialog from './ChatReportDialog';
import RequestDetailsModal from '../RequestDetailsModal';
import { useCurrentPageRequestDetails } from '../useCurrentPageRequestDetails';

export default function ChatConversationView() {
  const {
    backToList, closeChat, colors, isDark, currentConversation, hasEarlierMessages, loadEarlierMessages,
    loadingEarlier, threadLoading, messages, retryMessage, role, sendCurrentMessage, threadError,
    messageActionError,
    isOwnMessage, receiptForMessage, canSend, sendUnavailableReason, conversationNotice,
    editCurrentMessage, deleteCurrentMessage,
  } = useChat();
  const [reportTarget, setReportTarget] = React.useState(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState(null);
  const [editBody, setEditBody] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [mutationBusy, setMutationBusy] = React.useState(false);
  const {
    selectedRequest,
    requestDetailsVisible,
    openRequestDetails,
    closeRequestDetails,
  } = useCurrentPageRequestDetails();
  const [replyTarget, setReplyTarget] = React.useState(null);
  const [activeMessageMenu, setActiveMessageMenu] = React.useState(null);
  const rootRef = React.useRef(null);
  const messageMenuRef = React.useRef(null);
  const menuRequestRef = React.useRef(0);
  const scrollRef = React.useRef(null);
  const didInitialScroll = React.useRef(false);
  const isNearBottomRef = React.useRef(true);
  const prevMessagesLengthRef = React.useRef(messages.length);
  const reportingAllowed = (
    (['requester', 'distributor'].includes(role) && currentConversation?.type === 'requester_distributor') ||
    (role === 'manager' && ['requester_branch', 'distributor_branch'].includes(currentConversation?.type))
  );

  React.useEffect(() => {
    setReplyTarget(null);
    menuRequestRef.current += 1;
    setActiveMessageMenu(null);
    didInitialScroll.current = false;
    isNearBottomRef.current = true;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: false }), 40);
    return () => clearTimeout(timer);
  }, [currentConversation?.id, currentConversation?.historyId]);

  const closeMessageMenu = React.useCallback(() => {
    menuRequestRef.current += 1;
    setActiveMessageMenu(null);
  }, []);

  const toggleDesktopMessageMenu = React.useCallback(({ message, actions, own, anchorRef, onChoose }) => {
    if (activeMessageMenu?.id === message.id) {
      closeMessageMenu();
      return;
    }
    const request = ++menuRequestRef.current;
    anchorRef.current?.measureInWindow?.((x, y, width, height) => {
      scrollRef.current?.measureInWindow?.((scrollX, scrollY, scrollWidth, scrollHeight) => {
        rootRef.current?.measureInWindow?.((rootX, rootY) => {
          if (request !== menuRequestRef.current) return;
          const position = chatModel.positionMessageMenu({
            anchor: { x, y, width, height },
            viewport: { x: scrollX, y: scrollY, width: scrollWidth, height: scrollHeight },
            root: { x: rootX, y: rootY },
            own,
            actionCount: actions.length,
          });
          setActiveMessageMenu({ id: message.id, actions, onChoose, anchorRef, position });
        });
      });
    });
  }, [activeMessageMenu?.id, closeMessageMenu]);

  React.useEffect(() => {
    if (!activeMessageMenu || typeof document === 'undefined') return undefined;
    const closeOutside = (event) => {
      const target = event.target;
      if (messageMenuRef.current?.contains?.(target) || activeMessageMenu.anchorRef.current?.contains?.(target)) return;
      closeMessageMenu();
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') closeMessageMenu(); };
    const closeOnResize = () => closeMessageMenu();
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [activeMessageMenu, closeMessageMenu]);

  React.useEffect(() => {
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messages.length;
    if (messages.length !== prevLen && activeMessageMenu) closeMessageMenu();
    if (messages.length > prevLen) {
      const latest = messages[messages.length - 1];
      if (latest && (isOwnMessage(latest) || isNearBottomRef.current)) {
        scrollRef.current?.scrollToEnd?.({ animated: true });
      }
    }
  }, [activeMessageMenu, closeMessageMenu, isOwnMessage, messages]);

  const replySenderName = replyTarget
    ? (isOwnMessage(replyTarget) ? 'yourself' : (replyTarget.senderRole === 'manager' ? (currentConversation.branchDisplayName || 'Station') : (currentConversation.displayName || 'User')))
    : '';
  const replySnippet = replyTarget
    ? (replyTarget.deletedAt ? 'Message deleted' : String(replyTarget.body || '').slice(0, 140).trim())
    : '';

  if (!currentConversation) return null;
  return (
    <View ref={rootRef} style={styles.root}>
      {headerMenuOpen && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close conversation options"
          onPress={() => setHeaderMenuOpen(false)}
          style={styles.headerMenuBackdrop}
        />
      )}
      <View style={[styles.threadHeader, { borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to conversations" onPress={backToList} style={styles.back}><Text style={[styles.backText, { color: colors.primary }]}>{'<'}</Text></Pressable>
        <View style={[styles.headerAvatar, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}><Text style={[styles.headerAvatarText, { color: colors.primary }]}>{currentConversation.avatarLabel || 'BT'}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>{currentConversation.displayName}</Text><Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>{currentConversation.contextLabel}</Text></View>
        {reportingAllowed && <View style={styles.headerMenuWrap}><Pressable accessibilityRole="button" accessibilityLabel="Conversation options" onPress={() => setHeaderMenuOpen((open) => !open)} style={styles.headerMenuButton}><Text style={[styles.headerMenuGlyph, { color: colors.textPrimary }]}>{'\u22EE'}</Text></Pressable>{headerMenuOpen && <View style={[styles.headerMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}><Pressable accessibilityRole="button" accessibilityLabel="Report user" onPress={() => { setHeaderMenuOpen(false); setReportTarget({ type: 'user' }); }} style={styles.headerMenuItem}><Text style={[styles.reportUserText, { color: colors.danger }]}>Report user</Text></Pressable></View>}</View>}
        <Pressable accessibilityRole="button" accessibilityLabel="Close messages" onPress={closeChat} style={styles.close}><Text style={[styles.closeText, { color: colors.textPrimary }]}>x</Text></Pressable>
      </View>
      <ChatOrderContextCard order={currentConversation.orderContextLocal} colors={colors} role={role} onViewDetails={openRequestDetails} generalInquiry={currentConversation.type === 'requester_branch' && !currentConversation.orderContextLocal} />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        style={styles.messagesScroll}
        contentContainerStyle={styles.messages}
        scrollEventThrottle={32}
        onScroll={(event) => {
          if (activeMessageMenu) closeMessageMenu();
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          const paddingToBottom = 90;
          isNearBottomRef.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
        }}
        onContentSizeChange={() => {
          if (!didInitialScroll.current && messages.length > 0) {
            didInitialScroll.current = true;
            scrollRef.current?.scrollToEnd?.({ animated: false });
          } else if (isNearBottomRef.current) {
            scrollRef.current?.scrollToEnd?.({ animated: true });
          }
        }}
      >
        {hasEarlierMessages && (
          <Pressable accessibilityRole="button" accessibilityLabel="Load earlier messages" disabled={loadingEarlier} onPress={loadEarlierMessages} style={styles.earlier}>
            {loadingEarlier ? <ActivityIndicator color={colors.primary} /> : <Text style={[styles.earlierText, { color: colors.primary }]}>Load earlier messages</Text>}
          </Pressable>
        )}
        {threadLoading && messages.length === 0 ? (
          <View style={styles.threadSkeletonContainer} accessibilityLabel="Loading conversation messages">
            <View style={[styles.skeletonBubble, styles.skeletonBubbleIncoming, { backgroundColor: isDark ? (colors.surfaceAlt || '#1e293b') : '#E2E8F0' }]} />
            <View style={[styles.skeletonBubble, styles.skeletonBubbleOutgoing, { backgroundColor: isDark ? (colors.surfaceAlt || '#1e293b') : '#DBEAFE' }]} />
            <View style={[styles.skeletonBubble, styles.skeletonBubbleIncoming, { width: '55%', backgroundColor: isDark ? (colors.surfaceAlt || '#1e293b') : '#E2E8F0' }]} />
          </View>
        ) : messages.length === 0 && !threadError ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>Start a secure BlueTap conversation.</Text>
        ) : null}
        {!!threadError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{threadError}</Text>}
        {!!messageActionError && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{messageActionError}</Text>}
        {messages.map((message) => (
          <ChatMessageBubble
            key={message.id || `pending-${message.clientMutationId}`}
            message={message}
            own={isOwnMessage(message)}
            receipt={receiptForMessage(message)}
            colors={colors}
            onRetry={retryMessage}
            onReport={reportingAllowed ? (item) => setReportTarget({ type: 'message', message: item }) : undefined}
            onEdit={currentConversation.historyId ? undefined : (item) => { setEditTarget(item); setEditBody(item.body || ''); }}
            onDelete={currentConversation.historyId ? undefined : setDeleteTarget}
            onReply={canSend ? (item) => setReplyTarget(item) : undefined}
            desktopMenuOpen={activeMessageMenu?.id === message.id}
            onToggleDesktopMenu={toggleDesktopMessageMenu}
          />
        ))}
      </ScrollView>
      {!!conversationNotice && <View style={[styles.lifecycleNotice, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}><Text style={[styles.lifecycleTitle, { color: colors.textPrimary }]}>{conversationNotice.title}</Text><Text style={[styles.lifecycleBody, { color: colors.textSecondary }]}>{conversationNotice.body}</Text></View>}
      {replyTarget && (
        <View style={[styles.replyPreviewBar, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <View style={[styles.replyPreviewAccent, { backgroundColor: colors.primary }]} />
          <View style={styles.replyPreviewContent}>
            <Text style={[styles.replyPreviewHeading, { color: colors.primary }]} numberOfLines={1}>
              Replying to {replySenderName}
            </Text>
            <Text style={[styles.replyPreviewText, { color: colors.textSecondary }]} numberOfLines={1}>
              "{replySnippet}"
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={() => setReplyTarget(null)}
            style={styles.replyCancelButton}
          >
            <Text style={[styles.replyCancelText, { color: colors.textSecondary }]}>✕</Text>
          </Pressable>
        </View>
      )}
      {canSend ? (
        <ChatComposer
          colors={colors}
          onSend={async (body) => {
            const currentReply = replyTarget;
            setReplyTarget(null);
            isNearBottomRef.current = true;
            scrollRef.current?.scrollToEnd?.({ animated: true });
            await sendCurrentMessage(body, currentReply ? {
              replyToMessageId: currentReply.id,
              replyTo: {
                messageId: currentReply.id,
                seq: currentReply.seq,
                senderDisplayName: replySenderName,
                snippet: replySnippet,
              },
            } : {});
          }}
        />
      ) : !threadError && !conversationNotice && <Text style={[styles.readOnly, { color: colors.textSecondary, backgroundColor: colors.surfaceAlt }]}>{sendUnavailableReason || 'Sending is unavailable for this conversation.'}</Text>}
      {activeMessageMenu && (
        <View pointerEvents="box-none" style={styles.messageMenuLayer}>
          <View ref={messageMenuRef} style={[styles.messageMenu, activeMessageMenu.position, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: activeMessageMenu.position.maxHeight }}>
              {activeMessageMenu.actions.map((action) => (
                <Pressable
                  key={action}
                  accessibilityRole="button"
                  accessibilityLabel={`${action} message`}
                  onPress={(event) => {
                    event?.stopPropagation?.();
                    const choose = activeMessageMenu.onChoose;
                    closeMessageMenu();
                    choose(action);
                  }}
                  style={styles.messageMenuItem}
                >
                  <Text style={[styles.messageMenuText, { color: action === 'Delete' || action === 'Report' ? colors.danger : colors.textPrimary }]}>{action === 'Report' ? 'Report this message' : action}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
      <ChatReportDialog visible={!!reportTarget} conversation={currentConversation} message={reportTarget?.message} colors={colors} onClose={() => setReportTarget(null)} />
      <RequestDetailsModal visible={requestDetailsVisible} request={selectedRequest} branches={[]} onClose={closeRequestDetails} />
      <Modal visible={!!editTarget} transparent animationType="fade" onRequestClose={() => setEditTarget(null)}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Edit message</Text><TextInput accessibilityLabel="Edited message" value={editBody} onChangeText={setEditBody} maxLength={2000} multiline style={[styles.editInput, { color: colors.textPrimary, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} /><View style={styles.modalActions}><Pressable onPress={() => setEditTarget(null)} style={[styles.secondary, { borderColor: colors.border }]}><Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Cancel</Text></Pressable><Pressable disabled={mutationBusy || !editBody.trim()} onPress={async () => { setMutationBusy(true); try { await editCurrentMessage(editTarget, editBody); setEditTarget(null); } catch {} finally { setMutationBusy(false); } }} style={[styles.primary, { backgroundColor: colors.primaryAction, opacity: mutationBusy ? .6 : 1 }]}><Text style={styles.primaryText}>Save edit</Text></Pressable></View></View></View></Modal>
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Delete this message?</Text><Text style={[styles.modalCopy, { color: colors.textSecondary }]}>The message will become a tombstone. Protected revision and report evidence records are preserved.</Text><View style={styles.modalActions}><Pressable onPress={() => setDeleteTarget(null)} style={[styles.secondary, { borderColor: colors.border }]}><Text style={{ color: colors.textPrimary, fontWeight: '800' }}>Cancel</Text></Pressable><Pressable disabled={mutationBusy} onPress={async () => { setMutationBusy(true); try { await deleteCurrentMessage(deleteTarget); setDeleteTarget(null); } catch {} finally { setMutationBusy(false); } }} style={[styles.primary, { backgroundColor: colors.danger, opacity: mutationBusy ? .6 : 1 }]}><Text style={styles.primaryText}>Delete message</Text></Pressable></View></View></View></Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  messageMenuLayer: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
  messageMenu: { position: 'absolute', borderWidth: 1, borderRadius: 10, overflow: 'hidden', shadowColor: '#000', shadowOpacity: .18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 50 },
  messageMenuItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  messageMenuText: { fontSize: 12, fontWeight: '800' },
  headerMenuBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 25 },
  threadHeader: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, position: 'relative', zIndex: 30, elevation: 30 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 34, fontWeight: '500' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 9, flexShrink: 0 },
  headerAvatarText: { fontSize: 11, fontWeight: '950', letterSpacing: 0.3 },
  title: { fontSize: 15, fontWeight: '900' },
  subtitle: { fontSize: 11, marginTop: 2 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 26, lineHeight: 28 },
  headerMenuWrap: { position: 'relative', zIndex: 40 },
  headerMenuButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerMenuGlyph: { fontSize: 23, fontWeight: '900' },
  headerMenu: { position: 'absolute', right: 4, top: 46, minWidth: 140, borderWidth: 1, borderRadius: 10, zIndex: 100, elevation: 24, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  headerMenuItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13 },
  reportUserText: { fontSize: 11, fontWeight: '900' },
  messagesScroll: { flex: 1, minHeight: 0 },
  messages: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16 },
  earlier: { minHeight: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  earlierText: { fontSize: 12, fontWeight: '900' },
  empty: { textAlign: 'center', fontSize: 12, marginVertical: 24 },
  error: { textAlign: 'center', fontSize: 12, marginVertical: 10 },
  readOnly: { textAlign: 'center', paddingVertical: 7, fontSize: 11, fontWeight: '700' },
  lifecycleNotice: { marginHorizontal: 12, marginBottom: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  lifecycleTitle: { fontSize: 12, fontWeight: '900' },
  lifecycleBody: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  modalBackdrop: { flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(5,20,32,.62)' }, modalCard: { width: '100%', maxWidth: 460, borderWidth: 1, borderRadius: 16, padding: 20 }, modalTitle: { fontSize: 19, fontWeight: '900' }, modalCopy: { fontSize: 13, lineHeight: 20, marginTop: 8 }, editInput: { minHeight: 100, marginTop: 14, borderWidth: 1, borderRadius: 10, padding: 11, textAlignVertical: 'top' }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 9, marginTop: 16 }, secondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1, borderRadius: 10 }, primary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 }, primaryText: { color: '#FFFFFF', fontWeight: '900' },
  replyPreviewBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  replyPreviewAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginRight: 10 },
  replyPreviewContent: { flex: 1, minWidth: 0 },
  replyPreviewHeading: { fontSize: 11, fontWeight: '800', marginBottom: 2 },
  replyPreviewText: { fontSize: 12, lineHeight: 16 },
  replyCancelButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  replyCancelText: { fontSize: 14, fontWeight: '900' },
  threadSkeletonContainer: { paddingVertical: 14, paddingHorizontal: 6, gap: 10 },
  skeletonBubble: { height: 38, borderRadius: 16, opacity: 0.6 },
  skeletonBubbleIncoming: { width: '68%', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  skeletonBubbleOutgoing: { width: '60%', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
});
