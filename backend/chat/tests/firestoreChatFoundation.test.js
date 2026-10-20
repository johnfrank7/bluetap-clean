const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..', '..', '..');
const rules = readFileSync(resolve(root, 'firestore.rules'), 'utf8');
const firebase = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
const indexes = JSON.parse(readFileSync(resolve(root, 'firestore.indexes.json'), 'utf8'));

test('conversation summaries are scoped to the caller UID or current Manager branch', () => {
  const conversationBlock = rules.slice(rules.indexOf('match /chatConversations/{conversationId}'), rules.indexOf('match /requests/{requestId}'));
  assert.match(rules, /function isConversationUserParticipant\(conversation\)[\s\S]*request\.auth\.uid in conversation\.participantUserUids/);
  assert.match(rules, /participantUserAccess[\s\S]*\['active', 'read_only'\]/);
  assert.match(rules, /function isConversationBranchParticipant\(conversation\)[\s\S]*currentUser\(\)\.branchId in conversation\.participantBranchIds/);
  assert.match(rules, /participantBranchAccess[\s\S]*\['active', 'read_only'\]/);
  assert.match(rules, /function isCanonicalConversationUser\(conversation\)[\s\S]*conversation\.type == 'requester_branch'[\s\S]*conversation\.type == 'requester_distributor'[\s\S]*conversation\.type == 'distributor_branch'/);
  assert.match(rules, /function isCanonicalConversationBranch\(conversation\)[\s\S]*conversation\.type == 'branch_coordination'/);
  assert.match(rules, /function conversationAccessIsCurrent\(conversation\)[\s\S]*conversation\.accessEndsAt > request\.time/);
  assert.match(rules, /function canReadConversation\(conversation\)[\s\S]*isRequester\(\) \|\| isDistributor\(\)[\s\S]*isManager\(\)/);
  assert.match(conversationBlock, /allow get, list:\s*if resource\.data\.type != 'requester_branch'\s*&& canReadConversation\(resource\.data\);/);
  assert.doesNotMatch(conversationBlock, /allow (?:get|read|list):\s*if isAdmin\(\)/);
});

test('all authoritative chat, message, report, moderation, and restriction client writes are denied', () => {
  assert.match(rules, /match \/chatConversations\/\{conversationId\}[\s\S]*allow create, update, delete:\s*if false;/);
  assert.match(rules, /match \/messages\/\{messageId\}[\s\S]*allow create, update, delete:\s*if false;/);
  for (const collection of ['chatReports', 'chatModerationActions', 'moderationActions', 'moderationMutationIds', 'moderationNotices', 'orderAbuseReviews', 'chatRestrictions', 'orderingRestrictions', 'chatReportRateLimits', 'chatReportDuplicates', 'chatMessageRevisions']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  for (const collection of ['chatAuthorityRegistry', 'chatMutationIds', 'chatRateLimits']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  assert.match(rules, /match \/chatOrderHistory\/\{document=\*\*\} \{ allow read, write: if false; \}/);
});

test('moderation activity exposes only content-free exact documents and remains server-owned', () => {
  const block = rules.slice(rules.indexOf('match /moderationActivity/{activityId}'), rules.indexOf('match /orderAbuseReviews/'));
  assert.match(block, /activityId == 'admin' && isAdmin\(\)/);
  assert.match(block, /activityId == 'branch_' \+ currentUser\(\)\.branchId/);
  assert.match(block, /activityId == 'user_' \+ request\.auth\.uid/);
  assert.match(block, /allow list, create, update, delete:\s*if false;/);
});

test('direct message reads require the current server-maintained parent lifecycle projection', () => {
  const messageBlock = rules.slice(rules.indexOf('match /messages/{messageId}'), rules.indexOf('match /requests/{requestId}'));
  assert.match(messageBlock, /allow read:\s*if get\([\s\S]*\.data\.type != 'requester_branch'[\s\S]*&& canReadConversation\(/);
  assert.match(messageBlock, /get\(\/databases\/\$\(database\)\/documents\/chatConversations\/\$\(conversationId\)\)\.data/);
  assert.match(messageBlock, /allow create, update, delete:\s*if false;/);
});

test('Firebase config keeps old and new conversation indexes ready for a staged Chat History rollout', () => {
  assert.equal(firebase.firestore.rules, 'firestore.rules');
  assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
  const hasIndex = (group, fields) => indexes.indexes.some((index) =>
    index.collectionGroup === group && index.queryScope === 'COLLECTION' &&
    JSON.stringify(index.fields) === JSON.stringify(fields));
  for (const participant of ['participantUserUids', 'participantBranchIds']) {
    assert.ok(hasIndex('chatConversations', [
      { fieldPath: participant, arrayConfig: 'CONTAINS' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ]), `old Active index for ${participant} must remain available for rollback`);
    assert.ok(hasIndex('chatConversations', [
      { fieldPath: participant, arrayConfig: 'CONTAINS' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updatedAt', order: 'DESCENDING' },
    ]), `new Active index for ${participant} is required`);
    assert.ok(hasIndex('chatOrderHistory', [
      { fieldPath: participant, arrayConfig: 'CONTAINS' },
      { fieldPath: 'archivedAt', order: 'DESCENDING' },
    ]), `History index for ${participant} is required`);
  }
  assert.ok(hasIndex('messages', [
    { fieldPath: 'orderId', order: 'ASCENDING' },
    { fieldPath: 'seq', order: 'DESCENDING' },
  ]));
  assert.deepEqual(indexes.fieldOverrides, []);
});
