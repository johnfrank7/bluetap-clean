const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const model = require('../../../components/chat/chatModel');
const filename = resolve(__dirname, '../../../components/chat/ChatDataProvider.jsx');
const conversationListSource = readFileSync(resolve(__dirname, '../../../components/chat/ChatConversationList.jsx'), 'utf8');
const bubbleSource = readFileSync(resolve(__dirname, '../../../components/chat/ChatMessageBubble.jsx'), 'utf8');
const transformed = babel.transformSync(readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'] }).code;
const exportsObject = {};
vm.runInNewContext(transformed, { exports: exportsObject, require: (name) => name === './chatModel' ? model : { StyleSheet: { create: (styles) => styles } } });

test('station conversation presentation accepts no order context without crashing or inventing a route', () => {
  const station = exportsObject.presentationFor({ id: 'opaque-test', type: 'distributor_branch' }, 'distributor', { orders: [], profile: { branchName: 'Test station' } });
  assert.equal(station.displayName, 'Test station');
  assert.equal(station.orderReference, '');
  assert.equal(station.orderContextLocal, null);
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

test('message bubbles remain content-sized and wrap long text on shared web/mobile code', () => {
  assert.match(bubbleSource, /outgoingRow: \{ alignItems: 'flex-end' \}/);
  assert.match(bubbleSource, /incomingRow: \{ alignItems: 'flex-start' \}/);
  assert.match(bubbleSource, /maxWidth: '76%'/);
  assert.match(bubbleSource, /minWidth: 44/);
  assert.match(bubbleSource, /overflowWrap: 'anywhere'/);
  assert.match(bubbleSource, /receipt/);
});
