import React, { useState, useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
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
  { key: 'requests', label: 'Requests', path: '/manager/request', icon: 'security' },
  { key: 'distributors', label: 'Distributors', path: '/manager/distributors', icon: 'distributors' },
  { key: 'products', label: 'Products', path: '/manager/products', icon: 'products' },
  { key: 'analytics', label: 'Analytics', path: '/manager/analytics', icon: 'accounts' },
  { key: 'profile', label: 'Profile', path: '/manager/profile', icon: 'theme' },
];

const DESKTOP_WIDTH = 244;
const COLLAPSED_WIDTH = 76;
const DRAWER_WIDTH = 286;

export function ManagerWaterDrop({ color, size = 18, outline = false }) {
  const { colors } = useAdminTheme();
  const dropColor = color || colors.primaryLight;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: outline ? 'transparent' : dropColor,
        borderColor: dropColor,
        borderWidth: outline ? 1.5 : 0,
        transform: [{ rotate: '45deg' }],
        borderTopLeftRadius: 3,
      }}
    />
  );
}

export function ManagerPill({ children, tone = 'blue' }) {
  const { colors } = useAdminTheme();
  const toneBg = {
    blue: colors.primarySoft,
    green: colors.successSoft,
    red: colors.dangerSoft,
    cyan: colors.neutral,
  };
  const toneText = {
    blue: colors.primary,
    green: colors.success,
    red: colors.danger,
    cyan: colors.primaryLight,
  };

  return (
    <View style={{
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 5,
      backgroundColor: toneBg[tone] || toneBg.blue,
    }}>
      <Text style={{
        fontSize: 12,
        fontWeight: 'bold',
        color: toneText[tone] || toneText.blue,
      }}>
        {children}
      </Text>
    </View>
  );
}

