const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const parser = require('@babel/parser');
const { transformSync } = require('@babel/core');

test('assigned request card renders with light and dark theme colors', () => {
  const source = readFileSync(resolve(__dirname, '../../../app/distributor/d_requests.jsx'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = ast.program.body.find((node) => node.type === 'VariableDeclaration'
    && node.declarations.some((entry) => entry.id.name === 'PendingRequestCard'));
  assert.ok(declaration, 'PendingRequestCard must exist');
  const compiled = transformSync(source.slice(declaration.start, declaration.end), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx'],
  }).code;
  const element = ({ children }) => React.createElement('div', null, children);
  const icon = ({ name, color }) => React.createElement('i', { 'data-icon': name, 'data-color': color });
  const Animated = { View: element, Value: class { interpolate() { return 0; } } };
  const deps = { React, memo: React.memo, useRef: React.useRef, useEffect: React.useEffect,
    Animated, View: element, Text: element, TouchableOpacity: element, ActivityIndicator: element,
    OngoingRequestFieldIcon: icon, SoftStatusBadge: element, styles: {}, BLUE: '#187BCD',
    BLUETAP_COLORS: { danger: '#B52F2F' }, analyzeOrderCargo: () => ({ badgeLabel: '1 container' }),
    formatDisplayUniqueId: (value, fallback) => value || fallback };
  for (const textSecondary of ['#64748B', '#9FB4C8']) {
    const names = Object.keys(deps);
    const card = new Function(...names, 'useBlueTapTheme', `${compiled}\nreturn PendingRequestCard;`)(
      ...names.map((name) => deps[name]), () => ({ colors: { textSecondary } }));
    const output = renderToStaticMarkup(React.createElement(card, { index: 0, request: {
      id: 'QA-1', requester: 'Synthetic requester', productName: 'Water', quantity: 1,
      address: 'Synthetic address', status: 'pending',
    } }));
    assert.match(output, /Synthetic requester/);
    assert.match(output, /Accept Assignment/);
    assert.match(output, new RegExp(`data-icon="User" data-color="${textSecondary}"`));
  }
});
