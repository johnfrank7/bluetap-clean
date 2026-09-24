import React, { useState } from 'react';
import {
  Image,
  Modal,
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

import { BLUETAP_COLORS } from '../constants/bluetapTheme';
import { useAdminTheme } from './AdminTheme';
import AdminIcon from './AdminIcon';
import { getModuleSession, signOutAndClearSessions } from '../services/authSession';

export const MANAGER_COLORS = {
  navy: BLUETAP_COLORS.primary,
  navyMuted: BLUETAP_COLORS.primaryDark,
  blue: BLUETAP_COLORS.primary,
  cyan: BLUETAP_COLORS.primaryLight,
  green: '#1B8F4C',
  red: '#FF5B64',
  bg: BLUETAP_COLORS.background,
  card: BLUETAP_COLORS.surface,
  border: BLUETAP_COLORS.border,
  text: BLUETAP_COLORS.textPrimary,
  muted: BLUETAP_COLORS.textSecondary,
};

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', path: '/manager/dashboard', icon: 'dashboard' },
  { key: 'products', label: 'Products', path: '/manager/products', icon: 'products' },
  { key: 'requests', label: 'Requests', path: '/manager/request', icon: 'security' },
  { key: 'distributors', label: 'Distributors', path: '/manager/distributors', icon: 'distributors' },
  { key: 'analytics', label: 'Analytics', path: '/manager/analytics', icon: 'accounts' },
  { key: 'profile', label: 'Profile', path: '/manager/profile', icon: 'theme' },
];


export function ManagerWaterDrop({ color, size = 18, outline = false }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
  const dropColor = color || colors.primaryLight;
  return (
    <View
      style={[
        styles.drop,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: outline ? 'transparent' : dropColor,
          borderColor: dropColor,
          borderWidth: outline ? 1.5 : 0,
        },
      ]}
    />
  );
}

export function ManagerPill({ children, tone = 'blue' }) {
  const { colors } = useAdminTheme();
  const styles = createStyles(colors);
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

export function ManagerThemeSwitcher({ colors, isCompact }) {
  const { resolvedTheme, setPreference } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Dark' : 'Light';
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      accessibilityState={{ checked: isDark }}
      onPress={() => setPreference(isDark ? 'light' : 'dark')}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
          backgroundColor: colors.surfaceAlt || 'rgba(0,0,0,0.04)',
          borderWidth: 1,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={{
          width: 36,
          height: 20,
          borderRadius: 999,
          backgroundColor: isDark ? colors.primary : colors.success,
          padding: 2,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            backgroundColor: '#FFFFFF',
            alignSelf: isDark ? 'flex-end' : 'flex-start',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
      </View>
      {!isCompact && (
        <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: '800' }}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default function ManagerShell({
  active = 'dashboard',
  children,
  subtitle,
  title,
}) {
  const { colors, resolvedTheme } = useAdminTheme();
  const styles = createStyles(colors);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompactLayout = width < 768;
  const managerSession = getModuleSession('manager');
  const [confirmLogout, setConfirmLogout] = useState(false);

  React.useEffect(() => {
    if (!globalThis.addEventListener) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && confirmLogout) setConfirmLogout(false);
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener?.('keydown', onKeyDown);
  }, [confirmLogout]);

  const completeLogout = async () => {
    setConfirmLogout(false);
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
        <AdminIcon
          name={item.icon}
          size={isCompactLayout ? 16 : 18}
          color={isActive ? '#FFFFFF' : '#CBEAFF'}
        />
        <Text style={[styles.navText, isActive && styles.navTextActive]}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
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
          {!!managerSession?.branchName && <Text style={[styles.branchName, isCompactLayout && styles.branchNameCompact]} numberOfLines={1}>{managerSession.branchName}</Text>}

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
              <Text style={styles.footerText}>BlueTap Manager v2</Text>
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
              <ManagerThemeSwitcher colors={colors} isCompact={isCompactLayout} />

              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.logoutButton,
                  isCompactLayout && styles.logoutButtonCompact,
                ]}
                onPress={() => setConfirmLogout(true)}
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

      <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => setConfirmLogout(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}>
          <View accessibilityViewIsModal style={[styles.modal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.modalIcon, { backgroundColor: colors.dangerSoft }]}>
              <AdminIcon name="logout" color={colors.danger} size={24} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Log out of BlueTap?</Text>
            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>You will need to sign in again to access Manager tools.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel logout" onPress={() => setConfirmLogout(false)} style={[styles.modalSecondary, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.modalSecondaryText, { color: colors.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Confirm logout" onPress={completeLogout} style={[styles.modalDanger, { backgroundColor: colors.danger }]}>
                <Text style={styles.modalDangerText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  layoutCompact: {
    flexDirection: 'column',
  },
  sidebar: {
    width: 230,
    backgroundColor: colors.sidebar,
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
  branchName: {
    color: '#CBEAFF',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 28,
    paddingTop: 10,
  },
  branchNameCompact: {
    paddingHorizontal: 20,
    paddingTop: 7,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    backgroundColor: colors.sidebarActive,
    borderColor: colors.primaryLight,
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
    color: colors.textPrimary,
    fontSize: 23,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  pageSubtitle: {
    color: colors.textSecondary,
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
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 15,
  },
  searchBoxCompact: {
    flex: 1,
    width: undefined,
  },
  searchInput: {
    color: colors.textPrimary,
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
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    marginLeft: 10,
    paddingHorizontal: 18,
  },
  logoutButtonCompact: {
    minWidth: 72,
    paddingHorizontal: 14,
  },
  logoutText: {
    color: colors.primary,
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
    backgroundColor: colors.primarySoft,
  },
  pillGreen: {
    backgroundColor: colors.successSoft,
  },
  pillRed: {
    backgroundColor: colors.dangerSoft,
  },
  pillCyan: {
    backgroundColor: colors.neutral,
  },
  pillTextBlue: {
    color: colors.primary,
  },
  pillTextGreen: {
    color: colors.success,
  },
  pillTextRed: {
    color: colors.danger,
  },
  pillTextCyan: {
    color: colors.primaryLight,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    padding: 22,
  },
  modalIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 22,
  },
  modalSecondary: {
    minHeight: 44,
    paddingHorizontal: 17,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
  },
  modalSecondaryText: {
    fontWeight: '800',
  },
  modalDanger: {
    minHeight: 44,
    paddingHorizontal: 17,
    justifyContent: 'center',
    borderRadius: 10,
  },
  modalDangerText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
});
