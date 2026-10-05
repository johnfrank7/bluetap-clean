const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('shared icon contract uses semantic foregrounds, supported tint props, non-zero frames, and fallbacks', () => {
  const icon = read('components', 'BlueTapIcon.jsx');
  const brand = read('components', 'BlueTapBrandMark.jsx');
  const theme = read('constants', 'bluetapTheme.js');

  for (const token of ['iconPrimary', 'iconSecondary', 'iconOnPrimary', 'iconMuted', 'iconDanger', 'iconWarning', 'iconSuccess', 'iconInteractive']) {
    assert.match(theme, new RegExp(token));
  }
  assert.match(icon, /export default function BlueTapIcon/);
  assert.match(icon, /tintColor=\{resolvedColor\}/);
  assert.match(icon, /onError=\{\(\) => setAssetFailed\(true\)\}/);
  assert.match(icon, /width: size, height: size/);
  assert.match(icon, /ICON_FALLBACKS/);
  assert.match(brand, /export default function BlueTapBrandMark/);
  assert.match(brand, /BLUE_MARK/);
  assert.match(brand, /WHITE_MARK/);
  assert.match(brand, /styles\.drop/);
});

test('all critical raster icon assets exist and are non-empty', () => {
  for (const asset of ['home.png', 'home1.png', 'user.png', 'ballot.png', 'calendar-clock.png', 'notif.png', 'bluetaplogo.png', 'bluetapwhitelogo.png']) {
    const stat = fs.statSync(path.join(root, 'assets', 'icons', asset));
    assert.ok(stat.isFile(), `${asset} must be a file`);
    assert.ok(stat.size > 0, `${asset} must not be empty`);
  }
});

test('Requester and Distributor navigation icons have explicit themed colors and active cues', () => {
  const nav = read('components', 'AppBottomNav.jsx');
  assert.match(nav, /BlueTapIcon/);
  assert.match(nav, /colors\.iconOnPrimary/);
  assert.match(nav, /colors\.iconPrimary/);
  assert.match(nav, /const requesterItems/);
  assert.match(nav, /const distributorItems/);
  assert.match(nav, /isActive && !isPrimaryAction/);
  assert.match(nav, /backgroundColor: colors\.primarySoft/);
});

test('portal and Manager bells retain glyphs independently from their badges', () => {
  const header = read('components', 'BlueTapHeader.jsx');
  const manager = read('components', 'ManagerShell.jsx');
  for (const source of [header, manager]) {
    assert.match(source, /BlueTapIcon name="notifications"/);
    assert.match(source, /iconOnPrimary|iconInteractive/);
  }
  assert.match(header, /notificationBadge/);
  assert.match(manager, /notificationCount/);
});

test('Assistant, notifications, chat, Login, and empty states use durable visual contracts', () => {
  const assistant = read('components', 'assistant', 'AssistantScreen.jsx');
  const quickActions = read('components', 'assistant', 'AssistantQuickActions.jsx');
  const notification = read('components', 'NotificationCard.jsx');
  const empty = read('components', 'BlueTapEmptyState.jsx');
  const chat = read('components', 'chat', 'BlueTapChatIcon.jsx');
  const login = read('app', 'login.jsx');

  assert.match(assistant, /BlueTapBrandMark/);
  assert.match(assistant, /BlueTapIcon name="close"/);
  assert.match(assistant, /BlueTapIcon name="reset"/);
  assert.match(quickActions, /quickActionIcon/);
  assert.match(quickActions, /colors\.iconInteractive/);
  assert.match(notification, /BlueTapIcon name=\{tone\.kind\}/);
  assert.match(empty, /BlueTapIcon name=\{variant\}/);
  assert.match(chat, /useBlueTapTheme/);
  assert.match(chat, /resolvedColor/);
  assert.match(login, /BlueTapBrandMark/);
  assert.match(login, /backgroundColor: pressed \? '#D7ECFF' : hovered \? '#EAF6FF' : '#FFFFFF'/);
});

test('Manager sidebar glyphs are deterministic unicode escapes with explicit dimensions', () => {
  const adminIcon = read('components', 'AdminIcon.jsx');
  const manager = read('components', 'ManagerShell.jsx');
  for (const name of ['dashboard', 'requests', 'distributors', 'products', 'analytics', 'security', 'profile', 'logout', 'theme']) {
    if (name === 'profile') assert.match(manager, /key: 'profile'/);
    else assert.match(`${adminIcon}\n${manager}`, new RegExp(name));
  }
  assert.match(adminIcon, /minHeight: size/);
  assert.match(adminIcon, /minWidth: size/);
  assert.doesNotMatch(adminIcon, /â|ðŸ/);
});

test('chat launcher motion is subtle and fully reduced-motion aware', () => {
  const launcher = read('components', 'chat', 'ChatFloatingLauncher.jsx');
  assert.match(launcher, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(launcher, /toValue: -2/);
  assert.match(launcher, /duration: 1400/);
  assert.match(launcher, /reduceMotion \|\| interacting \|\| panelOpen/);
  assert.match(launcher, /animation\.stop\(\)/);
});

test('dashboard clock updates once per minute and remains beside the greeting at narrow widths', () => {
  const clock = read('components', 'LocalTimeCard.jsx');
  const requester = read('app', 'requester', 'r_dashboard.jsx');
  const distributor = read('app', 'distributor', 'd_dashboard.jsx');
  assert.match(clock, /60000 - \(Date\.now\(\) % 60000\)/);
  assert.match(clock, /setInterval\(update, 60000\)/);
  assert.match(clock, /clearInterval/);
  assert.match(clock, /accessibilityLabel=\{`Local time/);
  assert.match(clock, /BlueTapIcon name=\{daytime \? 'sun' : 'moon'\}/);
  assert.match(requester, /compact=\{windowWidth < 430\}/);
  assert.match(distributor, /compact=\{width < 430\}/);
  assert.doesNotMatch(requester, /welcomeRowStacked|stacked=/);
  assert.doesNotMatch(distributor, /welcomeRowStacked|stacked=/);
  assert.match(requester, /<LocalTimeCard/);
  assert.match(distributor, /<LocalTimeCard/);
});

test('global motion CSS never overrides child icon visibility', () => {
  const css = read('global.css');
  assert.doesNotMatch(css, /button\s+svg|\[role=['"]button['"]\]\s+svg|img\s*\{[^}]*opacity\s*:\s*0|svg\s*\{[^}]*opacity\s*:\s*0/);
});
