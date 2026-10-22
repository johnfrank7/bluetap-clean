const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { transformSync } = require('@babel/core');
const React = require('react');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const state = { pathname: '', segments: [], colors: {}, counts: {}, bottom: 0, destinations: [] };
const flatten = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

// Execute the actual JSX and Pressable style callbacks, substituting only platform
// primitives/providers. These are component contract tests, not browser rendering.
function load(file, extra = '') {
  const filename = path.join(root, file);
  const { code } = transformSync(read(file) + extra, {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  const mocks = {
    react: { ...React, useMemo: (factory) => factory() },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles } },
    'expo-image': { Image: 'ExpoImage' },
    'expo-router': { usePathname: () => state.pathname, useSegments: () => state.segments },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: state.bottom }) },
    './BlueTapTheme': { useBlueTapTheme: () => ({ colors: state.colors }) },
    './RoleNotifications': { useRoleNotifications: () => ({ attentionCounts: state.counts }) },
    './useSingleFlightNavigation': () => ({ replaceOnce: (route) => state.destinations.push(route) }),
    './shadowStyles': { createShadow: () => ({}) },
  };
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.endsWith('.svg')) return path.resolve(path.dirname(filename), name);
    if (name === '../constants/userPortalLayout') return load('constants/userPortalLayout.js');
    return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports;
}

const nav = load('components/AppBottomNav.jsx', '\nexport { requesterItems, distributorItems, routeMatches };');
const { USER_PORTAL_LAYOUT: layout } = load('constants/userPortalLayout.js');
const theme = load('constants/bluetapTheme.js');
const themes = [theme.BLUETAP_LIGHT_PORTAL_COLORS, theme.BLUETAP_DARK_PORTAL_COLORS];
const roles = [
  { component: nav.RequesterBottomNav, items: nav.requesterItems, keys: ['home', 'add', 'profile'] },
  { component: nav.DistributorBottomNav, items: nav.distributorItems, keys: ['home', 'requests', 'schedule', 'profile'] },
];

function expand(element) {
  if (!element || typeof element !== 'object') return element;
  if (typeof element.type === 'function') return expand(element.type(element.props));
  return { ...element, children: React.Children.toArray(element.props.children).map(expand) };
}
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap((child) => find(child, type))];
}
function render(role, pathname, colors = themes[0], counts = {}, segments = pathname.split('/')) {
  Object.assign(state, { pathname, colors, counts, segments, destinations: [] });
  const tree = expand(React.createElement(role.component));
  return { tree, buttons: find(tree, 'Pressable'), images: find(tree, 'ExpoImage') };
}

test('both roles use one minimal outline SVG family and identical shared artwork', () => {
  for (const role of roles) {
    assert.deepEqual(role.items.map((item) => item.key), role.keys);
    for (const item of role.items) {
      const svg = fs.readFileSync(item.icon, 'utf8');
      for (const attribute of ['width="24"', 'height="24"', 'viewBox="0 0 24 24"', 'fill="none"', 'stroke="#FFFFFF"', 'stroke-width="2"', 'stroke-linecap="round"', 'stroke-linejoin="round"']) {
        assert.ok(svg.includes(attribute), `${item.key}: missing ${attribute}`);
      }
      assert.doesNotMatch(svg, /<script|<image|<text|href=|currentColor|style=/);
      assert.equal(item.activeIcon, undefined, 'selection must not swap artwork');
    }
  }
  for (const key of ['home', 'profile']) {
    assert.equal(roles[0].items.find((item) => item.key === key).icon, roles[1].items.find((item) => item.key === key).icon);
  }
  assert.equal(new Set(roles.flatMap((role) => role.items.map((item) => item.icon))).size, 5);
});

test('all tab destinations and aliases exist, and presses retain their exact role route', () => {
  for (const role of roles) {
    const { buttons } = render(role, role.items[0].route);
    role.items.forEach((item, index) => {
      for (const route of [item.route, ...item.matches]) assert.ok(fs.existsSync(path.join(root, `app${route}.jsx`)), route);
      buttons[index].props.onPress();
    });
    assert.deepEqual(state.destinations, role.items.map((item) => item.route));
  }
});

