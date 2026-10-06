const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const accounts = read('app/manager/accounts.jsx');

test('Branch Accounts selected tabs have readable white text and high-contrast styling', () => {
  // Tab component and active states
  assert.match(accounts, /function AccountTab/);
  assert.match(accounts, /tabTextActive:\s*\{[^}]*color:\s*'#FFFFFF'/);
  assert.match(accounts, /tabCountActive:\s*\{[^}]*color:\s*'#FFFFFF'/);
  assert.match(accounts, /tabActive:\s*\{[^}]*backgroundColor:\s*colors\.primaryAction/);

  // Inactive states use dark/theme text and visible borders
  assert.match(accounts, /tabTextInactive:\s*\{[^}]*color:\s*colors\.textPrimary/);
  assert.match(accounts, /tabCountInactive:\s*\{[^}]*color:\s*colors\.textSecondary/);
  assert.match(accounts, /tabInactive:\s*\{[^}]*backgroundColor:\s*colors\.surfaceAlt/);

  // All 3 account type tabs are rendered
  assert.match(accounts, /label="All"/);
  assert.match(accounts, /label="Requesters"/);
  assert.match(accounts, /label="Distributors"/);
});

test('Manager Branch Accounts uses responsive mobile cards and desktop table with breakpoint', () => {
  // Breakpoint definition
  assert.match(accounts, /const compact = width < 768/);

  // Mobile card mode
  assert.match(accounts, /compact \? \(/);
  assert.match(accounts, /mobileList/);
  assert.match(accounts, /mobileCard/);
  assert.match(accounts, /mobileTop/);
  assert.match(accounts, /mobileDetails/);
  assert.match(accounts, /mobileMetaLabel/);

  // Desktop table mode
  assert.match(accounts, /<ScrollView horizontal/);
  assert.match(accounts, /styles\.tableHeader/);
  for (const col of ['NAME', 'PUBLIC UID', 'CONTACT', 'EMAIL \/ LOCATION', 'ROLE', 'STATUS', 'ACTIONS']) {
    assert.match(accounts, new RegExp(col));
  }
});

test('Filter bar provides search, status dropdown, and reset without fake filters', () => {
  assert.match(accounts, /Search name, username, Public UID, email, phone, or barangay/);
  assert.match(accounts, /SelectControl/);
  assert.match(accounts, /accessibilityLabel="Filter by status"/);
  assert.match(accounts, /options=\{?\['all', 'active', 'suspended'\]\}?/);
  assert.match(accounts, /Reset/);
});

test('Manager Branch Accounts actions and authority remain branch-scoped without Admin privileges', () => {
  // Branch-scoped moderation
  assert.match(accounts, /suspendManagerBranchUser/);
  assert.match(accounts, /restoreManagerBranchUser/);
  assert.match(accounts, /BRANCH_SUSPENSION_REASONS/);

  // No global Admin account privileges
  assert.doesNotMatch(accounts, /createAdminAccount/);
  assert.doesNotMatch(accounts, /manageAdminAccount/);
  assert.doesNotMatch(accounts, /Activity log/i);
  assert.doesNotMatch(accounts, /signOutAllSessions/);

  // Raw Firebase UID is never rendered directly
  assert.match(accounts, /publicUid \|\| account\.displayUid \|\| account\.uniqueId/);
  assert.doesNotMatch(accounts, /<Text[^>]*>\{account\.uid\}<\/Text>/);
});

test('Manager Accounts pagination reuses shared BlueTap pagination contract', () => {
  assert.match(accounts, /AccountPagination/);
  assert.match(accounts, /accountPageSlice/);
  assert.match(accounts, /accountPageMeta/);
  assert.match(accounts, /accountPageNumbers/);
});

test('Suspension modal adheres to Cross-Platform Responsive Visibility Contract', () => {
  // Viewport-safe three-tier structure
  assert.match(accounts, /modalCard:\s*\{[^}]*maxHeight:\s*'90%'/);
  assert.match(accounts, /modalHeader:\s*\{[^}]*flexShrink:\s*0/);
  assert.match(accounts, /modalScroll:\s*\{[^}]*flex:\s*1[^}]*flexShrink:\s*1/);
  assert.match(accounts, /modalFooter:\s*\{[^}]*flexShrink:\s*0/);

  // Cancel and Confirm Suspension are ALWAYS rendered (unconditional presence in footer)
  assert.match(accounts, /modalCancelBtn/);
  assert.match(accounts, /Cancel/);
  assert.match(accounts, /modalConfirmBtn/);
  assert.match(accounts, /Confirm Suspension/);

  // Confirm button disabled condition and legible disabled styling
  assert.match(accounts, /disabled=\{actionLoading \|\| !selectedReasonCode\}/);
  assert.match(accounts, /modalConfirmBtnDisabled/);
  assert.match(accounts, /modalConfirmBtnTextDisabled/);
  assert.match(accounts, /modalConfirmBtnEnabled/);

  // Theme-safe contrast: enabled is #DC2626 with #FFFFFF text; disabled has clear readable tint and contrast
  assert.match(accounts, /backgroundColor:\s*'#DC2626'/);
  assert.match(accounts, /color:\s*'#FFFFFF'/);
  assert.match(accounts, /color:\s*isDark \? '#F87171' : '#B91C1C'/);

  // Responsive footer layout (stacks on narrow widths < 440)
  assert.match(accounts, /width < 440 \? 'column-reverse' : 'row'/);
  assert.match(accounts, /minHeight:\s*44/);
});
