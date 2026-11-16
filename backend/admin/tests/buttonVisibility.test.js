const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const rnw = require('react-native-web');
const parser = require('@babel/parser');
const { transformSync } = require('@babel/core');
const postcss = require('postcss');

const root = path.resolve(__dirname, '../../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
function component(file, name, dependencies) {
  const source = read(file);
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const node = ast.program.body.find((entry) => entry.type === 'FunctionDeclaration' && entry.id.name === name);
  assert.ok(node, `${name} must exist`);
  const code = transformSync(source.slice(node.start, node.end), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx'],
  }).code;
  return new Function(...Object.keys(dependencies), `${code}\nreturn ${name};`)(...Object.values(dependencies));
}
const emptyStyles = new Proxy({}, { get: () => ({}) });
const colors = { neutral: '#EEF3F7', border: '#D7ECFF', primaryAction: '#0B67AD', onPrimary: '#FFFFFF',
  dangerAction: '#B52F2F', onDanger: '#FFFFFF', disabledText: '#526579', surface: '#FFFFFF',
  textSecondary: '#64748B' };

test('Manager pagination exposes visible page labels and selected state in all queues', () => {
  const Page = component('app/manager/request.jsx', 'PaginationBar', { React, View: rnw.View,
    Text: rnw.Text, TouchableOpacity: rnw.TouchableOpacity });
  for (const itemLabel of ['orders', 'requests', 'delivery reviews']) {
    const html = renderToStaticMarkup(React.createElement(Page, { currentPage: 1, totalItems: 6,
      pageSize: 3, onPageChange: () => {}, styles: emptyStyles, itemLabel }));
    assert.match(html, /data-manager-request-page="selected"/);
    assert.match(html, /aria-label="Current page, page 1"/);
    assert.match(html, /aria-label="Go to page 2"/);
  }
});

test('account confirmation retains its enabled or disabled button', () => {
  for (const [resolvedTheme, themeColors] of [['light', colors], ['dark', { ...colors, neutral: '#112A40',
    border: '#1C3C55', primaryAction: '#1565C0', dangerAction: '#B91C1C', disabledText: '#9FB4C8' }]]) {
  for (const [action, reason, expected] of [['deactivate', '', 'danger'], ['suspend', '', 'disabled'],
    ['terminate', '', 'disabled'], ['suspend', 'A factual reason with enough detail', 'danger'],
    ['terminate', 'A factual reason with enough detail', 'danger'], ['reactivate', '', 'primary']]) {
    const fakeReact = { ...React, useState: () => [reason, () => {}], useEffect: () => {} };
    const Dialog = component('app/admin/managers.jsx', 'AccountAccessActionDialog', { React: fakeReact,
      useAdminTheme: () => ({ colors: themeColors, resolvedTheme }), createStyles: () => emptyStyles,
      Modal: ({ children }) => React.createElement('div', null, children), View: rnw.View,
      Text: rnw.Text, ScrollView: rnw.ScrollView, TouchableOpacity: rnw.TouchableOpacity,
      TextInput: rnw.TextInput, Field: ({ children }) => React.createElement('div', null, children),
      titleCase: (value) => value });
    const html = renderToStaticMarkup(React.createElement(Dialog, { state: { action, account: { uid: 'qa', fullName: 'QA' } },
      saving: false, onClose: () => {}, onConfirm: () => {} }));
    assert.ok(html.includes(`Confirm ${action}`));
    assert.ok(html.includes(`data-account-access-action="${expected}"`));
  }
  }
});

test('pending Distributor approval and disabled actions retain labels and state', () => {
  const Action = component('app/admin/distributors.jsx', 'Action', { React, Pressable: rnw.Pressable, Text: rnw.Text });
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(Action, { label: 'Approve', tone: 'success',
      disabled, onPress: () => {}, styles: emptyStyles }));
    assert.ok(html.includes('Approve'));
    assert.ok(html.includes('data-admin-distributors-action-tone="success"'));
    assert.ok(html.includes(`data-admin-distributors-action-disabled="${disabled}"`));
  }
});

test('targeted web overrides have explicit selected, destructive, success and disabled states', () => {
  const css = postcss.parse(read('global.css'));
  const selectors = [];
  css.walkRules((rule) => selectors.push(rule.selector));
  for (const marker of ['data-manager-request-page', 'data-account-access-action']) {
    assert.ok(selectors.some((selector) => selector.includes(marker) && selector.includes('selected') ||
      marker === 'data-account-access-action' && selector.includes(marker) && selector.includes('danger')));
    assert.ok(selectors.some((selector) => selector.includes(marker) && selector.includes(':is(div, span)')));
  }
  const distributors = read('app/admin/distributors.jsx');
  assert.match(distributors, /data-admin-distributors-action-tone="success"/);
  assert.match(distributors, /data-admin-distributors-action-disabled="true"/);
});

test('pagination and account action web color pairs meet readable contrast in both themes', () => {
  const css = postcss.parse(read('global.css'));
  const vars = {};
  css.walkRules((rule) => {
    if (rule.selector !== ':root' && rule.selector !== "[data-bluetap-theme='dark']") return;
    const values = vars[rule.selector] ||= {};
    rule.walkDecls((decl) => { if (decl.prop.startsWith('--bluetap-')) values[decl.prop] = decl.value; });
  });
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  for (const theme of [vars[':root'], { ...vars[':root'], ...vars["[data-bluetap-theme='dark']"] }]) {
    for (const [fg, bg] of [['--bluetap-pagination-on-selected', '--bluetap-pagination-selected'],
      ['--bluetap-account-on-danger', '--bluetap-account-danger'],
      ['--bluetap-account-disabled-text', '--bluetap-account-disabled']]) {
      const levels = [luminance(theme[fg]), luminance(theme[bg])].sort((a, b) => a - b);
      assert.ok((levels[1] + 0.05) / (levels[0] + 0.05) >= 4.5, `${fg} on ${bg}`);
    }
  }
});
