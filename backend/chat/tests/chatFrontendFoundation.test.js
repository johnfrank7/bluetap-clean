const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const model = require('../../../components/chat/chatModel');
const { chatAccessReadiness } = require('../../../components/chat/chatAccessReadiness');
const { counterpartRoleLabel } = require('../../../components/chat/chatPresentation');
const { getRolePresentation, ROLE_THEME_TOKENS } = require('../../../constants/rolePresentation');

test('user and Manager branch unread totals use logical principal state', () => {
  const conversations = [{ participantState: [
    { principalType: 'user', principalId: 'requester-a', unreadCount: 2 },
    { principalType: 'branch', principalId: 'branch-a', unreadCount: 3 },
  ] }];
  assert.equal(model.totalUnread(conversations, 'requester', 'requester-a', ''), 2);
  assert.equal(model.totalUnread(conversations, 'manager', 'manager-a', 'branch-a'), 3);
  assert.equal(model.formatBadge(0), '0');
  assert.equal(model.formatBadge(99), '99');
  assert.equal(model.formatBadge(100), '99+');
});

test('receipt semantics move from pending to sent to seen', () => {
  const conversation = { participantState: [
    { principalType: 'user', principalId: 'requester-a', lastReadSeq: 8 },
    { principalType: 'user', principalId: 'distributor-a', lastReadSeq: 6 },
  ] };
  const message = { seq: 7, senderUid: 'requester-a' };
  assert.equal(model.receiptFor({ ...message, pending: true }, conversation, 'requester', 'requester-a', ''), 'pending');
  assert.equal(model.receiptFor(message, conversation, 'requester', 'requester-a', ''), 'sent');
  conversation.participantState[1].lastReadSeq = 7;
  assert.equal(model.receiptFor(message, conversation, 'requester', 'requester-a', ''), 'seen');
});

