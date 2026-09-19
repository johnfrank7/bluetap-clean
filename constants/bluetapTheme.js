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
