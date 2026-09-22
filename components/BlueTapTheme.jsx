import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';

import {
  BLUETAP_DARK_PORTAL_COLORS,
  BLUETAP_LAYOUT,
  BLUETAP_LIGHT_PORTAL_COLORS,
} from '../constants/bluetapTheme';

export const BLUETAP_THEME_STORAGE_KEY = 'bluetap-theme';

const BlueTapThemeContext = React.createContext(null);
let activePortalTheme = 'light';

function readWebTheme() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(BLUETAP_THEME_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function BlueTapThemeProvider({ children }) {
  const [preference, setPreferenceState] = React.useState(() => {
    const storedTheme = readWebTheme();
    return storedTheme === 'dark' ? 'dark' : 'light';
  });
  const [ready, setReady] = React.useState(() => Platform.OS === 'web');

  React.useEffect(() => {
    let active = true;
    AsyncStorage.getItem(BLUETAP_THEME_STORAGE_KEY)
      .then((storedTheme) => {
        if (active && (storedTheme === 'light' || storedTheme === 'dark')) {
          setPreferenceState(storedTheme);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = React.useCallback((nextTheme) => {
    if (nextTheme !== 'light' && nextTheme !== 'dark') return;
    setPreferenceState(nextTheme);
    AsyncStorage.setItem(BLUETAP_THEME_STORAGE_KEY, nextTheme).catch(() => {});
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.localStorage?.setItem(BLUETAP_THEME_STORAGE_KEY, nextTheme);
      } catch {}
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setPreference(preference === 'dark' ? 'light' : 'dark');
  }, [preference, setPreference]);
  const colors = preference === 'dark'
    ? BLUETAP_DARK_PORTAL_COLORS
    : BLUETAP_LIGHT_PORTAL_COLORS;
  activePortalTheme = preference;

  const value = React.useMemo(
    () => ({ colors, isDark: preference === 'dark', layout: BLUETAP_LAYOUT, preference, ready, setPreference, toggleTheme }),
    [colors, preference, ready, setPreference, toggleTheme]
  );

  return <BlueTapThemeContext.Provider value={value}>{children}</BlueTapThemeContext.Provider>;
}

export function useBlueTapTheme() {
  const value = React.useContext(BlueTapThemeContext);
  if (value) return value;
  return {
    colors: BLUETAP_LIGHT_PORTAL_COLORS,
    isDark: false,
    layout: BLUETAP_LAYOUT,
    preference: 'light',
    ready: true,
    setPreference: () => {},
    toggleTheme: () => {},
  };
}

const DARK_COLOR_MAP = Object.freeze({
  '#f4faff': 'background',
  '#f2f2f2': 'background',
  '#ffffff': 'surface',
  '#fff': 'surface',
  white: 'surface',
  '#f7fbff': 'surfaceAlt',
  '#f8fcff': 'surfaceAlt',
  '#eaf6ff': 'primarySoft',
  '#e3f2fd': 'primarySoft',
  '#d7ecff': 'border',
  '#b7ddf7': 'border',
  '#187bcd': 'primary',
  '#1565c0': 'primary',
  '#0b5fa8': 'primaryLight',
  '#2563eb': 'primaryLight',
  '#0d47a1': 'primaryLight',
  '#42a5f5': 'primaryLight',
  '#12304a': 'textPrimary',
  '#20384d': 'textPrimary',
  '#455a64': 'textSecondary',
  '#64748b': 'textSecondary',
  '#6f8ea8': 'textSecondary',
  '#6f879c': 'textSecondary',
  '#90a4ae': 'muted',
  '#eef3f7': 'surfaceAlt',
  '#eff6ff': 'primarySoft',
  '#d1e7f8': 'primarySoft',
  '#fff8e8': 'warningSoft',
  '#fff8e6': 'warningSoft',
  '#e8c77f': 'warning',
  '#e8f7ef': 'successSoft',
  '#ecfdf5': 'successSoft',
  '#fef2f2': 'dangerSoft',
});

function mapDarkColor(value, property, colors) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();

  if (property === 'shadowColor') return '#000000';
  if (property === 'color' && ['#fff', '#ffffff', 'white'].includes(normalized)) {
    return colors.white;
  }
  if (property === 'color' && ['#000', '#000000', 'black'].includes(normalized)) {
    return colors.textPrimary;
  }
  if (normalized.startsWith('rgba(255,255,255') || normalized.startsWith('rgba(255, 255, 255')) {
    if (property === 'color') return colors.textPrimary;
    if (property.toLowerCase().includes('border')) return colors.border;
    return colors.surfaceElevated;
  }

  const token = DARK_COLOR_MAP[normalized];
  return token ? colors[token] : value;
}

function transformPortalStyle(style, colors) {
  if (!style || typeof style !== 'object') return style;
  const next = { ...style };
  ['backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'color', 'shadowColor'].forEach((property) => {
    if (property in next) next[property] = mapDarkColor(next[property], property, colors);
  });
  return next;
}

export function createPortalStyleSheet(definition) {
  const base = StyleSheet.create(definition);
  const cache = new Map();
  return new Proxy(base, {
    get(target, property) {
      const value = target[property];
      if (activePortalTheme !== 'dark' || typeof property === 'symbol') return value;
      const cacheKey = String(property);
      if (!cache.has(cacheKey)) {
        cache.set(cacheKey, transformPortalStyle(StyleSheet.flatten(value), BLUETAP_DARK_PORTAL_COLORS));
      }
      return cache.get(cacheKey);
    },
  });
}
