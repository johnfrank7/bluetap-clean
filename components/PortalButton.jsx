/**
 * PortalButton — shared web-hover + native-pressed interaction primitive.
 *
 * WEB: hover elevation (box-shadow + translateY -1px), smooth CSS transition,
 *      focus-visible ring via :focus-visible (honoured by Expo web's CSS engine).
 * NATIVE: activeOpacity pressed feedback only. No extra packages required.
 *
 * Variants (maps to BlueTap semantic palette):
 *   'primary'     — BlueTap blue fill, white text
 *   'secondary'   — surface fill, primary border + text
 *   'success'     — green fill, white text (approve / deliver)
 *   'danger'      — red fill, white text (destructive / reject)
 *   'pill'        — borderless, inactive surface; active = primary fill
 *   'pill-active' — primary fill, white text (active pill state)
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

const IS_WEB = Platform.OS === 'web';

// Palette — intentionally does not import AdminTheme so this works in
// Requester / Distributor / Manager contexts that don't mount AdminTheme.
const PALETTE = {
  primary:    { bg: '#187BCD', hoverShadow: 'rgba(24,123,205,0.35)', text: '#fff' },
  secondary:  { bg: '#fff',    hoverShadow: 'rgba(24,123,205,0.18)', text: '#187BCD', border: '#B8D9F5' },
  success:    { bg: '#10B981', hoverShadow: 'rgba(16,185,129,0.35)', text: '#fff' },
  danger:     { bg: '#EF4444', hoverShadow: 'rgba(239,68,68,0.35)',  text: '#fff' },
  pill:       { bg: '#F0F4FA', hoverShadow: 'rgba(24,123,205,0.15)', text: '#374151', border: '#D1E4F7' },
  'pill-active': { bg: '#187BCD', hoverShadow: 'rgba(24,123,205,0.30)', text: '#fff' },
  ghost:      { bg: 'transparent', hoverShadow: 'rgba(24,123,205,0.12)', text: '#187BCD', border: '#B8D9F5' },
};

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

export function useButtonInteraction({ variant = 'primary', disabled = false } = {}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const palette = PALETTE[variant] || PALETTE.primary;
  const isElevated = IS_WEB && (hovered || focused) && !disabled;

  const interactionStyle = isElevated
    ? {
        boxShadow: focused
          ? `0 0 0 3px ${palette.hoverShadow}, 0 4px 12px ${palette.hoverShadow}`
          : `0 4px 12px ${palette.hoverShadow}`,
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
  // Resolve actual variant — pill can be overridden to pill-active
  const resolvedVariant = variant === 'pill' && active ? 'pill-active' : variant;
  const palette = PALETTE[resolvedVariant] || PALETTE.primary;
  const sizeStyle = SIZE[size] || SIZE.default;

  const { interactionStyle, handlers } = useButtonInteraction({
    variant: resolvedVariant,
    disabled,
  });

  const containerStyle = [
    BASE,
    sizeStyle,
    {
      backgroundColor: disabled ? '#CBD5E1' : palette.bg,
      ...(palette.border ? { borderWidth: 1, borderColor: palette.border } : {}),
    },
  ];

  const labelStyle = [
    {
      color: disabled ? '#94A3B8' : palette.text,
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