test('each route, alias, query, nested path and segment fallback selects exactly its tab in both themes', () => {
  for (const colors of themes) for (const role of roles) for (const item of role.items) {
    for (const match of item.matches) for (const route of [match, `${match}/`, `${match}?orderId=123`, `${match}/details`]) {
      const { buttons, images } = render(role, route, colors);
      assert.equal(buttons.filter((button) => button.props.accessibilityState.selected).length, 1, route);
      buttons.forEach((button, index) => {
        const active = role.items[index].key === item.key;
        assert.equal(button.props.accessibilityState.selected, active);
        assert.equal(button.props.accessibilityRole, 'button');
        assert.equal(button.props.accessibilityLabel, role.items[index].label);
        for (const interaction of [{}, { hovered: true }, { pressed: true }, { hovered: true, pressed: true }]) {
          const style = flatten(button.props.style(interaction));
          assert.equal(style.backgroundColor === colors.primarySoft, active);
          assert.equal(style.borderColor, active ? colors.navSelectedBorder : 'transparent');
          assert.equal(style.width, 44);
          assert.equal(style.height, 44);
          assert.equal(style.borderWidth, 1);
          assert.equal(style.transform, undefined);
          assert.ok((style.opacity ?? 1) >= 0.88);
        }
        assert.equal(images[index].props.tintColor, active ? colors.iconPrimary : colors.navIconMuted);
        assert.equal(images[index].props.source, role.items[index].icon);
      });
    }
    for (const segment of item.segments) {
      const { buttons } = render(role, '/', colors, {}, ['(portal)', segment]);
      assert.equal(buttons.filter((button) => button.props.accessibilityState.selected).length, 1);
      assert.equal(buttons[role.items.indexOf(item)].props.accessibilityState.selected, true);
    }
  }
});

test('Add Request stays inactive on Home/Profile and unknown routes never light up a tab', () => {
  for (const colors of themes) for (const route of ['/requester/r_dashboard', '/requester/r_profile']) {
    const { buttons } = render(roles[0], route, colors);
    assert.equal(buttons[1].props.accessibilityState.selected, false);
    assert.equal(flatten(buttons[1].props.style({})).backgroundColor, 'transparent');
  }
  for (const role of roles) for (const route of ['/manager/dashboard', '/requester/r_notification', '/distributor/d_notification', `${role.items[0].route}-invalid`]) {
    const { buttons } = render(role, route);
    assert.ok(buttons.every((button) => !button.props.accessibilityState.selected));
  }
  // Even if pathname and segments briefly disagree during navigation, findIndex
  // produces only one selected treatment (existing matcher precedence).
  const { buttons } = render(roles[0], '/requester/r_profile', themes[0], {}, ['requester', 'r_dashboard']);
  assert.equal(buttons.filter((button) => button.props.accessibilityState.selected).length, 1);
});

test('badges stay on Requests/Schedule, hide at zero, retain full accessible counts and clear the icons', () => {
  for (const colors of themes) for (const count of [0, 1, 99, 100]) {
    const { buttons } = render(roles[1], '/distributor/d_dashboard', colors, { requests: count, schedule: count + 1 });
    buttons.forEach((button, index) => {
      const expected = index === 1 ? count : index === 2 ? count + 1 : 0;
      const texts = find(button, 'Text');
      assert.equal(texts.length, expected > 0 ? 1 : 0);
      if (expected > 0) {
        assert.equal(texts[0].props.children, expected > 99 ? '99+' : String(expected));
        assert.ok(button.props.accessibilityLabel.includes(`${expected} items require attention`));
        const badge = find(button, 'View').find((view) => flatten(view.props.style).position === 'absolute');
        const style = flatten(badge.props.style);
        assert.ok(style.top + style.height <= 0, 'badge must clear the icon');
        const iconSize = find(button, 'ExpoImage')[0].props.style.width;
        assert.ok(layout.navHeight / 2 - iconSize / 2 + style.top >= 0, 'badge must stay inside the pill vertically');
        assert.equal(style.borderColor, colors.navSurface);
      }
    });
    assert.equal(find(render(roles[0], '/requester/r_request', colors, { requests: 100, schedule: 100 }).tree, 'Text').length, 0);
  }
});

