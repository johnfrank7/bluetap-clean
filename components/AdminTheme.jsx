import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { useColorScheme } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';

export const ADMIN_THEME_STORAGE_KEY = 'bluetap-admin-theme';
export const ADMIN_SIDEBAR_STORAGE_KEY = 'bluetap-admin-sidebar-collapsed';

const light = Object.freeze({
  ...BLUETAP_COLORS,
  sidebar: '#0E5F9F', sidebarHover: '#187BCD', sidebarActive: '#287FBE', sidebarBorder: 'rgba(255,255,255,0.14)',
  header: '#F8FCFF', input: '#F8FCFF', inputBorder: '#BDD5E6', overlay: 'rgba(8,31,51,.48)',
  tooltip: '#12304A', tooltipText: '#FFFFFF', neutral: '#EEF3F7', successSoft: '#E3F7EC', warningSoft: '#FFF7E5',
});

const dark = Object.freeze({
  ...BLUETAP_COLORS,
  background: '#0D1B2A', surface: '#14283A', surfaceAlt: '#193247', border: '#29485F',
  text: '#F1F7FC', textPrimary: '#F1F7FC', textSecondary: '#AFC2D2', muted: '#AFC2D2',
  primarySoft: '#173C58', sidebar: '#0A1725', sidebarHover: '#122C42', sidebarActive: '#164A70', sidebarBorder: '#26465E',
  header: '#102235', input: '#10283B', inputBorder: '#3A5C73', overlay: 'rgba(2,10,18,.68)',
  tooltip: '#EAF5FC', tooltipText: '#102235', neutral: '#20384B', successSoft: '#123D30', warningSoft: '#4B3916', dangerSoft: '#49282B', disabled: '#668094',
});

const AdminThemeContext = React.createContext(null);

export function AdminThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = React.useState('system');
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(ADMIN_THEME_STORAGE_KEY)
      .then((value) => {
        if (active && ['light', 'dark', 'system'].includes(value)) setPreferenceState(value);
      })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  const setPreference = React.useCallback((next) => {
    if (!['light', 'dark', 'system'].includes(next)) return;
    setPreferenceState(next);
    AsyncStorage.setItem(ADMIN_THEME_STORAGE_KEY, next).catch(() => {});
  }, []);
  const resolvedTheme = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
  const value = React.useMemo(() => ({ colors: resolvedTheme === 'dark' ? dark : light, layout: BLUETAP_LAYOUT, preference, resolvedTheme, setPreference, ready }), [preference, ready, resolvedTheme, setPreference]);
  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme() {
  const theme = React.useContext(AdminThemeContext);
  if (!theme) return { colors: light, layout: BLUETAP_LAYOUT, preference: 'light', resolvedTheme: 'light', setPreference: () => {}, ready: true };
  return theme;
}

