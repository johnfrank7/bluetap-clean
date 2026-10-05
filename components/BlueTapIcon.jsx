import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

const ICON_ASSETS = Object.freeze({
  home: require('../assets/icons/home.png'),
  add: require('../assets/icons/square-plus.png'),
  profile: require('../assets/icons/user.png'),
  people: require('../assets/icons/user.png'),
  requests: require('../assets/icons/ballot.png'),
  orders: require('../assets/icons/ballot.png'),
  schedule: require('../assets/icons/calendar-clock.png'),
  history: require('../assets/icons/time-past.png'),
  analytics: require('../assets/icons/time-past.png'),
  notifications: require('../assets/icons/notif.png'),
  edit: require('../assets/icons/pencil.png'),
  products: require('../assets/icons/square-plus.png'),
  applications: require('../assets/icons/square-plus.png'),
});

const ICON_FALLBACKS = Object.freeze({
  add: '+', analytics: '\u25B2', applications: '+', back: '\u2039', close: '\u00D7',
  coordination: '\u21C4', delivery: '\u2192', dispatch: '\u2192', edit: '\u270E', error: '\u00D7',
  exceptions: '!', history: '\u25F7', home: '\u2302', info: 'i', management: '\u2699',
  message: '\u25A3', notifications: '\u25C9', orders: '\u2637', people: '\u25C9', products: '+',
  profile: '\u25C9', requests: '\u2637', reset: '\u21BA', schedule: '\u25F7', send: '\u2191',
  success: '\u2713', sun: '\u2600', moon: '\u263E', star: '\u2726',
  'chevron-left': '\u2039', 'chevron-right': '\u203A', warning: '!',
});

const TONE_TOKEN = Object.freeze({
  danger: 'iconDanger', interactive: 'iconInteractive', muted: 'iconMuted', onPrimary: 'iconOnPrimary',
  primary: 'iconPrimary', secondary: 'iconSecondary', success: 'iconSuccess', warning: 'iconWarning',
});

export function resolveBlueTapIconColor(colors, tone = 'interactive') {
  const token = TONE_TOKEN[tone] || TONE_TOKEN.interactive;
  return colors?.[token] || colors?.primary || '#187BCD';
}

export default function BlueTapIcon({ accessibilityLabel, color, fallback, name, size = 24, source, style, tone = 'interactive' }) {
  const { colors } = useBlueTapTheme();
  const [assetFailed, setAssetFailed] = React.useState(false);
  const resolvedSource = source || ICON_ASSETS[name];
  const resolvedColor = color || resolveBlueTapIconColor(colors, tone);
  const fallbackGlyph = fallback || ICON_FALLBACKS[name] || '\u2022';
  const accessible = Boolean(accessibilityLabel);

  React.useEffect(() => setAssetFailed(false), [resolvedSource]);

  return (
    <View
      accessibilityElementsHidden={!accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessible ? 'image' : undefined}
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
      style={[styles.frame, { width: size, height: size }, style]}
    >
      {!!resolvedSource && !assetFailed ? (
        <Image
          source={resolvedSource}
          resizeMode="contain"
          style={{ width: size, height: size }}
          tintColor={resolvedColor}
          onError={() => setAssetFailed(true)}
        />
      ) : (
        <Text allowFontScaling={false} style={[styles.fallback, { color: resolvedColor, fontSize: size * 0.82, lineHeight: size }]}>
          {fallbackGlyph}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: 1, minWidth: 1 },
  fallback: { fontWeight: '900', textAlign: 'center' },
});
