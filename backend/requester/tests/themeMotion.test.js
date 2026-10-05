const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('one shared theme transition coordinates portal and privileged themes', () => {
  const layout = read('app', '_layout.jsx');
  const transition = read('components', 'BlueTapThemeTransition.jsx');
  const portalTheme = read('components', 'BlueTapTheme.jsx');
  const adminTheme = read('components', 'AdminTheme.jsx');

  assert.match(layout, /BlueTapThemeTransitionProvider/);
  assert.match(transition, /const TRANSITION_DURATION = 640/);
  assert.match(transition, /const THEME_SWITCH_MIDPOINT = 300/);
  assert.match(transition, /pointerEvents="none"/);
  assert.match(transition, /activeRef\.current/);
  assert.match(transition, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(transition, /prefers-reduced-motion: reduce/);
  assert.match(portalTheme, /startTransition\(\{/);
  assert.match(adminTheme, /startTransition\(\{/);
});

test('existing theme persistence keys remain authoritative', () => {
  const portalTheme = read('components', 'BlueTapTheme.jsx');
  const adminTheme = read('components', 'AdminTheme.jsx');
  const combined = `${portalTheme}\n${adminTheme}`;

  assert.equal((combined.match(/'bluetap-theme'/g) || []).length, 1);
  assert.equal((combined.match(/'bluetap-admin-theme'/g) || []).length, 1);
  assert.match(portalTheme, /AsyncStorage\.setItem\(BLUETAP_THEME_STORAGE_KEY/);
  assert.match(adminTheme, /AsyncStorage\.setItem\(ADMIN_THEME_STORAGE_KEY/);
});

test('shared interaction styling covers hover, press, focus, disabled, and reduced motion', () => {
  const css = read('global.css');
  const button = read('components', 'PortalButton.jsx');
  const iconToggle = read('components', 'ThemeIconButton.jsx');

  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /translateY\(-1px\) scale\(1\.01\)/);
  assert.match(css, /scale\(0\.98\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /aria-disabled='true'/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(button, /pressed[\s\S]*scale: 0\.98/);
  assert.match(iconToggle, /disabled=\{isTransitioning\}/);
});
