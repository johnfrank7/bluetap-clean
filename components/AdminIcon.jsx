import React from 'react';
import { Text } from 'react-native';

const glyphs = Object.freeze({
  dashboard: '▦', branches: '⌘', accounts: '◫', distributors: '◉', products: '◇', security: '◈', theme: '◐', logout: '⇥', menu: '☰', close: '×', check: '✓',
});

export default function AdminIcon({ name, color = '#FFFFFF', size = 20, style }) {
  return <Text accessibilityElementsHidden style={[{ color, fontSize: size, fontWeight: '800', lineHeight: size + 2, textAlign: 'center' }, style]}>{glyphs[name] || '•'}</Text>;
}
