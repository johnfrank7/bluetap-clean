import React, { useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { signOutAndClearSessions } from '../services/authSession';

export const ADMIN_COLORS = {
  navy: '#187BCD',
  navyMuted: '#1565C0',
  blue: '#187BCD',
  cyan: '#42A5F5',
  green: '#1B8F4C',
  red: '#FF5B64',
  bg: '#F4FAFF',
  card: '#FFFFFF',
  border: '#D7ECFF',
  text: '#20384D',
  muted: '#6F8EA8',
};

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin/dashboard' },
  { key: 'products', label: 'Products', path: '/admin/products' },
  { key: 'requests', label: 'Requests', path: '/admin/request' },
  { key: 'distributors', label: 'Distributors', path: '/admin/distributors' },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics' },
  { key: 'profile', label: 'Profile', path: '/admin/profile' },
];

export function AdminWaterDrop({ color = ADMIN_COLORS.cyan, size = 18, outline = false }) {
  return (
    <View
      style={[
        styles.drop,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: outline ? 'transparent' : color,
          borderColor: color,
          borderWidth: outline ? 1.5 : 0,
        },
      ]}
    />
  );
}

export function AdminPill({ children, tone = 'blue' }) {
  const toneStyles = {
    blue: styles.pillBlue,
    green: styles.pillGreen,
    red: styles.pillRed,
    cyan: styles.pillCyan,
  };
  const textStyles = {
    blue: styles.pillTextBlue,
    green: styles.pillTextGreen,
    red: styles.pillTextRed,
    cyan: styles.pillTextCyan,
  };

  return (
    <View style={[styles.pill, toneStyles[tone] || toneStyles.blue]}>
      <Text style={[styles.pillText, textStyles[tone] || textStyles.blue]}>
        {children}
      </Text>
    </View>
  );
}

export default function AdminShell({
  active = 'dashboard',
  children,
  onSearchChange,
  searchPlaceholder = 'Search users, barangay...',
  searchValue,
  subtitle,
  title,
}) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [internalSearch, setInternalSearch] = useState('');
  const isCompactLayout = width < 768;
  const visibleSearchValue = searchValue ?? internalSearch;
  const handleSearchChange = onSearchChange || setInternalSearch;

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

  const navigationItems = NAV_ITEMS.map((item) => {
    const isActive = active === item.key;

    return (
      <TouchableOpacity
        key={item.key}
        activeOpacity={0.85}
        style={[
          styles.navItem,
          isCompactLayout && styles.navItemCompact,
          isActive && styles.navItemActive,
        ]}
        onPress={() => router.replace(item.path)}
      >
        <Text style={[styles.navText, isActive && styles.navTextActive]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.layout, isCompactLayout && styles.layoutCompact]}>
        <View style={[styles.sidebar, isCompactLayout && styles.sidebarCompact]}>
          <View style={[styles.brand, isCompactLayout && styles.brandCompact]}>
            <Image
              source={require('../assets/icons/bluetapwhitelogo.png')}
              style={styles.brandIcon}
              resizeMode="contain"
              tintColor="#FFFFFF"
            />
            <Text style={styles.brandText}>BlueTap</Text>
          </View>

          {isCompactLayout ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navListCompact}
            >
              {navigationItems}
            </ScrollView>
          ) : (
            <View style={styles.navList}>{navigationItems}</View>
          )}

          {!isCompactLayout && (
            <View style={styles.sidebarFooter}>
              <Text style={styles.footerText}>BlueTap Admin v2</Text>
            </View>
          )}
        </View>

        <View style={styles.main}>
          <View style={[styles.topbar, isCompactLayout && styles.topbarCompact]}>
            <View style={[styles.titleBlock, isCompactLayout && styles.titleBlockCompact]}>
              <Text style={styles.pageTitle}>{title}</Text>
              {!!subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
            </View>

            <View style={[styles.topbarActions, isCompactLayout && styles.topbarActionsCompact]}>
              <View style={[styles.searchBox, isCompactLayout && styles.searchBoxCompact]}>
                <TextInput
                  style={styles.searchInput}
                  placeholder={searchPlaceholder}
                  placeholderTextColor="#95A6B8"
                  value={visibleSearchValue}
                  onChangeText={handleSearchChange}
                />
              </View>

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.logoutButton,
                  isCompactLayout && styles.logoutButtonCompact,
                ]}
                onPress={handleLogout}
              >
                <Text style={styles.logoutText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.content,
              isCompactLayout && styles.contentCompact,
            ]}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: ADMIN_COLORS.bg,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: ADMIN_COLORS.bg,
  },
  layoutCompact: {
    flexDirection: 'column',
  },
  sidebar: {
    width: 230,
    backgroundColor: ADMIN_COLORS.navy,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
  },
  sidebarCompact: {
    width: '100%',
    borderRightWidth: 0,
  },
  brand: {
    height: 74,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  brandCompact: {
    height: 56,
    paddingHorizontal: 20,
  },
  brandIcon: {
    width: 26,
    height: 26,
    marginRight: 10,
  },
  brandText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: 'bold',
  },
  navList: {
    paddingTop: 14,
    paddingHorizontal: 14,
  },
  navListCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  navItem: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 18,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navItemCompact: {
    minHeight: 36,
    paddingHorizontal: 13,
    marginRight: 6,
    marginBottom: 0,
  },
  navItemActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: '#FFFFFF',
  },
  navText: {
    color: '#E3F2FD',
    fontSize: 14,
    fontWeight: '700',
  },
  navTextActive: {
    color: '#FFFFFF',
  },
  sidebarFooter: {
    marginTop: 'auto',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    padding: 20,
  },
  footerText: {
    color: '#E3F2FD',
    fontSize: 12,
    fontWeight: '700',
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  topbar: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 12,
  },
  topbarCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 20,
  },
  titleBlockCompact: {
    paddingRight: 0,
  },
  pageTitle: {
    color: ADMIN_COLORS.text,
    fontSize: 23,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  pageSubtitle: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  topbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topbarActionsCompact: {
    width: '100%',
    marginTop: 14,
  },
  searchBox: {
    width: 230,
    height: 40,
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 15,
  },
  searchBoxCompact: {
    flex: 1,
    width: undefined,
  },
  searchInput: {
    color: ADMIN_COLORS.text,
    fontSize: 13,
    outlineStyle: 'none',
  },
  logoutButton: {
    height: 40,
    minWidth: 82,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.blue,
    backgroundColor: '#FFFFFF',
    marginLeft: 10,
    paddingHorizontal: 18,
  },
  logoutButtonCompact: {
    minWidth: 72,
    paddingHorizontal: 14,
  },
  logoutText: {
    color: ADMIN_COLORS.blue,
    fontSize: 13,
    fontWeight: 'bold',
  },
  content: {
    paddingHorizontal: 28,
    paddingBottom: 30,
  },
  contentCompact: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  drop: {
    transform: [{ rotate: '45deg' }],
    borderTopLeftRadius: 3,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  pillText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  pillBlue: {
    backgroundColor: '#EAF2FF',
  },
  pillGreen: {
    backgroundColor: '#E3F8EF',
  },
  pillRed: {
    backgroundColor: '#FFE9E9',
  },
  pillCyan: {
    backgroundColor: '#E1F8F6',
  },
  pillTextBlue: {
    color: ADMIN_COLORS.blue,
  },
  pillTextGreen: {
    color: ADMIN_COLORS.green,
  },
  pillTextRed: {
    color: ADMIN_COLORS.red,
  },
  pillTextCyan: {
    color: '#008D85',
  },
});