test('fixed icon/target dimensions fit all requested widths and preserve floating safe-area geometry', () => {
  assert.equal(layout.maxWidth, 480);
  for (const width of [1440, 1024, 768, 480, 390, 375]) for (const role of roles) for (const colors of themes) for (const bottom of [0, 34]) {
    state.bottom = bottom;
    const { tree, buttons, images } = render(role, role.items[0].route, colors);
    const pill = flatten(tree.props.style);
    assert.equal(pill.bottom, layout.navBottomOffset + bottom);
    assert.equal(pill.position, 'absolute');
    assert.equal(pill.minHeight, layout.navHeight);
    const innerWidth = Math.min(width, layout.maxWidth) - pill.left - pill.right - 2 * (pill.paddingHorizontal + pill.borderWidth);
    const slotWidth = innerWidth / buttons.length;
    assert.ok(slotWidth >= 44, `${width}px must fit all touch targets`);
    for (const image of images) {
      assert.equal(image.props.style.width, 27);
      assert.equal(image.props.style.height, 27);
      const svg = fs.readFileSync(image.props.source, 'utf8');
      const sourceStroke = Number(svg.match(/stroke-width="([\d.]+)"/)[1]);
      assert.equal(sourceStroke * image.props.style.width / 24, 2.25);
      assert.ok(image.props.style.width < 44 - 2, 'icon must clear the button border');
      assert.equal(image.props.style.flexShrink, 0);
      assert.equal(image.props.contentFit, 'contain');
      assert.equal(image.props.transition, 0);
      assert.equal(image.props.accessible, false);
    }
    assert.equal(find(tree, 'Text').length, 0, 'permanent labels must remain hidden');
  }
  state.bottom = 0;
});

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test('active and inactive icon foregrounds have at least 3:1 non-text contrast in both themes', () => {
  for (const colors of themes) for (const [foreground, background] of [
    [colors.iconPrimary, colors.primarySoft], [colors.navIconMuted, colors.navSurface], [colors.navIconMuted, colors.surfaceAlt],
  ]) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 3, `${foreground} on ${background}`);
  }
});

test('muted portal icons have stronger contrast without changing global role icon colors', () => {
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const colors of themes) {
    assert.ok(contrast(colors.navIconMuted, colors.navSurface) > contrast(colors.iconMuted, colors.navSurface));
    assert.notEqual(colors.navSelectedBorder, colors.iconPrimary, 'decorative border should be softer than the icon');
  }
  assert.equal(theme.BLUETAP_COLORS.iconMuted, '#64748B');
  assert.equal(theme.BLUETAP_DARK_COLORS.iconMuted, '#9FB4C8');
  assert.equal(theme.BLUETAP_COLORS.navIconMuted, undefined);
  assert.equal(theme.BLUETAP_DARK_COLORS.navIconMuted, undefined);
});

test('only portal tabs replace the decorative outline on keyboard focus and retain stable web geometry', () => {
  const css = require('postcss').parse(read('global.css'));
  const declarations = (selector) => {
    const result = {};
    css.walkRules(selector, (rule) => rule.walkDecls((declaration) => {
      result[declaration.prop] = { value: declaration.value, important: !!declaration.important };
    }));
    return result;
  };
  const tab = "[data-bluetap-bottom-nav='true']";
  const focus = declarations(`${tab}:focus-visible`);
  assert.deepEqual(focus.outline, { value: '2px solid var(--bluetap-primary)', important: false });
  assert.equal(focus['outline-offset'].value, '2px');
  assert.deepEqual(focus['border-color'], { value: 'transparent', important: true });
  assert.equal(focus['background-color'], undefined, 'focus must retain the route-selected surface');
  assert.equal(declarations(`${tab}:focus:not(:focus-visible)`).outline.value, 'none');
  assert.equal(declarations(`[data-bluetap-theme='dark'] ${tab}:focus-visible`)['outline-color'].value, 'var(--bluetap-primary-light)');
  assert.deepEqual(declarations(tab).transform, { value: 'none', important: true });
  assert.equal(declarations('*:focus-visible').outline.value, '3px solid rgba(24, 123, 205, 0.35)', 'other controls keep their focus ring');
  for (const role of roles) {
    for (const button of render(role, role.items[0].route).buttons) {
      assert.equal(button.props.dataSet.bluetapBottomNav, 'true');
      assert.equal(button.props.tabIndex, undefined, 'retain Pressable keyboard tab behavior');
      for (const container of find(button, 'View')) assert.equal(flatten(container.props.style).borderWidth, undefined, 'no nested decorative outline');
    }
  }
});
