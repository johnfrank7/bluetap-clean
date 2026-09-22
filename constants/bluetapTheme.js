export const BLUETAP_COLORS = Object.freeze({
  primary: '#187BCD',
  primaryHover: '#1565C0',
  primaryDark: '#1565C0',
  primaryDeep: '#0B5FA8',
  primaryLight: '#42A5F5',
  primarySoft: '#EAF6FF',
  background: '#F4FAFF',
  text: '#12304A',
  muted: '#64748B',
  surface: '#FFFFFF', surfaceAlt: '#F8FCFF', border: '#D7ECFF',
  textPrimary: '#12304A', textSecondary: '#64748B',
  success: '#167347', warning: '#A96800', danger: '#B52F2F', dangerSoft: '#FCE9E8', disabled: '#A8BBCB',
  white: '#FFFFFF',
});

export const BLUETAP_LAYOUT = Object.freeze({
  radius: { sm: 8, md: 12, lg: 16, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 },
  shadow: { shadowColor: '#12304A', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
});

export const BLUETAP_LOGIN_GRADIENT = [
  BLUETAP_COLORS.primary,
  BLUETAP_COLORS.primaryLight,
];

export const BLUETAP_DARK_COLORS = Object.freeze({
  background: '#07131F',
  header: '#0A1928',
  surface: '#0E2235',
  surfaceAlt: '#112A40',
  surfaceElevated: '#163B59',
  border: '#1C3C55',
  input: '#0A1928',
  text: '#F5FAFF',
  textPrimary: '#F5FAFF',
  textSecondary: '#9FB4C8',
  muted: '#9FB4C8',
  primary: '#2186D9',
  primaryDark: '#1565C0',
  primaryLight: '#70BDF2',
  primarySoft: '#163B59',
  success: '#22C55E',
  successSoft: '#103B2A',
  warning: '#F59E0B',
  warningSoft: '#493814',
  danger: '#EF4444',
  dangerSoft: '#48262A',
  disabled: '#6F879C',
  white: '#FFFFFF',
});

export const BLUETAP_LIGHT_PORTAL_COLORS = Object.freeze({
  ...BLUETAP_COLORS,
  header: BLUETAP_COLORS.primary,
  surfaceElevated: BLUETAP_COLORS.surface,
  input: BLUETAP_COLORS.surfaceAlt,
  navSurface: BLUETAP_COLORS.surface,
  navIcon: BLUETAP_COLORS.primary,
  navActive: BLUETAP_COLORS.primary,
});

export const BLUETAP_DARK_PORTAL_COLORS = Object.freeze({
  ...BLUETAP_DARK_COLORS,
  navSurface: BLUETAP_DARK_COLORS.surface,
  navIcon: BLUETAP_DARK_COLORS.primaryLight,
  navActive: BLUETAP_DARK_COLORS.primary,
});