function SidebarThemeToggle({ collapsed, colors }) {
  const { resolvedTheme, setPreference } = useAdminTheme();
  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Dark mode' : 'Light mode';

  return (
    <View style={[styles.themeSection, { borderTopColor: colors.sidebarBorder }]}>
      <TouchableOpacity
        accessibilityRole="switch"
        accessibilityLabel={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        accessibilityState={{ checked: isDark }}
        onPress={() => setPreference(isDark ? 'light' : 'dark')}
        style={[styles.themeToggle, collapsed && styles.themeToggleCollapsed]}
      >
        <View style={[styles.themeTrack, { backgroundColor: isDark ? colors.primary : 'rgba(255,255,255,0.28)' }]}>
          <View style={[styles.themeThumb, isDark && styles.themeThumbDark]}>
            <Text style={{ fontSize: 10, textAlign: 'center', lineHeight: 22, color: isDark ? '#0F172A' : '#F59E0B' }}>
              {isDark ? '☾' : '☀'}
            </Text>
          </View>
        </View>
        {!collapsed && <Text style={styles.themeLabel}>{label}</Text>}
      </TouchableOpacity>
    </View>
  );
}

function SidebarLogoutControl({ collapsed, onPress, colors }) {
  return (
    <View style={styles.navItemWrap}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Log out"
        accessibilityHint={collapsed ? 'Log out of BlueTap' : undefined}
        onPress={onPress}
        style={[styles.logout, collapsed && styles.logoutCollapsed, { borderTopColor: colors.sidebarBorder }]}
      >
        <AdminIcon name="logout" size={21} color="#FFD7D7" />
        {!collapsed && <Text style={styles.logoutText}>Log out</Text>}
      </TouchableOpacity>
    </View>
  );
}

export default function ManagerShell({
  active = 'dashboard',
  children,
  subtitle,
  title,
}) {
  const { colors, resolvedTheme } = useAdminTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const managerSession = getModuleSession('manager');
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [actionableRequestsCount, setActionableRequestsCount] = useState(0);

  const sidebarWidth = useRef(new Animated.Value(DESKTOP_WIDTH)).current;
  const drawerProgress = useRef(new Animated.Value(0)).current;

  // Branch-scoped actionable requests subscription
  const managerBranchId = managerSession?.branchId || managerSession?.branch?.id || '';

  useEffect(() => {
    if (!managerBranchId) {
      setActionableRequestsCount(0);
      return;
    }

    let count1 = 0;
    let count2 = 0;
    let unsub1 = null;
    let unsub2 = null;

    try {
      const q1 = query(
        collection(db, 'requests'),
        where('branchId', '==', managerBranchId),
        where('status', 'in', ['pending', 'outside_radius_pending_approval', 'awaiting_distributor_assignment'])
      );
      unsub1 = onSnapshot(
        q1,
        (snap) => {
          count1 = snap.size;
          setActionableRequestsCount(count1 + count2);
        },
        () => {}
      );

      const q2 = query(
        collection(db, 'requests'),
        where('transferToBranchId', '==', managerBranchId),
        where('status', '==', 'branch_transfer_pending')
      );
      unsub2 = onSnapshot(
        q2,
        (snap) => {
          count2 = snap.size;
          setActionableRequestsCount(count1 + count2);
        },
        () => {}
      );
    } catch (err) {
      console.log('Manager requests badge error:', err?.message);
    }

    return () => {
      if (typeof unsub1 === 'function') unsub1();
      if (typeof unsub2 === 'function') unsub2();
    };
  }, [managerBranchId]);

  useEffect(() => {
    Animated.timing(sidebarWidth, {
      toValue: collapsed ? COLLAPSED_WIDTH : DESKTOP_WIDTH,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [collapsed, sidebarWidth]);

  useEffect(() => {
    if (!compact) setDrawerOpen(false);
  }, [compact]);

  useEffect(() => {
    Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [drawerOpen, drawerProgress]);

  useEffect(() => {
    if (!globalThis.addEventListener) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (confirmLogout) setConfirmLogout(false);
      else if (drawerOpen) setDrawerOpen(false);
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener?.('keydown', onKeyDown);
  }, [confirmLogout, drawerOpen]);

  const toggleNavigation = () => {
    if (compact) {
      setDrawerOpen((open) => !open);
    } else {
      setCollapsed((value) => !value);
    }
  };

  const navigate = (path) => {
    router.replace(path);
    if (compact) setDrawerOpen(false);
  };

  const completeLogout = async () => {
    setConfirmLogout(false);
    await signOutAndClearSessions();
    router.replace('/login');
  };

  const renderSidebar = (isCollapsed, mobile = false) => (
    <Animated.View
      style={[
        styles.sidebar,
        mobile && styles.drawer,
        {
          width: mobile ? DRAWER_WIDTH : sidebarWidth,
          backgroundColor: colors.sidebar,
          borderRightColor: colors.sidebarBorder,
          transform: mobile
            ? [
                {
                  translateX: drawerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-DRAWER_WIDTH, 0],
                  }),
                },
              ]
            : undefined,
        },
      ]}
    >
      <View style={[styles.brand, { borderBottomColor: colors.sidebarBorder }, isCollapsed && styles.brandCollapsed]}>
        <Image
          source={require('../assets/icons/bluetapwhitelogo.png')}
          style={[styles.brandLogo, isCollapsed && styles.brandLogoCollapsed]}
          resizeMode="contain"
        />
        {!isCollapsed && (
          <View style={{ flex: 1 }}>
            <Text style={styles.brandName}>BlueTap</Text>
            <Text style={styles.brandRole}>Manager</Text>
            {!!managerSession?.branchName && (
              <Text style={styles.brandBranch} numberOfLines={1}>
                {managerSession.branchName}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.navigation}>
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.key;
          const isReq = item.key === 'requests';
          const label = isReq && actionableRequestsCount > 0
            ? `Requests [${actionableRequestsCount}]`
            : item.label;

          return (
            <View key={item.key} style={styles.navItemWrap}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isActive }}
                onPress={() => navigate(item.path)}
                style={[
                  styles.navItem,
                  isCollapsed && styles.navItemCollapsed,
                  isActive && {
                    backgroundColor: colors.sidebarActive,
                    borderColor: 'rgba(255,255,255,.42)',
                  },
                ]}
              >
                <AdminIcon name={item.icon} size={20} color={isActive ? '#FFFFFF' : '#CBEAFF'} />
                {!isCollapsed && (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 }}>
                    <Text numberOfLines={1} style={styles.navText}>
                      {item.label}
                    </Text>
                    {isReq && (
                      <View style={[styles.badgePill, { backgroundColor: actionableRequestsCount > 0 ? colors.warning : 'rgba(255,255,255,0.2)' }]}>
                        <Text style={styles.badgePillText}>{actionableRequestsCount}</Text>
                      </View>
                    )}
                  </View>
                )}
                {isActive && <View style={styles.activeMarker} />}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <View style={styles.sidebarBottom}>
        <SidebarThemeToggle collapsed={isCollapsed} colors={colors} />
        <SidebarLogoutControl
          collapsed={isCollapsed}
          colors={colors}
          onPress={() => setConfirmLogout(true)}
        />
      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.layout}>
        {!compact && renderSidebar(collapsed)}

        <View style={styles.main}>
          <View style={[styles.header, { backgroundColor: colors.header, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Toggle navigation"
              onPress={toggleNavigation}
              style={[styles.menuButton, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}
            >
              <AdminIcon
                name={compact ? (drawerOpen ? 'close' : 'menu') : (collapsed ? 'menu' : 'close')}
                color={colors.primary}
                size={23}
              />
            </TouchableOpacity>

            <View style={styles.heading}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>
                {title}
              </Text>
              {!!subtitle && (
                <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textSecondary }]}>
                  {subtitle}
                </Text>
              )}
            </View>

            <View style={[styles.managerBadge, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
              <AdminIcon name="security" color={colors.primary} size={16} />
              <Text style={[styles.managerBadgeText, { color: colors.primary }]}>Manager</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>

        {compact && (
          <>
            {drawerOpen && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close navigation"
                onPress={() => setDrawerOpen(false)}
                style={[styles.backdrop, { backgroundColor: colors.overlay }]}
              />
            )}
            {renderSidebar(false, true)}
          </>
        )}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  layout: { flex: 1, flexDirection: 'row' },
  sidebar: { zIndex: 4, overflow: 'visible', borderRightWidth: 1 },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, elevation: 18, shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 4, height: 0 } },
  brand: { minHeight: 86, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, gap: 11, borderBottomWidth: 1, paddingVertical: 12 },
  brandCollapsed: { justifyContent: 'center', paddingHorizontal: 12 },
  brandLogo: { width: 34, height: 34 },
  brandLogoCollapsed: { width: 38, height: 38 },
  brandName: { color: '#FFFFFF', fontSize: 19, fontWeight: '900' },
  brandRole: { color: '#CBEAFF', fontSize: 12, marginTop: 1, fontWeight: '700' },
  brandBranch: { color: '#90CDF4', fontSize: 11, marginTop: 2, fontWeight: '600' },
  navigation: { paddingHorizontal: 12, paddingTop: 16 },
  navItemWrap: { position: 'relative', zIndex: 10 },
  navItem: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  navItemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  navText: { color: '#F5FBFF', fontSize: 13, fontWeight: '800', flex: 1 },
  activeMarker: { width: 4, height: 18, borderRadius: 999, backgroundColor: '#E0F3FF' },
  sidebarBottom: { marginTop: 'auto' },
  themeSection: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 14 },
  themeToggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2, borderRadius: 12 },
  themeToggleCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  themeTrack: { width: 52, height: 28, borderRadius: 999, padding: 3, justifyContent: 'center' },
  themeThumb: { width: 22, height: 22, borderRadius: 999, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  themeThumbDark: { alignSelf: 'flex-end' },
  themeLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  logout: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, borderTopWidth: 1 },
  logoutCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  logoutText: { color: '#FFE1E1', fontWeight: '900', fontSize: 13 },
  main: { flex: 1, minWidth: 0 },
  header: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, borderBottomWidth: 1 },
  menuButton: { width: 42, height: 42, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  managerBadge: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10 },
  managerBadgeText: { fontSize: 12, fontWeight: '900' },
  content: { paddingHorizontal: 28, paddingBottom: 32, paddingTop: 14, flexGrow: 1 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 3 },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 18, padding: 22 },
  modalIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  modalBody: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  modalSecondary: { minHeight: 44, paddingHorizontal: 17, justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  modalSecondaryText: { fontWeight: '800' },
  modalDanger: { minHeight: 44, paddingHorizontal: 17, justifyContent: 'center', borderRadius: 10 },
  modalDangerText: { color: '#FFFFFF', fontWeight: '900' },
  badgePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, minWidth: 20, alignItems: 'center', justifyContent: 'center' },
  badgePillText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
});
