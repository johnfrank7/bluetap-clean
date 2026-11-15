import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

export const ONGOING_DETAIL_FIELD_ICONS = Object.freeze({
  product: 'Package',
  quantityContainer: 'Layers',
  scheduledDelivery: 'CalendarClock',
  deliveryAddress: 'MapPin',
  lastStatusUpdate: 'ClockHistory',
});

const icons = Object.freeze({
  Package: require('../assets/icons/sidebar/package.svg'),
  Layers: require('../assets/icons/ongoing/layers.svg'),
  CalendarClock: require('../assets/icons/ongoing/calendar-clock.svg'),
  MapPin: require('../assets/icons/ongoing/map-pin.svg'),
  ClockHistory: require('../assets/icons/ongoing/clock-history.svg'),
});

export default function OngoingRequestFieldIcon({
  name,
  size = 16,
  tintColor = '#4A6378',
  color = tintColor,
  accessibilityLabel,
}) {
  const source = icons[name] || icons.Package;
  const accessible = Boolean(accessibilityLabel);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden={!accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessible ? 'image' : undefined}
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
      style={[styles.frame, { width: size, height: size }]}
    >
      <Image
        source={source}
        contentFit="contain"
        tintColor={color}
        transition={0}
        accessible={false}
        style={{ width: size, height: size }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
