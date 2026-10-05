import React from 'react';
import { Text } from 'react-native';

const glyphs = Object.freeze({
  bell: '\u25C9',
  dashboard: '\u25A6',
  requests: '\u2637',
  branches: '\u2318',
  accounts: '\u25CE',
  distributors: '\u25C9',
  products: '\u25C7',
  analytics: '\u25B2',
  security: '\u25C8',
  maintenance: '\u25A3',
  theme: '\u25D0',
  logout: '\u21E5',
  menu: '\u2630',
  close: '\u00D7',
  check: '\u2713',
});

export default function AdminIcon({ name, color = '#FFFFFF', size = 20, style }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ color, fontSize: size, fontWeight: '800', lineHeight: size + 2, minHeight: size, minWidth: size, textAlign: 'center' }, style]}
    >
      {glyphs[name] || '\u2022'}
    </Text>
  );
}