test('optimistic reconciliation deduplicates the committed mutation', () => {
  const optimistic = { clientMutationId: 'same-id', senderUid: 'requester-a', body: 'Hello', pending: true };
  const committed = { id: 'message-a', seq: 2, clientMutationId: 'same-id', senderUid: 'requester-a', body: 'Hello' };
  const merged = model.mergeMessages([optimistic], [committed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'message-a');
  assert.equal(merged[0].pending, false);
});

test('send context uses only server-authorized order metadata and ignores local presentation state', () => {
  const provider = read('components/chat/ChatDataProvider.jsx');
  assert.equal(model.sendContextOrderId({
    type: 'requester_branch',
    authorityReasons: { active_order: { orderIds: ['order-a'] } },
    orderContext: { id: 'order-a' },
    orderContextLocal: { id: 'stale-local-order' },
  }), 'order-a');
  assert.equal(model.sendContextOrderId({
    type: 'requester_branch',
    authorityReasons: { requester_inquiry: { active: true } },
    orderContextLocal: { id: 'stale-local-order' },
  }), '');
  assert.equal(model.sendContextOrderId({ type: 'requester_distributor', orderId: 'order-a' }), 'order-a');
  assert.equal(model.sendContextOrderId({ type: 'distributor_branch', orderContextLocal: { id: 'order-a' } }), '');
  assert.match(provider, /orderId: sendContextOrderId\(currentConversation\)/);
  assert.doesNotMatch(provider, /orderId: orderIdOf\(currentConversation\.orderContextLocal\)/);
});

test('summary listeners are role scoped and bounded to fifty', () => {
  const source = read('services/chatRealtime.js');
  assert.match(source, /role === 'manager'[\s\S]*participantBranchIds/);
  assert.match(source, /\['requester', 'distributor'\][\s\S]*participantUserUids/);
  assert.match(source, /CHAT_SUMMARY_LIMIT = 50/);
  assert.match(source, /chatBranchActivity.*chatUserActivity/);
  assert.match(read('backend/chat/chatHandler.js'), /orderBy\('updatedAt', 'desc'\).limit\(50\)/);
});

test('one visible open thread listener is bounded to forty and cleaned up on change', () => {
  const realtime = read('services/chatRealtime.js');
  const provider = read('components/chat/ChatDataProvider.jsx');
  assert.match(realtime, /CHAT_REALTIME_MESSAGE_LIMIT = 40/);
  assert.match(realtime, /orderBy\('seq', 'desc'\)[\s\S]*limit\(CHAT_REALTIME_MESSAGE_LIMIT\)/);
  assert.match(provider, /threadUnsubscribeRef\.current\?\.\(\)/);
  assert.match(provider, /if \(!panelOpen \|\| !currentConversation\?\.id \|\| accessReadiness !== 'ready' \|\| !availability.readable\) return undefined/);
  assert.match(provider, /threadVersion/);
});

test('chat listeners distinguish identity hydration from verified access denial', () => {
  assert.equal(chatAccessReadiness({ authReady: false, role: 'requester', uid: '' }), 'pending');
  assert.equal(chatAccessReadiness({ authReady: true, role: 'requester', uid: 'requester-a' }), 'ready');
  assert.equal(chatAccessReadiness({ authReady: true, role: 'distributor', uid: 'distributor-a', roleData: { profileLoading: true } }), 'pending');
  assert.equal(chatAccessReadiness({
    authReady: true,
    role: 'distributor',
    uid: 'distributor-a',
    roleData: { profileLoading: false, profile: { uid: 'distributor-a', role: 'distributor', distributorStatus: 'active', branchId: 'branch-a' } },
  }), 'ready');
  assert.equal(chatAccessReadiness({
    authReady: true,
    role: 'distributor',
    uid: 'distributor-a',
    roleData: { profileLoading: false, profile: { uid: 'distributor-a', role: 'distributor', accountStatus: 'suspended', distributorStatus: 'active', branchId: 'branch-a' } },
  }), 'denied');
  assert.equal(chatAccessReadiness({
    authReady: true,
    branchId: 'branch-a',
    role: 'manager',
    uid: 'manager-a',
    roleData: { profileLoading: true, branchLoading: true },
  }), 'pending');
  assert.equal(chatAccessReadiness({
    authReady: true,
    branchId: 'branch-a',
    role: 'manager',
    uid: 'manager-a',
    roleData: {
      profileLoading: false,
      branchLoading: false,
      profile: { uid: 'manager-a', role: 'manager', managerStatus: 'active', branchId: 'branch-a' },
      branch: { id: 'branch-a', status: 'active' },
    },
  }), 'ready');
});

test('conversation resolution clears stale thread state and localizes resolve errors', () => {
  const provider = read('components/chat/ChatDataProvider.jsx');
  const list = read('components/chat/ChatConversationList.jsx');
  assert.match(provider, /setSelectedSeed\(null\)[\s\S]*resolveConversation\(intent\)/);
  assert.match(provider, /setResolveError\('Unable to open conversation\. Please try again\.'\)/);
  assert.doesNotMatch(provider, /catch \(resolveError\) \{[\s\S]{0,160}setThreadError/);
  assert.match(list, /resolveError/);
});

test('read state advances only after a visible thread presents incoming messages', () => {
  const provider = read('components/chat/ChatDataProvider.jsx');
  assert.match(provider, /if \(!panelOpen \|\| !currentConversation\?\.id \|\| messages\.length === 0 \|\| accessReadiness !== 'ready' \|\| !availability\.readable\)/);
  assert.match(provider, /incoming = messages\.filter/);
  assert.match(provider, /markRead\(\{ conversationId: currentConversation\.id, lastReadSeq: newestIncomingSeq \}\)/);
});

test('retry preserves the original client mutation identifier', () => {
  const provider = read('components/chat/ChatDataProvider.jsx');
  assert.match(provider, /const retry = \{ \.\.\.message, pending: true, failed: false \}/);
  assert.match(provider, /clientMutationId: optimistic\.clientMutationId/);
});

test('operational layouts mount chat while Admin stays excluded', () => {
  for (const role of ['requester', 'distributor', 'manager']) {
    assert.match(read(`app/${role}/_layout.jsx`), new RegExp(`ChatDataProvider role="${role}"`));
  }
  assert.doesNotMatch(read('app/admin/_layout.jsx'), /ChatDataProvider|ChatFloatingLauncher/);
});

test('chat role badges reuse Accounts and Audit role colors without replacing order statuses', () => {
  const list = read('components/chat/ChatConversationList.jsx');
  const accounts = read('app/admin/managers.jsx');
  const adminTheme = read('components/AdminTheme.jsx');
  const portalTheme = read('constants/bluetapTheme.js');

  assert.equal(counterpartRoleLabel({ type: 'distributor_branch', displayName: 'BlueTap A' }, 'distributor'), 'Manager');
  assert.equal(counterpartRoleLabel({ type: 'distributor_branch' }, 'manager'), 'Distributor');
  assert.equal(counterpartRoleLabel({ type: 'requester_branch', counterpartRole: 'manager' }, 'requester'), '');
  assert.deepEqual(getRolePresentation('manager', ROLE_THEME_TOKENS.light), {
    role: 'manager', label: 'Manager', backgroundColor: '#F2EDFF', color: '#6D28D9',
  });
  assert.deepEqual(getRolePresentation('distributor', ROLE_THEME_TOKENS.light), {
    role: 'distributor', label: 'Distributor', backgroundColor: '#E5F7F3', color: '#0F766E',
  });
  assert.notEqual(getRolePresentation('distributor', ROLE_THEME_TOKENS.light).color, '#047857');

  assert.match(list, /<RoleBadge colors=\{colors\} role=\{roleLabel\} compact/);
  assert.match(list, /!roleLabel && !!conversation\.orderStatus && <SoftStatusBadge status=\{conversation\.orderStatus\}/);
  assert.match(list, /displayName: stationConversation\?\.displayName \|\| stationName \|\| 'Your BlueTap Station'/);
  assert.doesNotMatch(list, /SoftStatusBadge status="active" label=\{roleLabel\}/);
  assert.match(accounts, /<RoleBadge colors=\{colors\}/);
  assert.match(adminTheme, /\.\.\.ROLE_THEME_TOKENS\.light/);
  assert.match(portalTheme, /\.\.\.ROLE_THEME_TOKENS\.light/);
});

test('order entry points resolve only server-authorized conversation intents', () => {
  const source = read('components/chat/ChatOrderActions.jsx');
  const provider = read('components/chat/ChatDataProvider.jsx');
  assert.match(source, /type: 'requester_branch', intent: 'order_followup', orderId/);
  assert.match(source, /type: 'requester_distributor', orderId/);
  assert.match(source, /Unable to open conversation\. Please try again\./);
  assert.match(provider, /if \(resolveInFlightRef\.current\) return resolveInFlightRef\.current/);
  assert.doesNotMatch(source, /requesterUid\s*:|distributorUid\s*:|participantUserUids\s*:/);
});

test('message bubbles keep incoming and outgoing alignment with semantic theme surfaces', () => {
  const source = read('components/chat/ChatMessageBubble.jsx');
  assert.match(source, /own \? styles\.outgoingRow : styles\.incomingRow/);
  assert.match(source, /colors\.primaryAction/);
  assert.match(source, /colors\.surfaceAlt/);
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(source, /window\.matchMedia/);
  assert.match(source, /<View\s+ref=\{groupRef\}/);
  assert.match(source, /onMouseEnter/);
  assert.match(source, /onMouseLeave/);
  assert.match(source, /ref=\{groupRef\}[\s\S]{0,300}style=\{\[styles\.row/);
  assert.match(source, /<View style=\{\[styles\.messageGroup/);
  assert.doesNotMatch(source, /ref=\{groupRef\}[\s\S]{0,160}onHoverIn/);
  assert.doesNotMatch(source, /width < 700/);
  assert.match(source, /onFocus/);
  assert.match(source, /delayLongPress=\{500\}/);
  assert.match(source, /More message actions/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /\\u2022\\u2022\\u2022/);
});

test('desktop message action visibility survives focus and an open menu while mouse leave hides a closed trigger', () => {
  assert.equal(model.messageActionTriggerVisible({ hovered: true }), true);
  assert.equal(model.messageActionTriggerVisible({ focused: true }), true);
  assert.equal(model.messageActionTriggerVisible({ menuOpen: true }), true);
  assert.equal(model.messageActionTriggerVisible({ hovered: false, focused: false, menuOpen: false }), false);
});

test('message action presentation keeps fine-pointer hover, touch long-press, and mirrored action slots', () => {
  const bubble = read('components/chat/ChatMessageBubble.jsx');
  const conversation = read('components/chat/ChatConversationView.jsx');
  assert.match(bubble, /const useActionSheet = Platform\.OS !== 'web' \|\| !finePointer/);
  assert.match(bubble, /onLongPress=\{useActionSheet && hasOptions/);
  assert.match(bubble, /\{own && desktopControl\}[\s\S]*styles\.bubble[\s\S]*\{!own && desktopControl\}/);
  assert.match(bubble, /pointerEvents=\{buttonVisible \? 'auto' : 'none'\}/);
  assert.match(conversation, /\['requester', 'distributor'\]\.includes\(role\) && currentConversation\?\.type === 'requester_distributor'/);
  assert.match(conversation, /onReport=\{reportingAllowed \? \(item\) => setReportTarget/);
});

test('message action controls preserve compact metadata and receipts', () => {
  const source = read('components/chat/ChatMessageBubble.jsx');
  assert.match(source, /\{'Edited \\u00B7'\}/);
  assert.match(source, /\{formatTime\(message\.createdAt\)\}/);
  assert.match(source, /own && <ChatReceipt state=\{receipt\}/);
  assert.match(source, /meta: \{ flexDirection: 'row', flexWrap: 'nowrap'/);
});

test('permanent send failures do not offer a futile retry while transient failures remain retryable', () => {
  assert.deepEqual(model.messageFailurePresentation('CHAT_READ_ONLY'), { retryable: false, label: 'Messaging for this delivery has ended.' });
  assert.deepEqual(model.messageFailurePresentation('CHAT_STALE_ASSIGNMENT'), { retryable: false, label: 'Messaging for this delivery has ended.' });
  assert.deepEqual(model.messageFailurePresentation('CHAT_NOT_AUTHORIZED'), { retryable: false, label: 'You no longer have access to this conversation.' });
  assert.deepEqual(model.messageFailurePresentation('CHAT_SERVICE_UNAVAILABLE'), { retryable: true, label: 'Tap to retry' });
});

test('message action derivation and failed-delivery UI remain role and lifecycle specific', () => {
  assert.deepEqual(model.messageActionNames({ own: true, withinWindow: true }), ['Edit', 'Delete']);
  assert.deepEqual(model.messageActionNames({ own: true, withinWindow: false }), []);
  assert.deepEqual(model.messageActionNames({ own: false, reportable: true }), ['Report']);
  const now = Date.parse('2026-01-01T00:00:00Z');
  const grace = model.conversationLifecycleNotice({
    type: 'requester_distributor', accessEndsAt: new Date(now + (42 * 60 * 1000)),
    orderContext: { status: 'delivery_failed' },
  }, now);
  assert.equal(grace.state, 'grace');
  assert.equal(grace.minutes, 42);
  assert.equal(model.conversationLifecycleNotice({ type: 'requester_distributor', orderContext: { status: 'delivered' } }, now).state, 'closed');
});

test('desktop and mobile messenger presentations remain overlay based', () => {
  const source = read('components/chat/ChatPanel.jsx');
  assert.match(source, /const mobile = width < 720/);
  assert.match(source, /<Modal visible transparent=\{false\}/);
  assert.match(source, /styles\.desktopAnchor/);
});

test('older history uses one bounded API page and merges without duplicate realtime listeners', () => {
  const provider = read('components/chat/ChatDataProvider.jsx');
  const api = read('services/chatApi.js');
  assert.match(provider, /loadMessageHistory\(\{ conversationId: currentConversation\.id, beforeSeq, limit: 40 \}\)/);
  assert.match(provider, /setOlderMessages\(\(items\) => mergeMessages\(items, page\.messages \|\| \[\]\)\)/);
  assert.match(api, /beforeSeq/);
});
