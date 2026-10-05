const { ROLE_THEME_TOKENS } = require('./rolePresentation');

export const BLUETAP_COLORS = Object.freeze({
  primary: '#187BCD',
  primaryAction: '#0B67AD',
  onPrimary: '#FFFFFF',
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
  success: '#167347', successSoft: '#E3F7EC', warning: '#A96800', warningSoft: '#FFF7E5', danger: '#B52F2F', dangerSoft: '#FCE9E8', disabled: '#A8BBCB',
  successAction: '#167347', onSuccess: '#FFFFFF', warningAction: '#A15F00', onWarning: '#FFFFFF', dangerAction: '#B52F2F', onDanger: '#FFFFFF', disabledText: '#526579',
  white: '#FFFFFF',
  iconPrimary: '#0B67AD', iconSecondary: '#12304A', iconOnPrimary: '#FFFFFF', iconMuted: '#64748B',
  iconDanger: '#B52F2F', iconWarning: '#A96800', iconSuccess: '#167347', iconInteractive: '#187BCD',
  ...ROLE_THEME_TOKENS.light,
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
  primaryAction: '#1565C0',
  onPrimary: '#FFFFFF',
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
  successAction: '#22C55E',
  onSuccess: '#07131F',
  warningAction: '#F59E0B',
  onWarning: '#07131F',
  dangerAction: '#B91C1C',
  onDanger: '#FFFFFF',
  disabledText: '#9FB4C8',
  white: '#FFFFFF',
  iconPrimary: '#70BDF2', iconSecondary: '#F5FAFF', iconOnPrimary: '#FFFFFF', iconMuted: '#9FB4C8',
  iconDanger: '#FB7185', iconWarning: '#FBBF24', iconSuccess: '#34D399', iconInteractive: '#70BDF2',
  ...ROLE_THEME_TOKENS.dark,
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
