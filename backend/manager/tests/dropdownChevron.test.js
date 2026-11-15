const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('shared dropdown chevron is theme-aware, geometric, scalable, and state-aware', () => {
  const icon = read('components/DropdownChevron.jsx');
  assert.match(icon, /useBlueTapTheme/);
  assert.match(icon, /size = 16/);
  assert.match(icon, /color, expanded = false/);
  assert.match(icon, /borderRightWidth:[\s\S]*borderBottomWidth:/);
  assert.match(icon, /Animated\.timing/);
  assert.match(icon, /outputRange: \['45deg', '225deg'\]/);
  assert.doesNotMatch(icon, /<Text|⌄|⌃|▾|▼|▴|▲/u);
});

test('shared dropdown overlay anchors options and animates them downward', () => {
  const overlay = read('components/DropdownMenuOverlay.jsx');
  assert.match(overlay, /anchorRef\?\.current/);
  assert.match(overlay, /measureInWindow/);
  assert.match(overlay, /animationType="none"/);
  assert.match(overlay, /const top = anchor\.y \+ anchor\.height \+ MENU_GAP/);
  assert.doesNotMatch(overlay, /openAbove|aboveSpace/);
  assert.match(overlay, /Animated\.timing/);
  assert.match(overlay, /outputRange: \[-10, 0\]/);
});

test('all dropdown indicators across role forms use the shared component', () => {
  const consumers = [
    'app/admin/managers.jsx',
    'app/admin/registration-security.jsx',
    'app/admin/requests.jsx',
    'app/admin/system-maintenance.jsx',
    'app/manager/accounts.jsx',
    'app/manager/distributors.jsx',
    'app/signup.jsx',
    'components/DeliveryActionDialog.jsx',
  ];

  for (const file of consumers) {
    const source = read(file);
    assert.match(source, /import DropdownChevron from ['"][^'"]*DropdownChevron['"];/, `${file} imports the shared chevron`);
    assert.match(source, /<DropdownChevron\b/, `${file} renders the shared chevron`);
  }

  for (const file of consumers) {
    assert.doesNotMatch(read(file), /⌄|⌃|▾|▼|▴|▲|âŒ„|âŒƒ|â–¼|â–²|â–´|â–¾/u, `${file} has no text arrow indicator`);
  }
});

test('stateful dropdown indicators preserve their expanded direction', () => {
  assert.match(read('components/DeliveryActionDialog.jsx'), /<DropdownChevron expanded=\{selectorOpen\}/);
  assert.match(read('app/manager/distributors.jsx'), /<DropdownChevron expanded=\{dateSelectorOpen\}/);
  assert.match(read('app/admin/requests.jsx'), /<DropdownChevron expanded=\{sortOpen\}/);
  assert.match(read('app/admin/requests.jsx'), /<DropdownChevron expanded=\{overrideDistributorOpen\}/);
});

test('modal-backed Admin and Manager selects share the anchored dropdown effect', () => {
  const consumers = [
    'app/admin/managers.jsx',
    'app/admin/registration-security.jsx',
    'app/admin/system-maintenance.jsx',
    'app/manager/accounts.jsx',
  ];
  for (const file of consumers) {
    const source = read(file);
    assert.match(source, /import DropdownMenuOverlay from ['"][^'"]*DropdownMenuOverlay['"];/, `${file} imports the shared overlay`);
    assert.match(source, /<DropdownMenuOverlay visible=\{open\} anchorRef=\{triggerRef\}/, `${file} anchors its dropdown`);
  }
});

test('Admin Requests sort options render in an anchored overlay without expanding the control row', () => {
  const source = read('app/admin/requests.jsx');
  assert.match(source, /import DropdownMenuOverlay from ['"][^'"]*DropdownMenuOverlay['"];/);
  assert.match(source, /<DropdownMenuOverlay\s+visible=\{sortOpen\}\s+anchorRef=\{sortTriggerRef\}/);
  assert.doesNotMatch(source, /\{sortOpen\s*&&\s*\(\s*<View style=\{styles\.sortMenu\}/);
});

test('Admin sidebar restores its collapsed width before route changes can remount the shell', () => {
  const shell = read('components/AdminShell.jsx');
  assert.match(shell, /let cachedSidebarCollapsed = null/);
  assert.match(shell, /useState\(\(\) => cachedSidebarCollapsed \?\? false\)/);
  assert.match(shell, /new Animated\.Value\(collapsed \? COLLAPSED_WIDTH : DESKTOP_WIDTH\)/);
  assert.match(shell, /if \(!active \|\| cachedSidebarCollapsed !== null\) return/);
  assert.match(shell, /cachedSidebarCollapsed = next;\s*setCollapsed\(next\)/);
});

test('Manager sidebar keeps its selected width when a new route remounts the shell', () => {
  const shell = read('components/ManagerShell.jsx');
  assert.match(shell, /let cachedManagerSidebarCollapsed = false/);
  assert.match(shell, /useState\(\(\) => cachedManagerSidebarCollapsed\)/);
  assert.match(shell, /new Animated\.Value\(collapsed \? COLLAPSED_WIDTH : DESKTOP_WIDTH\)/);
  assert.match(shell, /cachedManagerSidebarCollapsed = next;\s*setCollapsed\(next\)/);
});
