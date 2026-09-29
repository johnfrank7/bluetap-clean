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
  assert.match(rules, /function isConversationBranchParticipant\(conversation\)[\s\S]*currentUser\(\)\.branchId in conversation\.participantBranchIds/);
  assert.match(rules, /function canReadConversation\(conversation\)[\s\S]*isRequester\(\) \|\| isDistributor\(\)[\s\S]*isManager\(\)/);
  assert.match(conversationBlock, /allow get, list:\s*if canReadConversation\(resource\.data\);/);
  assert.doesNotMatch(conversationBlock, /allow (?:get|read|list):\s*if isAdmin\(\)/);
});

test('all authoritative chat, message, report, moderation, and restriction client writes are denied', () => {
  assert.match(rules, /match \/chatConversations\/\{conversationId\}[\s\S]*allow create, update, delete:\s*if false;/);
  assert.match(rules, /match \/messages\/\{messageId\}[\s\S]*allow read, write:\s*if false;/);
  for (const collection of ['chatReports', 'chatModerationActions', 'chatRestrictions']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
  for (const collection of ['chatAuthorityRegistry', 'chatMutationIds', 'chatRateLimits']) {
    assert.match(rules, new RegExp(`match \/${collection}\/\\{document=\\*\\*\\} \\{ allow read, write: if false; \\}`));
  }
});

test('direct message reads stay closed until Phase 3 can enforce current lifecycle authority', () => {
  const messageBlock = rules.slice(rules.indexOf('match /messages/{messageId}'), rules.indexOf('match /requests/{requestId}'));
  assert.match(messageBlock, /allow read, write:\s*if false;/);
  assert.match(rules, /Phase 2 history is served through the bounded Render endpoint/);
});

test('Firebase config keeps the two approved conversation summary indexes', () => {
  assert.equal(firebase.firestore.rules, 'firestore.rules');
  assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
  assert.equal(indexes.indexes.length, 2);
  const normalized = indexes.indexes.map((index) => ({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope,
    arrayField: index.fields[0].fieldPath,
    arrayConfig: index.fields[0].arrayConfig,
    orderField: index.fields[1].fieldPath,
    order: index.fields[1].order,
  }));
  assert.deepEqual(normalized, [
    { collectionGroup: 'chatConversations', queryScope: 'COLLECTION', arrayField: 'participantUserUids', arrayConfig: 'CONTAINS', orderField: 'updatedAt', order: 'DESCENDING' },
    { collectionGroup: 'chatConversations', queryScope: 'COLLECTION', arrayField: 'participantBranchIds', arrayConfig: 'CONTAINS', orderField: 'updatedAt', order: 'DESCENDING' },
  ]);
  assert.deepEqual(indexes.fieldOverrides, []);
});
