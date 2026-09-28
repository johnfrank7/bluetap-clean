import React from 'react';
import { Text } from 'react-native';

const glyphs = Object.freeze({
  bell: '\uD83D\uDD14',
  dashboard: '▦', requests: '▤', branches: '⌘', accounts: '◫', distributors: '◉', products: '◇', analytics: '▲', security: '◈', maintenance: '▣', theme: '◐', logout: '⇥', menu: '☰', close: '×', check: '✓',
});

export default function AdminIcon({ name, color = '#FFFFFF', size = 20, style }) {
  return <Text accessibilityElementsHidden style={[{ color, fontSize: size, fontWeight: '800', lineHeight: size + 2, textAlign: 'center' }, style]}>{glyphs[name] || '•'}</Text>;
}
