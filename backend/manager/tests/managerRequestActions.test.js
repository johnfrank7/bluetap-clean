const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('Manager requests: Upcoming orders queue includes ManagerOrderChatAction', () => {
  const fileContent = read('app/manager/request.jsx');

  // Verify ManagerOrderChatAction import
  assert.match(fileContent, /import\s*\{\s*ManagerOrderChatAction\s*\}\s*from\s*['"]\.\.\/\.\.\/components\/chat\/ChatOrderActions['"]/);

  // In ReceivedRequestsQueue (Upcoming / Normal Orders)
  const receivedQueueSection = fileContent.slice(
    fileContent.indexOf('function ReceivedRequestsQueue'),
    fileContent.indexOf('function BranchOrdersOverview')
  );

  assert.ok(receivedQueueSection.length > 0, 'ReceivedRequestsQueue section must exist');
  assert.match(receivedQueueSection, /<ManagerOrderChatAction\s+order=\{order\}\s+disabled=\{entry\.actionsDisabled\}\s+style=\{styles\.managerChatButton\}\s*\/>/);
});

test('Manager requests: Delivery exceptions queue includes ManagerOrderChatAction', () => {
  const fileContent = read('app/manager/request.jsx');

  // In OutsideRadiusApprovalQueue (Delivery Exceptions)
  const outsideRadiusSection = fileContent.slice(
    fileContent.indexOf('function OutsideRadiusApprovalQueue'),
    fileContent.indexOf('function EditOrderModal')
  );

  assert.ok(outsideRadiusSection.length > 0, 'OutsideRadiusApprovalQueue section must exist');
  assert.match(outsideRadiusSection, /<ManagerOrderChatAction\s+order=\{order\}\s+disabled=\{entry\.actionsDisabled\}\s+style=\{styles\.managerChatButton\}\s*\/>/);
});

test('Manager requests: actionRow enforces centered alignment and consistent 44-48px button heights', () => {
  const fileContent = read('app/manager/request.jsx');

  // actionRow must have alignItems: 'center' instead of 'stretch' to prevent ballooning
  assert.match(fileContent, /actionRow:\s*\{[^}]*alignItems:\s*['"]center['"]/);
  assert.doesNotMatch(fileContent, /actionRow:\s*\{[^}]*alignItems:\s*['"]stretch['"]/);

  // chatActionWrap must enforce 44-48px height and responsive flexBasis
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*height:\s*44/);
  assert.match(fileContent, /chatActionWrap:\s*\{[^}]*flexBasis:\s*width\s*<\s*430\s*\?\s*['"]48%['"]\s*:\s*118/);

  // actionButton must enforce 44-48px height and responsive flexBasis
  assert.match(fileContent, /actionButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*height:\s*44/);
  assert.match(fileContent, /actionButton:\s*\{[^}]*flexBasis:\s*width\s*<\s*430\s*\?\s*['"]48%['"]\s*:\s*118/);

  // managerChatButton must enforce matching height
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*minHeight:\s*44/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*maxHeight:\s*48/);
  assert.match(fileContent, /managerChatButton:\s*\{[^}]*height:\s*44/);
});
