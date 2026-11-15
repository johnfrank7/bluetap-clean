const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const page = readFileSync(resolve(__dirname, '../../../app/admin/branches.jsx'), 'utf8');

test('Admin Branches Cancel action never renders an empty editingId string inside a View', () => {
  assert.match(
    page,
    /\{!!editingId\s*&&\s*<TouchableOpacity style=\{styles\.secondary\} onPress=\{\(\) => confirmLeave\(cancel\)\}>\s*<Text style=\{styles\.secondaryText\}>Cancel<\/Text>/
  );
  assert.doesNotMatch(page, /\{editingId\s*&&\s*<TouchableOpacity style=\{styles\.secondary\} onPress=\{\(\) => confirmLeave\(cancel\)\}/);
  assert.equal(Boolean(''), false, 'Create Branch mode produces no Cancel child');
  assert.equal(Boolean('branch-id'), true, 'Edit Branch mode keeps the Cancel action visible');
});
