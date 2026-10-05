import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { useBlueTapTheme } from './BlueTapTheme';

const BLUE_MARK = require('../assets/icons/bluetaplogo.png');
const WHITE_MARK = require('../assets/icons/bluetapwhitelogo.png');

export default function BlueTapBrandMark({ accessibilityLabel, color, inverse = false, size = 32, style }) {
  const { colors } = useBlueTapTheme();
  const [assetFailed, setAssetFailed] = React.useState(false);
  const resolvedColor = color || (inverse ? colors.iconOnPrimary : colors.iconPrimary);
  const accessible = Boolean(accessibilityLabel);

  React.useEffect(() => setAssetFailed(false), [inverse]);

  return (
    <View
      accessibilityElementsHidden={!accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessible ? 'image' : undefined}
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
      style={[styles.frame, { width: size, height: size }, style]}
    >
      {!assetFailed ? (
        <Image
          source={inverse ? WHITE_MARK : BLUE_MARK}
          resizeMode="contain"
          style={{ width: size, height: size }}
          tintColor={color ? resolvedColor : undefined}
          onError={() => setAssetFailed(true)}
        />
      ) : (
        <View style={[styles.drop, { width: size * 0.62, height: size * 0.62, borderRadius: size * 0.31, backgroundColor: resolvedColor }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: 1, minWidth: 1 },
  drop: { borderTopLeftRadius: 3, transform: [{ rotate: '45deg' }] },
});
