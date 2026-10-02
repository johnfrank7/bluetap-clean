const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('reporting is limited in the client to requester-distributor threads and incoming messages', () => {
  const conversation = read('components/chat/ChatConversationView.jsx');
  const bubble = read('components/chat/ChatMessageBubble.jsx');
  assert.match(conversation, /currentConversation\?\.type === 'requester_distributor'/);
  assert.match(conversation, /Report user/);
  assert.match(bubble, /!own && message\.id/);
  assert.match(bubble, /Report this message/);
});

test('Manager and Admin expose separate Reports & Safety routes and action sets', () => {
  const workspace = read('components/ModerationWorkspace.jsx');
  assert.match(read('components/ManagerShell.jsx'), /\/manager\/reports-safety/);
  assert.match(read('components/AdminShell.jsx'), /\/admin\/reports-safety/);
  assert.match(workspace, /suspend_branch_chat/);
  assert.match(workspace, /suspend_platform_chat/);
  assert.match(workspace, /Audit and load up to 20 messages/);
  assert.doesNotMatch(read('app/admin/_layout.jsx'), /ChatDataProvider/);
});

test('restriction notices are mounted outside chat and ordering is blocked in the UI as defense in depth', () => {
  for (const role of ['requester', 'distributor']) {
    const layout = read(`app/${role}/_layout.jsx`);
    assert.match(layout, /ModerationNoticeProvider/);
    assert.ok(layout.indexOf('<ModerationNoticeProvider>') < layout.indexOf('<ChatDataProvider'));
  }
  assert.match(read('app/requester/requestform.jsx'), /!orderingRestriction/);
  assert.match(read('components/chat/ChatDataProvider.jsx'), /!chatRestriction/);
});

test('Reports and Safety notices use a bounded vertical information card with safe metadata and separate actions', () => {
  const notices = read('components/ModerationNotices.jsx');
  assert.match(notices, /noticeIcon/);
  assert.match(notices, /statusBadge/);
  assert.match(notices, />Branch</);
  assert.match(notices, />Reason</);
  assert.match(notices, />Until</);
  assert.match(notices, /bannerActions/);
  assert.match(notices, /maxWidth: 560/);
  assert.doesNotMatch(notices, /notice\.reporter|notice\.privateNote|notice\.actionId|notice\.riskScore/);
});
