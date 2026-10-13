const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const parser = require('@babel/parser');
const vm = require('node:vm');

const root = resolve(__dirname, '..', '..', '..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

const adminShellSource = read('components', 'AdminShell.jsx');

// Extract and evaluate formatBadgeCount in a sandbox
function loadFormatBadgeCount() {
  const match = adminShellSource.match(/export function formatBadgeCount\([\s\S]*?\n\}/);
  assert.ok(match, 'formatBadgeCount must be exported from AdminShell.jsx');
  const code = match[0].replace('export function formatBadgeCount', 'function formatBadgeCount') + '\nformatBadgeCount;';
  return vm.runInNewContext(code);
}

const formatBadgeCount = loadFormatBadgeCount();

test('Scenario 1: Navigation links list contains all 10 expected Admin destinations with correct paths', () => {
  const expectedLinks = [
    ['dashboard', 'Dashboard', '/admin/dashboard'],
    ['requests', 'Requests', '/admin/requests'],
    ['branches', 'Branches', '/admin/branches'],
    ['accounts', 'Accounts & Audit', '/admin/managers'],
    ['distributors', 'Distributors', '/admin/distributors'],
    ['products', 'Products', '/admin/products'],
    ['analytics', 'Analytics', '/admin/analytics'],
    ['reports', 'Reports & Safety', '/admin/reports-safety'],
    ['security', 'Security Settings', '/admin/registration-security'],
    ['maintenance', 'System Maintenance', '/admin/system-maintenance'],
  ];

  for (const [key, label, path] of expectedLinks) {
    const itemRegex = new RegExp(`\\['${key}',\\s*'${label.replace('&', '\\&')}',\\s*'${path}'\\]`);
    assert.match(adminShellSource, itemRegex, `Missing expected nav link for ${label} (${path})`);
  }
});

test('Scenario 2: formatBadgeCount returns null for 0, "0", "-0", negative numbers, and non-numeric garbage', () => {
  assert.equal(formatBadgeCount(0), null);
  assert.equal(formatBadgeCount(-1), null);
  assert.equal(formatBadgeCount(-10), null);
  assert.equal(formatBadgeCount('0'), null);
  assert.equal(formatBadgeCount('-0'), null);
  assert.equal(formatBadgeCount('-5'), null);
  assert.equal(formatBadgeCount(''), null);
  assert.equal(formatBadgeCount('   '), null);
  assert.equal(formatBadgeCount('abc'), null);
  assert.equal(formatBadgeCount(NaN), null);
  assert.equal(formatBadgeCount(Infinity), null);
  assert.equal(formatBadgeCount(-Infinity), null);
});

test('Scenario 3: formatBadgeCount returns null for null, undefined, false, true, and object values', () => {
  assert.equal(formatBadgeCount(null), null);
  assert.equal(formatBadgeCount(undefined), null);
  assert.equal(formatBadgeCount(false), null);
  assert.equal(formatBadgeCount(true), null);
  assert.equal(formatBadgeCount({}), null);
  assert.equal(formatBadgeCount([]), null);
});

test('Scenario 4: formatBadgeCount formats positive numbers and valid positive number strings correctly', () => {
  assert.equal(formatBadgeCount(1), '1');
  assert.equal(formatBadgeCount(5), '5');
  assert.equal(formatBadgeCount(42), '42');
  assert.equal(formatBadgeCount(99), '99');
  assert.equal(formatBadgeCount('1'), '1');
  assert.equal(formatBadgeCount('25'), '25');
  assert.equal(formatBadgeCount('99'), '99');
});

test('Scenario 5: formatBadgeCount formats counts > 99 as "99+" for both number and string inputs', () => {
  assert.equal(formatBadgeCount(100), '99+');
  assert.equal(formatBadgeCount(150), '99+');
  assert.equal(formatBadgeCount(9999), '99+');
  assert.equal(formatBadgeCount('100'), '99+');
  assert.equal(formatBadgeCount('250'), '99+');
});

test('Scenario 6: formatBadgeCount preserves valid "99+" string input', () => {
  assert.equal(formatBadgeCount('99+'), '99+');
  assert.equal(formatBadgeCount('10+'), '10+');
});

test('Scenario 7 & 8: NavItem accessibilityLabel formats with badge only when count is positive', () => {
  // Check the logic in NavItem:
  // const visibleBadge = formatBadgeCount(badgeCount);
  // const hasBadge = visibleBadge !== null;
  // const label = hasBadge ? `${baseLabel} [${visibleBadge}]` : baseLabel;
  assert.match(adminShellSource, /const visibleBadge = formatBadgeCount\(badgeCount\);/);
  assert.match(adminShellSource, /const hasBadge = visibleBadge !== null;/);
  assert.match(adminShellSource, /const label = hasBadge \? `\$\{baseLabel\} \[\$\{visibleBadge\}\]` : baseLabel;/);
  assert.match(adminShellSource, /accessibilityLabel=\{label\}/);
});

test('Scenario 9 & 10: NavItem renders badge pill only when count is positive and uses theme warning color', () => {
  // When hasBadge is false, no badge pill should be rendered
  assert.match(adminShellSource, /\{hasBadge && \(\s*<View style=\{\[styles\.badgePill,\s*\{\s*backgroundColor:\s*colors\.warning\s*\}\]\}>/);
  assert.match(adminShellSource, /<Text style=\{styles\.badgePillText\}>\{visibleBadge\}<\/Text>/);
  // Verify styles.badgePill exists and defines proper pill dimensions
  assert.match(adminShellSource, /badgePill:\s*\{[^}]*borderRadius:\s*999/);
});

test('Scenario 11: AdminShell sidebar styles contain height: 100%, maxHeight: 100%, minHeight: 0, and flexDirection: column', () => {
  assert.match(adminShellSource, /sidebar:\s*\{[\s\S]*?height:\s*'100%',[\s\S]*?maxHeight:\s*'100%',[\s\S]*?minHeight:\s*0,[\s\S]*?flexDirection:\s*'column'/);
});

test('Scenario 12: AdminShell navigationScroll has flex: 1, minHeight: 0, and flexShrink: 1', () => {
  assert.match(adminShellSource, /navigationScroll:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?minHeight:\s*0,[\s\S]*?flexShrink:\s*1/);
});

test('Scenario 13: AdminShell layout and root have minHeight: 0 and height: 100% for proper flex containment', () => {
  assert.match(adminShellSource, /root:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?height:\s*'100%'/);
  assert.match(adminShellSource, /layout:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?flexDirection:\s*'row',[\s\S]*?minHeight:\s*0,[\s\S]*?height:\s*'100%'/);
  assert.match(adminShellSource, /main:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?minWidth:\s*0,[\s\S]*?minHeight:\s*0,[\s\S]*?height:\s*'100%'/);
});

test('Scenario 14: Mobile drawer styles include height: 100%, maxHeight: 100%, minHeight: 0, and flexDirection: column', () => {
  assert.match(adminShellSource, /drawer:\s*\{[\s\S]*?position:\s*'absolute',[\s\S]*?height:\s*'100%',[\s\S]*?maxHeight:\s*'100%',[\s\S]*?minHeight:\s*0,[\s\S]*?flexDirection:\s*'column'/);
});

test('Scenario 15: Header (brand) and footer controls (sidebarBottom) have flexShrink: 0 so they remain pinned and never collapse', () => {
  assert.match(adminShellSource, /brand:\s*\{[\s\S]*?height:\s*86,[\s\S]*?flexShrink:\s*0/);
  assert.match(adminShellSource, /sidebarBottom:\s*\{[\s\S]*?marginTop:\s*'auto',[\s\S]*?flexShrink:\s*0/);
});

test('Scenario 16: Babel parsing passes without syntax errors for components/AdminShell.jsx', () => {
  assert.doesNotThrow(() => {
    parser.parse(adminShellSource, {
      sourceType: 'module',
      plugins: ['jsx'],
    });
  });
});
