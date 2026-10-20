import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

// Lucide SVGs, shared by both privileged sidebars. See assets/icons/sidebar/LICENSE.
const icons = Object.freeze({
  LayoutDashboard: require('../assets/icons/sidebar/layout-dashboard.svg'),
  ClipboardList: require('../assets/icons/sidebar/clipboard-list.svg'),
  Truck: require('../assets/icons/sidebar/truck.svg'),
  UsersRound: require('../assets/icons/sidebar/users-round.svg'),
  Package: require('../assets/icons/sidebar/package.svg'),
  BarChart3: require('../assets/icons/sidebar/chart-column.svg'),
  CircleDollarSign: require('../assets/icons/sidebar/circle-dollar-sign.svg'),
  ShieldCheck: require('../assets/icons/sidebar/shield-check.svg'),
  UserCircle2: require('../assets/icons/sidebar/circle-user-round.svg'),
  Building2: require('../assets/icons/sidebar/building-2.svg'),
  FileSearch: require('../assets/icons/sidebar/file-search.svg'),
  ShieldAlert: require('../assets/icons/sidebar/shield-alert.svg'),
  ShieldCog: require('../assets/icons/sidebar/shield-cog.svg'),
  Settings2: require('../assets/icons/sidebar/settings-2.svg'),
  LogOut: require('../assets/icons/sidebar/log-out.svg'),
  Menu: require('../assets/icons/sidebar/menu.svg'),
  X: require('../assets/icons/sidebar/x.svg'),
  Sun: require('../assets/icons/sidebar/sun.svg'),
  Moon: require('../assets/icons/sidebar/moon.svg'),
});

export const MANAGER_SIDEBAR_ICONS = Object.freeze({
  dashboard: 'LayoutDashboard', requests: 'ClipboardList', distributors: 'Truck',
  accounts: 'UsersRound', products: 'Package', analytics: 'BarChart3',
  reports: 'ShieldCheck', profile: 'UserCircle2',
});

export const ADMIN_SIDEBAR_ICONS = Object.freeze({
  dashboard: 'LayoutDashboard', requests: 'ClipboardList', branches: 'Building2',
  accounts: 'FileSearch', distributors: 'Truck', products: 'Package',
  analytics: 'BarChart3', reports: 'ShieldAlert', security: 'ShieldCog', maintenance: 'Settings2',
});

export default function SidebarIcon({ name, size = 20, color = '#FFFFFF' }) {
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width: size, height: size }]}>
      <Image source={icons[name]} contentFit="contain" tintColor={color} transition={0}
        accessible={false} style={{ width: size, height: size }} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
});
