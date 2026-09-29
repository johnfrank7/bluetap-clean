/**
 * PortalButton — shared web-hover + native-pressed interaction primitive.
 *
 * WEB: hover elevation (box-shadow + translateY -1px), smooth CSS transition,
 *      focus-visible ring via :focus-visible (honoured by Expo web's CSS engine).
 * NATIVE: activeOpacity pressed feedback only. No extra packages required.
 *
 * Variants (maps to BlueTap semantic palette):
 *   'primary'     — BlueTap action fill with its paired readable text color
 *   'secondary'   — surface fill, primary border + text
 *   'success'     — semantic success fill/text pair (approve / deliver)
 *   'danger'      — semantic danger fill/text pair (destructive / reject)
 *   'pill'        — borderless, inactive surface; active = primary fill
 *   'pill-active' — primary action fill/text pair (active pill state)
 *   'ghost'       — transparent, primary text/border (tertiary action)
 *
 * Usage:
 *   import PortalButton from '../../components/PortalButton';
 *   <PortalButton variant="primary" onPress={submit}>Submit</PortalButton>
 *   <PortalButton variant="danger"  onPress={reject}>Reject</PortalButton>
 *   <PortalButton variant="pill"    active={isSelected} onPress={…}>Label</PortalButton>
 *
 * Do NOT use for:
 *   - Status chips / badges (non-interactive)
 *   - Disabled-only states that should never hover
 *   - Card rows (use their own onPress)
 */
import React, { useState } from 'react';
import { Platform, Text, TouchableOpacity } from 'react-native';
import { useAdminTheme } from './AdminTheme';

const IS_WEB = Platform.OS === 'web';

// The shared theme context has safe defaults, so this palette also works in
// Requester and Distributor routes that do not mount a provider explicitly.
const paletteFor = (colors) => ({
  primary: { bg: colors.primaryAction, hoverShadow: 'rgba(24,123,205,0.35)', text: colors.onPrimary },
  secondary: { bg: colors.surface, hoverShadow: 'rgba(24,123,205,0.18)', text: colors.primaryLight || colors.primary, border: colors.inputBorder },
  success: { bg: colors.successAction, hoverShadow: 'rgba(16,185,129,0.35)', text: colors.onSuccess },
  danger: { bg: colors.dangerAction, hoverShadow: 'rgba(239,68,68,0.35)', text: colors.onDanger },
  pill: { bg: colors.surfaceAlt, hoverShadow: 'rgba(24,123,205,0.15)', text: colors.textPrimary, border: colors.border },
  'pill-active': { bg: colors.primaryAction, hoverShadow: 'rgba(24,123,205,0.30)', text: colors.onPrimary },
  ghost: { bg: 'transparent', hoverShadow: 'rgba(24,123,205,0.12)', text: colors.primaryLight || colors.primary, border: colors.inputBorder },
});

const BASE = {
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
};

const SIZE = {
  default: { minHeight: 44, paddingHorizontal: 18 },
  pill:    { minHeight: 36, paddingHorizontal: 14 },
  sm:      { minHeight: 38, paddingHorizontal: 14 },
};

export function useButtonInteraction({ variant = 'primary', disabled = false, palette } = {}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const variantPalette = palette[variant] || palette.primary;
  const isElevated = IS_WEB && (hovered || focused) && !disabled;

  const interactionStyle = isElevated
    ? {
        boxShadow: focused
          ? `0 0 0 3px ${variantPalette.hoverShadow}, 0 4px 12px ${variantPalette.hoverShadow}`
          : `0 4px 12px ${variantPalette.hoverShadow}`,
        transform: [{ translateY: -1 }],
        transition: 'box-shadow 0.16s ease, transform 0.16s ease',
        outline: 'none',
      }
    : IS_WEB
    ? { transition: 'box-shadow 0.16s ease, transform 0.16s ease', outline: 'none' }
    : {};

  const handlers = IS_WEB
    ? {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
      }
    : {};

  return { interactionStyle, handlers, isElevated, hovered, focused };
}

export default function PortalButton({
  children,
  variant = 'primary',
  size = 'default',
  active,          // for 'pill' — externally driven active state
  disabled = false,
  style,
  textStyle,
  onPress,
  ...rest
}) {
  const { colors } = useAdminTheme();
  const themePalette = paletteFor(colors);
  // Resolve actual variant — pill can be overridden to pill-active
  const resolvedVariant = variant === 'pill' && active ? 'pill-active' : variant;
  const palette = themePalette[resolvedVariant] || themePalette.primary;
  const sizeStyle = SIZE[size] || SIZE.default;

  const { interactionStyle, handlers } = useButtonInteraction({
    variant: resolvedVariant,
    disabled,
    palette: themePalette,
  });

  const containerStyle = [
    BASE,
    sizeStyle,
    {
      backgroundColor: disabled ? colors.neutral : palette.bg,
      ...(disabled ? { borderWidth: 1, borderColor: colors.border } : {}),
      ...(palette.border ? { borderWidth: 1, borderColor: palette.border } : {}),
    },
  ];

  const labelStyle = [
    {
      color: disabled ? colors.disabledText : palette.text,
      fontWeight: '800',
      fontSize: size === 'pill' ? 13 : 14,
    },
    textStyle,
  ];

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      {...handlers}
      style={[containerStyle, interactionStyle, style]}
      accessibilityRole="button"
      {...rest}
    >
      {typeof children === 'string' ? (
        <Text style={labelStyle}>{children}</Text>
      ) : (
        children
      )}
    </TouchableOpacity>
  );
}
