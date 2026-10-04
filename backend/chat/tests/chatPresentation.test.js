const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const model = require('../../../components/chat/chatModel');
const presentation = require('../../../components/chat/chatPresentation');
const filename = resolve(__dirname, '../../../components/chat/ChatDataProvider.jsx');
const conversationListSource = readFileSync(resolve(__dirname, '../../../components/chat/ChatConversationList.jsx'), 'utf8');
const bubbleSource = readFileSync(resolve(__dirname, '../../../components/chat/ChatMessageBubble.jsx'), 'utf8');
const transformed = babel.transformSync(readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'] }).code;
const exportsObject = {};
vm.runInNewContext(transformed, { exports: exportsObject, require: (name) => name === './chatModel' ? model : name === './chatPresentation' ? presentation : { StyleSheet: { create: (styles) => styles } } });

test('station conversation presentation accepts no order context without crashing or inventing a route', () => {
  const station = exportsObject.presentationFor({ id: 'opaque-test', type: 'distributor_branch' }, 'distributor', { orders: [], profile: { branchName: 'Test station' } });
  assert.equal(station.displayName, 'Test station');
  assert.equal(station.orderReference, '');
  assert.equal(station.orderContextLocal, null);
});

test('authorized server presentation supplies real requester names and order status without UID fallback', () => {
  const manager = exportsObject.presentationFor({
    id: 'branch-thread', type: 'requester_branch', requesterUid: 'firebase-requester-uid',
    requesterDisplayName: 'John Franz Caliguid',
    orderContext: { id: 'order-a', requestId: 'BT-2026-8B4B75BE', requesterName: 'John Franz Caliguid', status: 'pending' },
  }, 'manager', { orders: [], users: [] });
  assert.equal(manager.displayName, 'John Franz Caliguid');
  assert.equal(manager.displayName.includes('firebase-requester-uid'), false);
  assert.equal(manager.orderReference, 'BT-2026-8B4B75BE');
  assert.equal(manager.orderStatus, 'pending');

  const distributor = exportsObject.presentationFor({
    id: 'direct-thread', type: 'requester_distributor', requesterDisplayName: 'Crystal Jeanne Ortega',
    orderContext: { id: 'order-b', requestId: 'BT-2026-9A', status: 'out_for_delivery' },
  }, 'distributor', { orders: [], users: [] });
  assert.equal(distributor.displayName, 'Crystal Jeanne Ortega');
});

test('active logical participant is readable and sendable; closed, expired and read-only states cannot send', () => {
  const conversation = { status: 'active', participantState: [{ principalType: 'user', principalId: 'r1', accessState: 'active' }] };
  assert.deepEqual(model.conversationAvailability(conversation, 'requester', 'r1'), { readable: true, sendable: true });
  assert.equal(model.conversationAvailability(conversation, 'requester', 'r2').readable, false);
  assert.equal(model.conversationAvailability({ ...conversation, accessEndsAt: new Date(1) }, 'requester', 'r1').sendable, false);
  assert.equal(model.conversationAvailability({ ...conversation, status: 'closed' }, 'requester', 'r1').readable, false);
  assert.deepEqual(model.conversationAvailability({ ...conversation, status: 'read_only', accessEndsAt: new Date(Date.now() + 10000) }, 'requester', 'r1'), { readable: true, sendable: false });
});

test('Manager and Distributor conversation sections preserve authorized type grouping and search filtering', () => {
  assert.match(conversationListSource, /label="BRANCH DISTRIBUTORS"/);
  assert.match(conversationListSource, /label="REQUESTERS"/);
  assert.match(conversationListSource, /label="BRANCH COORDINATION"/);
  assert.match(conversationListSource, /label="YOUR STATION"/);
  assert.match(conversationListSource, /conversation\.type === 'distributor_branch'/);
  assert.match(conversationListSource, /conversation\.type === 'requester_branch'/);
  assert.match(conversationListSource, /conversation\.type === 'requester_distributor'/);
  assert.match(conversationListSource, /conversation\.type === 'branch_coordination'/);
  assert.match(conversationListSource, /existing = conversations\.find[\s\S]*conversation\.distributorUid === distributorId/);
  assert.match(conversationListSource, /\.filter\(\(row\) => matchesSearch\(row, needle\)\)/);
  assert.match(conversationListSource, /if \(!rows\.length\) return null/);
});

test('Requester conversations stay grouped by Branch or Distributor and pinned stations do not duplicate existing rows', () => {
  const groups = presentation.buildRequesterConversationGroups([
    { id: 'branch-thread', type: 'requester_branch', branchIds: ['branch-a'], displayName: 'BlueTap A' },
    { id: 'distributor-thread', type: 'requester_distributor', displayName: 'Assigned Distributor' },
    { id: 'unsupported', type: 'requester_requester', displayName: 'Another Requester' },
  ], [{ id: 'branch-a', name: 'BlueTap A' }, { id: 'branch-b', name: 'BlueTap B' }]);
  assert.deepEqual(groups.branchRows.map((row) => row.displayName), ['BlueTap A', 'BlueTap B']);
  assert.deepEqual(groups.distributorRows.map((row) => row.id), ['distributor-thread']);
  assert.equal(groups.branchRows[1].resolveIntent.intent, 'inquiry');
  assert.equal(presentation.conversationAllowedForRole({ id: 'bad', type: 'requester_requester' }, 'requester'), false);
  assert.match(conversationListSource, /label="BRANCH \/ STATION"/);
  assert.match(conversationListSource, /label="DISTRIBUTORS"/);
});

test('conversation role badges describe the visible counterpart without relabeling branch principals', () => {
  assert.equal(presentation.counterpartRoleLabel({ type: 'requester_distributor' }, 'requester'), 'Distributor');
  assert.equal(presentation.counterpartRoleLabel({ type: 'distributor_branch' }, 'manager'), 'Distributor');
  assert.equal(presentation.counterpartRoleLabel({ type: 'requester_branch', counterpartRole: 'manager' }, 'requester'), '');
  assert.equal(presentation.counterpartRoleLabel({ type: 'future_direct', counterpartRole: 'manager' }, 'requester'), 'Manager');
});

test('chat avatar initials are deterministic and never require a UID fallback', () => {
  assert.equal(presentation.initialsForName('John Franz'), 'JF');
  assert.equal(presentation.initialsForName('John Franz Caliguid'), 'JC');
  assert.equal(presentation.initialsForName('test'), 'T');
  assert.equal(presentation.initialsForName('   John    Franz   '), 'JF');
  assert.equal(presentation.initialsForName('', 'BT'), 'BT');
  assert.deepEqual(presentation.avatarForConversation({ type: 'requester_branch', displayName: 'BlueTap A' }, 'requester'), { avatarKind: 'station', avatarLabel: 'ST' });
});

test('message bubbles remain content-sized and wrap long text on shared web/mobile code', () => {
  assert.match(bubbleSource, /outgoingRow: \{ alignItems: 'flex-end' \}/);
  assert.match(bubbleSource, /incomingRow: \{ alignItems: 'flex-start' \}/);
  assert.match(bubbleSource, /ref=\{groupRef\}[\s\S]{0,300}style=\{\[styles\.row/);
  assert.match(bubbleSource, /row: \{ width: '100%'/);
  assert.match(bubbleSource, /\{own && desktopControl\}[\s\S]*styles\.bubble[\s\S]*\{!own && desktopControl\}/);
  assert.match(bubbleSource, /maxWidth: '100%'/);
  assert.match(bubbleSource, /minWidth: 72/);
  assert.match(bubbleSource, /flexWrap: 'nowrap'/);
  assert.match(bubbleSource, /overflowWrap: 'anywhere'/);
  assert.match(bubbleSource, /receipt/);
});

test('conversation status stays compact in the name row while unread remains visible', () => {
  assert.match(conversationListSource, /styles\.identityRow/);
  assert.match(conversationListSource, /compact numberOfLines=\{1\}/);
  assert.match(conversationListSource, /maxWidth: '52%'/);
  assert.doesNotMatch(conversationListSource, /flexWrap: 'wrap'/);
  assert.match(conversationListSource, /conversation\.unreadCount > 0/);
  assert.match(conversationListSource, /counterpartRoleLabel/);
});
