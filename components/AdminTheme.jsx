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
  background: '#07131F', surface: '#0E2235', surfaceAlt: '#112A40', border: '#1C3C55',
  text: '#F5FAFF', textPrimary: '#F5FAFF', textSecondary: '#9FB4C8', muted: '#6F879C',
  primary: '#2186D9', primaryHover: '#3B9CE8', primaryLight: '#70BDF2', primarySoft: '#163B59',
  success: '#22C55E', warning: '#F59E0B', danger: '#EF4444',
  sidebar: '#0A1928', sidebarHover: '#112A40', sidebarActive: '#163B59', sidebarBorder: '#1C3C55',
  header: '#0A1928', input: '#0A1928', inputBorder: '#1C3C55', overlay: 'rgba(2,10,18,.72)',
  tooltip: '#F5FAFF', tooltipText: '#07131F', neutral: '#112A40', successSoft: '#103B2A', warningSoft: '#493814', dangerSoft: '#48262A', disabled: '#6F879C',
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
